// SPDX-License-Identifier: GPL-2.0-or-later
import {_} from '../../lib/i18n.js';
import {comboRow, group, switchRow} from '../../lib/prefs-utils.js';

export function buildGroups(s) {
    return [
        group(_('Banners'), '', [
            comboRow(s, 'notifications-position', _('Position'), [
                ['top-right', _('Top right')],
                ['top-center', _('Top center')],
                ['top-left', _('Top left')],
            ]),
            switchRow(s, 'notifications-slide', _('Slide in from the screen edge'),
                _('Like macOS. Off: drop down from the top')),
        ]),
        group(_('Notification center'), '', [
            switchRow(s, 'notifications-style-center', _('Glass notification center'),
                _('Restyle the calendar and notification list opened from the clock')),
        ]),
    ];
}
