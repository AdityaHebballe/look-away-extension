#!/bin/bash

# build.sh
# Build script for Look Away! GNOME extension

SOURCES="
    extension.js
    prefs.js
    look-away.ogg
    "

GNOME_EXTENSIONS_CMD=()
GNOME_SESSION_QUIT_CMD=()

function ResolveGnomeExtensionsCommand()
{
    if command -v gnome-extensions >/dev/null 2>&1; then
        GNOME_EXTENSIONS_CMD=(gnome-extensions)
        return 0
    fi

    if command -v flatpak-spawn >/dev/null 2>&1 &&
        flatpak-spawn --host gnome-extensions --help >/dev/null 2>&1; then
        GNOME_EXTENSIONS_CMD=(flatpak-spawn --host gnome-extensions)
        return 0
    fi

    echo "Error: could not find 'gnome-extensions' in the container or on the host." >&2
    echo "Install it in the toolbox, or make it available on the host for flatpak-spawn." >&2
    return 1
}

function ResolveGnomeSessionQuitCommand()
{
    if command -v gnome-session-quit >/dev/null 2>&1; then
        GNOME_SESSION_QUIT_CMD=(gnome-session-quit)
        return 0
    fi

    if command -v flatpak-spawn >/dev/null 2>&1 &&
        flatpak-spawn --host gnome-session-quit --help >/dev/null 2>&1; then
        GNOME_SESSION_QUIT_CMD=(flatpak-spawn --host gnome-session-quit)
        return 0
    fi

    echo "Error: could not find 'gnome-session-quit' in the container or on the host." >&2
    return 1
}

function Help()
{
    echo "Usage: $(basename $0) [-bil]."
    echo "  -b  build the extension"
    echo "  -i  install the extension"
    echo "  -l  log out gnome session afterwards"
}

build=""
install=""
logout=""

while getopts ":bil" option; do
    case $option in
    b)
        build=1;;
    i)
        install=1;;
    l)
        logout=1;;
    *)
        Help
        exit
        ;;
    esac
done

if [[ $build ]]; then
    if [ -d "schemas" ]; then
        glib-compile-schemas schemas/
    fi

    ResolveGnomeExtensionsCommand || exit 1
    
    EXTRA_SOURCES=""
    for SCRIPT in ${SOURCES}; do
        EXTRA_SOURCES="${EXTRA_SOURCES} --extra-source=${SCRIPT}"
    done
    
    "${GNOME_EXTENSIONS_CMD[@]}" pack --force $EXTRA_SOURCES
fi

if [[ $install ]]; then
    ResolveGnomeExtensionsCommand || exit 1
    "${GNOME_EXTENSIONS_CMD[@]}" install --force *.zip
fi

if [[ $logout ]]; then
    ResolveGnomeSessionQuitCommand || exit 1
    "${GNOME_SESSION_QUIT_CMD[@]}" --logout --no-prompt
fi
