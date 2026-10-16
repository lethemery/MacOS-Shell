// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';

import {_} from '../../lib/i18n.js';

const DOT_SPACE = 7;
const MAGNIFY_RANGE = 3.0;
const AMP_DURATION = 160;
const BOUNCE_HEIGHT = 0.45;
const BOUNCE_UP = 260;
const BOUNCE_DOWN = 300;
const MAX_LAUNCH_BOUNCES = 6;

const DockItem = GObject.registerClass(
class TahoeDockItem extends St.Button {
    _init(dock, params) {
        super._init({
            style_class: 'tahoe-dock-item',
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.END,
        });
        this._dock = dock;
        this.scale = 1;

        this._content = new St.Widget();
        this.set_child(this._content);

        this.icon = new St.Icon({
            style_class: 'tahoe-dock-icon',
            pivot_point: new Graphene.Point({x: 0.5, y: 1}),
            ...params.gicon ? {gicon: params.gicon} : {icon_name: params.iconName ?? 'application-x-executable'},
        });
        this._content.add_child(this.icon);

        this._dot = new St.Widget({style_class: 'tahoe-dock-dot', visible: false});
        this._content.add_child(this._dot);

        this.connect('notify::hover', () => this._dock.itemHoverChanged(this));
        this.connect('clicked', (_b, button) => {
            this._dock.hideLabel();
            if (button === Clutter.BUTTON_SECONDARY)
                this.openMenu?.();
            else
                this.activate(button);
        });
        this.connect('popup-menu', () => this.openMenu?.());
        this.connect('destroy', () => this._onDestroy());
    }

    get labelText() {
        return '';
    }

    setGeometry(base, maxScale, scale) {
        this.scale = scale;
        const big = Math.round(base * maxScale);
        if (this.icon.icon_size !== big)
            this.icon.icon_size = big;

        const w = Math.round(base * scale);
        this._content.set_size(w, base + DOT_SPACE);
        this.icon.set_position(Math.round((w - big) / 2), base - big);
        this.icon.set_scale(scale / maxScale, scale / maxScale);
        this._dot.set_size(4, 4);
        this._dot.set_position(Math.round(w / 2 - 2), base + Math.round((DOT_SPACE - 4) / 2));
    }

    setRunning(running) {
        this._dot.visible = running;
    }

    appear() {
        this.icon.opacity = 0;
        this.icon.ease({opacity: 255, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    bounce(times = 1, keepGoing = () => true) {
        if (this._bouncing || !this._dock.settings.get_boolean('dock-bounce'))
            return;
        this._bouncing = true;
        const height = this._dock.iconSize * BOUNCE_HEIGHT;

        const step = left => {
            if (!this.icon || left <= 0 || !keepGoing()) {
                this._bouncing = false;
                return;
            }
            this.icon.ease({
                translation_y: -height,
                duration: BOUNCE_UP,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this.icon?.ease({
                    translation_y: 0,
                    duration: BOUNCE_DOWN,
                    mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
                    onComplete: () => step(left - 1),
                }),
            });
        };
        step(times);
    }

    activate(_button) {}

    _onDestroy() {
        this._menu?.destroy();
        this._menu = null;
        this.icon = null;
    }
});

const AppItem = GObject.registerClass(
class TahoeDockAppItem extends DockItem {
    _init(dock, app) {
        super._init(dock, {gicon: app.get_icon()});
        this.app = app;
        this._launching = false;

        app.connectObject(
            'notify::state', () => this._sync(),
            'windows-changed', () => this._sync(), this);
        this._sync();
    }

    get labelText() {
        return this.app.get_name();
    }

    _windows() {
        return this.app.get_windows().filter(w => !w.skip_taskbar);
    }

    _sync() {
        const running = this.app.state !== Shell.AppState.STOPPED;
        this.setRunning(running);
        if (this._windows().length > 0)
            this._launching = false;
    }

    _launch(newWindow = false) {
        this._launching = true;
        this.bounce(MAX_LAUNCH_BOUNCES, () => this._launching);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, BOUNCE_UP * MAX_LAUNCH_BOUNCES * 2, () => {
            this._launching = false;
            return GLib.SOURCE_REMOVE;
        });

        if (newWindow && this.app.can_open_new_window())
            this.app.open_new_window(-1);
        else
            this.app.activate();
        Main.overview.hide();
    }

    activate(button) {
        const event = Clutter.get_current_event();
        const modifiers = event ? event.get_state() : 0;
        const ctrl = (modifiers & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const windows = this._windows();

        if (button === Clutter.BUTTON_MIDDLE || ctrl) {
            this._launch(true);
            return;
        }

        if (windows.length === 0) {
            this._launch();
            return;
        }

        const focused = global.display.focus_window;
        const isFocused = windows.includes(focused) && !Main.overview.visible;

        if (isFocused) {
            const action = this._dock.settings.get_string('dock-click-action');
            if (action === 'minimize') {
                const ws = global.workspace_manager.get_active_workspace();
                windows.filter(w => w.located_on_workspace(ws) && w.can_minimize())
                    .forEach(w => w.minimize());
                return;
            }
            if (action === 'cycle' && windows.length > 1) {
                const sorted = global.display.sort_windows_by_stacking(windows);
                Main.activateWindow(sorted[0]);
                return;
            }
        }

        const allMinimized = windows.every(w => w.minimized);
        if (allMinimized)
            windows.forEach(w => w.unminimize());
        this.app.activate();
        Main.overview.hide();
    }

    openMenu() {
        if (!this._menu) {
            this._menu = new AppMenu(this, St.Side.BOTTOM, {
                favoritesSection: true,
                showSingleWindows: true,
            });
            this._menu.actor.add_style_class_name('tahoe-menu');
            this._menu.setApp(this.app);
            this._menu.connect('open-state-changed', (_m, open) => this._dock.menuStateChanged(open));
            Main.uiGroup.add_child(this._menu.actor);
            this._dock.menuManager.addMenu(this._menu);
        }
        this._menu.open(BoxPointer.PopupAnimation.FULL);
        this._dock.menuManager.ignoreRelease?.();
    }

    _onDestroy() {
        this.app.disconnectObject(this);
        super._onDestroy();
    }
});

const LauncherItem = GObject.registerClass(
class TahoeDockLauncherItem extends DockItem {
    _init(dock, iconFile) {
        super._init(dock, {gicon: Gio.FileIcon.new(iconFile)});
    }

    get labelText() {
        return this._dock.settings.get_boolean('module-launchpad') ? 'Launchpad' : _('Applications');
    }

    activate() {
        if (Main.overview.visible)
            Main.overview.hide();
        else
            Main.overview.showApps();
    }
});

const TrashItem = GObject.registerClass(
class TahoeDockTrashItem extends DockItem {
    _init(dock) {
        super._init(dock, {iconName: 'user-trash'});
        this._trash = Gio.File.new_for_uri('trash:///');
        this._cancellable = new Gio.Cancellable();
        try {
            this._monitor = this._trash.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', () => this._update());
        } catch (e) {
            console.warn(`[tahoe-dock] trash monitor: ${e.message}`);
        }
        this._update();
    }

    get labelText() {
        return _('Trash');
    }

    _update() {
        this._trash.query_info_async('trash::item-count', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_LOW, this._cancellable, (file, res) => {
                try {
                    const info = file.query_info_finish(res);
                    const count = info.get_attribute_uint32('trash::item-count');
                    if (this.icon)
                        this.icon.icon_name = count > 0 ? 'user-trash-full' : 'user-trash';
                } catch {}
            });
    }

    activate() {
        try {
            Gio.AppInfo.launch_default_for_uri('trash:///',
                global.create_app_launch_context(0, -1));
        } catch (e) {
            Main.notifyError(_('Trash'), e.message);
        }
        Main.overview.hide();
    }

    openMenu() {
        if (!this._menu) {
            this._menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.BOTTOM);
            this._menu.actor.add_style_class_name('tahoe-menu');
            this._menu.addAction(_('Open'), () => this.activate());
            this._menu.addAction(_('Empty Trash'), () => {
                try {
                    Gio.Subprocess.new(['gio', 'trash', '--empty'], Gio.SubprocessFlags.NONE);
                } catch (e) {
                    Main.notifyError(_('Trash'), e.message);
                }
            });
            this._menu.connect('open-state-changed', (_m, open) => this._dock.menuStateChanged(open));
            Main.uiGroup.add_child(this._menu.actor);
            this._dock.menuManager.addMenu(this._menu);
            this._menu.actor.hide();
        }
        this._menu.open(BoxPointer.PopupAnimation.FULL);
        this._dock.menuManager.ignoreRelease?.();
    }

    _onDestroy() {
        this._cancellable.cancel();
        this._monitor?.cancel();
        this._monitor = null;
        super._onDestroy();
    }
});

const Separator = GObject.registerClass(
class TahoeDockSeparator extends St.Widget {
    _init() {
        super._init({
            style_class: 'tahoe-dock-separator',
            y_align: Clutter.ActorAlign.CENTER,
        });
    }

    setGeometry(base) {
        this.set_size(1, Math.round(base * 0.75));
        this.translation_y = -Math.round(DOT_SPACE / 2);
    }
});

export class Dock {
    constructor(ctx, extDir) {
        this._ctx = ctx;
        this.settings = ctx.settings;
        this._extDir = extDir;

        this._appSystem = Shell.AppSystem.get_default();
        this._tracker = Shell.WindowTracker.get_default();
        this._favorites = AppFavorites.getAppFavorites();

        this._items = new Map();
        this._amp = 0;
        this._mouseX = -1;
        this._menuOpen = false;
        this._hoveredItem = null;
        this._firstDisplay = true;

        this._buildActors();
        this._connectSignals();

        this._redisplay();
        this._updateStrut();
        this._applyStyle();
        this._syncOverviewDash();
        this._slideIn();
    }

    get iconSize() {
        return this.settings.get_int('dock-icon-size');
    }

    get _maxScale() {
        return this.settings.get_boolean('dock-magnification')
            ? this.settings.get_double('dock-magnification-scale') : 1.0;
    }

    _buildActors() {
        this._box = new St.BoxLayout({
            name: 'tahoeDock',
            style_class: 'tahoe-dock',
            reactive: true,
            track_hover: true,
        });
        this._box._delegate = this;

        Main.layoutManager.addChrome(this._box, {
            trackFullscreen: true,
            affectsStruts: false,
        });
        Main.layoutManager.uiGroup.set_child_above_sibling(this._box, Main.layoutManager.panelBox);

        this.menuManager = new PopupMenu.PopupMenuManager(this._box);

        this._label = new St.Label({style_class: 'tahoe-dock-label', visible: false});
        Main.layoutManager.uiGroup.add_child(this._label);

        // Invisible, full-width strip that reserves the dock's height so
        // maximized windows end right above the dock.
        this._strut = new St.Widget({name: 'tahoeDockStrut', reactive: false, opacity: 0});

        this._ampTimeline = new Clutter.Timeline({actor: this._box, duration: AMP_DURATION});
        this._ampTimeline.connect('new-frame', () => {
            const p = this._ampTimeline.get_progress();
            const eased = 1 - (1 - p) * (1 - p);
            this._amp = this._ampFrom + (this._ampTo - this._ampFrom) * eased;
            this._updateLayout();
        });
        this._ampTimeline.connect('completed', () => {
            this._amp = this._ampTo;
            this._updateLayout();
        });
    }

    _connectSignals() {
        this._box.connect('captured-event', (_a, event) => {
            if (event.type() === Clutter.EventType.MOTION && !this._menuOpen) {
                [this._mouseX] = event.get_coords();
                if (this._ampTo !== 1)
                    this._animateAmp(1);
                else if (!this._ampTimeline.is_playing())
                    this._updateLayout();
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._box.connect('notify::hover', () => {
            if (!this._box.hover && !this._menuOpen) {
                this._animateAmp(0);
                this.hideLabel();
            }
        });
        this._box.connect('scroll-event', () => Clutter.EVENT_STOP);

        this._favorites.connectObject('changed', () => this._redisplay(), this);
        this._appSystem.connectObject(
            'app-state-changed', () => this._redisplay(),
            'installed-changed', () => this._redisplay(), this);

        global.display.connectObject(
            'window-demands-attention', (_d, w) => this._onAttention(w),
            'window-marked-urgent', (_d, w) => this._onAttention(w), this);

        Main.layoutManager.connectObject('monitors-changed', () => {
            this._updateStrut();
            this._updateLayout();
        }, this);

        const s = this.settings;
        this._settingIds = [
            ...['dock-icon-size', 'dock-magnification', 'dock-magnification-scale'].map(k =>
                s.connect(`changed::${k}`, () => {
                    this._updateLayout();
                    this._updateStrut();
                })),
            ...['dock-show-running', 'dock-show-launcher', 'dock-show-trash'].map(k =>
                s.connect(`changed::${k}`, () => this._redisplay())),
            ...['dock-reserve-space', 'dock-bottom-margin'].map(k =>
                s.connect(`changed::${k}`, () => {
                    this._updateStrut();
                    this._updateLayout();
                })),
            s.connect('changed::dock-hide-overview-dash', () => this._syncOverviewDash()),
        ];
    }

    itemHoverChanged(item) {
        if (item.hover && !this._menuOpen) {
            this._hoveredItem = item;
            this._showLabel(item);
        } else if (this._hoveredItem === item) {
            this._hoveredItem = null;
            this.hideLabel();
        }
    }

    menuStateChanged(open) {
        this._menuOpen = open;
        if (open) {
            this.hideLabel();
            this._animateAmp(0);
        } else if (!this._box.hover) {
            this._animateAmp(0);
        }
    }

    hideLabel() {
        this._label.remove_all_transitions();
        this._label.hide();
    }

    _wantedKeys() {
        const s = this.settings;
        const keys = [];
        if (s.get_boolean('dock-show-launcher'))
            keys.push('::launcher');

        const favorites = this._favorites.getFavorites();
        favorites.forEach(app => keys.push(app.get_id()));

        if (s.get_boolean('dock-show-running')) {
            const favIds = new Set(favorites.map(a => a.get_id()));
            const running = this._appSystem.get_running()
                .filter(app => !favIds.has(app.get_id()))
                .filter(app => app.get_windows().some(w => !w.skip_taskbar));
            if (running.length)
                keys.push('::sep-running');
            running.forEach(app => keys.push(app.get_id()));
        }

        if (s.get_boolean('dock-show-trash')) {
            keys.push('::sep-trash');
            keys.push('::trash');
        }
        return keys;
    }

    _createItem(key) {
        if (key === '::launcher')
            return new LauncherItem(this, this._extDir.get_child('icons').get_child('tahoe-apps.svg'));
        if (key === '::trash')
            return new TrashItem(this);
        if (key.startsWith('::sep'))
            return new Separator();
        const app = this._appSystem.lookup_app(key) ??
            this._appSystem.get_running().find(a => a.get_id() === key);
        return app ? new AppItem(this, app) : null;
    }

    _redisplay() {
        const keys = this._wantedKeys();
        const wanted = new Set(keys);

        for (const [key, item] of this._items) {
            if (!wanted.has(key)) {
                item.destroy();
                this._items.delete(key);
            }
        }

        let index = 0;
        for (const key of keys) {
            let item = this._items.get(key);
            if (!item) {
                item = this._createItem(key);
                if (!item)
                    continue;
                this._items.set(key, item);
                this._box.insert_child_at_index(item, index);
                if (!this._firstDisplay && item.appear)
                    item.appear();
            } else if (this._box.get_child_at_index(index) !== item) {
                this._box.set_child_at_index(item, index);
            }
            index++;
        }
        this._firstDisplay = false;
        this._updateLayout();
    }

    _rebuild() {
        for (const item of this._items.values())
            item.destroy();
        this._items.clear();
        this._firstDisplay = true;
        this._redisplay();
    }

    _onAttention(window) {
        const app = this._tracker.get_window_app(window);
        const item = app ? this._items.get(app.get_id()) : null;
        if (item && window !== global.display.focus_window)
            item.bounce(3, () => window.demands_attention || window.urgent);
    }

    iconRectFor(window) {
        const app = this._tracker.get_window_app(window);
        const icon = app ? this._items.get(app.get_id())?.icon : null;
        if (!icon?.mapped)
            return null;
        const [x, y] = icon.get_transformed_position();
        const [width, height] = icon.get_transformed_size();
        return {x, y, width, height};
    }

    _animateAmp(to) {
        if (this._ampTo === to)
            return;
        this._ampFrom = this._amp;
        this._ampTo = to;
        this._ampTimeline.stop();
        this._ampTimeline.rewind();
        this._ampTimeline.start();
    }

    _children() {
        return this._box.get_children().filter(c => c.visible);
    }

    _updateLayout() {
        const base = this.iconSize;
        const maxScale = this._maxScale;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this._box?.get_stage())
            return;

        const children = this._children();
        const node = this._box.get_theme_node();
        const padLeft = node.get_padding(St.Side.LEFT);
        const spacing = this._box.layout_manager.spacing ?? 0;

        // Base (unmagnified) geometry is used to map the pointer to items, so
        // the mapping does not move while icons grow.
        const baseWidths = children.map(c => c instanceof Separator ? 1 : base);
        const baseTotal = baseWidths.reduce((a, b) => a + b, 0) +
            spacing * Math.max(0, children.length - 1) +
            padLeft + node.get_padding(St.Side.RIGHT);
        const baseLeft = monitor.x + (monitor.width - baseTotal) / 2;
        const rel = this._mouseX - baseLeft;
        const range = base * MAGNIFY_RANGE;

        let x = padLeft;
        children.forEach((child, i) => {
            const w = baseWidths[i];
            const center = x + w / 2;
            x += w + spacing;

            if (child instanceof Separator) {
                child.setGeometry(base);
                return;
            }

            let scale = 1;
            if (maxScale > 1 && this._amp > 0 && this._mouseX >= 0) {
                const d = Math.abs(rel - center);
                if (d < range)
                    scale += (maxScale - 1) * this._amp * (Math.cos(Math.PI * d / range) + 1) / 2;
            }
            child.setGeometry(base, maxScale, scale);
        });

        const [, width] = this._box.get_preferred_width(-1);
        const [, height] = this._box.get_preferred_height(width);
        const margin = this.settings.get_int('dock-bottom-margin');
        this._box.set_position(
            Math.round(monitor.x + (monitor.width - width) / 2),
            monitor.y + monitor.height - margin - height);

        if (this._hoveredItem && this._label.visible)
            this._positionLabel(this._hoveredItem);
    }

    _updateStrut() {
        const monitor = Main.layoutManager.primaryMonitor;
        const reserve = this.settings.get_boolean('dock-reserve-space') && !!this._box?.get_stage();
        const tracked = this._strut.get_parent() !== null;

        if (!reserve || !monitor) {
            if (tracked)
                Main.layoutManager.removeChrome(this._strut);
            return;
        }

        const [, height] = this._box.get_preferred_height(-1);
        const margin = this.settings.get_int('dock-bottom-margin');
        const total = Math.round(height + margin);
        this._strut.set_position(monitor.x, monitor.y + monitor.height - total);
        this._strut.set_size(monitor.width, total);

        if (!tracked) {
            Main.layoutManager.addChrome(this._strut, {
                affectsStruts: true,
                trackFullscreen: true,
            });
            Main.layoutManager.uiGroup.set_child_below_sibling(this._strut, null);
        }
    }

    _showLabel(item) {
        const text = item.labelText;
        if (!text)
            return;
        this._label.text = text;
        this._label.opacity = 0;
        this._label.show();
        this._positionLabel(item);
        this._label.remove_all_transitions();
        this._label.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _positionLabel(item) {
        if (!item.icon)
            return;
        const [ix, iy] = item.icon.get_transformed_position();
        const [iw] = item.icon.get_transformed_size();
        const [, lw] = this._label.get_preferred_width(-1);
        const [, lh] = this._label.get_preferred_height(-1);
        this._label.set_position(
            Math.round(ix + iw / 2 - lw / 2),
            Math.round(iy - lh - 10));
    }

    _applyStyle() {
        this._ctx.applyAppearance(this._box);
        this._ctx.applyAppearance(this._label);
        this._updateLayout();
    }

    onAppearanceChanged() {
        this._applyStyle();
    }

    onLanguageChanged() {
        this.hideLabel();
        this._rebuild();
    }

    _syncOverviewDash() {
        const dash = Main.overview.dash;
        if (!dash)
            return;
        if (this.settings.get_boolean('dock-hide-overview-dash')) {
            dash.hide();
            dash.set_height(0);
            this._dashHidden = true;
        } else if (this._dashHidden) {
            dash.set_height(-1);
            dash.show();
            this._dashHidden = false;
        }
    }

    _slideIn() {
        const [, height] = this._box.get_preferred_height(-1);
        this._box.translation_y = height + this.settings.get_int('dock-bottom-margin');
        this._box.ease({
            translation_y: 0,
            duration: 450,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    }

    destroy() {
        for (const id of this._settingIds)
            this.settings.disconnect(id);
        this._settingIds = [];

        this._favorites.disconnectObject(this);
        this._appSystem.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);

        if (this._dashHidden) {
            Main.overview.dash.set_height(-1);
            Main.overview.dash.show();
        }

        this._ampTimeline.stop();
        this._ampTimeline = null;

        for (const item of this._items.values())
            item.destroy();
        this._items.clear();

        if (this._strut.get_parent())
            Main.layoutManager.removeChrome(this._strut);
        this._strut.destroy();

        this._label.destroy();
        this.menuManager = null;
        Main.layoutManager.removeChrome(this._box);
        this._box.destroy();
        this._box = null;
    }
}
