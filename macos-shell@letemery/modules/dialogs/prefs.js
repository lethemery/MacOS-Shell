// SPDX-License-Identifier: GPL-2.0-or-later
import {_} from '../../lib/i18n.js';
import {group, switchRow} from '../../lib/prefs-utils.js';

export function buildGroups(s) {
    return [
        group(_('Appearance'), _('Password requests, Wi‑Fi passwords, power off, “not responding” and permission dialogs.'), [
            switchRow(s, 'dialogs-dim', _('Dim the screen behind'),
                _('Like GNOME. macOS barely dims it')),
        ]),
    ];
}
