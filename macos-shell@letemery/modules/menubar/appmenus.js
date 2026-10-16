// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_, format} from '../../lib/i18n.js';

// Linux evdev key codes. Codes (not keysyms) make the shortcuts work with any
// keyboard layout, including Russian.
const KEY = {
    CTRL: 29, SHIFT: 42, ALT: 56,
    Q: 16, W: 17, T: 20, O: 24, P: 25, A: 30, S: 31, F: 33, H: 35,
    Z: 44, X: 45, C: 46, V: 47, N: 49, COMMA: 51,
    ZERO: 11, MINUS: 12, EQUAL: 13, F1: 59, F11: 87,
};

let _virtualKeyboard = null;

function keyboard() {
    if (!_virtualKeyboard) {
        const seat = Clutter.get_default_backend().get_default_seat();
        _virtualKeyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    }
    return _virtualKeyboard;
}

export function releaseVirtualKeyboard() {
    _virtualKeyboard = null;
}

function sendShortcut(window, codes) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
        if (window && global.display.focus_window !== window)
            Main.activateWindow(window);
        const dev = keyboard();
        let t = GLib.get_monotonic_time();
        for (const code of codes)
            dev.notify_key(t++, code, Clutter.KeyState.PRESSED);
        for (const code of [...codes].reverse())
            dev.notify_key(t++, code, Clutter.KeyState.RELEASED);
        return GLib.SOURCE_REMOVE;
    });
}

function launch(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (e) {
        console.warn(`[macos-shell] ${argv[0]}: ${e.message}`);
    }
}

function openUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        console.warn(`[macos-shell] ${uri}: ${e.message}`);
    }
}

function openSpecialDir(dir) {
    const path = dir === null ? GLib.get_home_dir() : GLib.get_user_special_dir(dir);
    if (path)
        openUri(GLib.filename_to_uri(path, null));
}

function addItem(menu, label, accel, callback, sensitive = true) {
    const item = new PopupMenu.PopupMenuItem(label);
    if (accel) {
        item.add_child(new St.Label({
            text: accel,
            style_class: 'tahoe-menu-accel',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        }));
    }
    item.setSensitive(sensitive);
    item.connect('activate', () => callback());
    menu.addMenuItem(item);
    return item;
}

export function populateOnOpen(menu, populate) {
    const open = menu.open;
    menu.open = function (...args) {
        populate();
        return open.apply(this, args);
    };
}

function separator(menu) {
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
}

const MenuTitle = GObject.registerClass(
class TahoeMenuTitle extends PanelMenu.Button {
    _init(owner, kind) {
        super._init(0.0, kind);
        this._owner = owner;
        this.kind = kind;
        this.add_style_class_name('tahoe-menu-title');
        this.menu.actor.add_style_class_name('tahoe-menu');
        this.menu.actor.add_style_class_name('tahoe-app-menu');

        this.label = new St.Label({y_align: Clutter.ActorAlign.CENTER, style_class: 'tahoe-menu-title-label'});
        this.add_child(this.label);

        // GNOME refuses to open an empty menu, so fill it right before opening.
        populateOnOpen(this.menu, () => this._owner.populate(this));
    }
});

export class AppMenus {
    constructor({showMenus, index}) {
        this._tracker = Shell.WindowTracker.get_default();
        this._buttons = [];

        const kinds = showMenus
            ? ['app', 'file', 'edit', 'view', 'go', 'window', 'help']
            : ['app'];
        kinds.forEach((kind, i) => {
            const button = new MenuTitle(this, kind);
            if (kind === 'app')
                button.add_style_class_name('tahoe-app-name');
            Main.panel.addToStatusArea(`tahoe-menu-${kind}`, button, index + i, 'left');
            this._buttons.push(button);
        });

        this._tracker.connectObject('notify::focus-app', () => this._sync(), this);
        global.display.connectObject('notify::focus-window', () => this._sync(), this);
        Main.overview.connectObject(
            'showing', () => this._sync(),
            'hidden', () => this._sync(), this);
        this._sync();
    }

    destroy() {
        this._tracker.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.overview.disconnectObject(this);
        this._buttons.forEach(b => b.destroy());
        this._buttons = [];
    }

    get _app() {
        if (Main.overview.visible)
            return null;
        return this._tracker.focus_app;
    }

