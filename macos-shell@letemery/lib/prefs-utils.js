// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

export function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function spinRow(settings, key, title, lower, upper, step = 1, digits = 0, subtitle = '') {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function comboRow(settings, key, title, choices, subtitle = '') {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(choices.map(c => c[1])),
    });
    const sync = () => {
        const idx = choices.findIndex(c => c[0] === settings.get_string(key));
        row.selected = Math.max(0, idx);
    };
    sync();
    const id = settings.connect(`changed::${key}`, sync);
    row.connect('notify::selected', () => {
        const value = choices[row.selected]?.[0];
        if (value && value !== settings.get_string(key))
            settings.set_string(key, value);
    });
    row.connect('destroy', () => settings.disconnect(id));
    return row;
}

export function group(title, description = '', rows = []) {
    const g = new Adw.PreferencesGroup({title, description});
    rows.forEach(r => g.add(r));
    return g;
}

export function page(title, iconName, groups = []) {
    const p = new Adw.PreferencesPage({title, icon_name: iconName});
    groups.forEach(g => p.add(g));
    return p;
}
