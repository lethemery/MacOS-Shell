// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const SLIDE_IN_TIME = 380;
const SLIDE_OUT_TIME = 260;

const ALIGN = {
    'top-left': Clutter.ActorAlign.START,
    'top-center': Clutter.ActorAlign.CENTER,
    'top-right': Clutter.ActorAlign.END,
};

export default class NotificationsModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    onAppearanceChanged() {
        this._applyStyle();
    }

    enable() {
        this._ids = this._ctx.watch(['notifications-position', 'notifications-style-center'],
            () => this._applyStyle());

        this._tray = Main.messageTray;
        this._origAlignment = this._tray.bannerAlignment;
        this._dateMenuBox = Main.panel.statusArea.dateMenu?.menu.box ?? null;

        this._injections = new InjectionManager();
        this._injectAnimations();
        this._applyStyle();
    }

    disable() {
        this._ctx.unwatch(this._ids);
        this._injections.clear();
        this._injections = null;

        this._tray.bannerAlignment = this._origAlignment;
        this._tray._bannerBin.translation_x = 0;
        for (const c of ['tahoe-notifications', 'tahoe-light', 'tahoe-dark'])
            this._tray.remove_style_class_name(c);
        this._tray = null;

        if (this._dateMenuBox) {
            for (const c of ['tahoe-notification-center', 'tahoe-light', 'tahoe-dark'])
                this._dateMenuBox.remove_style_class_name(c);
            this._dateMenuBox = null;
        }
    }

    _applyStyle() {
        const s = this._ctx.settings;
        this._tray.bannerAlignment = ALIGN[s.get_string('notifications-position')] ?? Clutter.ActorAlign.END;
        this._tray.add_style_class_name('tahoe-notifications');
        this._ctx.applyAppearance(this._tray);

        if (this._dateMenuBox) {
            if (s.get_boolean('notifications-style-center')) {
                this._dateMenuBox.add_style_class_name('tahoe-notification-center');
                this._ctx.applyAppearance(this._dateMenuBox);
            } else {
                for (const c of ['tahoe-notification-center', 'tahoe-light', 'tahoe-dark'])
                    this._dateMenuBox.remove_style_class_name(c);
            }
        }
    }

    _slideDirection() {
        if (!this._ctx.settings.get_boolean('notifications-slide'))
            return 0;
        const pos = this._ctx.settings.get_string('notifications-position');
        if (pos === 'top-right')
            return Clutter.get_default_text_direction() === Clutter.TextDirection.RTL ? 0 : 1;
        if (pos === 'top-left')
            return -1;
        return 0;
    }

    _slideDistance(tray) {
        const [, natWidth] = tray._banner?.get_preferred_width(-1) ?? [0, 400];
        return natWidth + 60;
    }

    _injectAnimations() {
        const ext = this;
        const {State, ANIMATION_TIME} = MessageTray;
        const proto = MessageTray.MessageTray.prototype;

        this._injections.overrideMethod(proto, '_updateShowingNotification', orig => function (...args) {
            const dir = ext._slideDirection();
            const fresh = this._notificationState !== State.SHOWN &&
                this._notificationState !== State.SHOWING;
            const bin = this._bannerBin;

            if (dir !== 0 && fresh) {
                bin.y = 0;
                bin.translation_x = dir * ext._slideDistance(this);
            }
            orig.apply(this, args);
            if (dir !== 0 && fresh) {
                bin.ease({
                    translation_x: 0,
                    duration: SLIDE_IN_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_EXPO,
                });
            }
        });

        this._injections.overrideMethod(proto, '_hideNotification', orig => function (animate) {
            const dir = ext._slideDirection();
            if (dir === 0 || !this._banner || typeof this._resetNotificationLeftTimeout !== 'function' ||
                typeof this._hideNotificationCompleted !== 'function') {
                orig.call(this, animate);
                return;
            }

            this._notificationFocusGrabber.ungrabFocus();
            this._banner.disconnectObject(this);
            this._resetNotificationLeftTimeout();

            const bin = this._bannerBin;
            bin.remove_all_transitions();
            this._notificationState = State.HIDING;

            const duration = animate ? SLIDE_OUT_TIME : 0;
            bin.ease({
                opacity: 0,
                duration: animate ? ANIMATION_TIME : 0,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
            bin.ease({
                translation_x: dir * ext._slideDistance(this),
                duration,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC,
                onStopped: () => {
                    bin.translation_x = 0;
                    this._notificationState = State.HIDDEN;
                    this._hideNotificationCompleted();
                    this._updateState();
                },
            });
        });
    }
}
