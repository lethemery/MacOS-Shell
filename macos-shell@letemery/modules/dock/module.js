// SPDX-License-Identifier: GPL-2.0-or-later

import {Dock} from './dock.js';

export default class DockModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    enable() {
        this._dock = new Dock(this._ctx, this._ctx.dir);
        this._ctx.dockIconRect = window => this._dock?.iconRectFor(window) ?? null;
    }

    disable() {
        this._ctx.dockIconRect = null;
        this._dock?.destroy();
        this._dock = null;
    }

    onLanguageChanged() {
        this._dock?.onLanguageChanged();
    }

    onAppearanceChanged() {
        this._dock?.onAppearanceChanged();
    }
}
