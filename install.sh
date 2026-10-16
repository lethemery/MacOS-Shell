#!/usr/bin/env bash
# MacOS Shell for GNOME Shell — installer.
#
#   ./install.sh               install (or update) and enable the extension
#   ./install.sh --no-enable   install without enabling
#   ./install.sh --uninstall   remove the extension (settings are kept)
#   ./install.sh --pack        build an installable zip in ./dist
#
# Modules are switched on and off in the extension's preferences.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID=macos-shell@letemery
SRC="$ROOT/$UUID"
DEST_BASE="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
DEST="$DEST_BASE/$UUID"
OLD_UUIDS=(tahoe-menubar@macos-shell tahoe-dock@macos-shell tahoe-widgets@macos-shell
           tahoe-notifications@macos-shell tahoe-lockscreen@macos-shell
           macos-tahoe@macos-shell macos-shell@macos-shell)
OLD_DCONF=/org/gnome/shell/extensions/macos-tahoe/
NEW_DCONF=/org/gnome/shell/extensions/macos-shell/

if [[ "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" == ru* ]]; then RU=1; else RU=0; fi
t() { if (( RU )); then printf '%s' "$2"; else printf '%s' "$1"; fi; }

bold=$'\e[1m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; reset=$'\e[0m'
info() { printf '%s\n' "${bold}==>${reset} $*"; }
ok()   { printf '%s\n' "  ${green}✓${reset} $*"; }
warn() { printf '%s\n' "  ${yellow}!${reset} $*"; }
die()  { printf '%s\n' "${red}✗ $*${reset}" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$(t "Missing command: $1" "Не найдена команда: $1")"; }

list_remove() {
    local key="$1" uuid="$2" list
    list=$(gsettings get org.gnome.shell "$key")
    [[ "$list" == *"'$uuid'"* ]] || return 0
    list=$(sed -e "s/'$uuid', //; s/, '$uuid'//; s/'$uuid'//" <<<"$list")
    gsettings set org.gnome.shell "$key" "$list"
}

list_add() {
    local key="$1" uuid="$2" list
    list=$(gsettings get org.gnome.shell "$key")
    [[ "$list" == *"'$uuid'"* ]] && return 0
    if [[ "$list" == "@as []" || "$list" == "[]" ]]; then
        list="['$uuid']"
    else
        list="${list%]}, '$uuid']"
    fi
    gsettings set org.gnome.shell "$key" "$list"
}

stage() {
    local target="$1"
    rm -rf "$target"
    mkdir -p "$target"
    cp -r "$SRC/." "$target/"
    rm -f "$target/po/"*.pot
    glib-compile-schemas "$target/schemas/"
}

remove_old() {
    local old found=0
    for old in "${OLD_UUIDS[@]}"; do
        list_remove enabled-extensions "$old"
        list_remove disabled-extensions "$old"
        if [[ -d "$DEST_BASE/$old" ]]; then
            rm -rf "${DEST_BASE:?}/$old"
            found=1
        fi
    done
    (( found )) && ok "$(t "Removed the previous versions (tahoe-*, macos-tahoe, macos-shell@macos-shell)" \
                           "Удалены прошлые версии (tahoe-*, macos-tahoe, macos-shell@macos-shell)")"
    return 0
}

migrate_settings() {
    command -v dconf >/dev/null 2>&1 || return 0
    local old new
    old=$(dconf dump "$OLD_DCONF" 2>/dev/null || true)
    new=$(dconf dump "$NEW_DCONF" 2>/dev/null || true)
    if [[ -n "$old" && -z "$new" ]]; then
        dconf load "$NEW_DCONF" <<<"$old"
        ok "$(t "Settings moved from MacOS Tahoe" "Настройки перенесены из MacOS Tahoe")"
    fi
}

do_install() {
    local enable="$1"
    need glib-compile-schemas
    info "$(t "Installing into" "Установка в") $DEST"
    remove_old
    migrate_settings
    mkdir -p "$DEST_BASE"
    stage "$DEST"
    ok "MacOS Shell  ${bold}$UUID${reset}"

    if (( enable )); then
        gsettings set org.gnome.shell disable-user-extensions false 2>/dev/null || true
        gnome-extensions enable "$UUID" 2>/dev/null || list_add enabled-extensions "$UUID"
        list_remove disabled-extensions "$UUID"
        ok "$(t "Enabled" "Включено")"
    fi

    echo
    if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
        warn "$(t "Log out and log back in to load the new version (Wayland)." \
                  "Выйдите из сеанса и войдите снова, чтобы загрузить новую версию (Wayland).")"
    else
        warn "$(t "Press Alt+F2, type r and press Enter to restart GNOME Shell." \
                  "Нажмите Alt+F2, введите r и нажмите Enter, чтобы перезапустить GNOME Shell.")"
    fi
    echo "  $(t "Settings:" "Настройки:") gnome-extensions prefs $UUID"
}

do_uninstall() {
    info "$(t "Removing" "Удаление")"
    gnome-extensions disable "$UUID" 2>/dev/null || true
    list_remove enabled-extensions "$UUID"
    rm -rf "${DEST:?}"
    remove_old
    ok "MacOS Shell"
    echo "  $(t "Your settings are kept. Reset them with:" "Настройки сохранены. Сбросить их можно командой:")"
    echo "  dconf reset -f /org/gnome/shell/extensions/macos-shell/"
}

do_pack() {
    need zip
    need glib-compile-schemas
    local dist="$ROOT/dist" tmp
    mkdir -p "$dist"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' RETURN
    stage "$tmp/$UUID"
    rm -f "$dist/$UUID.shell-extension.zip"
    (cd "$tmp/$UUID" && zip -qr "$dist/$UUID.shell-extension.zip" .)
    ok "dist/$UUID.shell-extension.zip"
    echo "  $(t "Install it with:" "Установить:") gnome-extensions install --force dist/$UUID.shell-extension.zip"
}

ACTION=install
ENABLE=1
for arg in "$@"; do
    case "$arg" in
        --uninstall|-u|uninstall) ACTION=uninstall ;;
        --pack|-p|pack)           ACTION=pack ;;
        --no-enable)              ENABLE=0 ;;
        -h|--help)                sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "$(t "Unknown option: $arg" "Неизвестный параметр: $arg")" ;;
    esac
done

case "$ACTION" in
    install)   do_install "$ENABLE" ;;
    uninstall) do_uninstall ;;
    pack)      do_pack ;;
esac
