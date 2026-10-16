
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const OUT = GLib.getenv('TEST_OUTPUT');
const UUID = 'macos-shell@letemery';
const wait = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));

function log(msg) {
    const stream = Gio.File.new_for_path(`${OUT}/test.log`).append_to(Gio.FileCreateFlags.NONE, null);
    stream.write_all(new TextEncoder().encode(`${msg}\n`), null);
    stream.close(null);
}

function check(name, ok, details = '') {
    log(`${ok ? 'PASS' : 'FAIL'} ${name}${details ? ` — ${details}` : ''}`);
}

async function shot(name) {
    const stream = Gio.File.new_for_path(`${OUT}/${name}.png`)
        .replace(null, false, Gio.FileCreateFlags.NONE, null);
    await new Shell.Screenshot().screenshot(false, stream);
    stream.close(null);
}

const ext = () => Main.extensionManager.lookup(UUID);
const module = name => ext().stateObj._active.get(name);

let started = false;
export default class Driver extends Extension {
    enable() {
        if (started)
            return;
        started = true;
        const go = () => this._run().catch(e => log(`ERROR ${e}\n${e.stack}`));
        if (Main.layoutManager._startingUp)
            Main.layoutManager.connect('startup-complete', go);
        else
            go();
    }

    disable() {}

