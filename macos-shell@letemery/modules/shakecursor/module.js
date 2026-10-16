// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';

const WATCH_INTERVAL = 10;
const WINDOW = 500;
const MIN_RUN = 30;
const GROWTH = 0.006;
const SETTLE = 300;
const FRAME = 16;
const HOTSPOT = [14 / 64, 6 / 64];   // arrow tip in icons/tahoe-cursor.svg

const SENSITIVITY = {
    low: {reversals: 4, distance: 1300},
    normal: {reversals: 3, distance: 900},
    high: {reversals: 2, distance: 600},
};

export default class ShakeCursorModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    enable() {
        this._samples = [];
        this._scale = 1;
        this._target = 1;
        this._lastShake = 0;
        this._tickId = 0;
        this._hidden = false;
        this._cursorTracker = global.backend.get_cursor_tracker();
        this._seat = Clutter.get_default_backend().get_default_seat();

        this._watch = PointerWatcher.getPointerWatcher().addWatch(WATCH_INTERVAL,
            (x, y) => this._onMotion(x, y));
    }

    disable() {
        this._watch?.remove();
        this._watch = null;
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        this._hideBigCursor();
        this._cursor?.destroy();
        this._cursor = null;
        this._samples = [];
    }

    get _maxScale() {
        return this._ctx.settings.get_double('shakecursor-max-size');
    }

    _onMotion(x, y, now = GLib.get_monotonic_time() / 1000) {
        const samples = this._samples;
        const last = samples[samples.length - 1];
        samples.push({t: now, x});
        while (samples.length && now - samples[0].t > WINDOW)
            samples.shift();

        if (this._isShaking()) {
            const dx = last ? Math.abs(x - last.x) : 0;
            this._target = Math.min(this._maxScale, Math.max(this._target, this._scale) + dx * GROWTH);
            this._lastShake = now;
            this._startTicking();
        }
        if (this._cursor?.visible)
            this._placeCursor(x, y);
    }

    _isShaking() {
        const need = SENSITIVITY[this._ctx.settings.get_string('shakecursor-sensitivity')] ??
            SENSITIVITY.normal;
        let reversals = 0, distance = 0, run = 0, direction = 0;
        for (let i = 1; i < this._samples.length; i++) {
            const dx = this._samples[i].x - this._samples[i - 1].x;
            distance += Math.abs(dx);
            if (dx === 0)
                continue;
            const sign = Math.sign(dx);
            if (sign === direction) {
                run += Math.abs(dx);
            } else {
                if (direction !== 0 && run >= MIN_RUN)
                    reversals++;
                direction = sign;
                run = Math.abs(dx);
            }
        }
        return reversals >= need.reversals && distance >= need.distance;
    }

    _startTicking() {
        if (this._tickId)
            return;
        this._tickId = GLib.timeout_add(GLib.PRIORITY_HIGH, FRAME, () => this._tick());
    }

    _tick() {
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastShake > SETTLE)
            this._target = 1;
        const k = this._target > this._scale ? 0.3 : 0.18;
        this._scale += (this._target - this._scale) * k;

        if (this._target === 1 && this._scale < 1.02) {
            this._scale = 1;
            this._hideBigCursor();
            this._tickId = 0;
            return GLib.SOURCE_REMOVE;
        }
        if (this._scale > 1.05)
            this._showBigCursor();
        const [x, y] = global.get_pointer();
        this._placeCursor(x, y);
        return GLib.SOURCE_CONTINUE;
    }

    _baseSize() {
        return Meta.prefs_get_cursor_size() || 24;
    }

    _ensureCursor() {
        if (this._cursor)
            return;
        const file = this._ctx.dir.get_child('icons').get_child('tahoe-cursor.svg');
        this._cursor = new St.Icon({
            gicon: new Gio.FileIcon({file}),
            icon_size: Math.ceil(this._baseSize() * 8),
            reactive: false,
            visible: false,
        });
        Main.layoutManager.uiGroup.add_child(this._cursor);
    }

    _showBigCursor() {
        this._ensureCursor();
        if (this._cursor.visible)
            return;
        Main.layoutManager.uiGroup.set_child_above_sibling(this._cursor, null);
        this._cursor.show();
        if (!this._hidden) {
            // The same two calls GNOME's magnifier uses; the tracker alone
            // leaves the hardware cursor on screen.
            this._seat.inhibit_unfocus();
            this._cursorTracker.inhibit_cursor_visibility();
            global.compositor.disable_unredirect();
            this._hidden = true;
        }
    }

    _hideBigCursor() {
        this._cursor?.hide();
        if (this._hidden) {
            this._seat.uninhibit_unfocus();
            this._cursorTracker.uninhibit_cursor_visibility();
            global.compositor.enable_unredirect();
            this._hidden = false;
        }
    }

    _placeCursor(x, y) {
        const cursor = this._cursor;
        if (!cursor)
            return;
        const scale = this._scale / 8;
        const size = cursor.icon_size * scale;
        cursor.set_scale(scale, scale);
        cursor.set_position(Math.round(x - HOTSPOT[0] * size), Math.round(y - HOTSPOT[1] * size));
    }
}
