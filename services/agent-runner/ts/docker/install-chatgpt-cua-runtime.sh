#!/usr/bin/env bash
set -euo pipefail

version=26.1111.71704
arch=${1:?Docker TARGETARCH is required}
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
repository=https://persistent.oaistatic.com/codex-app-prod/linux/deb
curl --fail --location --retry 3 --connect-timeout 15 --max-time 900 \
  "$repository/pool/main/c/chatgpt/chatgpt_${version}_${arch}.deb" --output "$package"
printf '%s  %s\n' "$sha256" "$package" | sha256sum --check -

upstream=./usr/lib/chatgpt
resources="$upstream/resources"
plugins="$resources/plugins/openai-bundled/plugins"
dpkg-deb --fsys-tarfile "$package" | tar --extract --file=- --directory="$stage" --no-same-owner \
  "$resources/cua_node" "$plugins/browser" "$plugins/chrome" \
  "$resources/THIRD_PARTY_NOTICES.txt" "$upstream/LICENSES.chromium.html" ./usr/share/doc/chatgpt

runtime="$stage/$resources/cua_node"
jq --exit-status --arg arch "$node_arch" '.platform == "linux" and .arch == $arch' "$runtime/manifest.json" >/dev/null
test "$("$runtime/bin/node" -p 'process.arch')" = "$node_arch"
test -x "$runtime/bin/node_repl"
test -r "$runtime/lib/node_modules/@oai/cua-repl/bin/cua-repl.mjs"
test -x "$runtime/lib/node_modules/@oai/sky/bin/linux/sky_linux_$node_arch"
test -s "$runtime/LICENSE"

skills=/opt/chatgpt-cua-skills
stager=/opt/agent-runner/scripts/computer-use/stage-skills.ts
node --import tsx "$stager" stage-linux "$stage/$plugins" "$skills" "$runtime"
chown -R node:node "$skills"
runuser -u node -- node --import tsx "$stager" verify "$skills" browser chrome computer-use

mv --no-target-directory "$runtime" /opt/cua_node
docs=/usr/share/doc/chatgpt-cua-runtime
mv --no-target-directory "$stage/usr/share/doc/chatgpt" "$docs"
install -m 644 "$stage/$resources/THIRD_PARTY_NOTICES.txt" "$stage/$upstream/LICENSES.chromium.html" "$docs/"
