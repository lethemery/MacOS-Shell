// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {_, getLanguage, monthNominative, weekdayInitial, weekdayLong, format} from '../../lib/i18n.js';

export const SMALL = 170;
export const MEDIUM_W = SMALL * 2 + 16;

const ACCENT_RED = [1.0, 0.23, 0.19];
const GREEN = [0.20, 0.78, 0.35];
const BLUE = [0.04, 0.52, 1.0];
const ORANGE = [1.0, 0.62, 0.04];

function rgba(c, a = 1) {
    return [...c, a];
}

export const TahoeWidget = GObject.registerClass(
class TahoeWidget extends St.Widget {
    _init(id, width, height, dark) {
        super._init({
            style_class: `tahoe-widget tahoe-widget-${id} ${dark ? 'tahoe-dark' : 'tahoe-light'}`,
            reactive: true,
            layout_manager: new Clutter.BinLayout(),
            width,
            height,
        });
        this.widgetId = id;
        this.dark = dark;
    }

    tick(_now) {}
});

export const ClockWidget = GObject.registerClass(
class TahoeClockWidget extends TahoeWidget {
    _init(dark) {
        super._init('clock', SMALL, SMALL, dark);
        this._area = new St.DrawingArea({x_expand: true, y_expand: true});
        this._area.connect('repaint', a => this._draw(a));
        this.add_child(this._area);
    }

    tick() {
        this._area.queue_repaint();
    }

    _draw(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const r = Math.min(w, h) / 2 - 10;
        const cx = w / 2, cy = h / 2;
        const fg = this.dark ? [1, 1, 1] : [0.1, 0.1, 0.12];
        const now = GLib.DateTime.new_now_local();

        cr.arc(cx, cy, r, 0, 2 * Math.PI);
        cr.setSourceRGBA(...(this.dark ? [0.11, 0.11, 0.12, 0.95] : [1, 1, 1, 0.95]));
        cr.fill();

        cr.selectFontFace('Sans', 0, 1);
        cr.setFontSize(r * 0.2);
        for (let i = 1; i <= 12; i++) {
            const a = i / 12 * 2 * Math.PI - Math.PI / 2;
            const text = String(i);
            const ext = cr.textExtents(text);
            cr.setSourceRGBA(...fg, 0.9);
            cr.moveTo(cx + Math.cos(a) * r * 0.78 - ext.width / 2 - ext.xBearing,
                cy + Math.sin(a) * r * 0.78 - ext.height / 2 - ext.yBearing);
            cr.showText(text);
        }

        for (let i = 0; i < 60; i++) {
            if (i % 5 === 0)
                continue;
            const a = i / 60 * 2 * Math.PI;
            cr.setSourceRGBA(...fg, 0.3);
            cr.setLineWidth(1);
            cr.moveTo(cx + Math.cos(a) * r * 0.93, cy + Math.sin(a) * r * 0.93);
            cr.lineTo(cx + Math.cos(a) * r * 0.97, cy + Math.sin(a) * r * 0.97);
            cr.stroke();
        }

        const sec = now.get_second() + now.get_microsecond() / 1e6;
        const min = now.get_minute() + sec / 60;
        const hour = now.get_hour() % 12 + min / 60;

        const hand = (angle, length, width, color) => {
            const a = angle * 2 * Math.PI - Math.PI / 2;
            cr.setSourceRGBA(...color);
            cr.setLineWidth(width);
            cr.setLineCap(1);
            cr.moveTo(cx - Math.cos(a) * r * 0.08, cy - Math.sin(a) * r * 0.08);
            cr.lineTo(cx + Math.cos(a) * length, cy + Math.sin(a) * length);
            cr.stroke();
        };
        hand(hour / 12, r * 0.5, r * 0.07, rgba(fg));
        hand(min / 60, r * 0.75, r * 0.05, rgba(fg));
        hand(sec / 60, r * 0.85, Math.max(1, r * 0.018), rgba(ORANGE));

        cr.arc(cx, cy, r * 0.045, 0, 2 * Math.PI);
        cr.setSourceRGBA(...rgba(ORANGE));
        cr.fill();
        cr.arc(cx, cy, r * 0.02, 0, 2 * Math.PI);
        cr.setSourceRGBA(...(this.dark ? [0.11, 0.11, 0.12, 1] : [1, 1, 1, 1]));
        cr.fill();

        cr.$dispose();
    }
});

