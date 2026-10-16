#!/usr/bin/env bash
# tools/headless-test/run.sh [output-dir]      (default: ./test-output)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$(realpath -m "${1:-$ROOT/test-output}")"
ENV="$(mktemp -d)"
RUNTIME="$(mktemp -d /tmp/msh.XXXX)"   # short path: Wayland socket names are limited
trap 'rm -rf "$ENV" "$RUNTIME" 2>/dev/null || true' EXIT

mkdir -p "$OUT" "$ENV"/{data,config,cache}
rm -f "$OUT"/*
export XDG_DATA_HOME="$ENV/data" XDG_CONFIG_HOME="$ENV/config" XDG_CACHE_HOME="$ENV/cache"
export XDG_RUNTIME_DIR="$RUNTIME" TEST_OUTPUT="$OUT"
EXT="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$EXT"
cp -r "$ROOT/macos-shell@letemery" "$EXT/"
glib-compile-schemas "$EXT/macos-shell@letemery/schemas"
cp -r "$HERE/driver@macos-shell" "$EXT/"
JP=just-perfection-desktop@just-perfection
EXTRA=""
for d in "${REAL_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$JP" "/usr/share/gnome-shell/extensions/$JP"; do
    if [[ -d "$d" ]]; then
        cp -r "$d" "$EXT/"
        EXTRA="\"$JP\","
        break
    fi
done
export EXTRA JP_AFTER="${JP_AFTER:-}"
unset WAYLAND_DISPLAY DISPLAY

dbus-run-session -- bash -c '
gsettings set org.gnome.shell disable-user-extensions false
if [ -n "$JP_AFTER" ]; then
  gsettings set org.gnome.shell enabled-extensions "[\"macos-shell@letemery\",$EXTRA\"driver@macos-shell\"]"
else
  gsettings set org.gnome.shell enabled-extensions "[$EXTRA\"macos-shell@letemery\",\"driver@macos-shell\"]"
fi
gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"
gsettings set org.gnome.desktop.interface clock-format "24h"
# The virtual mouse starts in the top-left corner and could set off the hot corner.
gsettings set org.gnome.desktop.interface enable-hot-corners false
gsettings set org.gnome.desktop.wm.preferences num-workspaces 2
gsettings set org.gnome.mutter dynamic-workspaces false
gsettings set org.gnome.shell favorite-apps "[\"org.gnome.Nautilus.desktop\",\"org.gnome.Ptyxis.desktop\",\"org.mozilla.firefox.desktop\",\"org.gnome.TextEditor.desktop\",\"org.gnome.Settings.desktop\"]"
timeout 180 gnome-shell --headless --wayland --no-x11 --virtual-monitor 1600x1000 --wayland-display=msh-test
' > "$OUT/shell.log" 2>&1
echo "exit $? — results in $OUT (test.log, *.png, shell.log)"
