// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const GENIE_TIME = 520;
const SCALE_TIME = 330;
const SPEED = {fast: 0.65, normal: 1, slow: 1.6};
const ICON_FALLBACK = 48;

const ANIMATED_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.DIALOG,
];

const clamp01 = t => Math.max(0, Math.min(1, t));
const smoothstep = t => t * t * (3 - 2 * t);
const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

// The genie is drawn by a fragment shader on a canvas that covers both the
// window and its dock icon: for every pixel it finds which window pixel
// lands there. Coordinates are in canvas pixels; `tgt` is relative to the
// window, worked out as if the icon were below it (`flip` mirrors that).
const GENIE_DECLARATIONS = `
uniform vec4 win;      // window x, y, width, height
uniform vec4 tgt;      // icon x, y, width, height (relative to the window)
uniform vec2 canvas;   // canvas width, height
uniform vec2 phase;    // bend, slide
uniform float flip;`;

const GENIE_CODE = `
vec2 p = cogl_tex_coord_in[0].xy * canvas;
float w = win.z;
float h = win.w;
float X = p.x - win.x;
float Y = p.y - win.y;
if (flip > 0.5)
    Y = h - Y;
float T = tgt.y;
float H = mix(h, max(h, T), phase.x);
float top = phase.y * T;
float bottom = H + top;
float y0 = Y;
if (Y > T && bottom - T > tgt.w) {
    float k = tgt.w / (bottom - T);
    if (T < h)
        k = mix(1.0, k, phase.y);
    y0 = T + (Y - T) / k;
}
float v = (y0 - top) / H;

// The curve stays put on screen, from where the window was down to the
// icon, so the window's top narrows too as it slides down the funnel.
float neck = T > 1.0 ? smoothstep(0.0, 1.0, clamp(Y / T, 0.0, 1.0)) : 1.0;
float f = neck * phase.x;
float left = mix(0.0, tgt.x, f);
float right = mix(w, tgt.x + tgt.z, f);
float u = (X - left) / max(right - left, 0.001);

float edge = clamp(min(X - left, right - X) + 0.5, 0.0, 1.0);
if (edge <= 0.0 || v < 0.0 || v > 1.0) {
    cogl_color_out = vec4(0.0);
} else {
    if (flip > 0.5)
        v = 1.0 - v;
    vec2 src = (win.xy + vec2(clamp(u, 0.0, 1.0) * w, v * h)) / canvas;
    cogl_color_out = texture2D(cogl_sampler0, src) * cogl_color_in.a * edge;
}`;

const GenieEffect = GObject.registerClass(
class TahoeGenieEffect extends Shell.GLSLEffect {
    _init() {
        super._init();
        this._locations = {};
        for (const name of ['win', 'tgt', 'canvas', 'phase', 'flip'])
            this._locations[name] = this.get_uniform_location(name);
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, GENIE_DECLARATIONS, GENIE_CODE, false);
    }

    set(name, ...values) {
        this.set_uniform_float(this._locations[name], values.length, values);
    }
});

export default class AnimationsModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    enable() {
        this._running = new Map();
        const wm = global.window_manager;

