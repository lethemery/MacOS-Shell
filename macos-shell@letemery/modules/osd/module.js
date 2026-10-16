// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OsdWindow from 'resource:///org/gnome/shell/ui/osdWindow.js';

import {_} from '../../lib/i18n.js';

const TRACK_WIDTH = 240;
const HIDE_TIMEOUT = 1500;
const FADE_IN_TIME = 140;
const FADE_OUT_TIME = 260;
const LEVEL_TIME = 100;
const MARGIN = 10;

const TITLES = [
    ['audio-volume', () => _('Sound')],
    ['audio-output', () => _('Sound')],
    ['audio-speakers', () => _('Sound')],
    ['audio-headphones', () => _('Sound')],
    ['audio-headset', () => _('Sound')],
    ['microphone', () => _('Microphone')],
    ['audio-input', () => _('Microphone')],
    ['display-brightness', () => _('Display')],
    ['keyboard-brightness', () => _('Keyboard')],
];

function iconNames(icon) {
    if (icon instanceof Gio.ThemedIcon)
        return icon.get_names();
    return [icon?.to_string?.() ?? ''];
}

class TahoeOsd {
    constructor(ctx, monitorIndex) {
        this._ctx = ctx;
        this.monitorIndex = monitorIndex;
        this._hideId = 0;

        this.actor = new St.BoxLayout({
            style_class: 'tahoe-osd',
            orientation: Clutter.Orientation.VERTICAL,
            visible: false,
            reactive: false,
        });

        const header = new St.BoxLayout({style_class: 'tahoe-osd-header'});
        this._title = new St.Label({style_class: 'tahoe-osd-title', y_align: Clutter.ActorAlign.CENTER});
        this._device = new St.Label({
            style_class: 'tahoe-osd-device',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._device.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        header.add_child(this._title);
        header.add_child(this._device);
        this.actor.add_child(header);

        this._track = new St.BoxLayout({style_class: 'tahoe-osd-track', width: TRACK_WIDTH});
        this._fill = new St.BoxLayout({style_class: 'tahoe-osd-fill', y_expand: true});
        this._icon = new St.Icon({style_class: 'tahoe-osd-icon', y_align: Clutter.ActorAlign.CENTER});
        this._fill.add_child(this._icon);
        this._track.add_child(this._fill);
        this.actor.add_child(this._track);

        Main.layoutManager.uiGroup.add_child(this.actor);
    }

    show(icon, label, level, maxLevel) {
        const names = iconNames(icon);
        const title = TITLES.find(([prefix]) => names.some(n => n.startsWith(prefix)))?.[1]();
        this._title.text = title ?? label ?? '';
        this._device.text = title && label ? label : '';
        this._device.visible = !!this._device.text;
        this._icon.gicon = icon;

        const max = maxLevel > 0 ? maxLevel : 1;
        const fraction = Math.max(0, Math.min(1, level / max));
        const trackHeight = this._track.height || 26;
        const width = Math.round(trackHeight + (TRACK_WIDTH - trackHeight) * fraction);

        this._ctx.applyAppearance(this.actor);
        const wasVisible = this.actor.visible && this.actor.opacity > 0;
        if (wasVisible) {
            this._fill.ease({width, duration: LEVEL_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this._fill.remove_all_transitions();
            this._fill.width = width;
            this._place();
            this.actor.remove_all_transitions();
            this.actor.set_pivot_point(0.5, 0.5);
            this.actor.opacity = 0;
            this.actor.set_scale(0.94, 0.94);
            this.actor.show();
            global.compositor.disable_unredirect();
            this._unredirectOff = true;
            this.actor.ease({
                opacity: 255,
                scale_x: 1,
                scale_y: 1,
                duration: FADE_IN_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
        Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);

        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_TIMEOUT, () => {
            this._hideId = 0;
            this.hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _place() {
        const monitor = Main.layoutManager.monitors[this.monitorIndex];
        if (!monitor)
            return;
        const [, width] = this.actor.get_preferred_width(-1);
        const [, height] = this.actor.get_preferred_height(width);
        let x, y;
        if (this._ctx.settings.get_string('osd-position') === 'bottom') {
            x = monitor.x + (monitor.width - width) / 2;
            y = monitor.y + monitor.height * 0.82 - height;
        } else {
            const rtl = Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;
            const panel = this.monitorIndex === Main.layoutManager.primaryIndex &&
                Main.layoutManager.panelBox.visible ? Main.layoutManager.panelBox.height : 0;
            x = rtl ? monitor.x + MARGIN : monitor.x + monitor.width - width - MARGIN;
            y = monitor.y + panel + MARGIN;
        }
        this.actor.set_position(Math.round(x), Math.round(y));
    }

    hide() {
        if (this._hideId) {
            GLib.source_remove(this._hideId);
            this._hideId = 0;
        }
        if (!this.actor.visible)
            return;
        this.actor.ease({
            opacity: 0,
            duration: FADE_OUT_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                this.actor.hide();
                this._enableUnredirect();
            },
        });
    }

    _enableUnredirect() {
        if (this._unredirectOff) {
            this._unredirectOff = false;
            global.compositor.enable_unredirect();
        }
    }

    destroy() {
        if (this._hideId)
            GLib.source_remove(this._hideId);
        this._hideId = 0;
        this.actor.remove_all_transitions();
        this._enableUnredirect();
        this.actor.destroy();
    }
}

export default class OsdModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    enable() {
        this._osds = [];
        this._injections = new InjectionManager();
        const module = this;
        const proto = OsdWindow.OsdWindowManager.prototype;

        this._injections.overrideMethod(proto, '_showOsdWindow', orig =>
            function (monitorIndex, icon, label, level, maxLevel) {
                if (level === null || level === undefined || !icon) {
                    module._osds[monitorIndex]?.hide();
                    orig.call(this, monitorIndex, icon, label, level, maxLevel);
                    return;
                }
                this._osdWindows[monitorIndex]?.cancel();
                module._osdFor(monitorIndex).show(icon, label, level, maxLevel);
            });
        this._injections.overrideMethod(proto, 'show', orig => function (icon, label, levels) {
            orig.call(this, icon, label, levels);
            module._osds.forEach((osd, i) => !levels[i] && osd?.hide());
        });
        this._injections.overrideMethod(proto, 'hideAll', orig => function () {
            orig.call(this);
            module._osds.forEach(osd => osd?.hide());
        });

        Main.layoutManager.connectObject('monitors-changed', () => this._destroyOsds(), this);
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._injections.clear();
        this._injections = null;
        this._destroyOsds();
        this._osds = null;
    }

    _osdFor(monitorIndex) {
        this._osds[monitorIndex] ??= new TahoeOsd(this._ctx, monitorIndex);
        return this._osds[monitorIndex];
    }

    _destroyOsds() {
        this._osds.forEach(osd => osd?.destroy());
        this._osds = [];
    }

    onAppearanceChanged() {
        this._osds?.forEach(osd => osd && this._ctx.applyAppearance(osd.actor));
    }
}
