// SPDX-License-Identifier: GPL-2.0-or-later
import {_, format} from '../../lib/i18n.js';
import {group, switchRow} from '../../lib/prefs-utils.js';
import {GTK_VERSIONS, cssState} from './gtkcss.js';

export function buildGroups(s) {
    const themed = GTK_VERSIONS.filter(v => cssState(v) === 'theme').map(v => v.dir);
    const note = themed.length
        ? format(_('Your GTK theme already draws the buttons in {dirs}; that file is left as it is.'),
            {dirs: themed.map(d => `~/.config/${d}/gtk.css`).join(', ')})
        : '';
    return [
        group(_('Title bar buttons'), _('Apps opened after the change pick it up.'), [
            switchRow(s, 'windowbuttons-left', _('Buttons on the left'),
                _('Close, minimize, maximize — in the macOS order')),
            switchRow(s, 'windowbuttons-colors', _('Red, yellow and green circles'),
                note || _('Adds a small block to ~/.config/gtk-3.0 and gtk-4.0/gtk.css, removed when switched off')),
        ]),
    ];
}
