#!/bin/sh
set -eu
cd "$(dirname "$0")"
launcher=../../services/agent-runner/ts/src/resources/plugins/computer-use/mcp/cua-repl.mjs
test -r "$launcher" || { echo "The computer-use plugin launcher is missing: $launcher" >&2; exit 1; }
swift build -c release
binary_dir=$(swift build -c release --show-bin-path)
bundle='dist/Priva Computer.app'
rm -rf "$bundle"
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
install -m 644 Info.plist "$bundle/Contents/Info.plist"
install -m 755 "$binary_dir/PrivaComputerTray" "$bundle/Contents/MacOS/PrivaComputerTray"
# The same launcher a local session uses. It starts the worker of the ChatGPT desktop app's runtime on this Mac.
install -m 644 "$launcher" "$bundle/Contents/Resources/cua-repl.mjs"
codesign --force --sign - "$bundle"
codesign --verify --strict "$bundle"
printf '%s\n' "$PWD/$bundle"
