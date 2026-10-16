// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {_, N_, initI18n, setLanguage} from './lib/i18n.js';
import {comboRow, group} from './lib/prefs-utils.js';
import * as MenubarPrefs from './modules/menubar/prefs.js';
import * as DockPrefs from './modules/dock/prefs.js';
import * as WidgetsPrefs from './modules/widgets/prefs.js';
import * as NotificationsPrefs from './modules/notifications/prefs.js';
import * as LockscreenPrefs from './modules/lockscreen/prefs.js';
import * as SpotlightPrefs from './modules/spotlight/prefs.js';
import * as OsdPrefs from './modules/osd/prefs.js';
import * as WindowButtonsPrefs from './modules/windowbuttons/prefs.js';
import * as AnimationsPrefs from './modules/animations/prefs.js';
import * as ShakeCursorPrefs from './modules/shakecursor/prefs.js';
import * as LaunchpadPrefs from './modules/launchpad/prefs.js';
import * as DialogsPrefs from './modules/dialogs/prefs.js';

const MODULES = [
    {id: 'menubar', title: N_('Menu bar'), icon: 'view-continuous-symbolic',
        description: N_('Logo menu, app name, clock, glass bar'), prefs: MenubarPrefs},
    {id: 'dock', title: N_('Dock'), icon: 'view-app-grid-symbolic',
        description: N_('Magnifying dock at the bottom of the screen'), prefs: DockPrefs},
    {id: 'widgets', title: N_('Widgets'), icon: 'view-grid-symbolic',
        description: N_('Clock, calendar, weather, battery, system'), prefs: WidgetsPrefs},
    {id: 'notifications', title: N_('Notifications'), icon: 'preferences-system-notifications-symbolic',
        description: N_('Glass banners sliding in from the corner'), prefs: NotificationsPrefs},
    {id: 'lockscreen', title: N_('Lock screen'), icon: 'system-lock-screen-symbolic',
        description: N_('Big clock on top, password at the bottom'), prefs: LockscreenPrefs},
    {id: 'spotlight', title: N_('Spotlight'), icon: 'system-search-symbolic',
        description: N_('Search apps, files and settings, calculator'), prefs: SpotlightPrefs},
];

const ADDITIONAL = [
    {id: 'launchpad', title: 'Launchpad', icon: 'view-app-grid-symbolic',
        description: N_('Full-screen grid of apps instead of the GNOME app grid'), prefs: LaunchpadPrefs},
    {id: 'osd', title: N_('Volume and brightness'), icon: 'audio-volume-high-symbolic',
        description: N_('macOS-style pop-up with a slider when you press the keys'), prefs: OsdPrefs},
    {id: 'windowbuttons', title: N_('Window buttons'), icon: 'window-close-symbolic',
        description: N_('Close, minimize and maximize on the left, red, yellow and green'),
        prefs: WindowButtonsPrefs},
    {id: 'animations', title: N_('Minimize animation'), icon: 'window-minimize-symbolic',
        description: N_('Windows go into the dock and come back like in macOS'), prefs: AnimationsPrefs},
    {id: 'dialogs', title: N_('System dialogs'), icon: 'dialog-password-symbolic',
        description: N_('Password and confirmation dialogs in the macOS style'), prefs: DialogsPrefs},
    {id: 'shakecursor', title: N_('Shake to find the cursor'), icon: 'input-mouse-symbolic',
        description: N_('Shake the mouse quickly and the cursor grows'), prefs: ShakeCursorPrefs},
];

export default class MacOSTahoePrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._settings = this.getSettings();
        initI18n(this.dir, this._settings.get_string('language'));

        window.set_default_size(660, 760);
        window.search_enabled = true;
        this._build();

        const id = this._settings.connect('changed::language', () => {
            setLanguage(this._settings.get_string('language'));
            // Rebuild after the combo row that triggered the change is done.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._build();
                return GLib.SOURCE_REMOVE;
            });
        });
        window.connect('close-request', () => {
            this._settings.disconnect(id);
            return false;
        });
    }

    _build() {
        const window = this._window;
        const s = this._settings;
        window.pop_subpage?.();
        if (this._page)
            window.remove(this._page);

        const modules = this._moduleGroup(_('Modules'),
            _('Switch modules on or off. Click a module to change its settings.'), MODULES);
        const additional = this._moduleGroup(_('Additional'),
            _('Window and system tweaks in the macOS style.'), ADDITIONAL);

        const general = group(_('Appearance and language'), '', [
            comboRow(s, 'language', _('Language'), [
                ['auto', _('System default')],
                ['en', 'English'],
                ['ru', 'Русский'],
            ], _('Applies to the whole extension and to these settings')),
            comboRow(s, 'appearance', _('Glass tint'), [
                ['auto', _('Follow system style')],
                ['light', _('Light')],
                ['dark', _('Dark')],
            ]),
        ]);

        this._page = new Adw.PreferencesPage({title: 'MacOS Shell', icon_name: 'preferences-system-symbolic'});
        this._page.add(modules);
        this._page.add(additional);
        this._page.add(general);
        window.add(this._page);
    }

    _moduleGroup(title, description, list) {
        const g = new Adw.PreferencesGroup({title, description});
        for (const mod of list) {
            const row = new Adw.ActionRow({
                title: _(mod.title),
                subtitle: _(mod.description),
                activatable: true,
            });
            row.add_prefix(new Gtk.Image({icon_name: mod.icon}));

            const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
            this._settings.bind(`module-${mod.id}`, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
            row.add_suffix(toggle);
            row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
            row.connect('activated', () => this._openModule(mod));
            g.add(row);
        }
        return g;
    }

    _openModule(mod) {
        const s = this._settings;
        const page = new Adw.PreferencesPage();

        const enabled = new Adw.SwitchRow({title: _('Enabled')});
        s.bind(`module-${mod.id}`, enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        page.add(group('', _(mod.description), [enabled]));

        for (const g of mod.prefs.buildGroups(s)) {
            s.bind(`module-${mod.id}`, g, 'sensitive', Gio.SettingsBindFlags.GET);
            page.add(g);
        }

        const toolbar = new Adw.ToolbarView({content: page});
        toolbar.add_top_bar(new Adw.HeaderBar());
        this._window.push_subpage(new Adw.NavigationPage({title: _(mod.title), child: toolbar}));
    }
}
