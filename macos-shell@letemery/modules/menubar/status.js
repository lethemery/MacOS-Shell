// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_, format} from '../../lib/i18n.js';
import {populateOnOpen} from './appmenus.js';

export function fileIcon(dir, name) {
    return Gio.FileIcon.new(dir.get_child('icons').get_child(`${name}.svg`));
}

function launch(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (e) {
        console.warn(`[macos-shell] ${argv[0]}: ${e.message}`);
    }
}

function headerItem(text) {
    const item = new PopupMenu.PopupMenuItem(text, {reactive: false, can_focus: false});
    item.add_style_class_name('tahoe-menu-header');
    return item;
}

const UPowerDeviceIface = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Type" type="u" access="read"/>
    <property name="State" type="u" access="read"/>
    <property name="Percentage" type="d" access="read"/>
    <property name="IsPresent" type="b" access="read"/>
    <property name="TimeToEmpty" type="x" access="read"/>
    <property name="TimeToFull" type="x" access="read"/>
  </interface>
</node>`;
const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPowerDeviceIface);

const STATE_CHARGING = 1;
const STATE_FULL = 4;

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    return format(_('{h}:{m}'), {h, m: String(m).padStart(2, '0')});
}

export const BatteryButton = GObject.registerClass(
class TahoeBatteryButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.5, _('Battery'));
        this.add_style_class_name('tahoe-status-button');
        this.menu.actor.add_style_class_name('tahoe-menu');
        this._settings = settings;

        const box = new St.BoxLayout({style_class: 'tahoe-battery-box', y_align: Clutter.ActorAlign.CENTER});
        this._percent = new St.Label({style_class: 'tahoe-battery-label', y_align: Clutter.ActorAlign.CENTER});
        this._area = new St.DrawingArea({
            style_class: 'tahoe-battery-icon',
            width: 27,
            height: 13,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._area.connect('repaint', a => this._draw(a));
        this._area.connect('style-changed', () => this._area.queue_repaint());
        box.add_child(this._percent);
        box.add_child(this._area);
        this.add_child(box);

        this.visible = false;
        this._level = 0;
        this._state = 0;

        this._settingsId = settings.connect('changed::menubar-battery-percent', () => this._sync());
        new UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice', (proxy, error) => {
                if (error || this._destroyed)
                    return;
                this._proxy = proxy;
                this._proxyId = proxy.connect('g-properties-changed', () => this._sync());
                this._sync();
            });

        // GNOME refuses to open an empty menu, so fill it right before opening.
        populateOnOpen(this.menu, () => this._buildMenu());
        this.connect('destroy', () => {
            this._destroyed = true;
            this._settings.disconnect(this._settingsId);
            if (this._proxy && this._proxyId)
                this._proxy.disconnect(this._proxyId);
        });
    }

    _sync() {
        const p = this._proxy;
        const present = p && p.IsPresent && p.Type === 2;
        this.visible = !!present;
        if (!present)
            return;
        this._level = Math.round(p.Percentage);
        this._state = p.State;
        this._percent.text = `${this._level}%`;
        this._percent.visible = this._settings.get_boolean('menubar-battery-percent');
        this._area.queue_repaint();
    }

    _buildMenu() {
        const m = this.menu;
        m.removeAll();
        const p = this._proxy;
        if (!p)
            return;
        const charging = p.State === STATE_CHARGING;
        const full = p.State === STATE_FULL;

        m.addMenuItem(headerItem(format(_('Battery {percent}%'), {percent: this._level})));
        let source = _('Power Source: Battery');
        if (charging || full)
            source = _('Power Source: Power Adapter');
        m.addMenuItem(headerItem(source));
        if (charging && p.TimeToFull > 0)
            m.addMenuItem(headerItem(format(_('{time} until fully charged'), {time: formatDuration(p.TimeToFull)})));
        else if (!charging && !full && p.TimeToEmpty > 0)
            m.addMenuItem(headerItem(format(_('{time} remaining'), {time: formatDuration(p.TimeToEmpty)})));

        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const percentItem = new PopupMenu.PopupSwitchMenuItem(_('Show Percentage'),
            this._settings.get_boolean('menubar-battery-percent'));
        percentItem.connect('toggled', (_i, state) => this._settings.set_boolean('menubar-battery-percent', state));
        m.addMenuItem(percentItem);
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        m.addAction(_('Battery Settings…'), () => launch(['gnome-control-center', 'power']));
    }

    _draw(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const fg = area.get_theme_node().get_foreground_color();
        const rgb = [fg.red / 255, fg.green / 255, fg.blue / 255];
        const charging = this._state === STATE_CHARGING || this._state === STATE_FULL;

        const roundRect = (x, y, rw, rh, r) => {
            cr.newSubPath();
            cr.arc(x + rw - r, y + r, r, -Math.PI / 2, 0);
            cr.arc(x + rw - r, y + rh - r, r, 0, Math.PI / 2);
            cr.arc(x + r, y + rh - r, r, Math.PI / 2, Math.PI);
            cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
            cr.closePath();
        };

        const bodyW = w - 3;
        cr.setSourceRGBA(...rgb, 0.45);
        cr.setLineWidth(1);
        roundRect(0.5, 0.5, bodyW - 1, h - 1, 3.5);
        cr.stroke();
        roundRect(bodyW + 0.5, h / 2 - 2.25, 2, 4.5, 1);
        cr.fill();
        const low = this._level <= 10 && !charging;
        if (low)
            cr.setSourceRGBA(1, 0.23, 0.19, 1);
        else
            cr.setSourceRGBA(...rgb, 1);
        const inner = Math.max(2.5, (bodyW - 4) * Math.min(1, this._level / 100));
        roundRect(2, 2, inner, h - 4, 2);
        cr.fill();

        if (charging) {
            const cx = bodyW / 2, cy = h / 2;
            const bolt = () => {
                cr.moveTo(cx + 1.2, cy - 5.2);
                cr.lineTo(cx - 3, cy + 0.8);
                cr.lineTo(cx - 0.2, cy + 0.8);
                cr.lineTo(cx - 1.2, cy + 5.2);
                cr.lineTo(cx + 3, cy - 0.8);
                cr.lineTo(cx + 0.2, cy - 0.8);
                cr.closePath();
            };
            cr.setOperator(0);
            cr.setLineWidth(2.2);
            bolt();
            cr.strokePreserve();
            cr.setOperator(2);
            cr.setSourceRGBA(...rgb, 1);
            cr.fill();
        }
        cr.$dispose();
    }
});

function wifiLevel(iconName) {
    if (!iconName)
        return null;
    if (iconName.startsWith('network-wireless')) {
        if (/excellent|good/.test(iconName))
            return 3;
        if (/-ok/.test(iconName))
            return 2;
        if (/weak|none/.test(iconName))
            return 1;
        if (/acquiring/.test(iconName))
            return 0;
        return 'off';
    }
    return null;
}

export const WifiButton = GObject.registerClass(
class TahoeWifiButton extends PanelMenu.Button {
    _init(dir) {
        super._init(0.5, _('Wi‑Fi'));
        this.add_style_class_name('tahoe-status-button');
        this.menu.actor.add_style_class_name('tahoe-menu');
        this._dir = dir;

        this._icon = new St.Icon({style_class: 'system-status-icon tahoe-status-icon'});
        this.add_child(this._icon);
        this.visible = false;

        // GNOME refuses to open an empty menu, so fill it right before opening.
        populateOnOpen(this.menu, () => this._buildMenu());

        this._waitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => this._attach());
        this.connect('destroy', () => {
            if (this._waitId)
                GLib.source_remove(this._waitId);
            this._waitId = 0;
            this._source?.disconnectObject(this);
        });
    }

    get _network() {
        return Main.panel.statusArea.quickSettings?._network ?? null;
    }

    _attach() {
        const source = this._network?._primaryIndicator;
        if (!source) {
            // Quick settings are set up asynchronously; try again shortly.
            this._waitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => this._attach());
            return GLib.SOURCE_REMOVE;
        }
        this._waitId = 0;
        this._source = source;
        source.connectObject(
            'notify::icon-name', () => this._sync(),
            'notify::visible', () => this._sync(), this);
        this._sync();
        return GLib.SOURCE_REMOVE;
    }

    _sync() {
        const level = this._source?.visible ? wifiLevel(this._source.icon_name) : null;
        const wifiOff = this._network?._client && !this._network._client.wireless_enabled;
        if (level === null && !wifiOff) {
            this.visible = false;
            return;
        }
        this.visible = true;
        const name = wifiOff || level === 'off' ? 'tahoe-wifi-off-symbolic' : `tahoe-wifi-${level}-symbolic`;
        this._icon.gicon = fileIcon(this._dir, name);
    }

    _buildMenu() {
        const m = this.menu;
        m.removeAll();
        const network = this._network;
        const client = network?._client;

        if (client) {
            const toggle = new PopupMenu.PopupSwitchMenuItem(_('Wi‑Fi'), client.wireless_enabled);
            toggle.add_style_class_name('tahoe-menu-header');
            toggle.connect('toggled', (_i, state) => {
                client.wireless_enabled = state;
            });
            m.addMenuItem(toggle);

            const ssid = client.get_active_connections()
                .filter(c => c.get_connection_type() === '802-11-wireless')
                .map(c => c.get_id())[0];
            if (ssid) {
                m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Known Network')));
                const item = new PopupMenu.PopupImageMenuItem(ssid, fileIcon(this._dir, 'tahoe-wifi-3-symbolic'));
                item.setOrnament(PopupMenu.Ornament.CHECK);
                m.addMenuItem(item);
            }
        }

        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        m.addAction(_('Other Networks…'), () => {
            const qs = Main.panel.statusArea.quickSettings;
            qs?.menu.open();
            network?._wirelessToggle?.menu?.open();
        });
        m.addAction(_('Wi‑Fi Settings…'), () => launch(['gnome-control-center', 'wifi']));
    }
});

const PRIVACY = [
    ['_volumeInput', 'mic'],
    ['_camera', 'camera'],
    ['_remoteAccess', 'screen'],
    ['_location', 'location'],
];

export class ControlCenter {
    constructor(dir) {
        this._qs = Main.panel.statusArea.quickSettings;
        if (!this._qs?._indicators)
            return;

        this._box = new St.BoxLayout({
            style_class: 'tahoe-control-center',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._dots = new St.BoxLayout({style_class: 'tahoe-privacy-dots', y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._dots);
        this._box.add_child(new St.Icon({
            gicon: fileIcon(dir, 'tahoe-control-center-symbolic'),
            style_class: 'system-status-icon tahoe-status-icon',
        }));

        // PanelMenu.ButtonBox only lays out its first child.
        this._qs.insert_child_at_index(this._box, 0);
        this._qs._indicators.hide();
        this._qs.add_style_class_name('tahoe-control-center-button');
        this._qs.menu.actor.add_style_class_name('tahoe-control-center-menu');

        for (const [field, kind] of PRIVACY) {
            const indicator = this._qs[field];
            if (!indicator)
                continue;
            const dot = new St.Widget({style_class: `tahoe-privacy-dot ${kind}`, y_align: Clutter.ActorAlign.CENTER});
            this._dots.add_child(dot);
            indicator.connectObject('notify::visible', () => {
                dot.visible = indicator.visible;
            }, this);
            dot.visible = indicator.visible;
        }
    }

    destroy() {
        if (!this._box)
            return;
        for (const [field] of PRIVACY)
            this._qs[field]?.disconnectObject(this);
        this._box.destroy();
        this._box = null;
        this._qs._indicators.show();
        this._qs.remove_style_class_name('tahoe-control-center-button');
        this._qs.menu.actor.remove_style_class_name('tahoe-control-center-menu');
    }
}
