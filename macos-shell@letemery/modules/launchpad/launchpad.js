// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ParentalControlsManager from 'resource:///org/gnome/shell/misc/parentalControlsManager.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {_} from '../../lib/i18n.js';

const OPEN_TIME = 280;
const CLOSE_TIME = 220;
const PAGE_TIME = 380;
const FOLDER_TIME = 240;
const ZOOM = 1.12;
const SWIPE_FRACTION = 0.12;
const SCROLL_COOLDOWN = 350;
const FOLDER_SCHEMA = 'org.gnome.desktop.app-folders';

const ease = Clutter.AnimationMode.EASE_OUT_QUAD;
const SUPER_MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;

function folderName(folder) {
    const name = folder.get_string('name');
    if (folder.get_boolean('translate'))
        return Shell.util_get_translated_folder_name(name) ?? name;
    return name;
}

function itemName(item) {
    return item.type === 'folder' ? item.name : item.app.get_name();
}

export class Launchpad {
    constructor(ctx) {
        this._ctx = ctx;
        this._appSystem = Shell.AppSystem.get_default();
        this._favorites = AppFavorites.getAppFavorites();
        this._folderSettings = new Gio.Settings({schema_id: FOLDER_SCHEMA});
        this._parental = ParentalControlsManager.getDefault();
        this._isOpen = false;
        this._dirty = true;
        this._page = 0;
        this._selected = -1;

        this._buildActors();

        const dirty = () => {
            this._dirty = true;
        };
        this._appSystem.connectObject('installed-changed', dirty, this);
        this._folderSettings.connectObject('changed', dirty, this);
        global.settings.connectObject('changed::app-picker-layout', dirty, this);
        this._parental.connectObject('app-filter-changed', dirty, this);
        Main.layoutManager.connectObject('monitors-changed', () => {
            this.close(false);
            this._rebuildBackground();
        }, this);
        this._ids = ctx.watch(['launchpad-columns', 'launchpad-rows'], dirty);
    }

    get isOpen() {
        return this._isOpen;
    }

    _buildActors() {
        this.actor = new St.Widget({
            name: 'tahoeLaunchpad',
            style_class: 'tahoe-launchpad',
            reactive: true,
            visible: false,
        });
        Main.layoutManager.uiGroup.add_child(this.actor);

        this._bg = new Clutter.Actor();
        this.actor.add_child(this._bg);
        this._rebuildBackground();
        this.actor.add_child(new St.Widget({
            style_class: 'tahoe-launchpad-dim',
            x_expand: true,
            y_expand: true,
            constraints: new Clutter.BindConstraint({source: this.actor, coordinate: Clutter.BindCoordinate.SIZE}),
        }));

        this._content = new St.Widget({reactive: false});
        this.actor.add_child(this._content);

        this._search = new St.Entry({
            style_class: 'tahoe-launchpad-search',
            hint_text: _('Search'),
            can_focus: true,
            primary_icon: new St.Icon({
                icon_name: 'edit-find-symbolic',
                style_class: 'tahoe-launchpad-search-icon',
            }),
        });
        this._search.clutter_text.connect('text-changed', () => this._onSearchChanged());
        this._search.clutter_text.connect('key-press-event', (_a, event) => this._onKeyPress(event));
        this._content.add_child(this._search);

        this._viewport = new St.Widget({clip_to_allocation: true, reactive: false});
        this._pagesBox = new Clutter.Actor();
        this._viewport.add_child(this._pagesBox);
        this._content.add_child(this._viewport);

        this._dots = new St.BoxLayout({style_class: 'tahoe-launchpad-dots'});
        this._content.add_child(this._dots);

        this._folderLayer = new St.Widget({reactive: true, visible: false});
        this._folderLayer.connect('button-release-event', (_a, event) => {
            if (event.get_button() === Clutter.BUTTON_PRIMARY)
                this._closeFolder();
            return Clutter.EVENT_STOP;
        });
        this.actor.add_child(this._folderLayer);

        this.actor.connect('key-press-event', (_a, event) => this._onKeyPress(event));
        this.actor.connect('key-release-event', (_a, event) => this._onKeyRelease(event));
        this._search.clutter_text.connect('key-release-event', (_a, event) => this._onKeyRelease(event));
        this.actor.connect('scroll-event', (_a, event) => this._onScroll(event));
        this.actor.connect('button-press-event', (_a, event) => this._onPress(event));
        this.actor.connect('motion-event', (_a, event) => this._onMotion(event));
        this.actor.connect('button-release-event', (_a, event) => this._onRelease(event));

        this._menuManager = new PopupMenu.PopupMenuManager(this.actor);
    }

