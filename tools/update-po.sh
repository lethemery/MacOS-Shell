#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../macos-shell@letemery"

xgettext -L JavaScript --from-code=UTF-8 --keyword=_ --keyword=N_ \
    --package-name="MacOS Shell" --add-comments=Translators \
    -o po/macos-shell.pot $(find . -name '*.js' | sort)

for po in po/*.po; do
    msgmerge --quiet --update --backup=none "$po" po/macos-shell.pot
    msgfmt --check --statistics -o /dev/null "$po"
done
