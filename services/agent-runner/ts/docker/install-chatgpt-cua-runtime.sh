#!/usr/bin/env bash
# Install the Linux cua_node runtime and make it the computer-use plugin's
# runtime for this platform. The runtime is stored once; the plugin directories
# of the source tree (tsx watch) and of the build link to it.
set -euo pipefail

version=26.1111.71704
arch=${1:?Docker TARGETARCH is required}
# A mirror may serve the package; its SHA-256 below is checked either way.
repository=${2:-https://persistent.oaistatic.com/codex-app-prod/linux/deb}
# SHA256 from the Codex Linux Repository's signed stable/main Packages indexes.
case "$arch" in
  arm64)
    node_arch=arm64
    sha256=f0550dee1f99127d357ad760aef739c557d49bd67728d2f105d00a7a4780f740
    ;;
  amd64)
    node_arch=x64
    sha256=01eef7c77c835f7e1afb92ba1c29178a4c19d6c66573bdd3b86520e2abf806a4
    ;;
  *)
    printf 'The ChatGPT Computer Use runtime is available for arm64 and amd64, got %s.\n' "$arch" >&2
    exit 1
    ;;
esac

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
package="$stage/chatgpt.deb"
curl --fail --location --retry 3 --connect-timeout 15 --max-time 900 \
  "$repository/pool/main/c/chatgpt/chatgpt_${version}_${arch}.deb" --output "$package"
printf '%s  %s\n' "$sha256" "$package" | sha256sum --check -

upstream=./usr/lib/chatgpt
resources="$upstream/resources"
dpkg-deb --fsys-tarfile "$package" | tar --extract --file=- --directory="$stage" --no-same-owner \
  "$resources/cua_node" "$resources/THIRD_PARTY_NOTICES.txt" "$upstream/LICENSES.chromium.html" ./usr/share/doc/chatgpt

runtime="$stage/$resources/cua_node"
target="linux-$node_arch"
jq --exit-status --arg target "$target" '.target == $target' "$runtime/manifest.json" >/dev/null
test "$("$runtime/bin/node" -p 'process.arch')" = "$node_arch"
test -x "$runtime/bin/node_repl"
test -r "$runtime/lib/node_modules/@oai/cua-repl/package.json"
test -x "$runtime/lib/node_modules/@oai/sky/bin/linux/sky_linux_$node_arch"
test -s "$runtime/LICENSE"

mv --no-target-directory "$runtime" /opt/cua_node
for tree in src dist; do
  directory="/opt/agent-runner/$tree/resources/plugins/computer-use/mcp/runtime"
  install -d -o node -g node "$directory"
  ln -s /opt/cua_node "$directory/$target"
done

docs=/usr/share/doc/chatgpt-cua-runtime
mv --no-target-directory "$stage/usr/share/doc/chatgpt" "$docs"
install -m 644 "$stage/$resources/THIRD_PARTY_NOTICES.txt" "$stage/$upstream/LICENSES.chromium.html" "$docs/"