    _rebuildBackground() {
        this._bgManager?.destroy();
        this._bgManager = null;
        const index = Main.layoutManager.primaryIndex;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        this._bgManager = new Background.BackgroundManager({
            container: this._bg,
            monitorIndex: index,
            vignette: false,
            controlPosition: false,
        });
        const setup = () => {
            const actor = this._bgManager?.backgroundActor;
            if (!actor)
                return;
            actor.set_position(0, 0);
            actor.set_size(monitor.width, monitor.height);
            if (!actor.get_effect('tahoe-blur')) {
                actor.add_effect_with_name('tahoe-blur', new Shell.BlurEffect({
                    mode: Shell.BlurMode.ACTOR,
                    radius: 60,
                    brightness: 0.72,
                }));
            }
        };
        setup();
        this._bgManager.connect('changed', setup);
    }

    _shouldShow(info) {
        try {
            info.get_id();
        } catch {
            return false;
        }
        return info.should_show() && this._parental.shouldShowApp(info);
    }

    _loadItems() {
        const apps = new Map();
        for (const info of this._appSystem.get_installed()) {
            if (!this._shouldShow(info))
                continue;
            const app = this._appSystem.lookup_app(info.get_id());
            if (app)
                apps.set(app.get_id(), app);
        }

        const folders = [];
        const inFolders = new Set();
        for (const id of this._folderSettings.get_strv('folder-children')) {
            const folder = new Gio.Settings({
                schema_id: `${FOLDER_SCHEMA}.folder`,
                path: `${this._folderSettings.path}folders/${id}/`,
            });
            const excluded = folder.get_strv('excluded-apps');
            const list = [];
            const add = appId => {
                const app = apps.get(appId);
                if (app && !excluded.includes(appId) && !list.includes(app))
                    list.push(app);
            };
            folder.get_strv('apps').forEach(add);
            const categories = folder.get_strv('categories');
            if (categories.length) {
                for (const [appId, app] of apps) {
                    const own = (app.app_info.get_categories() ?? '').split(';');
                    if (own.some(c => categories.includes(c)))
                        add(appId);
                }
            }
            if (!list.length)
                continue;
            list.forEach(a => inFolders.add(a.get_id()));
            folders.push({type: 'folder', id, name: folderName(folder), apps: list});
        }

        const items = [
            ...folders,
            ...[...apps.values()].filter(a => !inFolders.has(a.get_id()))
                .map(app => ({type: 'app', id: app.get_id(), app})),
        ];

        const rank = new Map();
        let pages = [];
        try {
            pages = global.settings.get_value('app-picker-layout').recursiveUnpack();
        } catch {}
        pages.forEach((page, p) => {
            for (const [id, data] of Object.entries(page))
                rank.set(id, p * 10000 + (data?.position ?? 0));
        });
        items.sort((a, b) => {
            const ra = rank.get(a.id), rb = rank.get(b.id);
            if (ra !== undefined && rb !== undefined)
                return ra - rb;
            if (ra !== undefined)
                return -1;
            if (rb !== undefined)
                return 1;
            return itemName(a).localeCompare(itemName(b));
        });

        this._items = items;
        this._allApps = [...apps.values()];
        this._dirty = false;
    }

    _searchTerms() {
        return this._search.get_text().trim().toLowerCase();
    }

    _matches(app, terms) {
        const info = app.app_info;
        const fields = [
            app.get_name(),
            info.get_display_name?.(),
            info.get_generic_name?.(),
            info.get_executable?.(),
            app.get_id(),
            ...(info.get_keywords?.() ?? []),
        ].filter(Boolean).map(s => s.toLowerCase());
        return terms.split(/\s+/).every(t => fields.some(f => f.includes(t)));
    }

    _visibleItems() {
        const terms = this._searchTerms();
        if (!terms)
            return this._items;
        const found = this._allApps.filter(app => this._matches(app, terms));
        const starts = app => app.get_name().toLowerCase().startsWith(terms) ? 0 : 1;
        found.sort((a, b) => starts(a) - starts(b) || a.get_name().localeCompare(b.get_name()));
        return found.map(app => ({type: 'app', id: app.get_id(), app}));
    }

