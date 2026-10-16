// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as RemoteSearch from 'resource:///org/gnome/shell/ui/remoteSearch.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {_, format} from '../../lib/i18n.js';
import {evaluate, formatNumber} from './calculator.js';

const SEARCH_DELAY = 120;
const MAX_APPS = 6;
const MAX_PER_PROVIDER = 3;
const ICON_SIZE = 30;

const ENGINES = {
    duckduckgo: 'https://duckduckgo.com/?q=',
    google: 'https://www.google.com/search?q=',
    yandex: 'https://yandex.ru/search/?text=',
    bing: 'https://www.bing.com/search?q=',
};

const ResultRow = GObject.registerClass(
class TahoeSpotlightRow extends St.Button {
    _init(item) {
        super._init({
            style_class: 'tahoe-spotlight-row',
            x_expand: true,
            can_focus: false,
            reactive: true,
            track_hover: true,
        });
        this.item = item;

        const box = new St.BoxLayout({style_class: 'tahoe-spotlight-row-box', x_expand: true});
        this.set_child(box);

        let icon = null;
        try {
            icon = item.createIcon?.(ICON_SIZE) ?? null;
        } catch {}
        if (!icon) {
            icon = new St.Icon({
                icon_size: ICON_SIZE,
                ...item.gicon ? {gicon: item.gicon} : {icon_name: item.iconName ?? 'system-search-symbolic'},
            });
        }
        const iconBin = new St.Bin({style_class: 'tahoe-spotlight-row-icon', child: icon,
            y_align: Clutter.ActorAlign.CENTER});
        box.add_child(iconBin);

        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        const name = new St.Label({text: item.name ?? '', style_class: 'tahoe-spotlight-row-name'});
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(name);
        if (item.description) {
            const desc = new St.Label({
                text: item.description.split('\n')[0],
                style_class: 'tahoe-spotlight-row-desc',
            });
            desc.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(desc);
        }
        box.add_child(text);

        if (item.hint) {
            box.add_child(new St.Label({
                text: item.hint,
                style_class: 'tahoe-spotlight-row-hint',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
    }

    setSelected(selected) {
        if (selected)
            this.add_style_pseudo_class('selected');
        else
            this.remove_style_pseudo_class('selected');
    }
});

class SpotlightPopup {
    constructor(module) {
        this._module = module;
        this._ctx = module.ctx;
        this._sections = new Map();
        this._rows = [];
        this._selected = 0;
        this._cancellable = null;
        this._searchId = 0;
        this._generation = 0;
    }

    open() {
        const monitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;

        this._overlay = new St.Widget({
            name: 'tahoeSpotlight',
            reactive: true,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });
        Main.layoutManager.addTopChrome(this._overlay);

        this._panel = new St.BoxLayout({
            style_class: 'tahoe-spotlight',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
        });
        this._ctx.applyAppearance(this._panel);
        this._overlay.add_child(this._panel);

        this._entry = new St.Entry({
            style_class: 'tahoe-spotlight-entry',
            hint_text: _('Spotlight Search'),
            can_focus: true,
            x_expand: true,
            primary_icon: new St.Icon({
                icon_name: 'edit-find-symbolic',
                style_class: 'tahoe-spotlight-search-icon',
            }),
        });
        this._panel.add_child(this._entry);

        this._scroll = new St.ScrollView({
            style_class: 'tahoe-spotlight-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            visible: false,
        });
        this._list = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'tahoe-spotlight-list',
            x_expand: true,
        });
        this._scroll.set_child(this._list);
        this._panel.add_child(this._scroll);

        const width = Math.min(680, monitor.width - 40);
        this._panel.width = width;
        this._panel.set_position(Math.round((monitor.width - width) / 2), Math.round(monitor.height * 0.2));

        this._overlay.connect('button-press-event', (_a, event) => {
            const source = global.stage.get_event_actor(event);
            if (!source || !this._panel.contains(source)) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._entry.clutter_text.connect('text-changed', () => this._queueSearch());
        this._entry.clutter_text.connect('key-press-event', (_a, event) => this._onKeyPress(event));
        this._overlay.connect('key-press-event', (_a, event) => this._onKeyPress(event));

        this._grab = Main.pushModal(this._overlay, {actionMode: Shell.ActionMode.SYSTEM_MODAL});
        this._entry.grab_key_focus();

        this._panel.opacity = 0;
        this._panel.set_pivot_point(0.5, 0.0);
        this._panel.scale_x = this._panel.scale_y = 0.96;
        this._panel.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        return true;
    }

    get isOpen() {
        return !!this._overlay;
    }

    close(then = null) {
        if (!this._overlay)
            return;
        this._cancel();
        if (this._searchId) {
            GLib.source_remove(this._searchId);
            this._searchId = 0;
        }
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        const overlay = this._overlay;
        this._overlay = null;
        this._panel.ease({
            opacity: 0,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                Main.layoutManager.removeChrome(overlay);
                overlay.destroy();
            },
        });
        this._module.popupClosed(this);
        // Run the action once the modal grab is gone, so focus goes to the app.
        if (then) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                try {
                    then();
                } catch (e) {
                    console.error(`[macos-shell] spotlight: ${e.message}`);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    destroy() {
        this.close();
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        switch (symbol) {
        case Clutter.KEY_Escape:
            if (this._entry.text)
                this._entry.text = '';
            else
                this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
        case Clutter.KEY_Tab:
            this._select(this._selected + 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
        case Clutter.KEY_ISO_Left_Tab:
            this._select(this._selected - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
            this._activate(this._rows[this._selected]?.item);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _select(index) {
        if (this._rows.length === 0)
            return;
        index = (index + this._rows.length) % this._rows.length;
        this._rows[this._selected]?.setSelected(false);
        this._selected = index;
        const row = this._rows[index];
        row.setSelected(true);
        this._ensureVisible(row);
    }

    _ensureVisible(row) {
        const adjustment = this._scroll.vadjustment;
        const box = row.get_allocation_box();
        if (box.y1 < adjustment.value)
            adjustment.value = box.y1;
        else if (box.y2 > adjustment.value + adjustment.page_size)
            adjustment.value = box.y2 - adjustment.page_size;
    }

    _activate(item) {
        if (!item)
            return;
        this.close(item.activate);
    }

    _cancel() {
        this._cancellable?.cancel();
        this._cancellable = null;
    }

    _queueSearch() {
        if (this._searchId)
            GLib.source_remove(this._searchId);
        this._searchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DELAY, () => {
            this._searchId = 0;
            this._search(this._entry.text);
            return GLib.SOURCE_REMOVE;
        });
    }

    _search(text) {
        this._cancel();
        this._sections.clear();
        const generation = ++this._generation;
        const query = text.trim();

        if (!query) {
            this._render(true);
            return;
        }

        const terms = query.split(/\s+/).filter(Boolean);
        let order = 0;

        const value = evaluate(query);
        if (value !== null) {
            const result = formatNumber(value);
            this._sections.set('calc', {
                order: order++,
                title: _('Calculator'),
                items: [{
                    iconName: 'accessories-calculator-symbolic',
                    name: `= ${result}`,
                    description: query,
                    hint: _('Enter — copy'),
                    activate: () => {
                        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, result);
                        Main.osdWindowManager?.showAll?.(Gio.ThemedIcon.new('edit-copy-symbolic'),
                            _('Copied'), null, null);
                    },
                }],
            });
        }

        const appSys = Shell.AppSystem.get_default();
        const usage = Shell.AppUsage.get_default();
        const apps = [];
        for (const group of Shell.AppSystem.search(query)) {
            const sorted = group.filter(id => appSys.lookup_app(id)).sort((a, b) => usage.compare(a, b));
            apps.push(...sorted);
        }
        if (apps.length) {
            this._sections.set('apps', {
                order: order++,
                title: _('Applications'),
                items: apps.slice(0, MAX_APPS).map(id => {
                    const app = appSys.lookup_app(id);
                    return {
                        gicon: app.get_icon(),
                        name: app.get_name(),
                        description: app.get_description() ?? '',
                        activate: () => {
                            app.activate();
                            Main.overview.hide();
                        },
                    };
                }),
            });
        }

        const actions = SystemActions.getDefault();
        const actionIds = actions.getMatchingActions(terms);
        if (actionIds.length) {
            this._sections.set('system', {
                order: order++,
                title: _('System'),
                items: actionIds.map(id => ({
                    iconName: actions.getIconName(id),
                    name: actions.getName(id),
                    activate: () => actions.activateAction(id),
                })),
            });
        }

        const s = this._ctx.settings;
        if (s.get_boolean('spotlight-web-search')) {
            const engine = ENGINES[s.get_string('spotlight-search-engine')] ?? ENGINES.duckduckgo;
            this._sections.set('web', {
                order: 1000,
                title: _('Web'),
                items: [{
                    iconName: 'web-browser-symbolic',
                    name: format(_('Search the web for “{query}”'), {query}),
                    activate: () => Gio.AppInfo.launch_default_for_uri(
                        engine + encodeURIComponent(query), global.create_app_launch_context(0, -1)),
                }],
            });
        }

        this._render(true);

        if (!s.get_boolean('spotlight-providers'))
            return;
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;
        this._module.providers.forEach((provider, index) => {
            // Our own calculator already answered; skip GNOME Calculator's copy.
            if (value !== null && provider.id === 'org.gnome.Calculator.desktop')
                return;
            this._searchProvider(provider, terms, cancellable, generation, 100 + index);
        });
    }

    async _searchProvider(provider, terms, cancellable, generation, order) {
        try {
            // The D-Bus proxy is initialised asynchronously; give it a moment.
            for (let i = 0; i < 20 && !provider.proxy?.get_connection(); i++)
                await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => resolve() ?? GLib.SOURCE_REMOVE));
            if (!provider.proxy?.get_connection() || cancellable.is_cancelled())
                return;
            const results = await provider.getInitialResultSet(terms, cancellable);
            if (cancellable.is_cancelled() || generation !== this._generation || !results?.length)
                return;
            const ids = provider.filterResults(results, MAX_PER_PROVIDER);
            const metas = await provider.getResultMetas(ids, cancellable);
            if (cancellable.is_cancelled() || generation !== this._generation || !metas?.length)
                return;

            this._sections.set(`provider:${provider.id}`, {
                order,
                title: provider.appInfo?.get_name() ?? provider.id,
                items: metas.map(meta => ({
                    createIcon: size => meta.createIcon(size),
                    name: meta.name,
                    description: meta.description,
                    activate: () => provider.activateResult(meta.id, terms),
                })),
            });
            this._render(false);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`[macos-shell] spotlight provider ${provider.id}: ${e.message}`);
        }
    }

    _render(resetSelection) {
        if (!this._overlay)
            return;
        const selectedItem = resetSelection ? null : this._rows[this._selected]?.item;

        this._list.destroy_all_children();
        this._rows = [];

        const sections = [...this._sections.values()].sort((a, b) => a.order - b.order);
        for (const section of sections) {
            this._list.add_child(new St.Label({
                text: section.title,
                style_class: 'tahoe-spotlight-section',
            }));
            for (const item of section.items) {
                const row = new ResultRow(item);
                const index = this._rows.length;
                row.connect('clicked', () => this._activate(item));
                row.connect('notify::hover', () => {
                    if (row.hover)
                        this._select(index);
                });
                this._list.add_child(row);
                this._rows.push(row);
            }
        }

        this._scroll.visible = this._rows.length > 0;
        if (this._rows.length) {
            this._panel.add_style_pseudo_class('expanded');
            const keep = selectedItem ? this._rows.findIndex(r => r.item === selectedItem) : -1;
            this._selected = keep >= 0 ? keep : 0;
            this._rows[this._selected].setSelected(true);
        } else {
            this._panel.remove_style_pseudo_class('expanded');
        }
    }
}

const SpotlightButton = GObject.registerClass(
class TahoeSpotlightButton extends PanelMenu.Button {
    _init(dir, onActivate) {
        super._init(0.0, _('Spotlight Search'), true);
        this.add_style_class_name('tahoe-spotlight-button');
        this.add_style_class_name('tahoe-status-button');
        this.add_child(new St.Icon({
            gicon: Gio.FileIcon.new(dir.get_child('icons').get_child('tahoe-search-symbolic.svg')),
            style_class: 'system-status-icon tahoe-status-icon',
        }));

        if (Clutter.ClickGesture) {
            const gesture = new Clutter.ClickGesture();
            gesture.set_recognize_on_press?.(true);
            gesture.connect('recognize', () => onActivate());
            this.add_action(gesture);
        } else {
            this.connect('button-press-event', () => {
                onActivate();
                return Clutter.EVENT_STOP;
            });
        }
    }
});

export default class SpotlightModule {
    constructor(ctx) {
        this.ctx = ctx;
    }

    enable() {
        Main.wm.addKeybinding('spotlight-shortcut', this.ctx.settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this.toggle());

        this._ids = this.ctx.watch(['spotlight-show-icon'], () => this._syncButton());
        this._syncButton();

        this._preloadId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._preloadId = 0;
            void this.providers;
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._preloadId) {
            GLib.source_remove(this._preloadId);
            this._preloadId = 0;
        }
        Main.wm.removeKeybinding('spotlight-shortcut');
        this.ctx.unwatch(this._ids);
        this._popup?.destroy();
        this._popup = null;
        this._button?.destroy();
        this._button = null;
        this._providers = null;
    }

    onLanguageChanged() {
        this._popup?.close();
        this._button?.destroy();
        this._button = null;
        this._syncButton();
    }

    get providers() {
        if (!this._providers) {
            try {
                const searchSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.search-providers'});
                this._providers = searchSettings.get_boolean('disable-external')
                    ? [] : RemoteSearch.loadRemoteSearchProviders(searchSettings);
            } catch (e) {
                console.warn(`[macos-shell] spotlight: cannot load search providers: ${e.message}`);
                this._providers = [];
            }
        }
        return this._providers;
    }

    _syncButton() {
        const show = this.ctx.settings.get_boolean('spotlight-show-icon');
        if (show && !this._button) {
            this._button = new SpotlightButton(this.ctx.dir, () => this.toggle());
            const quickSettings = Main.panel.statusArea.quickSettings?.container;
            const index = quickSettings ? Main.panel._rightBox.get_children().indexOf(quickSettings) : 0;
            Main.panel.addToStatusArea('tahoe-spotlight', this._button, Math.max(0, index), 'right');
        } else if (!show && this._button) {
            this._button.destroy();
            this._button = null;
        }
    }

    toggle() {
        if (this._popup?.isOpen) {
            this._popup.close();
            return;
        }
        Main.overview.hide();
        this._popup = new SpotlightPopup(this);
        if (!this._popup.open())
            this._popup = null;
    }

    popupClosed(popup) {
        if (this._popup === popup)
            this._popup = null;
    }
}
