#!/usr/bin/env bash
# Copy a cua_node runtime into the computer-use plugin. The runtime names its
# own platform, so one plugin directory can hold every platform side by side.
set -euo pipefail

source=${1:-/Applications/ChatGPT.app/Contents/Resources/cua_node}
manifest="$source/manifest.json"
if [[ ! -r "$manifest" ]]; then
  printf 'No cua_node runtime found at %s. Pass the path of a cua_node directory.\n' "$source" >&2
  exit 1
fi

target=$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).target' "$manifest")
if [[ ! "$target" =~ ^[a-z0-9]+-[a-z0-9]+$ ]]; then
  printf 'Unexpected runtime target in %s: %s\n' "$manifest" "$target" >&2
  exit 1
fi
for file in bin/node bin/node_repl lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs; do
  if [[ ! -r "$source/$file" ]]; then
    printf 'The runtime at %s is missing %s.\n' "$source" "$file" >&2
    exit 1
  fi
done

root=$(cd "$(dirname "$0")/../.." && pwd)
destination="$root/src/resources/plugins/computer-use/mcp/runtime/$target"
rm -rf "$destination"
mkdir -p "$(dirname "$destination")"
# -R keeps the package symlinks, -p keeps the executable bits.
cp -Rp "$source" "$destination"
printf 'Copied the %s runtime to %s\n' "$target" "$destination"
