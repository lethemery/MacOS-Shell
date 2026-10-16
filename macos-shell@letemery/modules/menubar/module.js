// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ExtensionUtils from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {_, format, formatShortDate, formatTime} from '../../lib/i18n.js';
import {AppMenus, releaseVirtualKeyboard} from './appmenus.js';
import {BatteryButton, ControlCenter, WifiButton} from './status.js';

const JUST_PERFECTION = 'just-perfection-desktop@just-perfection';

function spawn(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
        return true;
    } catch (e) {
        console.warn(`[macos-shell] ${argv[0]}: ${e.message}`);
        return false;
    }
}

function launchDesktop(ids, fallbackArgv = null) {
    const appSys = Shell.AppSystem.get_default();
    for (const id of ids) {
        const app = appSys.lookup_app(id);
        if (app) {
            app.activate();
            return;
        }
    }
    if (fallbackArgv)
        spawn(fallbackArgv);
}

const LogoMenu = GObject.registerClass(
class TahoeLogoMenu extends PanelMenu.Button {
    _init(gicon) {
        super._init(0.0, _('System menu'));
        this.add_style_class_name('tahoe-logo-button');

        this.add_child(new St.Icon({
            gicon,
            style_class: 'system-status-icon tahoe-logo-icon',
        }));

        this.menu.actor.add_style_class_name('tahoe-menu');
        const actions = SystemActions.getDefault();
        const userName = GLib.get_real_name() || GLib.get_user_name();
        const m = this.menu;

        m.addAction(_('About This Computer'), () =>
            launchDesktop([], ['gnome-control-center', 'system', 'about']));
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        m.addAction(_('System Settings…'), () =>
            launchDesktop(['org.gnome.Settings.desktop'], ['gnome-control-center']));
        m.addAction(_('App Store…'), () =>
            launchDesktop(['org.gnome.Software.desktop', 'io.github.kolunmi.Bazaar.desktop']));
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        m.addAction(_('Force Quit…'), () =>
            launchDesktop(['org.gnome.SystemMonitor.desktop', 'gnome-system-monitor.desktop',
                'io.missioncenter.MissionCenter.desktop'], ['gnome-system-monitor']));
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        m.addAction(_('Sleep'), () => actions.activateSuspend());
        m.addAction(_('Restart…'), () => actions.activateRestart());
        m.addAction(_('Shut Down…'), () => actions.activatePowerOff());
        m.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        m.addAction(_('Lock Screen'), () => actions.activateLockScreen());
        m.addAction(format(_('Log Out {user}…'), {user: userName}), () => actions.activateLogout());
    }
});

export default class MenubarModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    enable() {
        this._ids = [
            ...this._ctx.watch(['menubar-style', 'menubar-height'], () => this._applyStyle()),
            ...this._ctx.watch(['menubar-show-logo', 'menubar-logo-path', 'menubar-show-app-name',
                'menubar-show-app-menus', 'menubar-show-activities', 'menubar-show-battery',
                'menubar-show-wifi', 'menubar-control-center'], () => this._rebuild()),
            ...this._ctx.watch(['menubar-show-date', 'menubar-show-weekday', 'menubar-show-seconds'],
                () => this._restartClock()),
        ];

        this._panel = Main.panel;
        this._panel.add_style_class_name('tahoe-menubar');
        this._origPanelStyle = this._panel.get_style();

        // GNOME rebuilds the panel boxes when the session mode changes (e.g.
        // after unlocking): it shows "Activities" again and puts the clock
        // back in the middle. Re-apply our layout afterwards.
        this._injections = new InjectionManager();
        const module = this;
        this._injections.overrideMethod(Object.getPrototypeOf(this._panel), '_updatePanel',
            orig => function (...args) {
                const ret = orig.apply(this, args);
                if (this === module._panel)
                    module._afterPanelUpdate();
                return ret;
            });

