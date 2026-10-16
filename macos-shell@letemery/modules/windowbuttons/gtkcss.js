// SPDX-License-Identifier: GPL-2.0-or-later
// macOS "traffic light" title bar buttons for GTK apps. GTK reads the user
// stylesheet ~/.config/gtk-{3.0,4.0}/gtk.css; we keep our rules in a marked
// block there and never touch the rest of the file. A gtk.css that belongs to
// a theme (a symlink, or one that already styles the title bar buttons, like
// WhiteSur) is left alone. Used by both the shell and the preferences.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BEGIN = '/* >>> MacOS Shell: window buttons (managed by the extension, do not edit) >>> */';
const END = '/* <<< MacOS Shell: window buttons <<< */';

const GTK4_CSS = `
windowcontrols { border-spacing: 8px; }
windowcontrols > button.close,
windowcontrols > button.minimize,
windowcontrols > button.maximize {
  min-width: 14px;
  min-height: 14px;
  margin: 0;
  padding: 0;
  background: none;
  box-shadow: none;
  border: none;
}
windowcontrols > button.close > image,
windowcontrols > button.minimize > image,
windowcontrols > button.maximize > image {
  padding: 2px;
  margin: 0;
  -gtk-icon-size: 9px;
  border-radius: 100%;
  color: transparent;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  transition: color 120ms;
}
windowcontrols > button.close > image { background-color: #ff5f57; }
windowcontrols > button.minimize > image { background-color: #febc2e; }
windowcontrols > button.maximize > image { background-color: #28c840; }
windowcontrols:hover > button.close > image { color: rgba(90, 0, 0, 0.75); }
windowcontrols:hover > button.minimize > image { color: rgba(110, 60, 0, 0.75); }
windowcontrols:hover > button.maximize > image { color: rgba(0, 80, 0, 0.75); }
windowcontrols > button.close:active > image { background-color: #d9473f; }
windowcontrols > button.minimize:active > image { background-color: #d99a1e; }
windowcontrols > button.maximize:active > image { background-color: #1da831; }
windowcontrols:backdrop:not(:hover) > button.close > image,
windowcontrols:backdrop:not(:hover) > button.minimize > image,
windowcontrols:backdrop:not(:hover) > button.maximize > image {
  background-color: alpha(currentColor, 0.2);
  color: transparent;
  box-shadow: none;
}
`;

const GTK3_CSS = `
button.titlebutton.close,
button.titlebutton.minimize,
button.titlebutton.maximize {
  min-width: 14px;
  min-height: 14px;
  margin: 0 3px;
  padding: 0;
  border: none;
  border-radius: 100%;
  background-image: none;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  color: transparent;
  -gtk-icon-shadow: none;
}
button.titlebutton.close { background-color: #ff5f57; }
button.titlebutton.minimize { background-color: #febc2e; }
button.titlebutton.maximize { background-color: #28c840; }
button.titlebutton.close:hover { color: rgba(90, 0, 0, 0.75); }
button.titlebutton.minimize:hover { color: rgba(110, 60, 0, 0.75); }
button.titlebutton.maximize:hover { color: rgba(0, 80, 0, 0.75); }
button.titlebutton.close:active { background-color: #d9473f; }
button.titlebutton.minimize:active { background-color: #d99a1e; }
button.titlebutton.maximize:active { background-color: #1da831; }
button.titlebutton.close:backdrop:not(:hover),
button.titlebutton.minimize:backdrop:not(:hover),
button.titlebutton.maximize:backdrop:not(:hover) {
  background-color: alpha(currentColor, 0.2);
  box-shadow: none;
}
`;

export const GTK_VERSIONS = [
    {dir: 'gtk-4.0', css: GTK4_CSS, themed: /windowcontrols\s*>?\s*button\.close/},
    {dir: 'gtk-3.0', css: GTK3_CSS, themed: /titlebutton\.close/},
];

function cssFile(version) {
    return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), version.dir, 'gtk.css']));
}

function read(file) {
    try {
        const [, bytes] = file.load_contents(null);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}

function stripBlock(text) {
    const start = text.indexOf(BEGIN);
    const end = text.indexOf(END);
    if (start < 0 || end < start)
        return text;
    const before = text.slice(0, start).replace(/\n+$/, '');
    const after = text.slice(end + END.length).replace(/^\n+/, '');
    return before && after ? `${before}\n\n${after}` : before || after;
}

function isSymlink(file) {
    try {
        return file.query_info('standard::is-symlink', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null)
            .get_is_symlink();
    } catch {
        return false;
    }
}

export function cssState(version) {
    const file = cssFile(version);
    const text = read(file);
    if (text === null)
        return 'none';
    if (text.includes(BEGIN))
        return 'ours';
    if (isSymlink(file) || version.themed.test(text))
        return 'theme';
    return 'none';
}

export function install(version) {
    const file = cssFile(version);
    const state = cssState(version);
    if (state === 'theme')
        return false;
    const rest = stripBlock(read(file) ?? '');
    const block = `${BEGIN}\n${version.css.trim()}\n${END}\n`;
    const text = rest ? `${rest.replace(/\n+$/, '')}\n\n${block}` : block;
    try {
        file.get_parent().make_directory_with_parents(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw e;
    }
    file.replace_contents(new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.NONE, null);
    return true;
}

export function uninstall(version) {
    const file = cssFile(version);
    const text = read(file);
    if (text === null || !text.includes(BEGIN))
        return;
    const rest = stripBlock(text).trim();
    if (rest)
        file.replace_contents(new TextEncoder().encode(`${rest}\n`), null, false, Gio.FileCreateFlags.NONE, null);
    else
        file.delete(null);
}
