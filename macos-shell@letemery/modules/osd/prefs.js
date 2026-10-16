// SPDX-License-Identifier: GPL-2.0-or-later
import {_} from '../../lib/i18n.js';
import {comboRow, group} from '../../lib/prefs-utils.js';

export function buildGroups(s) {
    return [
        group(_('Pop-up'), _('Shown when you change the volume or the screen brightness with the keys.'), [
            comboRow(s, 'osd-position', _('Position'), [
                ['top-right', _('Under the menu bar on the right, like macOS Tahoe')],
                ['bottom', _('Bottom center, like older macOS')],
            ]),
        ]),
    ];
}