        // GNOME's handlers were connected first, at startup.
        this._blocked = [];
        for (const signal of ['minimize', 'unminimize']) {
            const id = GObject.signal_handler_find(wm, {signalId: signal});
            if (id) {
                GObject.signal_handler_block(wm, id);
                this._blocked.push(id);
            }
        }
        wm.connectObject(
            'minimize', (_wm, actor) => this._animate(actor, true),
            'unminimize', (_wm, actor) => this._animate(actor, false),
            'kill-window-effects', (_wm, actor) => this._running.get(actor)?.finish(),
            this);
    }

    disable() {
        const wm = global.window_manager;
        wm.disconnectObject(this);
        for (const {finish} of [...this._running.values()])
            finish();
        this._running = null;
        for (const id of this._blocked)
            GObject.signal_handler_unblock(wm, id);
        this._blocked = [];
    }

    _complete(actor, minimize) {
        if (minimize)
            global.window_manager.completed_minimize(actor);
        else
            global.window_manager.completed_unminimize(actor);
    }

    _duration(base) {
        return base * (SPEED[this._ctx.settings.get_string('animations-speed')] ?? 1);
    }

    _targetRect(window) {
        const rect = this._ctx.dockIconRect?.(window);
        if (rect)
            return rect;
        const [ok, geom] = window.get_icon_geometry();
        if (ok && geom.width > 0)
            return {x: geom.x, y: geom.y, width: geom.width, height: geom.height};
        const monitor = Main.layoutManager.monitors[window.get_monitor()] ?? Main.layoutManager.primaryMonitor;
        if (!monitor)
            return null;
        return {
            x: monitor.x + (monitor.width - ICON_FALLBACK) / 2,
            y: monitor.y + monitor.height - ICON_FALLBACK - 8,
            width: ICON_FALLBACK,
            height: ICON_FALLBACK,
        };
    }

    _animate(actor, minimize) {
        this._running.get(actor)?.finish();

        const window = actor.meta_window;
        const target = window ? this._targetRect(window) : null;
        if (!target || !Main.wm._shouldAnimateActor(actor, ANIMATED_TYPES)) {
            this._complete(actor, minimize);
            return;
        }

        const rect = window.get_buffer_rect();
        actor.remove_all_transitions();
        actor.set_position(rect.x, rect.y);
        actor.set_pivot_point(0, 0);
        actor.set_scale(1, 1);
        actor.opacity = 255;

        if (this._ctx.settings.get_string('animations-effect') === 'scale')
            this._scale(actor, minimize, target);
        else
            this._genie(actor, minimize, target);
    }

    _track(actor, minimize, cleanup) {
        global.compositor.disable_unredirect();
        let done = false;
        const finish = (complete = true) => {
            if (done)
                return;
            done = true;
            this._running?.delete(actor);
            actor.disconnectObject(this);
            cleanup();
            actor.set_scale(1, 1);
            actor.set_pivot_point(0, 0);
            actor.opacity = 255;
            global.compositor.enable_unredirect();
            if (complete)
                this._complete(actor, minimize);
        };
        actor.connectObject('destroy', () => finish(false), this);
        this._running.set(actor, {finish: () => finish()});
        return finish;
    }

    _genie(actor, minimize, target) {
        const win = {x: actor.x, y: actor.y, width: actor.width, height: actor.height};
        const flip = target.y + target.height / 2 < win.y + win.height / 2;
        const gap = flip ? win.y - (target.y + target.height) : target.y - win.y;
        if (gap <= 0) {
            this._scale(actor, minimize, target);
            return;
        }

        const x1 = Math.floor(Math.min(win.x, target.x));
        const y1 = Math.floor(Math.min(win.y, target.y));
        const x2 = Math.ceil(Math.max(win.x + win.width, target.x + target.width));
        const y2 = Math.ceil(Math.max(win.y + win.height, target.y + target.height));
        const canvas = new Clutter.Actor({x: x1, y: y1, width: x2 - x1, height: y2 - y1});
        canvas.add_child(new Clutter.Clone({source: actor, x: win.x - x1, y: win.y - y1}));

        const effect = new GenieEffect();
        effect.set('win', win.x - x1, win.y - y1, win.width, win.height);
        const ty = flip ? win.y + win.height - (target.y + target.height) : target.y - win.y;
        effect.set('tgt', target.x - win.x, ty, target.width, target.height);
        effect.set('canvas', x2 - x1, y2 - y1);
        effect.set('flip', flip ? 1 : 0);
        canvas.add_effect(effect);

        global.window_group.insert_child_above(canvas, actor);
        actor.opacity = 0;

        const timeline = new Clutter.Timeline({actor: canvas, duration: this._duration(GENIE_TIME)});
        const update = () => {
            const t = timeline.get_progress();
            const p = minimize ? t : 1 - t;
            effect.set('phase', smoothstep(clamp01(p / 0.4)), easeInOut(clamp01((p - 0.3) / 0.7)));
            canvas.opacity = Math.round(255 * clamp01((1 - p) / 0.12));
            effect.queue_repaint();
        };

        const finish = this._track(actor, minimize, () => {
            timeline.disconnectObject(this);
            timeline.stop();
            canvas.destroy();
        });
        timeline.connectObject(
            'new-frame', update,
            'completed', () => finish(), this);

        update();
        if (!minimize)
            actor.show();
        timeline.start();
    }

    _scale(actor, minimize, target) {
        const rect = actor.meta_window.get_buffer_rect();
        const scale = Math.min(target.width / actor.width, target.height / actor.height);
        const small = {
            x: target.x + (target.width - actor.width * scale) / 2,
            y: target.y + (target.height - actor.height * scale) / 2,
            scale_x: scale,
            scale_y: scale,
            opacity: 0,
        };
        const full = {x: rect.x, y: rect.y, scale_x: 1, scale_y: 1, opacity: 255};
        const [from, to] = minimize ? [full, small] : [small, full];

        const finish = this._track(actor, minimize, () => {
            actor.remove_all_transitions();
            actor.set_position(rect.x, rect.y);
        });
        actor.set_position(from.x, from.y);
        actor.set_scale(from.scale_x, from.scale_y);
        actor.opacity = from.opacity;
        if (!minimize)
            actor.show();
        actor.ease({
            ...to,
            duration: this._duration(SCALE_TIME),
            mode: minimize ? Clutter.AnimationMode.EASE_IN_QUAD : Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => finish(),
        });
    }
}