    _sync() {
        const app = this._app;
        const titles = {
            app: app ? app.get_name() : _('Files'),
            file: _('File'),
            edit: _('Edit'),
            view: _('View'),
            go: _('Go'),
            window: _('Window'),
            help: _('Help'),
        };
        for (const button of this._buttons) {
            button.label.text = titles[button.kind];
            let visible = true;
            if (button.kind === 'go')
                visible = !app;
            else if (button.kind === 'edit' || button.kind === 'view')
                visible = !!app;
            button.visible = visible;
            button.container.visible = visible;
        }
    }

    populate(button) {
        const menu = button.menu;
        menu.removeAll();
        const app = this._app;
        let window = global.display.focus_window;
        if (app && (!window || this._tracker.get_window_app(window) !== app))
            window = app.get_windows()[0] ?? null;
        const builders = {
            app: () => this._appMenu(menu, app, window),
            file: () => this._fileMenu(menu, app, window),
            edit: () => this._editMenu(menu, window),
            view: () => this._viewMenu(menu, window),
            go: () => this._goMenu(menu),
            window: () => this._windowMenu(menu, app, window),
            help: () => this._helpMenu(menu, app, window),
        };
        builders[button.kind]();
    }

    _appMenu(menu, app, window) {
        if (!app) {
            addItem(menu, _('Open Files'), null, () => openSpecialDir(null));
            separator(menu);
            addItem(menu, _('Empty Trash…'), null, () => launch(['gio', 'trash', '--empty']));
            return;
        }
        const name = app.get_name();
        const id = app.get_id()?.replace(/\.desktop$/, '');
        addItem(menu, format(_('About {app}'), {app: name}), null,
            () => launch(['gnome-control-center', 'applications', id]), !!id);
        separator(menu);
        addItem(menu, _('Settings…'), 'Ctrl+,', () => sendShortcut(window, [KEY.CTRL, KEY.COMMA]));
        separator(menu);
        addItem(menu, format(_('Hide {app}'), {app: name}), null, () => {
            app.get_windows().filter(w => w.can_minimize()).forEach(w => w.minimize());
        });
        addItem(menu, _('Hide Others'), null, () => {
            const ws = global.workspace_manager.get_active_workspace();
            ws.list_windows()
                .filter(w => this._tracker.get_window_app(w) !== app && w.can_minimize() &&
                    w.window_type === Meta.WindowType.NORMAL)
                .forEach(w => w.minimize());
        });
        addItem(menu, _('Show All'), null, () => {
            global.workspace_manager.get_active_workspace().list_windows()
                .filter(w => w.minimized).forEach(w => w.unminimize());
        });
        separator(menu);
        addItem(menu, format(_('Quit {app}'), {app: name}), 'Ctrl+Q', () => app.request_quit());
    }

    _fileMenu(menu, app, window) {
        if (!app) {
            addItem(menu, _('New Files Window'), null, () => openSpecialDir(null));
            addItem(menu, _('Open Trash'), null, () => openUri('trash:///'));
            return;
        }
        addItem(menu, _('New Window'), 'Ctrl+N', () => {
            if (app.can_open_new_window())
                app.open_new_window(-1);
            else
                sendShortcut(window, [KEY.CTRL, KEY.N]);
        });
        addItem(menu, _('New Tab'), 'Ctrl+T', () => sendShortcut(window, [KEY.CTRL, KEY.T]));
        addItem(menu, _('Open…'), 'Ctrl+O', () => sendShortcut(window, [KEY.CTRL, KEY.O]));
        separator(menu);
        addItem(menu, _('Close Window'), 'Ctrl+W', () => window?.delete(global.get_current_time()), !!window);
        addItem(menu, _('Save'), 'Ctrl+S', () => sendShortcut(window, [KEY.CTRL, KEY.S]));
        addItem(menu, _('Save As…'), 'Shift+Ctrl+S', () => sendShortcut(window, [KEY.CTRL, KEY.SHIFT, KEY.S]));
        separator(menu);
        addItem(menu, _('Print…'), 'Ctrl+P', () => sendShortcut(window, [KEY.CTRL, KEY.P]));
    }

