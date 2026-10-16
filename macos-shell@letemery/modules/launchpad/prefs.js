// SPDX-License-Identifier: GPL-2.0-or-later
import {_} from '../../lib/i18n.js';
import {group, spinRow, switchRow} from '../../lib/prefs-utils.js';

export function buildGroups(s) {
    return [
        group(_('Opening'), _('Launchpad also opens from the Applications button in the dock and with Super+A.'), [
            switchRow(s, 'launchpad-super-key', _('Open with the Super key'),
                _('Instead of the GNOME overview, which still opens from the hot corner and the three-finger swipe')),
        ]),
        group(_('Grid'), '', [
            spinRow(s, 'launchpad-columns', _('Columns'), 4, 10),
            spinRow(s, 'launchpad-rows', _('Rows'), 3, 7),
        ]),
    ];
}