    async _run() {
        await wait(1500);
        Main.overview.hide();
        await wait(2500);

        const jp = Main.extensionManager.lookup('just-perfection-desktop@just-perfection');
        log(`just perfection: ${jp ? `state=${jp.state}` : 'not installed'}`);
        const e = ext();
        check('extension enabled', e.state === 1, e.error ?? '');
        check('metadata name', e.metadata.name === 'MacOS Shell', e.metadata.name);
        const settings = e.stateObj._ctx.settings;

        const right = Main.panel._rightBox;
        const clock = Main.panel.statusArea.dateMenu.container;
        check('clock at far right', clock.get_parent() === right && right.get_last_child() === clock);
        Main.panel._updatePanel();
        await wait(300);
        check('activities stays hidden after panel update',
            !Main.panel.statusArea.activities.container.visible);
        check('clock back at far right after panel update',
            clock.get_parent() === right && right.get_last_child() === clock,
            clock.get_parent()?.name);

        if (jp?.state === 1) {
            const jps = jp.stateObj.getSettings();
            check('Just Perfection told: clock right, no Activities',
                jps.get_int('clock-menu-position') === 1 && !jps.get_boolean('activities-button'),
                `pos=${jps.get_int('clock-menu-position')} activities=${jps.get_boolean('activities-button')}`);
            await Main.extensionManager._callExtensionDisable(jp.uuid);
            await wait(300);
            await Main.extensionManager._callExtensionEnable(jp.uuid);
            log(`  right after JP enable: ${clock.get_parent()?.name}`);
            await wait(1500);
            log(`  1.5s later: ${clock.get_parent()?.name}`);
            module('menubar')._ctx.settings.set_boolean('menubar-show-wifi', false);
            module('menubar')._ctx.settings.set_boolean('menubar-show-wifi', true);
            await wait(500);
            check('clock at far right with Just Perfection started later',
                clock.get_parent() === right && right.get_last_child() === clock, clock.get_parent()?.name);
            check('no Activities with Just Perfection started later',
                !Main.panel.statusArea.activities.container.visible);
            await Main.extensionManager._callExtensionDisable(UUID);
            await wait(500);
            check('Just Perfection settings restored when disabled',
                jps.get_int('clock-menu-position') === 0 && jps.get_boolean('activities-button'),
                `pos=${jps.get_int('clock-menu-position')} activities=${jps.get_boolean('activities-button')}`);
            await Main.extensionManager._callExtensionEnable(UUID);
            await wait(1000);
        }

        settings.set_string('weather-location',
            "(uint32 2, <('Yekaterinburg', 'USSS', true, [(0.99192878573234644, 1.0582512973081308)], [(0.99235057945267602, 1.0578876928650629)])>)");
        await wait(6000);
        const widgets = module('widgets')._widgets;
        const weather = widgets.find(w => w.widgetId === 'weather');
        log(`weather setting length=${weather?._settings.get_string('weather-location').length} infoLoc=${weather?._info.location?.get_name()} valid=${weather?._info.is_valid()} netErr=${weather?._info.network_error()}`);
        log(`weather: location="${weather?._location.text}" temp="${weather?._temp.text}" sky="${weather?._sky.text}" range="${weather?._range.text}"`);
        check('weather has data', !!weather?._temp.text);
        await shot('01-desktop');

        e.stateObj.openPreferences();
        await wait(6000);
        const win = global.display.list_all_windows().find(w => (w.title || '').length);
        check('prefs window opened', !!win, win?.title);
        if (win) {
            win.move_frame(false, 60, 80);
            Main.activateWindow(win);
            win.raise();
            await wait(800);
            const layer = module('widgets')._layer;
            const children = global.window_group.get_children();
            const layerIndex = children.indexOf(layer);
            const winIndex = children.indexOf(win.get_compositor_private());
            check('widget layer below windows after restack', layerIndex >= 0 && layerIndex < winIndex,
                `layer=${layerIndex} window=${winIndex}`);
            await shot('02-window-over-widgets');
        }

        const system = module('widgets')._widgets.find(w => w.widgetId === 'system');
        check('battery ring in System widget', !!system?._battery?.column.visible,
            system?._battery?.value.text ?? 'none');
        check('no separate battery widget by default',
            !module('widgets')._widgets.some(w => w.widgetId === 'battery'));

        settings.set_strv('widgets-enabled', [...settings.get_strv('widgets-enabled'), 'battery']);
        settings.set_string('widgets-battery-size', 'wide');
        await wait(1500);
        win?.delete(global.get_current_time());
        await wait(800);
        const battery = module('widgets')._widgets.find(w => w.widgetId === 'battery');
        check('wide battery widget', battery?.width > 300, `${battery?.width}`);
        await shot('03-wide-battery');

        const seat = Clutter.get_default_backend().get_default_seat();
        const mouse = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const now = () => GLib.get_monotonic_time();
        const moveTo = async (x, y, ms = 15) => {
            seat.warp_pointer(x, y);
            mouse.notify_absolute_motion(now(), x, y);
            await wait(ms);
        };
        settings.set_boolean('widgets-locked', false);
        const clockWidget = module('widgets')._widgets.find(w => w.widgetId === 'clock');
        const [cx0, cy0] = [clockWidget.x, clockWidget.y];
        const [gx, gy] = [cx0 + 40, cy0 + 40];
        await moveTo(gx, gy, 200);
        mouse.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        await wait(100);
        for (let i = 1; i <= 20; i++)
            await moveTo(gx + i * 25, gy + i * 15);
        mouse.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await wait(400);
        const saved = JSON.parse(settings.get_string('widgets-positions')).clock;
        check('dragged widget stays where it was dropped',
            Math.abs(clockWidget.x - (cx0 + 500)) < 3 && Math.abs(clockWidget.y - (cy0 + 300)) < 3,
            `from ${cx0},${cy0} to ${clockWidget.x},${clockWidget.y}`);
        module('widgets')._placeAll();
        check('dropped position saved', Array.isArray(saved) &&
            Math.abs(clockWidget.x - (cx0 + 500)) < 3, JSON.stringify(saved));
        await shot('13-widget-dragged');
        settings.set_string('widgets-positions', '{}');
        await wait(300);

        const dockItem = [...module('dock')._dock._items.values()].find(i => i.app);
        const [dx, dy] = dockItem.get_transformed_position();
        await moveTo(dx + dockItem.width / 2, dy + dockItem.height / 2, 300);
        mouse.notify_button(now(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
        await wait(80);
        mouse.notify_button(now(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
        await wait(500);
        check('dock icon menu opens on right click', dockItem._menu?.isOpen === true,
            `${dockItem.app.get_name()}: ${dockItem._menu?.isOpen}`);
        dockItem._menu?.close();
        await moveTo(800, 500, 400);

        const shake = module('shakecursor');
        const unfocusBefore = seat.is_unfocus_inhibited();
        await moveTo(800, 500, 300);
        for (let i = 0; i < 40; i++)
            await moveTo(i % 2 ? 650 : 950, 500 + (i % 3) * 4, 16);
        check('shaking enlarges the cursor', shake?._cursor?.visible && shake._scale > 2,
            `scale=${shake?._scale.toFixed(2)} visible=${shake?._cursor?.visible}`);
        const tracker = global.backend.get_cursor_tracker();
        check('system cursor hidden like the magnifier does it', !tracker.get_pointer_visible());
        await shot('14-shake-cursor');
        await moveTo(820, 520, 1200);
        check('cursor back to normal after shaking', shake._scale === 1 && !shake._cursor.visible &&
            seat.is_unfocus_inhibited() === unfocusBefore && tracker.get_pointer_visible() &&
            !shake._hidden, `scale=${shake._scale}`);
        for (let i = 0; i < 6; i++)
            await moveTo(800 + i * 30, 520, 40);
        check('slow movement does not enlarge the cursor', shake._scale === 1);

        settings.set_string('language', 'ru');
        settings.set_string('appearance', 'dark');
        await wait(4000);
        await shot('04-ru-dark');

        Main.osdWindowManager.showAll(Gio.ThemedIcon.new('audio-volume-medium-symbolic'), 'Speakers', 0.5, 1);
        await wait(400);
        const osd = module('osd')?._osds[0];
        check('volume pop-up shown, GNOME one hidden',
            osd?.actor.visible && osd.actor.opacity === 255 && !Main.osdWindowManager._osdWindows[0].visible,
            `${osd?.actor.visible} ${osd?.actor.opacity}`);
        check('volume pop-up title and level', osd?._title.text === 'Звук' &&
            Math.abs(osd._fill.width - (26 + (240 - 26) * 0.5)) < 2, `${osd?._title.text} ${osd?._fill.width}`);
        const [ox, oy] = osd?.actor.get_transformed_position() ?? [0, 0];
        check('volume pop-up under the menu bar on the right',
            oy >= Main.panel.height && oy < Main.panel.height + 30 && ox + osd.actor.width > global.stage.width - 30,
            `${Math.round(ox)},${Math.round(oy)}`);
        await shot('08-osd-volume');
        Main.osdWindowManager.showOne(0, Gio.ThemedIcon.new('display-brightness-symbolic'), null, 0.9, 1);
        await wait(300);
        check('brightness pop-up title', osd?._title.text === 'Дисплей' && osd._fill.width > 200,
            `${osd?._title.text} ${osd?._fill.width}`);
        await shot('09-osd-brightness');
        Main.osdWindowManager.showAll(Gio.ThemedIcon.new('input-keyboard-symbolic'), 'Caps Lock', null, null);
        await wait(500);
        check('pop-up without level stays GNOME\'s',
            Main.osdWindowManager._osdWindows[0].visible && osd.actor.opacity < 255);
        await wait(2000);

        const wmPrefs = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        const cssPath = dir => `${GLib.get_user_config_dir()}/${dir}/gtk.css`;
        const readCss = dir => {
            try {
                return new TextDecoder().decode(GLib.file_get_contents(cssPath(dir))[1]);
            } catch {
                return null;
            }
        };
        check('buttons on the left', wmPrefs.get_string('button-layout') === 'close,minimize,maximize:',
            wmPrefs.get_string('button-layout'));
        check('traffic light css written', readCss('gtk-4.0')?.includes('MacOS Shell: window buttons') &&
            readCss('gtk-3.0')?.includes('titlebutton.close'));
        settings.set_boolean('module-windowbuttons', false);
        await wait(300);
        check('window buttons off: layout and css restored',
            wmPrefs.get_string('button-layout') === 'appmenu:close' && readCss('gtk-4.0') === null,
            `${wmPrefs.get_string('button-layout')} ${readCss('gtk-4.0')?.length}`);
        GLib.mkdir_with_parents(`${GLib.get_user_config_dir()}/gtk-4.0`, 0o755);
        GLib.file_set_contents(`${GLib.get_user_config_dir()}/gtk-4.0/theme.css`, '/* theme */\n');
        Gio.File.new_for_path(cssPath('gtk-4.0')).make_symbolic_link('theme.css', null);
        settings.set_boolean('module-windowbuttons', true);
        await wait(300);
        check('themed gtk.css left alone', readCss('gtk-4.0') === '/* theme */\n' &&
            readCss('gtk-3.0')?.includes('titlebutton.close'));
        Gio.File.new_for_path(cssPath('gtk-4.0')).delete(null);
        settings.set_boolean('module-windowbuttons', false);
        settings.set_boolean('module-windowbuttons', true);
        await wait(300);

        GLib.spawn_async(null, ['gjs', '-m', this.dir.get_child('test-window.js').get_path()],
            null, GLib.SpawnFlags.SEARCH_PATH, null);
        await wait(5000);
        const pw = global.display.list_all_windows().find(w => w.title === 'Test window');
        if (pw) {
            pw.move_frame(false, 300, 150);
            await wait(500);
            await shot('10-window-buttons');
            const pa = pw.get_compositor_private();
            pw.minimize();
            await wait(Math.round(520 * 0.65));
            const anim = module('animations');
            check('genie running while minimizing', anim._running.has(pa) && pa.opacity === 0);
            await shot('11-genie-minimize');
            await wait(700);
            check('window minimized, effect removed',
                pw.minimized && !anim._running.has(pa) && !pa.visible && pa.opacity === 255);
            pw.unminimize();
            await wait(Math.round(520 * 0.5));
            check('genie running while restoring', anim._running.has(pa) && pa.visible);
            await shot('12-genie-restore');
            await wait(700);
            check('window restored', !pw.minimized && pa.visible && !anim._running.has(pa) &&
                pa.scale_x === 1 && pa.opacity === 255);
            settings.set_string('animations-effect', 'scale');
            pw.minimize();
            await wait(150);
            check('scale effect while minimizing', pa.scale_x < 1 && pa.scale_x > 0, `${pa.scale_x}`);
            await wait(600);
            pw.unminimize();
            await wait(600);
            check('window restored after scale', !pw.minimized && pa.visible && pa.scale_x === 1);
            settings.set_string('animations-effect', 'genie');
            pw.delete(global.get_current_time());
            await wait(800);
        } else {
            check('prefs window for animation test', false);
        }

        const lp = module('launchpad')?._launchpad;
        settings.set_int('launchpad-rows', 3);
        Main.overview.showApps();
        await wait(800);
        check('Launchpad opens from showApps, not the overview',
            lp?.isOpen && lp.actor.visible && !Main.overview.visible,
            `open=${lp?.isOpen} overview=${Main.overview.visible}`);
        check('Launchpad lists apps', lp?._tiles.length >= 10 && lp._pageCount >= 1,
            `tiles=${lp?._tiles.length} pages=${lp?._pageCount} hint=${lp?._search.hint_text}`);
        await shot('15-launchpad');
        check('several pages', lp._pageCount > 1, `${lp._pageCount}`);
        if (lp._pageCount > 1) {
            lp._goToPage(1);
            await wait(600);
            check('Launchpad turns pages', lp._pagesBox.translation_x === -lp._geom.W,
                `${lp._pagesBox.translation_x}`);
            await shot('16-launchpad-page2');
            lp._goToPage(0, false);
        }
        const folderTile = lp._tiles.find(t => t._item.type === 'folder');
        if (folderTile) {
            folderTile.emit('clicked', Clutter.BUTTON_PRIMARY);
            await wait(500);
            check('Launchpad folder opens', !!lp._folder && lp._folder.tiles.length > 0,
                `${folderTile._item.name}: ${lp._folder?.tiles.length}`);
            await shot('17-launchpad-folder');
            lp._onKeyPress({get_key_symbol: () => Clutter.KEY_Escape});
            await wait(400);
            check('Escape closes the folder first', !lp._folder && lp.isOpen);
        }
        lp._search.set_text('sett');
        await wait(300);
        check('Launchpad search', lp._visible.length >= 1 &&
            lp._visible[0].app.get_id() === 'org.gnome.Settings.desktop' && lp._selected === 0,
            lp._visible.map(i => i.app.get_name()).join(', '));
        await shot('18-launchpad-search');
        lp._onKeyPress({get_key_symbol: () => Clutter.KEY_Escape});
        check('Escape clears the search', lp._search.get_text() === '' && lp.isOpen);
        lp._onKeyPress({get_key_symbol: () => Clutter.KEY_Escape});
        await wait(500);
        check('Escape closes Launchpad', !lp.isOpen && !lp.actor.visible && Main.modalCount === 0,
            `modal=${Main.modalCount}`);
        global.display.emit('overlay-key');
        await wait(500);
        check('Super opens Launchpad', lp.isOpen && !Main.overview.visible);
        global.display.emit('overlay-key');
        await wait(500);
        check('Super closes Launchpad', !lp.isOpen);
        const keyboard = Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const tapSuper = async () => {
            keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
            await wait(60);
            keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
        };
        const states = [];
        for (let i = 0; i < 6; i++) {
            await tapSuper();
            await wait(i % 2 ? 150 : 600);
            states.push(`${lp.isOpen ? 'open' : 'closed'}/${lp.actor.visible ? 'shown' : 'hidden'}/modal${Main.modalCount}`);
        }
        await wait(600);
        log(`  super taps: ${states.join(' ')}`);
        check('Super taps toggle Launchpad every time',
            states.every((st, i) => st.startsWith(i % 2 ? 'closed' : 'open')) &&
            lp.actor.visible === lp.isOpen, states.join(' '));
        if (lp.isOpen)
            lp.close(false);
        await wait(300);
        await tapSuper();
        await wait(600);
        check('Launchpad still opens after the taps', lp.isOpen && lp.actor.visible,
            `${lp.isOpen} ${lp.actor.visible}`);
        lp.close(false);
        await wait(300);
        for (let i = 0; i < 9; i++) {
            await tapSuper();
            await wait(40);
        }
        await wait(800);
        check('mashing Super leaves Launchpad consistent',
            lp.actor.visible === lp.isOpen && Main.modalCount === (lp.isOpen ? 1 : 0),
            `open=${lp.isOpen} visible=${lp.actor.visible} modal=${Main.modalCount}`);
        const wasOpen = lp.isOpen;
        await tapSuper();
        await wait(600);
        check('Super still works after mashing', lp.isOpen === !wasOpen && lp.actor.visible === lp.isOpen);
        lp.close(false);
        await wait(300);
        settings.set_boolean('launchpad-super-key', false);
        global.display.emit('overlay-key');
        await wait(1200);
        check('Super opens the overview when switched off', Main.overview.visible && !lp.isOpen);
        Main.overview.hide();
        await wait(1200);
        settings.set_boolean('launchpad-super-key', true);
        settings.set_int('launchpad-rows', 5);

        const AccountsService = (await import('gi://AccountsService')).default;
        const St = (await import('gi://St')).default;
        const ModalDialogs = await import('resource:///org/gnome/shell/ui/modalDialog.js');
        const Dialogs = await import('resource:///org/gnome/shell/ui/dialog.js');
        const UserWidget = await import('resource:///org/gnome/shell/ui/userWidget.js');
        const ShellEntry = await import('resource:///org/gnome/shell/ui/shellEntry.js');
        const makeAuth = () => {
            const d = new ModalDialogs.ModalDialog({styleClass: 'prompt-dialog'});
            d.contentLayout.add_child(new Dialogs.MessageDialogContent({
                title: 'Требуется аутентификация',
                description: 'Для изменения системных настроек требуется аутентификация',
            }));
            const body = new Dialogs.MessageDialogContent();
            const userBox = new St.BoxLayout({style_class: 'polkit-dialog-user-layout', orientation: Clutter.Orientation.VERTICAL});
            const user = AccountsService.UserManager.get_default().get_user(GLib.get_user_name());
            const avatar = new UserWidget.Avatar(user, {iconSize: 64});
            avatar.x_align = Clutter.ActorAlign.CENTER;
            userBox.add_child(avatar);
            userBox.add_child(new St.Label({style_class: 'polkit-dialog-user-label', text: GLib.get_real_name(), x_align: Clutter.ActorAlign.CENTER}));
            body.add_child(userBox);
            const pwBox = new St.BoxLayout({style_class: 'prompt-dialog-password-layout', orientation: Clutter.Orientation.VERTICAL});
            const entry = new St.PasswordEntry({style_class: 'prompt-dialog-password-entry', text: '', can_focus: true, x_align: Clutter.ActorAlign.CENTER});
            pwBox.add_child(entry);
            const warnings = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
            warnings.add_child(new ShellEntry.CapsLockWarning());
            warnings.add_child(new St.Label({style_class: 'prompt-dialog-error-label', visible: false}));
            warnings.add_child(new St.Label({style_class: 'prompt-dialog-info-label', visible: false}));
            warnings.add_child(new St.Label({style_class: 'prompt-dialog-null-label', text: ' '}));
            pwBox.add_child(warnings);
            body.add_child(pwBox);
            d._entry = entry;
            d.setInitialKeyFocus(entry);
            d.contentLayout.add_child(body);
            d.setButtons([
                {label: 'Отменить', action: () => d.close(), key: Clutter.KEY_Escape},
                {label: 'Подтвердить', action: () => {}, default: true},
            ]);
            return d;
        };
        const makePowerOff = () => {
            const d = Main.endSessionDialog;
            d.OpenAsync([1, 0, 60, []], {return_value() {}, return_dbus_error() {}});
            return d;
        };
        GLib.spawn_async(null, ['gjs', '-m', this.dir.get_child('test-window.js').get_path()],
            null, GLib.SpawnFlags.SEARCH_PATH, null);
        await wait(4000);
        const tw = global.display.list_all_windows().find(w => w.title === 'Test window');
        tw?.move_frame(false, 380, 200);
        const showAll = async suffix => {
            for (const [name, make] of [['auth', makeAuth], ['poweroff', makePowerOff]]) {
                const d = make();
                if (name !== 'poweroff')
                    d.open();
                for (let i = 0; i < 30 && d.state !== ModalDialogs.State.OPENED; i++)
                    await wait(100);
                await wait(400);
                if (suffix === 'after' && name === 'auth') {
                    const e = d._entry;
                    const w0 = e.width;
                    e.set_text('correct horse battery');
                    await wait(200);
                    check('password field keeps its width while typing', w0 >= 240 && e.width === w0, `${w0} -> ${e.width}`);
                    check('password field not highlighted when focused',
                        global.stage.key_focus === e.clutter_text && !e.get_theme_node().get_box_shadow(),
                        `focus=${global.stage.key_focus === e.clutter_text}`);
                    const [, ey] = e.get_transformed_position();
                    const [, by] = d.buttonLayout.get_transformed_position();
                    check('small gap between the field and the buttons', by - (ey + e.height) <= 32,
                        `${Math.round(by - (ey + e.height))}px`);
                    e.set_text('');
                }
                if (suffix === 'after' && name === 'poweroff') {
                    const labels = d.buttonLayout.get_children().map(b => b.label);
                    const kids = d.buttonLayout.get_children();
                    const stacked = d.buttonLayout.layout_manager.orientation === Clutter.Orientation.VERTICAL;
                    check('power off buttons: 3+ stacked with the default on top, 2 side by side',
                        kids.length > 2 ? stacked && kids[0].has_style_pseudo_class('default') : !stacked,
                        labels.join(', '));
                }
                if (suffix === 'after') {
                    const box = d.dialogLayout._dialog;
                    check(`${name} dialog restyled`, box.has_style_class_name('tahoe-dialog') &&
                        !!box._tahoeIcon && box.scale_x === 1, `${box.style_class}`);
                }
                await shot(`19-dialog-${name}-${suffix}`);
                if (name === 'poweroff')
                    d.Close();
                else
                    d.close();
                for (let i = 0; i < 30 && d.state !== ModalDialogs.State.CLOSED; i++)
                    await wait(100);
            }
            if (tw) {
                const cd = Main.wm._createCloseDialog(global.window_manager, tw);
                cd.show();
                await wait(900);
                if (suffix === 'after') {
                    const box = cd._dialog?._dialog;
                    check('not-responding dialog restyled with the app icon',
                        box?.has_style_class_name('tahoe-dialog') && !!box._tahoeIcon);
                }
                await shot(`19-dialog-notresponding-${suffix}`);
                cd.hide();
                await wait(500);
            }
        };
        settings.set_boolean('module-dialogs', false);
        await wait(300);
        await showAll('before');
        settings.set_boolean('module-dialogs', true);
        await wait(300);
        await showAll('after');
        const leftover = makeAuth();
        leftover.open();
        await wait(500);
        settings.set_boolean('module-dialogs', false);
        await wait(300);
        check('dialogs restored when switched off', !leftover.dialogLayout._dialog.has_style_class_name('tahoe-dialog') &&
            !leftover.dialogLayout._dialog._tahoeIcon);
        leftover.close();
        settings.set_boolean('module-dialogs', true);
        await wait(300);
        tw?.delete(global.get_current_time());
        await wait(800);

        settings.set_int('lockscreen-clock-opacity', 60);
        Main.screenShield.lock(false);
        await wait(2500);
        Main.screenShield._onUserBecameActive();
        Main.screenShield._dialog?._showPrompt();
        await wait(2000);
        const lock = module('lockscreen');
        check('lock clock opacity', lock?._clock?._box.opacity === 153, `${lock?._clock?._box.opacity}`);
        const findAvatar = actor => {
            if (actor.has_style_class_name?.('user-icon'))
                return actor;
            for (const c of actor.get_children()) {
                const r = findAvatar(c);
                if (r)
                    return r;
            }
            return null;
        };
        const avatar = Main.screenShield._dialog ? findAvatar(Main.screenShield._dialog) : null;
        check('small avatar on lock screen', avatar && avatar.width <= 80, `${avatar?.width}`);
        await shot('05-lock-prompt');

        const promptBox = Main.screenShield._dialog?._promptBox;
        if (promptBox) {
            const [, py] = promptBox.get_transformed_position();
            const [, ph] = promptBox.get_transformed_size();
            const screenH = global.stage.height;
            check('password field low on the screen', py > screenH * 0.6,
                `top=${Math.round(py)} bottom=${Math.round(py + ph)} of ${screenH}`);
        }

        e.stateObj.openPreferences();
        await wait(5000);
        const shield = Main.screenShield;
        shield._continueDeactivate(true);
        await wait(180);
        const g = shield._lockDialogGroup;
        const winActor = global.get_window_actors().find(a => a.meta_window?.title);
        log(`mid-unlock: opacity=${g.opacity} scale=${g.scale_x.toFixed(3)} ty=${g.translation_y} windowScale=${winActor?.scale_x.toFixed(3)} groupScale=${global.window_group.scale_x}`);
        check('unlock fades instead of sliding',
            g.opacity < 255 && g.opacity > 0 && g.translation_y === 0 && g.scale_x > 1);
        check('windows zoom in while unlocking, wallpaper stays',
            winActor && winActor.scale_x < 1 && global.window_group.scale_x === 1);
        await shot('06-unlocking');
        await wait(900);
        check('windows back to normal after unlock', winActor?.scale_x === 1, `${winActor?.scale_x}`);
        check('screen unlocked', !shield.locked && !shield.actor.visible);
        await shot('07-unlocked');

        log('DONE');
        await wait(300);
        global.context.terminate();
    }
}