    _geometry() {
        const monitor = Main.layoutManager.primaryMonitor;
        const s = this._ctx.settings;
        const cols = s.get_int('launchpad-columns');
        const rows = s.get_int('launchpad-rows');
        const {width: W, height: H} = monitor;
        const gridTop = Math.round(H * 0.13);
        const gridHeight = Math.round(H * 0.74);
        const gridWidth = Math.round(Math.min(W * 0.84, cols * H * 0.2));
        const cellW = gridWidth / cols;
        const cellH = gridHeight / rows;
        const iconSize = Math.round(Math.min(cellW * 0.6, (cellH - 34) * 0.85, 128));
        return {
            monitor, W, H, cols, rows, gridTop, gridHeight, cellW, cellH, iconSize,
            gridLeft: Math.round((W - gridWidth) / 2),
            perPage: cols * rows,
        };
    }

    _layout() {
        const g = this._geom = this._geometry();
        this.actor.set_position(g.monitor.x, g.monitor.y);
        this.actor.set_size(g.W, g.H);
        this._content.set_size(g.W, g.H);
        this._content.set_pivot_point(0.5, 0.5);
        this._folderLayer.set_size(g.W, g.H);

        const [, searchW] = this._search.get_preferred_width(-1);
        const [, searchH] = this._search.get_preferred_height(searchW);
        this._search.set_position(Math.round((g.W - searchW) / 2), Math.round(g.H * 0.045));
        this._search.height = searchH;

        this._viewport.set_position(0, g.gridTop);
        this._viewport.set_size(g.W, g.gridHeight);
    }

    _fill() {
        const g = this._geom;
        this._pagesBox.destroy_all_children();
        this._tiles = [];
        this._visible = this._visibleItems();

        const pageCount = Math.max(1, Math.ceil(this._visible.length / g.perPage));
        for (let p = 0; p < pageCount; p++) {
            const page = new Clutter.Actor({x: p * g.W, width: g.W, height: g.gridHeight});
            this._pagesBox.add_child(page);
        }
        const pages = this._pagesBox.get_children();
        this._visible.forEach((item, i) => {
            const p = Math.floor(i / g.perPage);
            const n = i % g.perPage;
            const tile = this._makeTile(item, i, g);
            tile.set_position(Math.round(g.gridLeft + (n % g.cols) * g.cellW),
                Math.round(Math.floor(n / g.cols) * g.cellH));
            pages[p].add_child(tile);
            this._tiles.push(tile);
        });

        if (!this._visible.length) {
            const empty = new St.Label({style_class: 'tahoe-launchpad-empty', text: _('No Results')});
            pages[0].add_child(empty);
            const [, ew] = empty.get_preferred_width(-1);
            empty.set_position(Math.round((g.W - ew) / 2), Math.round(g.gridHeight * 0.35));
        }

        this._pageCount = pageCount;
        this._dots.destroy_all_children();
        for (let p = 0; p < pageCount && pageCount > 1; p++) {
            const dot = new St.Button({style_class: 'tahoe-launchpad-dot', can_focus: false});
            dot.connect('clicked', () => this._goToPage(p));
            this._dots.add_child(dot);
        }
        const [, dotsW] = this._dots.get_preferred_width(-1);
        this._dots.set_position(Math.round((g.W - dotsW) / 2), Math.round(g.gridTop + g.gridHeight + g.H * 0.035));

        this._goToPage(0, false);
        this._select(this._searchTerms() && this._visible.length ? 0 : -1);
    }

