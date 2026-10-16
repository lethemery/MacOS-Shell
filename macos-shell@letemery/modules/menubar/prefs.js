// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {_} from '../../lib/i18n.js';
import {comboRow, group, spinRow, switchRow} from '../../lib/prefs-utils.js';

function logoRow(s) {
    const row = new Adw.ActionRow({title: _('Logo image')});
    const sync = () => {
        const path = s.get_string('menubar-logo-path');
        row.subtitle = path || _('Built-in icon');
    };
    sync();
    const id = s.connect('changed::menubar-logo-path', sync);
    row.connect('destroy', () => s.disconnect(id));

    const choose = new Gtk.Button({label: _('Choose…'), valign: Gtk.Align.CENTER});
    choose.connect('clicked', () => {
        const filter = new Gtk.FileFilter({name: _('Images')});
        filter.add_mime_type('image/svg+xml');
        filter.add_mime_type('image/png');
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
        filters.append(filter);
        const dialog = new Gtk.FileDialog({title: _('Logo image'), filters});
        dialog.open(row.get_root(), null, (d, res) => {
            try {
                const file = d.open_finish(res);
                if (file?.get_path())
                    s.set_string('menubar-logo-path', file.get_path());
            } catch {}
        });
    });
    const reset = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: _('Built-in icon'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    reset.connect('clicked', () => s.set_string('menubar-logo-path', ''));
    row.add_suffix(choose);
    row.add_suffix(reset);
    return row;
}

export function buildGroups(s) {
    return [
        group(_('Look'), '', [
            comboRow(s, 'menubar-style', _('Bar style'), [
                ['glass', _('Liquid glass')],
                ['transparent', _('Transparent')],
                ['solid', _('Solid')],
            ]),
            spinRow(s, 'menubar-height', _('Height'), 24, 40, 1, 0, _('In pixels')),
        ]),
        group(_('Left side'), _('Logo menu, bold app name, then File, Edit, View, Window and Help.'), [
            switchRow(s, 'menubar-show-logo', _('Logo menu'),
                _('About this computer, settings, sleep, restart, shut down')),
            logoRow(s),
            switchRow(s, 'menubar-show-app-name', _('Application name'),
                _('Bold name of the active app with its menu')),
            switchRow(s, 'menubar-show-app-menus', _('File, Edit, View, Window, Help'),
                _('Editing commands are sent to the app as keyboard shortcuts')),
            switchRow(s, 'menubar-show-activities', _('“Activities” button')),
        ]),
        group(_('Right side'), _('Battery, Wi‑Fi, Spotlight, Control Center and the clock.'), [
            switchRow(s, 'menubar-show-battery', _('Battery')),
            switchRow(s, 'menubar-battery-percent', _('Show battery percentage')),
            switchRow(s, 'menubar-show-wifi', _('Wi‑Fi')),
            switchRow(s, 'menubar-control-center', _('Control Center'),
                _('One icon instead of GNOME’s status icons; opens quick settings')),
        ]),
        group(_('Clock'), '', [
            switchRow(s, 'menubar-show-date', _('Show date')),
            switchRow(s, 'menubar-show-weekday', _('Show day of the week')),
            switchRow(s, 'menubar-show-seconds', _('Show seconds')),
        ]),
    ];
}
