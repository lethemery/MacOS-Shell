// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import {ScreenShield} from 'resource:///org/gnome/shell/ui/screenShield.js';
import {UnlockDialog} from 'resource:///org/gnome/shell/ui/unlockDialog.js';

import {formatLongDate, formatTime} from '../../lib/i18n.js';

const BLUR_RADIUS = 90;
const BLUR_BRIGHTNESS = 0.65;
const FADE_OUT_TRANSLATION = 200;
const AVATAR_SIZES = ['small', 'medium', 'large'];
const UNLOCK_TIME = 420;
const UNLOCK_SCALE = 1.08;
const DESKTOP_START_SCALE = 0.94;

const LockClock = GObject.registerClass(
class TahoeLockClock extends St.Widget {
    _init(settings) {
        super._init({
            reactive: false,
            layout_manager: new Clutter.BinLayout(),
            style_class: 'tahoe-lock-overlay',
        });
        this.add_constraint(new Layout.MonitorConstraint({primary: true}));
        this._settings = settings;

        this._box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
            x_expand: true,
            y_expand: true,
        });
        this._date = new St.Label({style_class: 'tahoe-lock-date', x_align: Clutter.ActorAlign.CENTER});
        this._time = new St.Label({style_class: 'tahoe-lock-time', x_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._date);
        this._box.add_child(this._time);
        this.add_child(this._box);

        this.connect('notify::height', () => {
            this._box.style = `padding-top: ${Math.round(this.height * 0.07)}px;`;
        });
        this.connect('destroy', () => {
            if (this._timeout)
                GLib.source_remove(this._timeout);
            this._timeout = 0;
        });
        this.sync();
    }

    sync() {
        this._box.opacity = Math.round(this._settings.get_int('lockscreen-clock-opacity') * 2.55);
        const weight = this._settings.get_string('lockscreen-clock-weight');
        this._time.style_class = `tahoe-lock-time tahoe-lock-${weight}`;
        this._date.visible = this._settings.get_boolean('lockscreen-show-date');
        this._tick();
    }

    _tick() {
        if (this._timeout)
            GLib.source_remove(this._timeout);

        const now = GLib.DateTime.new_now_local();
        this._date.text = formatLongDate(now);
        this._time.text = formatTime(now).replace(/\s?[AP]M$/i, '');

        const ms = (60 - now.get_second()) * 1000 - Math.floor(now.get_microsecond() / 1000);
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(ms, 50), () => {
            this._timeout = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }
});