    _makeTile(item, index, g, inFolder = false) {
        const tile = new St.Button({
            style_class: 'tahoe-launchpad-item',
            can_focus: false,
            reactive: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            width: Math.round(g.cellW),
            height: Math.round(g.cellH),
        });
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'tahoe-launchpad-item-box',
        });
        tile.set_child(box);

        const icon = item.type === 'folder'
            ? this._folderIcon(item, g.iconSize)
            : item.app.create_icon_texture(g.iconSize);
        icon.x_align = Clutter.ActorAlign.CENTER;
        box.add_child(icon);

        const label = new St.Label({
            style_class: 'tahoe-launchpad-label',
            text: itemName(item),
            x_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        label.clutter_text.line_alignment = Pango.Alignment.CENTER;
        label.style = `max-width: ${Math.round(g.cellW - 16)}px;`;
        box.add_child(label);

        tile.connect('clicked', (_b, button) => {
            if (button === Clutter.BUTTON_SECONDARY && item.type === 'app')
                this._openMenu(tile, item.app);
            else if (button === Clutter.BUTTON_PRIMARY)
                this._activate(item);
        });
        tile.connect('notify::hover', () => {
            if (tile.hover && !inFolder && this._tiles?.[index] === tile)
                this._select(index, false);
        });
        tile._item = item;
        return tile;
    }

    _folderIcon(folder, size) {
        const icon = new St.Widget({
            style_class: 'tahoe-launchpad-folder-icon',
            width: size,
            height: size,
        });
        icon.style = `border-radius: ${Math.round(size * 0.24)}px;`;
        const mini = Math.round(size * 0.24);
        const gap = (size - 3 * mini) / 4;
        folder.apps.slice(0, 9).forEach((app, i) => {
            const a = app.create_icon_texture(mini);
            a.set_position(Math.round(gap + (i % 3) * (mini + gap)), Math.round(gap + Math.floor(i / 3) * (mini + gap)));
            icon.add_child(a);
        });
        return icon;
    }

    _goToPage(page, animate = true) {
        page = Math.max(0, Math.min(page, (this._pageCount ?? 1) - 1));
        this._page = page;
        const x = -page * this._geom.W;
        this._pagesBox.remove_all_transitions();
        if (animate)
            this._pagesBox.ease({translation_x: x, duration: PAGE_TIME, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        else
            this._pagesBox.translation_x = x;
        this._dots.get_children().forEach((dot, i) => dot.checked = i === page);
    }

    _select(index, followPage = true) {
        this._tiles?.[this._selected]?.remove_style_pseudo_class('selected');
        this._selected = index;
        const tile = this._tiles?.[index];
        if (!tile)
            return;
        tile.add_style_pseudo_class('selected');
        if (followPage) {
            const page = Math.floor(index / this._geom.perPage);
            if (page !== this._page)
                this._goToPage(page);
        }
    }

    _moveSelection(dx, dy) {
        const tiles = this._folder ? this._folder.tiles : this._tiles;
        if (!tiles?.length)
            return;
        const cols = this._folder ? this._folder.cols : this._geom.cols;
        const current = this._folder ? this._folder.selected : this._selected;
        let next;
        if (current < 0) {
            next = this._folder ? 0 : this._page * this._geom.perPage;
        } else if (!this._folder && dx !== 0) {
            next = current + dx;
        } else {
            next = current + dx + dy * cols;
        }
        next = Math.max(0, Math.min(next, tiles.length - 1));
        if (this._folder) {
            tiles[this._folder.selected]?.remove_style_pseudo_class('selected');
            this._folder.selected = next;
            tiles[next].add_style_pseudo_class('selected');
        } else {
            this._select(next);
        }
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        switch (symbol) {
        case Clutter.KEY_Escape:
            if (this._folder)
                this._closeFolder();
            else if (this._search.get_text())
                this._search.set_text('');
            else
                this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Super_L:
        case Clutter.KEY_Super_R:
            // Closed on release (see _onKeyRelease), so the same tap does
            // not reach GNOME's Super handler and open us again.
            this._superDown = true;
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter: {
            const tiles = this._folder ? this._folder.tiles : this._tiles;
            const index = this._folder ? this._folder.selected : this._selected;
            if (tiles?.[index])
                this._activate(tiles[index]._item);
            return Clutter.EVENT_STOP;
        }
        case Clutter.KEY_Left:
            this._moveSelection(-1, 0);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Right:
            this._moveSelection(1, 0);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._moveSelection(0, -1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._moveSelection(0, 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._goToPage(this._page - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._goToPage(this._page + 1);
            return Clutter.EVENT_STOP;
        }
        if (global.stage.key_focus !== this._search.clutter_text && event.get_key_unicode()) {
            global.stage.set_key_focus(this._search.clutter_text);
            return this._search.clutter_text.event(event, false);
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onKeyRelease(event) {
        const symbol = event.get_key_symbol();
        if (symbol !== Clutter.KEY_Super_L && symbol !== Clutter.KEY_Super_R)
            return Clutter.EVENT_PROPAGATE;
        if (this._superDown) {
            this._superDown = false;
            this.close();
        }
        return Clutter.EVENT_STOP;
    }

    get justClosed() {
        return Date.now() - (this._closedAt ?? 0) < 150;
    }

    _onSearchChanged() {
        if (!this._isOpen)
            return;
        this._closeFolder(false);
        this._fill();
    }

    _onScroll(event) {
        if (this._folder)
            return Clutter.EVENT_PROPAGATE;
        const direction = event.get_scroll_direction();
        let step = 0;
        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            this._scrollAccum = (this._scrollAccum ?? 0) + (Math.abs(dx) > Math.abs(dy) ? dx : dy);
            if (Math.abs(this._scrollAccum) >= 1) {
                step = Math.sign(this._scrollAccum);
                this._scrollAccum = 0;
            }
        } else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT) {
            step = 1;
        } else if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT) {
            step = -1;
        }
        const now = event.get_time();
        if (step && now - (this._lastScroll ?? 0) > SCROLL_COOLDOWN) {
            this._lastScroll = now;
            this._goToPage(this._page + step);
        }
        return Clutter.EVENT_STOP;
    }

    _onPress(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY || this._folder)
            return Clutter.EVENT_PROPAGATE;
        const [x] = event.get_coords();
        this._drag = {x, moved: false, from: this._pagesBox.translation_x};
        return Clutter.EVENT_STOP;
    }

    _onMotion(event) {
        if (!this._drag)
            return Clutter.EVENT_PROPAGATE;
        const [x] = event.get_coords();
        const dx = x - this._drag.x;
        if (Math.abs(dx) > 8)
            this._drag.moved = true;
        if (this._drag.moved) {
            this._pagesBox.remove_all_transitions();
            this._pagesBox.translation_x = this._drag.from + dx;
        }
        return Clutter.EVENT_STOP;
    }

    _onRelease(event) {
        const drag = this._drag;
        this._drag = null;
        if (!drag || event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        if (!drag.moved) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        const [x] = event.get_coords();
        const dx = x - drag.x;
        const threshold = this._geom.W * SWIPE_FRACTION;
        this._goToPage(this._page + (dx < -threshold ? 1 : dx > threshold ? -1 : 0));
        return Clutter.EVENT_STOP;
    }

    _openFolder(folder) {
        this._closeFolder(false);
        const g = this._geom;
        const n = folder.apps.length;
        const cols = Math.min(Math.max(3, Math.ceil(Math.sqrt(n))), g.cols - 1, n);
        const rowsNeeded = Math.ceil(n / cols);
        const rowsShown = Math.min(rowsNeeded, g.rows - 1);

        const panel = new St.BoxLayout({
            style_class: 'tahoe-launchpad-folder',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
        });
        panel.connect('button-release-event', () => Clutter.EVENT_STOP);
        panel.add_child(new St.Label({
            style_class: 'tahoe-launchpad-folder-title',
            text: folder.name,
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const grid = new Clutter.Actor({width: Math.round(cols * g.cellW), height: Math.round(rowsNeeded * g.cellH)});
        const tiles = folder.apps.map((app, i) => {
            const tile = this._makeTile({type: 'app', id: app.get_id(), app}, i, g, true);
            tile.set_position(Math.round((i % cols) * g.cellW), Math.round(Math.floor(i / cols) * g.cellH));
            grid.add_child(tile);
            return tile;
        });
        if (rowsNeeded > rowsShown) {
            const scroll = new St.ScrollView({
                style_class: 'tahoe-launchpad-folder-scroll',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                overlay_scrollbars: true,
                width: grid.width,
                height: Math.round(rowsShown * g.cellH),
            });
            const content = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
            content.add_child(grid);
            scroll.set_child(content);
            panel.add_child(scroll);
        } else {
            panel.add_child(grid);
        }

        this._folderLayer.add_child(panel);
        const [, pw] = panel.get_preferred_width(-1);
        const [, ph] = panel.get_preferred_height(pw);
        panel.set_position(Math.round((g.W - pw) / 2), Math.round(g.gridTop + (g.gridHeight - ph) / 2));
        panel.set_pivot_point(0.5, 0.5);

        this._folder = {panel, tiles, cols, selected: -1};
        this._folderLayer.show();
        panel.opacity = 0;
        panel.set_scale(0.85, 0.85);
        panel.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: FOLDER_TIME, mode: ease});
        this._content.ease({opacity: 25, duration: FOLDER_TIME, mode: ease});
    }

    _closeFolder(animate = true) {
        const folder = this._folder;
        if (!folder)
            return;
        this._folder = null;
        const done = () => {
            folder.panel.destroy();
            if (!this._folder)
                this._folderLayer.hide();
        };
        this._content.ease({opacity: 255, duration: animate ? FOLDER_TIME : 0, mode: ease});
        if (!animate) {
            done();
            return;
        }
        folder.panel.ease({
            opacity: 0,
            scale_x: 0.9,
            scale_y: 0.9,
            duration: FOLDER_TIME,
            mode: ease,
            onStopped: done,
        });
    }

    _activate(item) {
        if (item.type === 'folder') {
            this._openFolder(item);
            return;
        }
        item.app.activate();
        this.close();
    }

    _openMenu(tile, app) {
        this._menu?.destroy();
        const menu = this._menu = new PopupMenu.PopupMenu(tile, 0.5, St.Side.TOP);
        menu.actor.add_style_class_name('tahoe-menu');
        this._ctx.applyAppearance(menu.actor);
        menu.addAction(_('Open'), () => this._activate({type: 'app', app}));
        if (app.can_open_new_window()) {
            menu.addAction(_('New Window'), () => {
                app.open_new_window(-1);
                this.close();
            });
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const id = app.get_id();
        if (this._favorites.isFavorite(id))
            menu.addAction(_('Remove from Dock'), () => this._favorites.removeFavorite(id));
        else
            menu.addAction(_('Add to Dock'), () => this._favorites.addFavorite(id));
        this.actor.add_child(menu.actor);
        this._menuManager.addMenu(menu);
        menu.connect('menu-closed', () => {
            if (this._menu === menu) {
                this._menu = null;
                menu.destroy();
            }
        });
        menu.open(true);
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this._isOpen || !Main.layoutManager.primaryMonitor)
            return;
        if (Main.overview.visible)
            Main.overview.hide();

        if (this._dirty)
            this._loadItems();
        this._layout();
        this._search.set_text('');
        this._fill();

        Main.layoutManager.uiGroup.set_child_above_sibling(this.actor, null);
        this.actor.show();
        this._grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
        // Let a Super tap reach us while we hold the keyboard, to close.
        Main.wm.allowKeybinding('overlay-key', SUPER_MODES | Shell.ActionMode.POPUP);
        this._isOpen = true;
        global.stage.set_key_focus(this._search.clutter_text);
        global.compositor.disable_unredirect();

        this._bg.remove_all_transitions();
        this._content.remove_all_transitions();
        this._bg.opacity = 0;
        this._content.opacity = 0;
        this._content.set_scale(ZOOM, ZOOM);
        this._bg.ease({opacity: 255, duration: OPEN_TIME, mode: ease});
        this._content.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: OPEN_TIME, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
    }

    close(animate = true) {
        if (!this._isOpen)
            return;
        this._isOpen = false;
        this._closedAt = Date.now();
        this._superDown = false;
        this._drag = null;
        this._menu?.close();
        this._closeFolder(false);
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        Main.wm.allowKeybinding('overlay-key', SUPER_MODES);
        global.compositor.enable_unredirect();

        const done = () => {
            // Opened again while fading out: stay visible.
            if (this._isOpen)
                return;
            this.actor.hide();
            this._content.set_scale(1, 1);
        };
        if (!animate) {
            this._bg.remove_all_transitions();
            this._content.remove_all_transitions();
            done();
            return;
        }
        this._bg.ease({opacity: 0, duration: CLOSE_TIME, mode: ease});
        this._content.ease({
            opacity: 0,
            scale_x: ZOOM,
            scale_y: ZOOM,
            duration: CLOSE_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: done,
        });
    }

    onLanguageChanged() {
        this._dirty = true;
        this._search.hint_text = _('Search');
    }

    destroy() {
        this.close(false);
        this._ctx.unwatch(this._ids);
        this._appSystem.disconnectObject(this);
        this._folderSettings.disconnectObject(this);
        global.settings.disconnectObject(this);
        this._parental.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._menu?.destroy();
        this._bgManager?.destroy();
        this._bgManager = null;
        this.actor.destroy();
    }
}
