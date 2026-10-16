// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

const POP_TIME = 260;
const DIM_FACTOR = 0.25;

const ICONS = {
    'prompt-dialog': 'changes-prevent-symbolic',
    'end-session-dialog': 'system-shutdown-symbolic',
    'access-dialog': 'security-high-symbolic',
    'audio-device-selection-dialog': 'audio-headphones-symbolic',
    'inhibit-shortcuts-dialog': 'input-keyboard-symbolic',
};

export default class DialogsModule {
    constructor(ctx) {
        this._ctx = ctx;
    }

    enable() {
        this._boxes = new Set();
        this._injections = new InjectionManager();
        const module = this;

        this._injections.overrideMethod(Dialog.Dialog.prototype, '_init', orig =>
            function (parentActor, styleClass) {
                orig.call(this, parentActor, styleClass);
                try {
                    module._decorate(this, parentActor, styleClass);
                } catch (e) {
                    console.error(`[macos-shell] dialog: ${e.message}`);
                }
            });

        this._injections.overrideMethod(ModalDialog.ModalDialog.prototype, '_fadeOpen', orig =>
            function (...args) {
                const box = this.dialogLayout?._dialog;
                const ours = box && module._boxes.has(box);
                if (ours && this._lightbox && !module._ctx.settings.get_boolean('dialogs-dim'))
                    this._lightbox._fadeFactor = DIM_FACTOR;
                orig.apply(this, args);
                if (ours && this._shouldFadeIn)
                    module._pop(box);
            });

        this._decorateExisting();
    }

    // Dialogs made before us, e.g. the power off dialog created at startup.
    _decorateExisting() {
        for (const child of Main.layoutManager.modalDialogGroup.get_children()) {
            const box = child.dialogLayout?._dialog;
            if (!box || this._boxes.has(box))
                continue;
            const styleClass = Object.keys(ICONS).find(c => box.has_style_class_name(c)) ?? null;
            this._decorate(child.dialogLayout, null, styleClass);
        }
    }

    disable() {
        this._injections.clear();
        this._injections = null;
        for (const box of this._boxes)
            this._undecorate(box);
        this._boxes = null;
    }

    _iconFor(parentActor, styleClass) {
        if (styleClass === 'close-dialog') {
            const app = parentActor?.meta_window
                ? Shell.WindowTracker.get_default().get_window_app(parentActor.meta_window) : null;
            const icon = app?.create_icon_texture(64);
            icon?.add_style_class_name('tahoe-dialog-app-icon');
            return icon ?? null;
        }
        const name = ICONS[styleClass];
        return name ? new St.Icon({icon_name: name, style_class: 'tahoe-dialog-icon'}) : null;
    }

    _decorate(dialog, parentActor, styleClass) {
        const box = dialog._dialog;
        if (!box)
            return;
        box.add_style_class_name('tahoe-dialog');
        this._ctx.applyAppearance(box);

        const icon = this._iconFor(parentActor, styleClass);
        if (icon) {
            icon.x_align = Clutter.ActorAlign.CENTER;
            box.insert_child_at_index(icon, 0);
            box._tahoeIcon = icon;
        }

        this._stackButtons(box, dialog.buttonLayout);
        this._boxes.add(box);
        box.connect('destroy', () => this._boxes?.delete(box));
    }

    _stackButtons(box, buttons) {
        if (!buttons?.layout_manager)
            return;
        box._tahoeButtons = buttons;
        buttons._tahoeOrder = [...buttons.get_children()];
        buttons.connectObject('child-added', (_b, child) => {
            if (buttons._tahoeSyncing)
                return;
            buttons._tahoeOrder.push(child);
            this._syncButtons(buttons, true);
        }, this);
        this._syncButtons(buttons, true);
    }

    _syncButtons(buttons, ours) {
        const order = buttons._tahoeOrder.filter(b => b.get_parent() === buttons);
        buttons._tahoeOrder = order;
        const stacked = ours && order.length > 2;
        buttons.layout_manager.orientation = stacked
            ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
        if (stacked)
            buttons.add_style_class_name('tahoe-stacked');
        else
            buttons.remove_style_class_name('tahoe-stacked');
        buttons._tahoeSyncing = true;
        (stacked ? [...order].reverse() : order).forEach((b, i) => buttons.set_child_at_index(b, i));
        buttons._tahoeSyncing = false;
    }

    _undecorate(box) {
        for (const c of ['tahoe-dialog', 'tahoe-light', 'tahoe-dark'])
            box.remove_style_class_name(c);
        box._tahoeIcon?.destroy();
        delete box._tahoeIcon;
        const buttons = box._tahoeButtons;
        if (buttons) {
            buttons.disconnectObject(this);
            this._syncButtons(buttons, false);
            delete box._tahoeButtons;
        }
        box.set_scale(1, 1);
    }

    _pop(box) {
        box.remove_transition('scale-x');
        box.remove_transition('scale-y');
        box.set_pivot_point(0.5, 0.5);
        box.set_scale(0.88, 0.88);
        box.ease({
            scale_x: 1,
            scale_y: 1,
            duration: POP_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_BACK,
        });
    }

    onAppearanceChanged() {
        for (const box of this._boxes ?? [])
            this._ctx.applyAppearance(box);
    }
}
