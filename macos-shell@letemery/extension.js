// SPDX-License-Identifier: GPL-2.0-or-later

import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {TahoeContext} from './lib/context.js';
import MenubarModule from './modules/menubar/module.js';
import DockModule from './modules/dock/module.js';
import WidgetsModule from './modules/widgets/module.js';
import NotificationsModule from './modules/notifications/module.js';
import LockscreenModule from './modules/lockscreen/module.js';
import SpotlightModule from './modules/spotlight/module.js';
import OsdModule from './modules/osd/module.js';
import WindowButtonsModule from './modules/windowbuttons/module.js';
import AnimationsModule from './modules/animations/module.js';
import ShakeCursorModule from './modules/shakecursor/module.js';
import LaunchpadModule from './modules/launchpad/module.js';
import DialogsModule from './modules/dialogs/module.js';

// Order matters: the menu bar must exist before Spotlight adds its button.
const MODULES = [
    ['menubar', MenubarModule],
    ['dock', DockModule],
    ['widgets', WidgetsModule],
    ['notifications', NotificationsModule],
    ['lockscreen', LockscreenModule],
    ['spotlight', SpotlightModule],
    ['osd', OsdModule],
    ['windowbuttons', WindowButtonsModule],
    ['animations', AnimationsModule],
    ['shakecursor', ShakeCursorModule],
    ['launchpad', LaunchpadModule],
    ['dialogs', DialogsModule],
];

// Modules that keep running on the lock screen. Window buttons stay so the
// title bar layout is not flipped back and forth on every lock.
const LOCK_SCREEN_MODULES = new Set(['lockscreen', 'osd', 'windowbuttons']);

export default class MacOSTahoeExtension extends Extension {
    enable() {
        this._ctx = new TahoeContext(this, {
            onLanguageChanged: () => this._forEachActive(m => m.onLanguageChanged?.()),
            onAppearanceChanged: () => this._forEachActive(m => m.onAppearanceChanged?.()),
        });

        this._loadStylesheets();

        this._active = new Map();
        this._settingIds = this._ctx.watch(
            MODULES.map(([name]) => `module-${name}`), () => this._sync());
        Main.sessionMode.connectObject('updated', () => this._sync(), this);

        this._sync();
    }

    disable() {
        Main.sessionMode.disconnectObject(this);
        this._ctx.unwatch(this._settingIds);

        for (const [name] of [...MODULES].reverse())
            this._stop(name);
        this._active = null;

        this._unloadStylesheets();
        this._ctx.destroy();
        this._ctx = null;
    }

    _forEachActive(fn) {
        for (const module of this._active?.values() ?? []) {
            try {
                fn(module);
            } catch (e) {
                console.error(`[macos-shell] ${e.message}\n${e.stack}`);
            }
        }
    }

    _wanted(name) {
        if (!this._ctx.settings.get_boolean(`module-${name}`))
            return false;
        if (Main.sessionMode.isLocked || Main.sessionMode.currentMode === 'unlock-dialog')
            return LOCK_SCREEN_MODULES.has(name);
        return true;
    }

    _sync() {
        for (const [name] of [...MODULES].reverse()) {
            if (!this._wanted(name))
                this._stop(name);
        }
        for (const [name, Module] of MODULES) {
            if (this._wanted(name) && !this._active.has(name))
                this._start(name, Module);
        }
    }

    _start(name, Module) {
        let module = null;
        try {
            module = new Module(this._ctx);
            module.enable();
            this._active.set(name, module);
        } catch (e) {
            console.error(`[macos-shell] cannot enable module ${name}: ${e.message}\n${e.stack}`);
            try {
                module?.disable();
            } catch {}
        }
    }

    _stop(name) {
        const module = this._active?.get(name);
        if (!module)
            return;
        this._active.delete(name);
        try {
            module.disable();
        } catch (e) {
            console.error(`[macos-shell] cannot disable module ${name}: ${e.message}\n${e.stack}`);
        }
    }

    _loadStylesheets() {
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        this._stylesheets = [];
        for (const [name] of MODULES) {
            const file = this.dir.get_child('modules').get_child(name).get_child('stylesheet.css');
            if (!file.query_exists(null))
                continue;
            try {
                theme.load_stylesheet(file);
                this._stylesheets.push(file);
            } catch (e) {
                console.error(`[macos-shell] stylesheet ${name}: ${e.message}`);
            }
        }
    }

    _unloadStylesheets() {
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        for (const file of this._stylesheets ?? [])
            theme.unload_stylesheet(file);
        this._stylesheets = [];
    }
}
