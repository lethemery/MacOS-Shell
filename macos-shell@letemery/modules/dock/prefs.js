// SPDX-License-Identifier: GPL-2.0-or-later
import {_} from '../../lib/i18n.js';
import {comboRow, group, spinRow, switchRow} from '../../lib/prefs-utils.js';

export function buildGroups(s) {
    return [
        group(_('Size and animation'), '', [
            spinRow(s, 'dock-icon-size', _('Icon size'), 24, 96, 2, 0, _('In pixels')),
            switchRow(s, 'dock-magnification', _('Magnification'),
                _('Icons grow under the pointer')),
            spinRow(s, 'dock-magnification-scale', _('Magnification amount'), 1.0, 2.5, 0.1, 1),
            switchRow(s, 'dock-bounce', _('Bounce'),
                _('Icons bounce while apps launch or need attention')),
        ]),
        group(_('Position'), '', [
            switchRow(s, 'dock-reserve-space', _('Keep windows above the dock'),
                _('Maximized windows end where the dock begins')),
            spinRow(s, 'dock-bottom-margin', _('Distance from the screen edge'), 0, 32, 1, 0,
                _('In pixels')),
        ]),
        group(_('Content'), '', [
            switchRow(s, 'dock-show-launcher', _('Applications button')),
            switchRow(s, 'dock-show-running', _('Show running apps that are not pinned')),
            switchRow(s, 'dock-show-trash', _('Trash')),
            switchRow(s, 'dock-hide-overview-dash', _('Hide the standard dash in the overview')),
        ]),
        group(_('Behavior'), _('Middle click or Ctrl+click opens a new window.'), [
            comboRow(s, 'dock-click-action', _('Clicking the active app'), [
                ['minimize', _('Minimizes its windows')],
                ['cycle', _('Switches between its windows')],
                ['focus', _('Does nothing')],
            ]),
        ]),
    ];
}
