// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const SUPPORTED_LANGUAGES = ['en', 'ru'];

let _catalog = new Map();
let _language = 'en';
let _baseDir = null;
let _interfaceSettings = null;

function _unescape(str) {
    return str.replace(/\\(.)/g, (m, c) => {
        switch (c) {
        case 'n': return '\n';
        case 't': return '\t';
        case '"': return '"';
        case '\\': return '\\';
        default: return c;
        }
    });
}

function _parsePo(text) {
    const catalog = new Map();
    let msgid = null, msgstr = null, current = null;

    const flush = () => {
        if (msgid && msgstr)
            catalog.set(msgid, msgstr);
        msgid = msgstr = current = null;
    };

    for (let line of text.split('\n')) {
        line = line.trim();
        if (!line || line.startsWith('#')) {
            if (!line && msgstr !== null)
                flush();
            continue;
        }

        let m;
        if ((m = line.match(/^msgid\s+"(.*)"$/))) {
            if (msgstr !== null)
                flush();
            msgid = _unescape(m[1]);
            current = 'id';
        } else if ((m = line.match(/^msgstr\s+"(.*)"$/))) {
            msgstr = _unescape(m[1]);
            current = 'str';
        } else if ((m = line.match(/^"(.*)"$/))) {
            if (current === 'id')
                msgid += _unescape(m[1]);
            else if (current === 'str')
                msgstr += _unescape(m[1]);
        }
    }
    flush();
    return catalog;
}

export function resolveLanguage(setting) {
    if (SUPPORTED_LANGUAGES.includes(setting))
        return setting;

    for (const name of GLib.get_language_names()) {
        const code = name.split(/[_.@]/)[0];
        if (SUPPORTED_LANGUAGES.includes(code))
            return code;
    }
    return 'en';
}

function _load() {
    _catalog = new Map();
    if (_language === 'en' || !_baseDir)
        return;

    const file = _baseDir.get_child('po').get_child(`${_language}.po`);
    try {
        const [, bytes] = file.load_contents(null);
        _catalog = _parsePo(new TextDecoder().decode(bytes));
    } catch (e) {
        console.warn(`[macos-shell] cannot load translation ${file.get_path()}: ${e.message}`);
    }
}

export function initI18n(baseDir, languageSetting = 'auto') {
    _baseDir = baseDir;
    setLanguage(languageSetting);
}

export function setLanguage(languageSetting) {
    _language = resolveLanguage(languageSetting);
    _load();
}

export function getLanguage() {
    return _language;
}

export function _(msgid) {
    return _catalog.get(msgid) ?? msgid;
}

export function N_(msgid) {
    return msgid;
}

export function format(str, args) {
    return str.replace(/\{(\w+)\}/g, (m, k) => k in args ? String(args[k]) : m);
}

const WEEKDAYS_SHORT = [N_('Mon'), N_('Tue'), N_('Wed'), N_('Thu'), N_('Fri'), N_('Sat'), N_('Sun')];
const WEEKDAYS_LONG = [N_('Monday'), N_('Tuesday'), N_('Wednesday'), N_('Thursday'),
    N_('Friday'), N_('Saturday'), N_('Sunday')];
const MONTHS_SHORT = [N_('Jan'), N_('Feb'), N_('Mar'), N_('Apr'), N_('May|short'), N_('Jun'),
    N_('Jul'), N_('Aug'), N_('Sep'), N_('Oct'), N_('Nov'), N_('Dec')];
const MONTHS_LONG = [N_('January'), N_('February'), N_('March'), N_('April'), N_('May'),
    N_('June'), N_('July'), N_('August'), N_('September'), N_('October'), N_('November'),
    N_('December')];
const MONTHS_NOMINATIVE = [N_('January|nominative'), N_('February|nominative'),
    N_('March|nominative'), N_('April|nominative'), N_('May|nominative'),
    N_('June|nominative'), N_('July|nominative'), N_('August|nominative'),
    N_('September|nominative'), N_('October|nominative'), N_('November|nominative'),
    N_('December|nominative')];

function _ctx(str) {
    const t = _(str);
    return t === str ? str.split('|')[0] : t;
}

export function weekdayShort(dt) {
    return _(WEEKDAYS_SHORT[dt.get_day_of_week() - 1]);
}

export function weekdayLong(dt) {
    return _(WEEKDAYS_LONG[dt.get_day_of_week() - 1]);
}

export function weekdayInitial(i) {
    return _(WEEKDAYS_SHORT[i]).substring(0, _language === 'ru' ? 2 : 1);
}

export function monthShort(dt) {
    return _ctx(MONTHS_SHORT[dt.get_month() - 1]);
}

export function monthLong(dt) {
    return _(MONTHS_LONG[dt.get_month() - 1]);
}

export function monthNominative(dt) {
    return _ctx(MONTHS_NOMINATIVE[dt.get_month() - 1]);
}

export function formatLongDate(dt) {
    const day = dt.get_day_of_month();
    const weekday = weekdayLong(dt);
    const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1);
    if (_language === 'ru')
        return `${capitalized}, ${day} ${monthLong(dt)}`;
    return `${capitalized}, ${monthLong(dt)} ${day}`;
}

export function formatShortDate(dt) {
    const day = dt.get_day_of_month();
    if (_language === 'ru')
        return `${weekdayShort(dt)} ${day} ${monthShort(dt)}`;
    return `${weekdayShort(dt)} ${monthShort(dt)} ${day}`;
}

export function formatTime(dt, seconds = false) {
    _interfaceSettings ??= new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const h24 = _interfaceSettings.get_string('clock-format') !== '12h';

    if (h24)
        return dt.format(seconds ? '%H:%M:%S' : '%H:%M');
    return dt.format(seconds ? '%-l:%M:%S %p' : '%-l:%M %p');
}
