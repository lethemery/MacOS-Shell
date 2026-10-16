// SPDX-License-Identifier: GPL-2.0-or-later
import {_} from '../../lib/i18n.js';
import {comboRow, group, spinRow} from '../../lib/prefs-utils.js';

export function buildGroups(s) {
    return [
        group(_('Shake to find'), _('Shake the mouse quickly left and right: the cursor grows, then shrinks back.'), [
            spinRow(s, 'shakecursor-max-size', _('Largest size'), 2, 8, 0.5, 1,
                _('Times the normal cursor size')),
            comboRow(s, 'shakecursor-sensitivity', _('Sensitivity'), [
                ['low', _('Low: shake hard')],
                ['normal', _('Normal')],
                ['high', _('High: a light shake is enough')],
            ]),
        ]),
    ];
}
