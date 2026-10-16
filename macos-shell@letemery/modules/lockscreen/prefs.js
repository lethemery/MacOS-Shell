// SPDX-License-Identifier: GPL-2.0-or-later
import {_} from '../../lib/i18n.js';
import {comboRow, group, spinRow, switchRow} from '../../lib/prefs-utils.js';

export function buildGroups(s) {
    return [
        group(_('Clock'), '', [
            switchRow(s, 'lockscreen-show-date', _('Show date above the time')),
            comboRow(s, 'lockscreen-clock-weight', _('Time font weight'), [
                ['bold', _('Bold')],
                ['regular', _('Regular')],
                ['light', _('Thin')],
            ]),
            spinRow(s, 'lockscreen-clock-opacity', _('Clock opacity'), 10, 100, 5, 0, _('In percent')),
        ]),
        group(_('Wallpaper and prompt'), _('Lock the screen (Super+L) to see the changes.'), [
            comboRow(s, 'lockscreen-blur', _('Blur the wallpaper'), [
                ['prompt', _('Only while entering the password')],
                ['always', _('Always')],
                ['never', _('Never')],
            ]),
            comboRow(s, 'lockscreen-avatar-size', _('Avatar size'), [
                ['small', _('Small, like macOS')],
                ['medium', _('Medium')],
                ['large', _('Large, like GNOME')],
            ]),
            switchRow(s, 'lockscreen-prompt-bottom', _('Password field at the bottom'),
                _('Like macOS. Off: in the middle of the screen')),
            spinRow(s, 'lockscreen-prompt-margin', _('Distance from the bottom'), 2, 40, 1, 0,
                _('In percent of the screen height')),
        ]),
        group(_('Unlocking'), '', [
            switchRow(s, 'lockscreen-unlock-animation', _('macOS unlock animation'),
                _('The lock screen fades away and the desktop zooms in')),
        ]),
    ];
}
