// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from '../../lib/i18n.js';
import {SMALL, BatteryWidget, CalendarWidget, ClockWidget, DateWidget, SystemWidget} from './widgets.js';
import {WeatherWidget} from './weather.js';
import {BatteriesWidget} from './batteries.js';

const WIDGET_TYPES = {
    clock: ClockWidget,
    calendar: CalendarWidget,
    date: DateWidget,
    weather: WeatherWidget,
    battery: BatteryWidget,
    system: SystemWidget,
};

const GAP = 16;
const DRAG_THRESHOLD = 6;

const DEFAULT_SLOTS = {
    clock: [0, 0],
    calendar: [1, 0],
    weather: [0, 1],
    system: [0, 2],
    battery: [1, 1],
    date: [0, 4],
};
const WIDE_BATTERY_SLOT = [0, 3];

export default class WidgetsModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    enable() {
        this._ids = [
            ...this._ctx.watch(['widgets-enabled', 'widgets-scale', 'widgets-battery-size',
                'widgets-system-battery'],
                () => this._rebuild()),
            ...this._ctx.watch(['widgets-layer'], () => this._attachLayer()),
            ...this._ctx.watch(['widgets-positions'], () => {
                if (!this._savingPositions)
                    this._placeAll();
            }),
        ];

        // A Meta.BackgroundGroup on purpose: whenever windows are restacked,
        // Mutter lowers all window actors and then all background groups to
        // the bottom of window_group. Any other actor would end up above the
        // windows (this is why widgets used to cover the browser and the
        // terminal); a background group stays with the wallpaper.
        this._layer = new Meta.BackgroundGroup({name: 'tahoeWidgetsLayer', reactive: false});
        this._menuManager = new PopupMenu.PopupMenuManager(this._layer);
        this._widgets = [];

        Main.layoutManager.connectObject('monitors-changed', () => this._placeAll(), this);
        global.display.connectObject('workareas-changed', () => this._placeAll(), this);
        Main.overview.connectObject(
            'showing', () => this._syncOverview(true),
            'hidden', () => this._syncOverview(false), this);
        // Workspace switch animations cover the real windows (and anything in
        // window_group) with their own copies; put our widgets into them too.
        Main.layoutManager.uiGroup.connectObject('child-added',
            (_p, child) => this._onUiChildAdded(child), this);

        this._attachLayer();
        this._rebuild();

        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            const now = GLib.DateTime.new_now_local();
            this._widgets.forEach(w => w.tick(now));
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        this._ctx.unwatch(this._ids);
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        Main.layoutManager.disconnectObject(this);
        Main.layoutManager.uiGroup.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.overview.disconnectObject(this);