export default class LockscreenModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    onLanguageChanged() {
        this._clock?.sync();
    }

    enable() {
        this._ids = [
            ...this._ctx.watch(['lockscreen-show-date', 'lockscreen-clock-weight', 'lockscreen-clock-opacity'],
                () => this._clock?.sync()),
            ...this._ctx.watch(['lockscreen-avatar-size'], () => this._syncAvatar()),
            ...this._ctx.watch(['lockscreen-blur', 'lockscreen-prompt-bottom', 'lockscreen-prompt-margin'],
                () => this._refresh()),
        ];

        this._injections = new InjectionManager();
        const ext = this;

        this._injections.overrideMethod(ScreenShield.prototype, '_ensureUnlockDialog',
            orig => function (...args) {
                const ret = orig.apply(this, args);
                if (this._dialog)
                    ext._decorate(this._dialog);
                return ret;
            });

        this._injections.overrideMethod(ScreenShield.prototype, '_continueDeactivate',
            orig => function (animate, ...rest) {
                if (!animate || !ext._ctx.settings.get_boolean('lockscreen-unlock-animation'))
                    return orig.call(this, animate, ...rest);

                const group = this._lockDialogGroup;
                const ownEase = Object.prototype.hasOwnProperty.call(group, 'ease');
                const ease = group.ease;
                group.ease = function (params) {
                    if (!('translation_y' in params))
                        return ease.call(this, params);
                    const {translation_y: _, duration: __, mode: ___, ...rest2} = params;
                    return ease.call(this, {
                        ...rest2,
                        opacity: 0,
                        scale_x: UNLOCK_SCALE,
                        scale_y: UNLOCK_SCALE,
                        duration: UNLOCK_TIME,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                };
                try {
                    const ret = orig.call(this, animate, ...rest);
                    // Windows are hidden while locked and the original call
                    // shows them again; Clutter does not animate hidden actors.
                    ext._zoomInDesktop();
                    return ret;
                } finally {
                    if (ownEase)
                        group.ease = ease;
                    else
                        delete group.ease;
                }
            });

        this._injections.overrideMethod(ScreenShield.prototype, '_resetLockScreen',
            orig => function (...args) {
                this._lockDialogGroup.set({opacity: 255, scale_x: 1, scale_y: 1});
                return orig.apply(this, args);
            });

        this._injections.overrideMethod(UnlockDialog.prototype, '_setTransitionProgress',
            orig => function (progress) {
                orig.call(this, progress);
                if (this === ext._dialog)
                    ext._onProgress(progress);
            });

        this._injections.overrideMethod(UnlockDialog.prototype, '_updateBackgroundEffects',
            orig => function (...args) {
                orig.apply(this, args);
                if (this === ext._dialog)
                    ext._applyBlur();
            });

        const dialog = Main.screenShield?._dialog;
        if (dialog)
            this._decorate(dialog);
    }

    disable() {
        this._ctx.unwatch(this._ids);
        this._injections.clear();
        this._injections = null;
        this._undecorate();
    }

    _progress() {
        return this._dialog?._adjustment?.value ?? 0;
    }

    _decorate(dialog) {
        if (this._dialog === dialog)
            return;
        this._undecorate();
        this._dialog = dialog;

        dialog.add_style_class_name('tahoe-lockscreen');
        this._syncAvatar();

        dialog._clock?._time?.hide();
        dialog._clock?._date?.hide();

        // macOS shows no clock in the bar on the lock screen. The panel shows
        // its items again whenever the session mode changes, so re-hide it.
        this._panelClock = Main.panel.statusArea.dateMenu?.container ?? null;
        this._panelClock?.hide();
        Main.sessionMode.connectObject('updated', () => {
            if (this._dialog)
                this._panelClock?.hide();
        }, this);

        this._clock = new LockClock(this._ctx.settings);
        const parent = dialog.get_parent();
        parent.insert_child_above(this._clock, dialog);
        dialog.bind_property('visible', this._clock, 'visible', GObject.BindingFlags.SYNC_CREATE);
        dialog.bind_property('opacity', this._clock, 'opacity', GObject.BindingFlags.SYNC_CREATE);

        dialog.connectObject('destroy', () => {
            this._clock?.destroy();
            this._clock = null;
            Main.sessionMode.disconnectObject(this);
            this._panelClock?.show();
            this._panelClock = null;
            this._dialog = null;
        }, this);
        dialog._stack?.connectObject('notify::allocation', () => this._onProgress(this._progress()), this);

        this._refresh();
    }

    _undecorate() {
        const dialog = this._dialog;
        this._clock?.destroy();
        this._clock = null;
        Main.sessionMode.disconnectObject(this);
        this._panelClock?.show();
        this._panelClock = null;
        if (!dialog)
            return;

        dialog.disconnectObject(this);
        dialog._stack?.disconnectObject(this);
        dialog.remove_style_class_name('tahoe-lockscreen');
        for (const size of AVATAR_SIZES)
            dialog.remove_style_class_name(`tahoe-avatar-${size}`);
        dialog._clock?._time?.show();
        dialog._clock?._date?.show();
        this._dialog = null;

        dialog._setTransitionProgress?.(dialog._adjustment?.value ?? 0);
        dialog._updateBackgroundEffects?.();
    }

    // GNOME reads the avatar size from the icon-size CSS property.
    _syncAvatar() {
        if (!this._dialog)
            return;
        const wanted = this._ctx.settings.get_string('lockscreen-avatar-size');
        for (const size of AVATAR_SIZES) {
            if (size === wanted)
                this._dialog.add_style_class_name(`tahoe-avatar-${size}`);
            else
                this._dialog.remove_style_class_name(`tahoe-avatar-${size}`);
        }
    }

    _zoomInDesktop() {
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            if (!win || win.minimized || !actor.visible)
                continue;
            const monitor = Main.layoutManager.monitors[win.get_monitor()];
            if (!monitor || actor.width <= 0 || actor.height <= 0)
                continue;
            const pivotX = (monitor.x + monitor.width / 2 - actor.x) / actor.width;
            const pivotY = (monitor.y + monitor.height / 2 - actor.y) / actor.height;
            actor.remove_transition('scale-x');
            actor.remove_transition('scale-y');
            actor.set_pivot_point(pivotX, pivotY);
            actor.set_scale(DESKTOP_START_SCALE, DESKTOP_START_SCALE);
            actor.ease({
                scale_x: 1,
                scale_y: 1,
                duration: UNLOCK_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onStopped: () => {
                    actor.set_scale(1, 1);
                    actor.set_pivot_point(0, 0);
                },
            });
        }
    }

    _refresh() {
        if (!this._dialog)
            return;
        this._onProgress(this._progress());
    }

    _onProgress(progress) {
        const dialog = this._dialog;
        if (!dialog)
            return;

        // GNOME sets the prompt's translation from the progress; recompute it
        // from scratch so repeated calls do not accumulate.
        if (dialog._stack && dialog._promptBox) {
            const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
            let translation = FADE_OUT_TRANSLATION * (1 - progress) * scaleFactor;

            if (this._ctx.settings.get_boolean('lockscreen-prompt-bottom')) {
                const box = dialog._stack.get_allocation_box();
                const [, promptHeight] = dialog._promptBox.get_preferred_height(box.x2 - box.x1);
                const height = dialog.height;
                if (height > 0 && promptHeight > 0) {
                    const margin = height * this._ctx.settings.get_int('lockscreen-prompt-margin') / 100;
                    const target = Math.max(height * 0.45, height - promptHeight - margin);
                    translation += Math.max(0, target - box.y1);
                }
            }
            dialog._promptBox.translation_y = translation;
        }

        this._applyBlur(progress);
    }

    _applyBlur(progress = this._progress()) {
        const dialog = this._dialog;
        if (!dialog?._backgroundGroup)
            return;
        const mode = this._ctx.settings.get_string('lockscreen-blur');
        let amount;
        if (mode === 'always')
            amount = 1;
        else if (mode === 'never')
            amount = 0;
        else
            amount = Math.max(0, Math.min(1, progress));

        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        for (const widget of dialog._backgroundGroup) {
            const effect = widget.get_effect('blur');
            if (!effect)
                continue;
            effect.set({
                radius: BLUR_RADIUS * scaleFactor * amount,
                brightness: 1 - (1 - BLUR_BRIGHTNESS) * amount,
            });
            effect.enabled = amount > 0.01;
        }
    }
}
