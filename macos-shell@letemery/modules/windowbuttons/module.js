// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';

import {GTK_VERSIONS, install, uninstall} from './gtkcss.js';

const WM_SCHEMA = 'org.gnome.desktop.wm.preferences';
const LEFT_LAYOUT = 'close,minimize,maximize:';

export default class WindowButtonsModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    enable() {
        this._wm = new Gio.Settings({schema_id: WM_SCHEMA});
        this._ids = this._ctx.watch(['windowbuttons-left', 'windowbuttons-colors'], () => this._sync());
        this._sync();
    }

    disable() {
        this._ctx.unwatch(this._ids);
        this._restoreLayout();
        this._removeCss();
        this._wm = null;
    }

    _sync() {
        const s = this._ctx.settings;
        if (s.get_boolean('windowbuttons-left'))
            this._setLayout();
        else
            this._restoreLayout();

        if (s.get_boolean('windowbuttons-colors')) {
            for (const version of GTK_VERSIONS) {
                try {
                    install(version);
                } catch (e) {
                    console.error(`[macos-shell] ${version.dir}/gtk.css: ${e.message}`);
                }
            }
        } else {
            this._removeCss();
        }
    }

    _setLayout() {
        const s = this._ctx.settings;
        const current = this._wm.get_string('button-layout');
        if (current === LEFT_LAYOUT)
            return;
        if (!s.get_string('windowbuttons-saved-layout'))
            s.set_string('windowbuttons-saved-layout', current);
        this._wm.set_string('button-layout', LEFT_LAYOUT);
    }

    _restoreLayout() {
        const s = this._ctx.settings;
        const saved = s.get_string('windowbuttons-saved-layout');
        if (!saved)
            return;
        if (this._wm.get_string('button-layout') === LEFT_LAYOUT)
            this._wm.set_string('button-layout', saved);
        s.set_string('windowbuttons-saved-layout', '');
    }

    _removeCss() {
        for (const version of GTK_VERSIONS) {
            try {
                uninstall(version);
            } catch (e) {
                console.error(`[macos-shell] ${version.dir}/gtk.css: ${e.message}`);
            }
        }
    }
}