export const CalendarWidget = GObject.registerClass(
class TahoeCalendarWidget extends TahoeWidget {
    _init(dark) {
        super._init('calendar', SMALL, SMALL, dark);
        this._box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'tahoe-widget-content',
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._box);
        this._day = -1;
    }

    tick(now) {
        if (now.get_day_of_year() === this._day)
            return;
        this._day = now.get_day_of_year();
        this._build(now);
    }

    _build(now) {
        this._box.destroy_all_children();

        this._box.add_child(new St.Label({
            text: monthNominative(now).toUpperCase(),
            style_class: 'tahoe-cal-month',
        }));

        const grid = new Clutter.GridLayout({column_homogeneous: true, row_homogeneous: true});
        const table = new St.Widget({layout_manager: grid, x_expand: true, y_expand: true,
            style_class: 'tahoe-cal-grid'});
        this._box.add_child(table);

        const mondayFirst = getLanguage() === 'ru';
        for (let c = 0; c < 7; c++) {
            const idx = mondayFirst ? c : (c + 6) % 7;
            const isWeekend = idx >= 5;
            grid.attach(new St.Label({
                text: weekdayInitial(idx),
                style_class: `tahoe-cal-head${isWeekend ? ' weekend' : ''}`,
                x_align: Clutter.ActorAlign.CENTER,
            }), c, 0, 1, 1);
        }

        const first = GLib.DateTime.new_local(now.get_year(), now.get_month(), 1, 0, 0, 0);
        const dow = first.get_day_of_week();
        const offset = mondayFirst ? dow - 1 : dow % 7;
        const days = GLib.Date.get_days_in_month(now.get_month(), now.get_year());

        for (let d = 1; d <= days; d++) {
            const pos = offset + d - 1;
            const isToday = d === now.get_day_of_month();
            grid.attach(new St.Label({
                text: String(d),
                style_class: `tahoe-cal-day${isToday ? ' today' : ''}`,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }), pos % 7, 1 + Math.floor(pos / 7), 1, 1);
        }
    }
});

export function drawRing(cr, cx, cy, r, width, fraction, color, dark) {
    cr.setLineWidth(width);
    cr.setLineCap(1);
    cr.setSourceRGBA(...(dark ? [1, 1, 1, 0.14] : [0, 0, 0, 0.09]));
    cr.arc(cx, cy, r, 0, 2 * Math.PI);
    cr.stroke();
    if (fraction > 0.001) {
        cr.setSourceRGBA(...color, 1);
        cr.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, fraction));
        cr.stroke();
    }
}

const UPowerDeviceIface = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Type" type="u" access="read"/>
    <property name="State" type="u" access="read"/>
    <property name="Percentage" type="d" access="read"/>
    <property name="IsPresent" type="b" access="read"/>
    <property name="TimeToEmpty" type="x" access="read"/>
    <property name="TimeToFull" type="x" access="read"/>
  </interface>
