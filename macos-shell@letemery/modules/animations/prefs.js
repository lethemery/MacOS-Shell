// SPDX-License-Identifier: GPL-2.0-or-later
import {_} from '../../lib/i18n.js';
import {comboRow, group} from '../../lib/prefs-utils.js';

export function buildGroups(s) {
    return [
        group(_('Minimize and restore'), _('The window goes into its icon in the dock and comes back out of it.'), [
            comboRow(s, 'animations-effect', _('Effect'), [
                ['genie', _('Genie')],
                ['scale', _('Scale')],
            ]),
            comboRow(s, 'animations-speed', _('Speed'), [
                ['fast', _('Fast')],
                ['normal', _('Normal')],
                ['slow', _('Slow')],
            ]),
        ]),
    ];
}