        this._clear();
        this._menuAnchor?.destroy();
        this._menuAnchor = null;
        this._detachLayer();
        this._layer.destroy();
        this._layer = null;
        this._menuManager = null;
    }

    onLanguageChanged() {
        this._rebuild();
    }

    onAppearanceChanged() {
        this._rebuild();
    }

    get _onTop() {
        return this._ctx.settings.get_string('widgets-layer') === 'top';
    }

    _detachLayer() {
        if (this._layerTracked) {
            Main.layoutManager.removeChrome(this._layer);
            this._layerTracked = false;
        }
        this._layer.get_parent()?.remove_child(this._layer);
    }

    _attachLayer() {
        this._detachLayer();
        if (this._onTop) {
            Main.layoutManager.addChrome(this._layer, {trackFullscreen: true});
            this._layerTracked = true;
            Main.layoutManager.uiGroup.set_child_above_sibling(this._layer, global.window_group);
        } else {
            global.window_group.insert_child_above(this._layer, Main.layoutManager._backgroundGroup);
        }
        this._syncOverview(Main.overview.visible);
    }

    _syncOverview(inOverview) {
        if (!this._onTop)
            return;
        this._layer.remove_all_transitions();
        if (inOverview) {
            this._layer.ease({
                opacity: 0,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this._layer?.hide(),
            });
        } else {
            this._layer.show();
            this._layer.ease({opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    _onUiChildAdded(child) {
        if (this._onTop || !child.has_style_class_name?.('workspace-animation'))
            return;
        const monitor = child._monitor;
        for (const group of child._workspaceGroups ?? []) {
            const background = group._background;
            if (!background || !monitor)
                continue;
            const clone = new Clutter.Clone({source: this._layer});
            clone.set_position(-monitor.x, -monitor.y);
            background.add_child(clone);
        }
    }

    _clear() {
        this._endDrag();
        this._menu?.destroy();
        this._menu = null;
        this._widgets.forEach(w => w.destroy());
        this._widgets = [];
    }

    _rebuild() {
        this._clear();
        const dark = this._ctx.appearance === 'dark';
        const scale = this._ctx.settings.get_double('widgets-scale');
        const now = GLib.DateTime.new_now_local();

        for (const id of this._ctx.settings.get_strv('widgets-enabled')) {
            const Type = id === 'battery' && this._ctx.settings.get_string('widgets-battery-size') === 'wide'
                ? BatteriesWidget : WIDGET_TYPES[id];
            if (!Type)
                continue;
            let widget;
            try {
                widget = new Type(dark, this._ctx);
            } catch (e) {
                console.error(`[tahoe-widgets] cannot create ${id}: ${e.message}`);
                continue;
            }
            widget.set_scale(scale, scale);
            this._layer.add_child(widget);
            this._connectWidget(widget);
            widget.tick(now);
            this._widgets.push(widget);

            widget.opacity = 0;
            widget.ease({opacity: 255, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        this._placeAll();
    }

    _workArea() {
        return Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
    }

    _positions() {
        try {
            return JSON.parse(this._ctx.settings.get_string('widgets-positions')) ?? {};
        } catch {
            return {};
        }
    }

    _placeAll() {
        const area = this._workArea();
        if (!area)
            return;
        const positions = this._positions();
        const scale = this._ctx.settings.get_double('widgets-scale');
        const cell = (SMALL + GAP) * scale;

        for (const w of this._widgets) {
            const saved = positions[w.widgetId];
            let x, y;
            if (Array.isArray(saved)) {
                x = area.x + saved[0] * area.width;
                y = area.y + saved[1] * area.height;
            } else {
                const wide = w.widgetId === 'battery' && w instanceof BatteriesWidget;
                const [col, row] = wide ? WIDE_BATTERY_SLOT : DEFAULT_SLOTS[w.widgetId] ?? [0, 0];
                x = area.x + GAP * 2 + col * cell;
                y = area.y + GAP * 2 + row * cell;
            }
            w.set_position(Math.round(x), Math.round(y));
            this._clampIntoWorkArea(w);
        }
    }

    _clampIntoWorkArea(widget) {
        const area = this._workArea();
        if (!area)
            return;
        const scale = this._ctx.settings.get_double('widgets-scale');
        const [ww, wh] = [widget.width * scale, widget.height * scale];
        const x = Math.max(area.x, Math.min(widget.x, area.x + area.width - ww));
        const y = Math.max(area.y, Math.min(widget.y, area.y + area.height - wh));
        widget.set_position(Math.round(x), Math.round(y));
    }

    _savePosition(widget) {
        const area = this._workArea();
        const positions = this._positions();
        positions[widget.widgetId] = [
            (widget.x - area.x) / area.width,
            (widget.y - area.y) / area.height,
        ];
        this._savingPositions = true;
        this._ctx.settings.set_string('widgets-positions', JSON.stringify(positions));
        this._savingPositions = false;
    }

    _connectWidget(widget) {
        widget.connect('button-press-event', (_a, event) => {
            const button = event.get_button();
            if (button === Clutter.BUTTON_SECONDARY) {
                this._openMenu(widget, event);
                return Clutter.EVENT_STOP;
            }
            if (button !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;

            const [sx, sy] = event.get_coords();
            this._drag = {
                widget,
                startX: sx,
                startY: sy,
                origX: widget.x,
                origY: widget.y,
                moved: false,
                grab: global.stage.grab(widget),
            };
            return Clutter.EVENT_STOP;
        });

        widget.connect('motion-event', (_a, event) => {
            const d = this._drag;
            if (!d || d.widget !== widget)
                return Clutter.EVENT_PROPAGATE;
            const [sx, sy] = event.get_coords();
            const dx = sx - d.startX, dy = sy - d.startY;
            if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD)
                return Clutter.EVENT_STOP;
            if (this._ctx.settings.get_boolean('widgets-locked'))
                return Clutter.EVENT_STOP;

            if (!d.moved) {
                d.moved = true;
                widget.add_style_pseudo_class('dragging');
                widget.get_parent().set_child_above_sibling(widget, null);
            }
            widget.set_position(Math.round(d.origX + dx), Math.round(d.origY + dy));
            return Clutter.EVENT_STOP;
        });

        widget.connect('button-release-event', (_a, event) => {
            const d = this._drag;
            if (!d || d.widget !== widget || event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            const moved = d.moved;
            this._endDrag();
            if (moved) {
                // Keep the dropped widget inside the work area and remember
                // where it is (laying out everything first would put it back
                // at its old saved position).
                this._clampIntoWorkArea(widget);
                this._savePosition(widget);
            } else {
                widget.activate?.();
            }
            return Clutter.EVENT_STOP;
        });
    }

    _endDrag() {
        if (!this._drag)
            return;
        this._drag.grab?.dismiss();
        this._drag.widget.remove_style_pseudo_class('dragging');
        this._drag = null;
    }

    _openMenu(widget, event) {
        this._menu?.destroy();

        const [x, y] = event.get_coords();
        this._menuAnchor ??= new St.Widget({width: 1, height: 1});
        if (!this._menuAnchor.get_parent())
            Main.layoutManager.uiGroup.add_child(this._menuAnchor);
        this._menuAnchor.set_position(x, y);

        const menu = new PopupMenu.PopupMenu(this._menuAnchor, 0, St.Side.TOP);
        menu.actor.add_style_class_name('tahoe-menu');
        const s = this._ctx.settings;

        menu.addAction(_('Remove widget'), () => {
            s.set_strv('widgets-enabled', s.get_strv('widgets-enabled').filter(id => id !== widget.widgetId));
        });
        const locked = s.get_boolean('widgets-locked');
        menu.addAction(locked ? _('Unlock widget positions') : _('Lock widget positions'),
            () => s.set_boolean('widgets-locked', !locked));
        menu.addAction(_('Reset positions'), () => s.set_string('widgets-positions', '{}'));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction(_('Edit widgets…'), () => this._ctx.openPreferences());

        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        this._menuManager.addMenu(menu);
        menu.connect('open-state-changed', (_m, open) => {
            if (!open) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (this._menu === menu) {
                        menu.destroy();
                        this._menu = null;
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        this._menu = menu;
        menu.open(BoxPointer.PopupAnimation.FULL);
    }
}