</node>`;
const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPowerDeviceIface);

export const BatteryWidget = GObject.registerClass(
class TahoeBatteryWidget extends TahoeWidget {
    _init(dark) {
        super._init('battery', SMALL, SMALL, dark);

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'tahoe-widget-content',
            x_expand: true,
            y_expand: true,
        });
        this.add_child(box);

        const ringBin = new St.Widget({layout_manager: new Clutter.BinLayout(), y_expand: true});
        this._area = new St.DrawingArea({width: 96, height: 96,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        this._area.connect('repaint', a => this._draw(a));
        this._icon = new St.Icon({icon_name: 'battery-symbolic', icon_size: 30,
            style_class: 'tahoe-battery-icon',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        ringBin.add_child(this._area);
        ringBin.add_child(this._icon);

        this._percent = new St.Label({style_class: 'tahoe-battery-percent',
            x_align: Clutter.ActorAlign.CENTER});
        this._state = new St.Label({style_class: 'tahoe-widget-caption',
            x_align: Clutter.ActorAlign.CENTER});

        box.add_child(ringBin);
        box.add_child(this._percent);
        box.add_child(this._state);

        this._fraction = 0;
        this._color = GREEN;
        this._percent.text = '—';

        this._proxy = null;
        new UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice', (proxy, error) => {
                if (this._destroyed)
                    return;
                if (error) {
                    this._state.text = _('No battery');
                    return;
                }
                this._proxy = proxy;
                this._propsId = proxy.connect('g-properties-changed', () => this._sync());
                this._sync();
            });

        this.connect('destroy', () => {
            this._destroyed = true;
            if (this._proxy && this._propsId)
                this._proxy.disconnect(this._propsId);
        });
    }

    _sync() {
        const p = this._proxy;
        if (!p || !p.IsPresent || p.Type !== 2) {
            this._fraction = 1;
            this._color = GREEN;
            this._percent.text = _('AC');
            this._state.text = _('No battery');
            this._icon.icon_name = 'ac-adapter-symbolic';
            this._area.queue_repaint();
            return;
        }

        const pct = Math.round(p.Percentage);
        this._fraction = pct / 100;
        this._percent.text = `${pct}%`;
        const charging = p.State === 1;
        const full = p.State === 4;
        this._color = pct <= 10 && !charging ? ACCENT_RED : pct <= 20 && !charging ? ORANGE : GREEN;

        const level = Math.min(100, Math.round(pct / 10) * 10);
        this._icon.icon_name = charging || full
            ? `battery-level-${level}-charging-symbolic`
            : `battery-level-${level}-symbolic`;

        if (full) {
            this._state.text = _('Fully charged');
        } else if (charging) {
            this._state.text = p.TimeToFull > 0
                ? format(_('{time} until full'), {time: this._formatTime(p.TimeToFull)})
                : _('Charging');
        } else {
            this._state.text = p.TimeToEmpty > 0
                ? format(_('{time} left'), {time: this._formatTime(p.TimeToEmpty)})
                : _('On battery');
        }
        this._area.queue_repaint();
    }

    _formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor(seconds % 3600 / 60);
        return format(_('{h} h {m} min'), {h, m});
    }

    _draw(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        drawRing(cr, w / 2, h / 2, Math.min(w, h) / 2 - 6, 9, this._fraction, this._color, this.dark);
        cr.$dispose();
    }
});

function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : '';
    } catch {
        return '';
    }
}

export const SystemWidget = GObject.registerClass(
class TahoeSystemWidget extends TahoeWidget {
    _init(dark, ctx) {
        super._init('system', MEDIUM_W, SMALL, dark);

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'tahoe-widget-content',
            x_expand: true,
            y_expand: true,
        });
        this.add_child(box);

        box.add_child(new St.Label({text: _('System'), style_class: 'tahoe-widget-title'}));

        const row = new St.BoxLayout({x_expand: true, y_expand: true, style_class: 'tahoe-system-row'});
        box.add_child(row);

        this._cpu = this._gauge(row, _('CPU'), BLUE);
        this._mem = this._gauge(row, _('Memory'), GREEN);
        this._swap = this._gauge(row, _('Swap'), ORANGE);

        if (ctx?.settings.get_boolean('widgets-system-battery')) {
            this._battery = this._gauge(row, _('Battery'), GREEN);
            this._battery.column.hide();
            new UPowerProxy(Gio.DBus.system, 'org.freedesktop.UPower',
                '/org/freedesktop/UPower/devices/DisplayDevice', (proxy, error) => {
                    if (error || this._destroyed)
                        return;
                    this._upower = proxy;
                    this._upowerId = proxy.connect('g-properties-changed', () => this._syncBattery());
                    this._syncBattery();
                });
            this.connect('destroy', () => {
                this._destroyed = true;
                if (this._upower && this._upowerId)
                    this._upower.disconnect(this._upowerId);
            });
        }

        this._prevCpu = null;
        this._counter = 0;
        this._sample();
    }

    _gauge(parent, title, color) {
        const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const bin = new St.Widget({layout_manager: new Clutter.BinLayout(), y_expand: true});
        const area = new St.DrawingArea({width: 68, height: 68,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        const value = new St.Label({style_class: 'tahoe-system-value',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        bin.add_child(area);
        bin.add_child(value);
        col.add_child(bin);
        const caption = new St.Label({text: title, style_class: 'tahoe-widget-caption',
            x_align: Clutter.ActorAlign.CENTER});
        col.add_child(caption);
        parent.add_child(col);

        const gauge = {area, value, caption, column: col, fraction: 0, color};
        area.connect('repaint', a => {
            const cr = a.get_context();
            const [w, h] = a.get_surface_size();
            drawRing(cr, w / 2, h / 2, Math.min(w, h) / 2 - 5, 7, gauge.fraction, gauge.color, this.dark);
            cr.$dispose();
        });
        return gauge;
    }

    _set(gauge, fraction) {
        gauge.fraction = Math.max(0, Math.min(1, fraction));
        gauge.value.text = `${Math.round(gauge.fraction * 100)}%`;
        gauge.area.queue_repaint();
    }

    tick() {
        if (++this._counter % 2 === 0)
            this._sample();
    }

    _syncBattery() {
        const p = this._upower;
        const present = p && p.IsPresent && p.Type === 2;
        this._battery.column.visible = !!present;
        if (!present)
            return;
        const charging = p.State === 1 || p.State === 4;
        const fraction = p.Percentage / 100;
        this._battery.color = fraction <= 0.1 && !charging ? ACCENT_RED
            : fraction <= 0.2 && !charging ? ORANGE : GREEN;
        this._battery.caption.text = p.State === 1 ? _('Charging') : _('Battery');
        this._set(this._battery, fraction);
    }

    _sample() {
        const stat = readFile('/proc/stat').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
        if (stat.length >= 4) {
            const idle = stat[3] + (stat[4] || 0);
            const total = stat.reduce((a, b) => a + b, 0);
            if (this._prevCpu) {
                const dt = total - this._prevCpu.total;
                const di = idle - this._prevCpu.idle;
                this._set(this._cpu, dt > 0 ? 1 - di / dt : 0);
            }
            this._prevCpu = {idle, total};
        }

        const mem = {};
        for (const line of readFile('/proc/meminfo').split('\n')) {
            const m = line.match(/^(\w+):\s+(\d+)/);
            if (m)
                mem[m[1]] = Number(m[2]);
        }
        if (mem.MemTotal)
            this._set(this._mem, 1 - (mem.MemAvailable ?? mem.MemFree) / mem.MemTotal);
        this._set(this._swap, mem.SwapTotal ? 1 - mem.SwapFree / mem.SwapTotal : 0);
    }
});

export const DateWidget = GObject.registerClass(
class TahoeDateWidget extends TahoeWidget {
    _init(dark) {
        super._init('date', SMALL, SMALL, dark);
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'tahoe-widget-content',
            x_expand: true,
            y_expand: true,
        });
        this.add_child(box);
        this._weekday = new St.Label({style_class: 'tahoe-date-weekday'});
        this._number = new St.Label({style_class: 'tahoe-date-number'});
        this._month = new St.Label({style_class: 'tahoe-widget-caption'});
        [this._weekday, this._number, this._month].forEach(a => box.add_child(a));
        this._day = -1;
    }

    tick(now) {
        if (now.get_day_of_year() === this._day)
            return;
        this._day = now.get_day_of_year();
        this._weekday.text = weekdayLong(now).toUpperCase();
        this._number.text = String(now.get_day_of_month());
        this._month.text = `${monthNominative(now)} ${now.get_year()}`;
    }
});
