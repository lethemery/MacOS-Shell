// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {_} from '../../lib/i18n.js';
import {TahoeWidget, MEDIUM_W, SMALL, drawRing} from './widgets.js';

const SLOTS = 4;
const GREEN = [0.20, 0.78, 0.35];
const ORANGE = [1.0, 0.62, 0.04];
const RED = [1.0, 0.23, 0.19];

const UPowerIface = `
<node>
  <interface name="org.freedesktop.UPower">
    <method name="EnumerateDevices"><arg name="devices" direction="out" type="ao"/></method>
    <signal name="DeviceAdded"><arg name="device" type="o"/></signal>
    <signal name="DeviceRemoved"><arg name="device" type="o"/></signal>
  </interface>
</node>`;
const UPowerDeviceIface = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Type" type="u" access="read"/>
    <property name="State" type="u" access="read"/>
    <property name="Percentage" type="d" access="read"/>
    <property name="IsPresent" type="b" access="read"/>
    <property name="PowerSupply" type="b" access="read"/>
    <property name="Model" type="s" access="read"/>
  </interface>
</node>`;
const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPowerIface);
const DeviceProxy = Gio.DBusProxy.makeProxyWrapper(UPowerDeviceIface);

const TYPE_ICONS = {
    2: 'computer-symbolic',
    3: 'uninterruptible-power-supply-symbolic',
    5: 'input-mouse-symbolic',
    6: 'input-keyboard-symbolic',
    8: 'phone-symbolic',
    12: 'input-tablet-symbolic',
    13: 'computer-symbolic',
    14: 'input-gaming-symbolic',
    15: 'input-tablet-symbolic',
    16: 'input-touchpad-symbolic',
    19: 'audio-headset-symbolic',
    20: 'audio-speakers-symbolic',
    21: 'audio-headphones-symbolic',
    25: 'printer-symbolic',
    27: 'camera-photo-symbolic',
    28: 'watch-symbolic',
};
const LINE_POWER = 1;
const STATE_CHARGING = 1;

export const BatteriesWidget = GObject.registerClass(
class TahoeBatteriesWidget extends TahoeWidget {
    _init(dark) {
        super._init('battery', MEDIUM_W, SMALL, dark);
        this.add_style_class_name('tahoe-widget-batteries');

        const box = new St.BoxLayout({
            style_class: 'tahoe-widget-content tahoe-batteries-row',
            x_expand: true,
            y_expand: true,
        });
        this.add_child(box);

        this._slots = [];
        for (let i = 0; i < SLOTS; i++) {
            const col = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const bin = new St.Widget({layout_manager: new Clutter.BinLayout()});
            const area = new St.DrawingArea({
                width: 70, height: 70,
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
            });
            const icon = new St.Icon({
                icon_size: 26,
                style_class: 'tahoe-batteries-icon',
                x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
            });
            const label = new St.Label({style_class: 'tahoe-batteries-percent', x_align: Clutter.ActorAlign.CENTER});
            bin.add_child(area);
            bin.add_child(icon);
            col.add_child(bin);
            col.add_child(label);
            box.add_child(col);

            const slot = {area, icon, label, device: null};
            area.connect('repaint', a => this._drawSlot(a, slot));
            this._slots.push(slot);
        }

        this._devices = new Map();
        this._sync();

        new UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower', '/org/freedesktop/UPower',
            (proxy, error) => {
                if (error || this._destroyed)
                    return;
                this._upower = proxy;
                this._signalIds = [
                    proxy.connectSignal('DeviceAdded', () => this._enumerate()),
                    proxy.connectSignal('DeviceRemoved', () => this._enumerate()),
                ];
                this._enumerate();
            });

        this.connect('destroy', () => {
            this._destroyed = true;
            this._signalIds?.forEach(id => this._upower.disconnectSignal(id));
            for (const proxy of this._devices.values())
                proxy.disconnectObject?.(this);
            this._devices.clear();
        });
    }

    _enumerate() {
        this._upower.EnumerateDevicesRemote(([paths], error) => {
            if (error || this._destroyed)
                return;
            for (const [path, proxy] of this._devices) {
                if (!paths.includes(path)) {
                    proxy.disconnectObject?.(this);
                    this._devices.delete(path);
                }
            }
            for (const path of paths) {
                if (this._devices.has(path))
                    continue;
                new DeviceProxy(Gio.DBus.system, 'org.freedesktop.UPower', path, (proxy, err) => {
                    if (err || this._destroyed)
                        return;
                    this._devices.set(path, proxy);
                    proxy.connectObject('g-properties-changed', () => this._sync(), this);
                    this._sync();
                });
            }
            this._sync();
        });
    }

    _visibleDevices() {
        const devices = [...this._devices.values()].filter(d =>
            d.Type !== LINE_POWER && d.IsPresent !== false && d.Percentage > 0);
        devices.sort((a, b) => (b.PowerSupply ? 1 : 0) - (a.PowerSupply ? 1 : 0));
        return devices.slice(0, SLOTS);
    }

    _sync() {
        const devices = this._visibleDevices();
        this._slots.forEach((slot, i) => {
            const device = devices[i] ?? null;
            slot.device = device;
            if (device) {
                slot.icon.icon_name = TYPE_ICONS[device.Type] ?? 'battery-symbolic';
                slot.icon.opacity = 255;
                slot.label.text = `${Math.round(device.Percentage)}%`;
            } else {
                slot.icon.icon_name = i === 0 && devices.length === 0 ? 'ac-adapter-symbolic' : '';
                slot.icon.opacity = 90;
                slot.label.text = i === 0 && devices.length === 0 ? _('No battery') : '';
            }
            slot.area.queue_repaint();
        });
    }

    _drawSlot(area, slot) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const d = slot.device;
        const pct = d ? d.Percentage / 100 : 0;
        const charging = d?.State === STATE_CHARGING;
        const color = !d ? GREEN : pct <= 0.1 && !charging ? RED : pct <= 0.2 && !charging ? ORANGE : GREEN;
        drawRing(cr, w / 2, h / 2, Math.min(w, h) / 2 - 5, 6, pct, color, this.dark);
        cr.$dispose();
    }
});