        this._moveDateMenu();
        this._syncJustPerfection();
        Main.extensionManager.connectObject('extension-state-changed', (_m, ext) => {
            if (ext.uuid === JUST_PERFECTION)
                this._syncJustPerfection();
        }, this);
        this._createBlur();
        this._build();
        this._applyStyle();
    }

    disable() {
        Main.extensionManager.disconnectObject(this);
        this._restoreJustPerfection();
        this._injections?.clear();
        this._injections = null;
        this._ctx.unwatch(this._ids);
        this._teardown();
        this._destroyBlur();
        this._restoreDateMenu();
        releaseVirtualKeyboard();

        this._panel.remove_style_class_name('tahoe-menubar');
        for (const c of ['tahoe-glass', 'tahoe-transparent', 'tahoe-solid', 'tahoe-light', 'tahoe-dark'])
            this._panel.remove_style_class_name(c);
        this._panel.set_style(this._origPanelStyle);
        this._panel = null;
    }

    // Just Perfection, if enabled, applies its own panel layout (by default:
    // clock in the middle, "Activities" button shown) and re-applies it when
    // panel items are added, which undoes ours. While the menu bar module
    // runs, point those settings to the macOS layout; restore them after.
    _justPerfectionOverrides() {
        const s = this._ctx.settings;
        return {
            'clock-menu-position': new GLib.Variant('i', 1),
            'clock-menu-position-offset': new GLib.Variant('i', 20),
            'activities-button': new GLib.Variant('b', s.get_boolean('menubar-show-activities')),
        };
    }

    _syncJustPerfection() {
        const jp = Main.extensionManager.lookup(JUST_PERFECTION);
        if (!jp || jp.state !== ExtensionUtils.ExtensionState.ACTIVE)
            return;
        if (!this._jp) {
            let settings = null;
            try {
                settings = jp.stateObj?.getSettings?.() ?? null;
            } catch {}
            if (!settings)
                return;
            this._jp = {settings, saved: {}};
        }
        const {settings, saved} = this._jp;
        const keys = settings.settings_schema.list_keys();
        for (const [key, value] of Object.entries(this._justPerfectionOverrides())) {
            if (!keys.includes(key))
                continue;
            if (!(key in saved))
                saved[key] = settings.get_value(key);
            if (!settings.get_value(key).equal(value))
                settings.set_value(key, value);
        }
        this._placeDateMenu();
    }

    _restoreJustPerfection() {
        if (!this._jp)
            return;
        const {settings, saved} = this._jp;
        this._jp = null;
        for (const [key, value] of Object.entries(saved)) {
            try {
                settings.set_value(key, value);
            } catch {}
        }
    }

    _afterPanelUpdate() {
        if (this._jp)
            this._syncJustPerfection();
        const activities = this._panel.statusArea.activities;
        if (activities)
            activities.container.visible = this._ctx.settings.get_boolean('menubar-show-activities');
        this._placeDateMenu();
    }

    onLanguageChanged() {
        this._rebuild();
    }

    onAppearanceChanged() {
        this._applyStyle();
    }

    _build() {
        const s = this._ctx.settings;
        const panel = this._panel;
        if (this._jp)
            this._syncJustPerfection();

        const activities = panel.statusArea.activities;
        if (activities)
            activities.container.visible = s.get_boolean('menubar-show-activities');

        let index = 0;
        if (s.get_boolean('menubar-show-logo')) {
            this._logo = new LogoMenu(this._logoIcon());
            panel.addToStatusArea('tahoe-logo', this._logo, index++, 'left');
        }
        if (s.get_boolean('menubar-show-app-name')) {
            this._appMenus = new AppMenus({
                showMenus: s.get_boolean('menubar-show-app-menus'),
                index,
            });
        }

        const before = () => {
            const anchor = panel.statusArea['tahoe-spotlight']?.container ??
                panel.statusArea.quickSettings?.container;
            const i = anchor ? panel._rightBox.get_children().indexOf(anchor) : -1;
            return i >= 0 ? i : panel._rightBox.get_n_children();
        };
        if (s.get_boolean('menubar-show-battery')) {
            this._battery = new BatteryButton(s);
            panel.addToStatusArea('tahoe-battery', this._battery, before(), 'right');
        }
        if (s.get_boolean('menubar-show-wifi')) {
            this._wifi = new WifiButton(this._ctx.dir);
            panel.addToStatusArea('tahoe-wifi', this._wifi, before(), 'right');
        }
        if (s.get_boolean('menubar-control-center'))
            this._controlCenter = new ControlCenter(this._ctx.dir);

        this._createClock();
    }

    _logoIcon() {
        const path = this._ctx.settings.get_string('menubar-logo-path');
        if (path && GLib.file_test(path, GLib.FileTest.EXISTS))
            return Gio.FileIcon.new(Gio.File.new_for_path(path));
        return Gio.FileIcon.new(this._ctx.dir.get_child('icons').get_child('tahoe-logo-symbolic.svg'));
    }

    _teardown() {
        this._destroyClock();
        this._logo?.destroy();
        this._logo = null;
        this._appMenus?.destroy();
        this._appMenus = null;
        this._battery?.destroy();
        this._battery = null;
        this._wifi?.destroy();
        this._wifi = null;
        this._controlCenter?.destroy();
        this._controlCenter = null;

        const activities = this._panel.statusArea.activities;
        if (activities)
            activities.container.visible = true;
    }

    _rebuild() {
        this._teardown();
        this._build();
        this._applyStyle();
    }

    _applyStyle() {
        const s = this._ctx.settings;
        const style = s.get_string('menubar-style');
        for (const c of ['tahoe-glass', 'tahoe-transparent', 'tahoe-solid'])
            this._panel.remove_style_class_name(c);
        this._panel.add_style_class_name(`tahoe-${style}`);
        this._ctx.applyAppearance(this._panel);

        const height = s.get_int('menubar-height');
        this._panel.set_style(`height: ${height}px;`);

        if (this._blur) {
            this._blur.visible = style === 'glass' && this._panelBox.visible && !Main.overview.visible;
            this._ctx.applyAppearance(this._blur);
        }
    }

    // Static blur: a blurred copy of the wallpaper clipped to the bar.
    // A live background blur (Shell.BlurMode.BACKGROUND) is not repainted when
    // a window moves under the bar and leaves stale "imprints" of it, so only
    // the wallpaper is blurred, like blur-my-shell's static mode.
    _createBlur() {
        this._panelBox = Main.layoutManager.panelBox;
        this._blur = new St.Widget({
            name: 'tahoeMenubarBlur',
            style_class: 'tahoe-menubar-blur',
            reactive: false,
            clip_to_allocation: true,
        });
        this._blur.add_constraint(new Clutter.BindConstraint({
            source: this._panelBox,
            coordinate: Clutter.BindCoordinate.ALL,
        }));
        this._bgGroup = new Meta.BackgroundGroup();
        this._blur.add_child(this._bgGroup);
        Main.layoutManager.uiGroup.insert_child_below(this._blur, this._panelBox);

        this._createBackground();
        Main.layoutManager.connectObject('monitors-changed', () => this._createBackground(), this);
        this._panelBox.connectObject('notify::visible', () => this._applyStyle(), this);
        Main.overview.connectObject(
            'showing', () => this._applyStyle(),
            'hidden', () => this._applyStyle(), this);
    }

    _createBackground() {
        this._bgManager?.destroy();
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        this._bgManager = new Background.BackgroundManager({
            container: this._bgGroup,
            monitorIndex: Main.layoutManager.primaryIndex,
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
                    radius: 48,
                    brightness: 0.95,
                }));
            }
        };
        setup();
        this._bgManager.connect('changed', setup);
    }

    _destroyBlur() {
        Main.layoutManager.disconnectObject(this);
        this._panelBox?.disconnectObject(this);
        Main.overview.disconnectObject(this);
        this._bgManager?.destroy();
        this._bgManager = null;
        this._blur?.destroy();
        this._blur = null;
        this._bgGroup = null;
        this._panelBox = null;
    }

    // GNOME puts the clock back in the middle whenever the session mode
    // changes (lock/unlock), and other extensions may move it too, so keep
    // watching its parent.
    _moveDateMenu() {
        const dateMenu = this._panel.statusArea.dateMenu;
        if (!dateMenu)
            return;
        const container = dateMenu.container;
        this._dateMenuParent = container.get_parent();
        this._dateMenuIndex = this._dateMenuParent?.get_children().indexOf(container) ?? 0;
        this._placeDateMenu();
        container.connectObject('parent-set', () => {
            if (this._dateMenuIdle || this._placingDateMenu)
                return;
            this._dateMenuIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._dateMenuIdle = 0;
                this._placeDateMenu();
                return GLib.SOURCE_REMOVE;
            });
        }, this);
    }

    _placeDateMenu() {
        const container = this._panel.statusArea.dateMenu?.container;
        const right = this._panel._rightBox;
        if (!container || (container.get_parent() === right && right.get_last_child() === container))
            return;
        this._placingDateMenu = true;
        container.get_parent()?.remove_child(container);
        right.add_child(container);
        this._placingDateMenu = false;
    }

    _restoreDateMenu() {
        if (this._dateMenuIdle) {
            GLib.source_remove(this._dateMenuIdle);
            this._dateMenuIdle = 0;
        }
        const dateMenu = this._panel.statusArea.dateMenu;
        if (!dateMenu || !this._dateMenuParent)
            return;
        dateMenu.container.disconnectObject(this);
        dateMenu.container.get_parent()?.remove_child(dateMenu.container);
        this._dateMenuParent.insert_child_at_index(dateMenu.container, this._dateMenuIndex);
        this._dateMenuParent = null;
    }

    _createClock() {
        const dateMenu = this._panel.statusArea.dateMenu;
        if (!dateMenu?._clockDisplay)
            return;

        this._origClock = dateMenu._clockDisplay;
        this._origClock.hide();
        this._clockLabel = new St.Label({
            style_class: 'clock tahoe-clock',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._origClock.get_parent().insert_child_above(this._clockLabel, this._origClock);
        this._restartClock();
    }

    _destroyClock() {
        if (this._clockTimeout) {
            GLib.source_remove(this._clockTimeout);
            this._clockTimeout = 0;
        }
        this._clockLabel?.destroy();
        this._clockLabel = null;
        this._origClock?.show();
        this._origClock = null;
    }

    _restartClock() {
        if (!this._clockLabel)
            return;
        if (this._clockTimeout) {
            GLib.source_remove(this._clockTimeout);
            this._clockTimeout = 0;
        }
        this._tick();
    }

    _tick() {
        const s = this._ctx.settings;
        const seconds = s.get_boolean('menubar-show-seconds');
        const now = GLib.DateTime.new_now_local();

        const parts = [];
        if (s.get_boolean('menubar-show-date')) {
            let date = formatShortDate(now);
            if (!s.get_boolean('menubar-show-weekday'))
                date = date.replace(/^\S+\s/, '');
            parts.push(date);
        }
        parts.push(formatTime(now, seconds));
        this._clockLabel.text = parts.join('  ');

        const ms = seconds
            ? 1000 - Math.floor(now.get_microsecond() / 1000)
            : (60 - now.get_second()) * 1000 - Math.floor(now.get_microsecond() / 1000);
        this._clockTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(ms, 50), () => {
            this._clockTimeout = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }
}
