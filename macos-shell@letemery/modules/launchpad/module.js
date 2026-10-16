// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Launchpad} from './launchpad.js';

const KEYBINDINGS_SCHEMA = 'org.gnome.shell.keybindings';
const APP_VIEW_KEY = 'toggle-application-view';

export default class LaunchpadModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    enable() {
        this._launchpad = new Launchpad(this._ctx);
        const launchpad = this._launchpad;

        this._injections = new InjectionManager();
        this._injections.overrideMethod(Main.overview, 'showApps', () => function () {
            launchpad.open();
        });

        Main.wm.removeKeybinding(APP_VIEW_KEY);
        Main.wm.addKeybinding(APP_VIEW_KEY, new Gio.Settings({schema_id: KEYBINDINGS_SCHEMA}),
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => launchpad.toggle());

        this._a11y = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.keyboard'});
        this._ids = this._ctx.watch(['launchpad-super-key'], () => this._syncSuperKey());
        this._syncSuperKey();
    }

    disable() {
        this._ctx.unwatch(this._ids);
        this._releaseSuperKey();

        Main.wm.removeKeybinding(APP_VIEW_KEY);
        const controls = Main.overview._overview?.controls;
        if (controls?._toggleAppsPage) {
            Main.wm.addKeybinding(APP_VIEW_KEY, new Gio.Settings({schema_id: KEYBINDINGS_SCHEMA}),
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                controls._toggleAppsPage.bind(controls));
        }

        this._injections.clear();
        this._injections = null;
        this._launchpad.destroy();
        this._launchpad = null;
        this._a11y = null;
    }

    // The Super key: GNOME's own handler (the overview) is blocked while
    // ours runs.
    _syncSuperKey() {
        if (this._ctx.settings.get_boolean('launchpad-super-key'))
            this._takeSuperKey();
        else
            this._releaseSuperKey();
    }

    _takeSuperKey() {
        if (this._superId)
            return;
        this._blockedSuper = GObject.signal_handler_find(global.display, {signalId: 'overlay-key'});
        if (this._blockedSuper)
            GObject.signal_handler_block(global.display, this._blockedSuper);
        this._superId = global.display.connect('overlay-key', () => {
            if (this._a11y.get_boolean('stickykeys-enable') || this._launchpad.justClosed)
                return;
            this._launchpad.toggle();
        });
    }

    _releaseSuperKey() {
        if (this._superId) {
            global.display.disconnect(this._superId);
            this._superId = 0;
        }
        if (this._blockedSuper) {
            GObject.signal_handler_unblock(global.display, this._blockedSuper);
            this._blockedSuper = 0;
        }
    }

    onLanguageChanged() {
        this._launchpad?.onLanguageChanged();
    }
}
