// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Geoclue from 'gi://Geoclue';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GWeather from 'gi://GWeather?version=4.0';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {_, format} from '../../lib/i18n.js';
import {TahoeWidget, SMALL} from './widgets.js';

const REFRESH_SECONDS = 15 * 60;
const PROVIDERS = GWeather.Provider.METAR | GWeather.Provider.MET_NO | GWeather.Provider.OWM;

function settingsOrNull(schemaId) {
    const source = Gio.SettingsSchemaSource.get_default();
    return source.lookup(schemaId, true) ? new Gio.Settings({schema_id: schemaId}) : null;
}

function firstSavedLocation(settings) {
    try {
        const [first] = settings?.get_value('locations').deepUnpack() ?? [];
        return first ? GWeather.Location.get_world().deserialize(first) : null;
    } catch {
        return null;
    }
}

function roundTemp(value) {
    return `${Math.round(value)}°`;
}

export const WeatherWidget = GObject.registerClass(
class TahoeWeatherWidget extends TahoeWidget {
    _init(dark, ctx) {
        super._init('weather', SMALL, SMALL, dark);
        this.add_style_class_name('tahoe-weather-sky');
        this._settings = ctx.settings;

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'tahoe-widget-content',
            x_expand: true,
            y_expand: true,
        });
        this.add_child(box);

        const header = new St.BoxLayout({style_class: 'tahoe-weather-header'});
        this._location = new St.Label({style_class: 'tahoe-weather-location', x_expand: true});
        this._location.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._arrow = new St.Icon({
            icon_name: 'find-location-symbolic',
            icon_size: 10,
            style_class: 'tahoe-weather-arrow',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._location);
        header.add_child(this._arrow);

        this._temp = new St.Label({style_class: 'tahoe-weather-temp'});
        const spacer = new St.Widget({y_expand: true});
        this._icon = new St.Icon({
            style_class: 'tahoe-weather-icon',
            icon_size: 22,
            visible: false,
            x_align: Clutter.ActorAlign.START,
        });
        this._sky = new St.Label({style_class: 'tahoe-weather-sky-label'});
        this._sky.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._range = new St.Label({style_class: 'tahoe-weather-range'});

        [header, this._temp, spacer, this._icon, this._sky, this._range].forEach(a => box.add_child(a));

        this._info = new GWeather.Info({
            application_id: 'org.gnome.Shell',
            contact_info: 'https://gitlab.gnome.org/GNOME/gnome-shell/-/raw/HEAD/gnome-shell.doap',
            enabled_providers: PROVIDERS,
        });
        this._info.connect_after('updated', () => this._sync());

        this._weatherSettings = settingsOrNull('org.gnome.Weather');
        this._shellWeatherSettings = settingsOrNull('org.gnome.shell.weather');
        this._locationSettings = settingsOrNull('org.gnome.system.location');
        this._ids = [
            [this._settings, this._settings.connect('changed::weather-location', () => this._pickLocation())],
        ];
        for (const s of [this._weatherSettings, this._shellWeatherSettings]) {
            if (s)
                this._ids.push([s, s.connect('changed::locations', () => this._pickLocation())]);
        }

        this._showStatus(_('Loading…'));
        this._pickLocation();

        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, REFRESH_SECONDS, () => {
            if (this._info.location)
                this._info.update();
            return GLib.SOURCE_CONTINUE;
        });

        this.connect('destroy', () => {
            GLib.source_remove(this._timer);
            for (const [obj, id] of this._ids)
                obj.disconnect(id);
            this._cancellable?.cancel();
            this._geoclue = null;
            this._info.abort?.();
        });
    }

    activate() {
        try {
            Gio.DBus.session.call('org.gnome.Weather', '/org/gnome/Weather',
                'org.freedesktop.Application', 'Activate',
                new GLib.Variant('(a{sv})', [{}]), null, Gio.DBusCallFlags.NONE, -1, null, null);
        } catch {}
    }

    _pickLocation() {
        // A GeoClue lookup still in flight must not override this choice.
        this._cancellable?.cancel();
        this._cancellable = null;

        let location = null;
        let automatic = false;

        const own = this._settings.get_string('weather-location');
        if (own) {
            try {
                const variant = GLib.Variant.parse(null, own, null, null);
                location = GWeather.Location.get_world().deserialize(variant);
            } catch (e) {
                console.warn(`[macos-shell] weather location: ${e.message}`);
            }
        }
        location ??= firstSavedLocation(this._weatherSettings);
        location ??= firstSavedLocation(this._shellWeatherSettings);

        if (location) {
            this._setLocation(location, false);
            return;
        }

        automatic = this._locationSettings?.get_boolean('enabled') ?? false;
        if (automatic) {
            this._locateWithGeoclue();
            return;
        }
        this._hasLocation = false;
        this._showStatus(_('Choose a city in the widget settings'));
    }

    _locateWithGeoclue() {
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        Geoclue.Simple.new('org.gnome.Shell', Geoclue.AccuracyLevel.CITY, cancellable, (_o, res) => {
            if (cancellable.is_cancelled() || this._cancellable !== cancellable)
                return;
            try {
                this._geoclue = Geoclue.Simple.new_finish(res);
                const geo = this._geoclue.get_location();
                const location = GWeather.Location.new_detached('', null, geo.latitude, geo.longitude);
                this._setLocation(location, true);
            } catch {
                if (!this._hasLocation)
                    this._showStatus(_('Choose a city in the widget settings'));
            }
        });
    }

    _setLocation(location, automatic) {
        this._hasLocation = true;
        this._automatic = automatic;
        this._info.location = location;
        this._info.update();
    }

    _showStatus(text) {
        this._location.text = _('Weather');
        this._arrow.visible = false;
        this._temp.text = '';
        this._icon.visible = false;
        this._sky.text = text;
        this._sky.clutter_text.line_wrap = true;
        this._range.text = '';
    }

    _sync() {
        const info = this._info;
        if (!info.is_valid()) {
            this._showStatus(info.network_error()
                ? _('Go online for weather information')
                : _('Weather information unavailable'));
            return;
        }

        this._location.text = info.get_location_name() || info.location?.get_city_name() || _('Weather');
        this._arrow.visible = this._automatic;

        const [ok, temp] = info.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
        this._temp.text = ok ? roundTemp(temp) : info.get_temp_summary();

        this._icon.icon_name = info.get_symbolic_icon_name();
        this._icon.visible = true;

        const conditions = info.get_conditions();
        this._sky.clutter_text.line_wrap = false;
        this._sky.text = conditions && conditions !== '-' ? conditions : info.get_sky();

        const now = GLib.DateTime.new_now_local().to_unix();
        const temps = [];
        for (const fc of info.get_forecast_list()) {
            const [hasTime, time] = fc.get_value_update();
            if (!hasTime || time < now - 3600 || time > now + 24 * 3600)
                continue;
            const [hasTemp, value] = fc.get_value_temp(GWeather.TemperatureUnit.DEFAULT);
            if (hasTemp)
                temps.push(value);
        }
        if (ok)
            temps.push(temp);
        this._range.text = temps.length
            ? format(_('H:{high} L:{low}'), {high: roundTemp(Math.max(...temps)), low: roundTemp(Math.min(...temps))})
            : '';

        const day = info.is_daytime();
        if (day)
            this.remove_style_class_name('tahoe-weather-night');
        else
            this.add_style_class_name('tahoe-weather-night');
    }
});