    _editMenu(menu, window) {
        addItem(menu, _('Undo'), 'Ctrl+Z', () => sendShortcut(window, [KEY.CTRL, KEY.Z]));
        addItem(menu, _('Redo'), 'Shift+Ctrl+Z', () => sendShortcut(window, [KEY.CTRL, KEY.SHIFT, KEY.Z]));
        separator(menu);
        addItem(menu, _('Cut'), 'Ctrl+X', () => sendShortcut(window, [KEY.CTRL, KEY.X]));
        addItem(menu, _('Copy'), 'Ctrl+C', () => sendShortcut(window, [KEY.CTRL, KEY.C]));
        addItem(menu, _('Paste'), 'Ctrl+V', () => sendShortcut(window, [KEY.CTRL, KEY.V]));
        addItem(menu, _('Select All'), 'Ctrl+A', () => sendShortcut(window, [KEY.CTRL, KEY.A]));
        separator(menu);
        addItem(menu, _('Find…'), 'Ctrl+F', () => sendShortcut(window, [KEY.CTRL, KEY.F]));
    }

    _viewMenu(menu, window) {
        addItem(menu, _('Zoom In'), 'Ctrl++', () => sendShortcut(window, [KEY.CTRL, KEY.EQUAL]));
        addItem(menu, _('Zoom Out'), 'Ctrl+−', () => sendShortcut(window, [KEY.CTRL, KEY.MINUS]));
        addItem(menu, _('Actual Size'), 'Ctrl+0', () => sendShortcut(window, [KEY.CTRL, KEY.ZERO]));
        separator(menu);
        const fullscreen = window?.is_fullscreen();
        addItem(menu, fullscreen ? _('Exit Full Screen') : _('Enter Full Screen'), 'F11', () => {
            if (!window)
                return;
            if (window.is_fullscreen())
                window.unmake_fullscreen();
            else
                window.make_fullscreen();
        }, !!window);
    }

    _goMenu(menu) {
        addItem(menu, _('Recents'), null, () => openUri('recent:///'));
        addItem(menu, _('Documents'), null, () => openSpecialDir(GLib.UserDirectory.DIRECTORY_DOCUMENTS));
        addItem(menu, _('Desktop'), null, () => openSpecialDir(GLib.UserDirectory.DIRECTORY_DESKTOP));
        addItem(menu, _('Downloads'), null, () => openSpecialDir(GLib.UserDirectory.DIRECTORY_DOWNLOAD));
        addItem(menu, _('Home'), null, () => openSpecialDir(null));
        addItem(menu, _('Computer'), null, () => openUri('file:///'));
        addItem(menu, _('Applications'), null, () => Main.overview.showApps());
        separator(menu);
        addItem(menu, _('Trash'), null, () => openUri('trash:///'));
    }

    _windowMenu(menu, app, window) {
        addItem(menu, _('Minimize'), 'Super+H', () => window?.minimize(), !!window?.can_minimize());
        addItem(menu, _('Zoom'), null, () => {
            if (!window)
                return;
            // Mutter 49+ takes no flags; older versions want MaximizeFlags.BOTH.
            const flags = window.maximize.length ? [Meta.MaximizeFlags.BOTH] : [];
            const maximized = window.is_maximized
                ? window.is_maximized()
                : window.maximized_horizontally && window.maximized_vertically;
            if (maximized)
                window.unmaximize(...flags);
            else
                window.maximize(...flags);
        }, !!window?.can_maximize());
        separator(menu);
        addItem(menu, _('Move to Next Desktop'), null, () => {
            const ws = window?.get_workspace();
            const next = ws?.get_neighbor(Meta.MotionDirection.RIGHT);
            if (window && next && next !== ws)
                window.change_workspace(next);
        }, !!window);
        separator(menu);
        addItem(menu, _('Bring All to Front'), null, () => {
            if (!app)
                return;
            global.display.sort_windows_by_stacking(app.get_windows())
                .forEach(w => Main.activateWindow(w));
        }, !!app);

        const windows = app ? app.get_windows().filter(w => !w.skip_taskbar) : [];
        if (windows.length) {
            separator(menu);
            for (const w of windows) {
                const item = addItem(menu, w.get_title() || app.get_name(), null, () => Main.activateWindow(w));
                if (w === window)
                    item.setOrnament(PopupMenu.Ornament.CHECK);
            }
        }
    }

    _helpMenu(menu, app, window) {
        if (app) {
            addItem(menu, format(_('{app} Help'), {app: app.get_name()}), 'F1',
                () => sendShortcut(window, [KEY.F1]));
            addItem(menu, _('Keyboard Shortcuts'), 'Ctrl+?',
                () => sendShortcut(window, [KEY.CTRL, KEY.SHIFT, 53]));
            separator(menu);
        }
        addItem(menu, _('GNOME Help'), null, () => openUri('help:gnome-help'));
    }
}
