// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';

import {initI18n, setLanguage} from './i18n.js';

export class TahoeContext {
    constructor(extension, {onLanguageChanged, onAppearanceChanged} = {}) {
        this.extension = extension;
        this.dir = extension.dir;
        this.settings = extension.getSettings();
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this.dockIconRect = null;

        initI18n(this.dir, this.settings.get_string('language'));

        this._ids = [
            [this.settings, this.settings.connect('changed::language', () => {
                setLanguage(this.settings.get_string('language'));
                onLanguageChanged?.();
            })],
            [this.settings, this.settings.connect('changed::appearance',
                () => onAppearanceChanged?.(this.appearance))],
            [this._interface, this._interface.connect('changed::color-scheme',
                () => onAppearanceChanged?.(this.appearance))],
        ];
    }

    get appearance() {
        const value = this.settings.get_string('appearance');
        if (value === 'light' || value === 'dark')
            return value;
        return this._interface.get_string('color-scheme') === 'prefer-dark' ? 'dark' : 'light';
    }

    applyAppearance(actor) {
        const dark = this.appearance === 'dark';
        actor.remove_style_class_name(dark ? 'tahoe-light' : 'tahoe-dark');
        actor.add_style_class_name(dark ? 'tahoe-dark' : 'tahoe-light');
    }

    watch(keys, callback) {
        return keys.map(key => this.settings.connect(`changed::${key}`, callback));
    }

    unwatch(ids) {
        ids?.forEach(id => this.settings.disconnect(id));
    }

    openPreferences() {
        this.extension.openPreferences();
    }

    destroy() {
        for (const [obj, id] of this._ids)
            obj.disconnect(id);
        this._ids = [];
        this.settings = null;
        this._interface = null;
    }
}
