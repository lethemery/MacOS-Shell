// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import GWeather from 'gi://GWeather?version=4.0';

import {_, N_} from '../../lib/i18n.js';
import {comboRow, group, spinRow, switchRow} from '../../lib/prefs-utils.js';

const WIDGETS = [
    ['clock', N_('Clock'), N_('Analog clock'), 'preferences-system-time-symbolic'],
    ['calendar', N_('Calendar'), N_('Month at a glance'), 'x-office-calendar-symbolic'],
    ['date', N_('Date'), N_('Today, big and bold'), 'view-calendar-day-symbolic'],
    ['weather', N_('Weather'), N_('Weather from GWeather, like GNOME Weather'), 'weather-few-clouds-symbolic'],
    ['system', N_('System'), N_('CPU, memory, swap and battery'), 'utilities-system-monitor-symbolic'],
    ['battery', N_('Battery'), N_('A separate battery widget'), 'battery-good-symbolic'],
];

function widgetRow(s, [id, title, subtitle, icon]) {
    const row = new Adw.SwitchRow({title: _(title), subtitle: _(subtitle)});
    row.add_prefix(new Gtk.Image({icon_name: icon}));
    const sync = () => {
        const on = s.get_strv('widgets-enabled').includes(id);
        if (row.active !== on)
            row.active = on;
    };
    sync();
    const handler = s.connect('changed::widgets-enabled', sync);
    row.connect('destroy', () => s.disconnect(handler));
    row.connect('notify::active', () => {
        const list = s.get_strv('widgets-enabled').filter(w => w !== id);
        if (row.active)
            list.push(id);
        s.set_strv('widgets-enabled', list);
    });
    return row;
}

let _cities = null;

function allCities() {
    if (_cities)
        return _cities;
    _cities = [];
    const walk = location => {
        let child = null;
        while ((child = location.next_child(child)) !== null) {
            if (child.get_level() === GWeather.LocationLevel.CITY)
                _cities.push(child);
            else
                walk(child);
        }
    };
    walk(GWeather.Location.get_world());
    return _cities;
}

function describe(location) {
    const country = location.get_country_name();
    return country ? `${location.get_name()}, ${country}` : location.get_name();
}

function weatherGroup(s) {
    const g = new Adw.PreferencesGroup({
        title: _('Weather location'),
        description: _('Data comes from libgweather, the library GNOME Weather uses.'),
    });

    const current = new Adw.ActionRow({title: _('City')});
    const syncCurrent = () => {
        current.subtitle = s.get_string('weather-location')
            ? s.get_string('weather-location-name')
            : _('Automatic: GNOME Weather’s city or your current location');
    };
    syncCurrent();
    const id = s.connect('changed::weather-location', syncCurrent);
    current.connect('destroy', () => s.disconnect(id));
    const auto = new Gtk.Button({label: _('Automatic'), valign: Gtk.Align.CENTER});
    auto.connect('clicked', () => {
        s.set_string('weather-location', '');
        s.set_string('weather-location-name', '');
    });
    current.add_suffix(auto);
    g.add(current);

    const search = new Adw.EntryRow({title: _('Find a city')});
    g.add(search);

    let results = [];
    let timeout = 0;
    const clear = () => {
        results.forEach(r => g.remove(r));
        results = [];
    };
    search.connect('changed', () => {
        if (timeout)
            GLib.source_remove(timeout);
        timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            timeout = 0;
            clear();
            const text = search.text.trim().toLowerCase();
            if (text.length < 2)
                return GLib.SOURCE_REMOVE;
            const matches = allCities()
                .filter(c => c.get_name().toLowerCase().includes(text) ||
                    (c.get_english_name?.() ?? '').toLowerCase().includes(text))
                .sort((a, b) => {
                    const pa = a.get_name().toLowerCase().startsWith(text) ? 0 : 1;
                    const pb = b.get_name().toLowerCase().startsWith(text) ? 0 : 1;
                    return pa - pb || a.get_name().localeCompare(b.get_name());
                })
                .slice(0, 8);
            for (const city of matches) {
                const row = new Adw.ActionRow({title: describe(city), activatable: true});
                row.add_prefix(new Gtk.Image({icon_name: 'mark-location-symbolic'}));
                row.connect('activated', () => {
                    s.set_string('weather-location', city.serialize().print(true));
                    s.set_string('weather-location-name', describe(city));
                    search.text = '';
                    clear();
                });
                g.add(row);
                results.push(row);
            }
            return GLib.SOURCE_REMOVE;
        });
    });
    search.connect('destroy', () => {
        if (timeout)
            GLib.source_remove(timeout);
        timeout = 0;
    });
    return g;
}

export function buildGroups(s) {
    const reset = new Adw.ButtonRow({title: _('Reset widget positions')});
    reset.connect('activated', () => s.set_string('widgets-positions', '{}'));

    return [
        group(_('Widgets on the desktop'),
            _('Drag widgets with the mouse. Right-click a widget for more options.'),
            WIDGETS.map(w => widgetRow(s, w))),
        group(_('Layout'), '', [
            comboRow(s, 'widgets-layer', _('Layer'), [
                ['desktop', _('On the desktop — under windows')],
                ['top', _('Above windows — always visible')],
            ]),
            switchRow(s, 'widgets-system-battery', _('Battery in the System widget'),
                _('A fourth ring next to CPU, memory and swap')),
            comboRow(s, 'widgets-battery-size', _('Separate battery widget'), [
                ['small', _('Small — this computer')],
                ['wide', _('Wide — all devices, like macOS')],
            ]),
            spinRow(s, 'widgets-scale', _('Size'), 0.6, 1.6, 0.1, 1),
            switchRow(s, 'widgets-locked', _('Lock positions'), _('Prevent accidental dragging')),
            reset,
        ]),
        weatherGroup(s),
    ];
}
