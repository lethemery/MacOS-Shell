// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {_} from '../../lib/i18n.js';
import {comboRow, group, switchRow} from '../../lib/prefs-utils.js';

// Presets avoid GNOME's own shortcuts (Super+Space switches the keyboard
// layout, Alt+Space opens the window menu).
const SHORTCUTS = [
    ['<Super>f', 'Super+F'],
    ['<Control><Alt>space', 'Ctrl+Alt+Space'],
    ['<Alt><Super>space', 'Super+Alt+Space'],
    ['<Super>space', 'Super+Space'],
    ['', null],
];

function shortcutRow(s) {
    const labels = SHORTCUTS.map(([, label]) => label ?? _('Disabled'));
    const row = new Adw.ComboRow({
        title: _('Keyboard shortcut'),
        subtitle: _('Super+Space is used by GNOME to switch the keyboard layout'),
        model: Gtk.StringList.new(labels),
    });
    const sync = () => {
        const current = s.get_strv('spotlight-shortcut')[0] ?? '';
        const idx = SHORTCUTS.findIndex(([accel]) => accel === current);
        row.selected = idx >= 0 ? idx : 0;
    };
    sync();
    const id = s.connect('changed::spotlight-shortcut', sync);
    row.connect('destroy', () => s.disconnect(id));
    row.connect('notify::selected', () => {
        const accel = SHORTCUTS[row.selected]?.[0] ?? '';
        const value = accel ? [accel] : [];
        if (JSON.stringify(value) !== JSON.stringify(s.get_strv('spotlight-shortcut')))
            s.set_strv('spotlight-shortcut', value);
    });
    return row;
}

export function buildGroups(s) {
    return [
        group(_('Opening'), '', [
            shortcutRow(s),
            switchRow(s, 'spotlight-show-icon', _('Magnifier in the top bar')),
        ]),
        group(_('Search'), _('Applications, system actions and the calculator are always searched.'), [
            switchRow(s, 'spotlight-providers', _('Files, settings and other apps'),
                _('Uses GNOME search providers, like the overview')),
            switchRow(s, 'spotlight-web-search', _('Web search')),
            comboRow(s, 'spotlight-search-engine', _('Search engine'), [
                ['duckduckgo', 'DuckDuckGo'],
                ['google', 'Google'],
                ['yandex', 'Яндекс'],
                ['bing', 'Bing'],
            ]),
        ]),
    ];
}
