#!/usr/bin/env bash
set -euo pipefail

version=0.34.1
case "${1:?Docker TARGETARCH is required}" in
  arm64)
    release_arch=arm64
    sha256=1c839d35401bbdea20f3e1cf50ace926ef17be6f32cea7e821b02b263c4933dc
    ;;
  amd64)
    release_arch=x86_64
    sha256=a41fe2bdcbeea4501dc594c074f16b0975728e0cc7b08b90acea8564d48fafee
    ;;
  *)
    printf 'Cua Driver %s supports only arm64 and amd64 in this image.\n' "$version" >&2
    exit 1
    ;;
esac

download_dir=$(mktemp -d)
trap 'rm -rf "$download_dir"' EXIT
archive="$download_dir/cua-driver.tar.gz"
install_dir="/opt/cua-driver/$version"
curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 \
  "https://github.com/trycua/cua/releases/download/cua-driver-rs-v$version/cua-driver-rs-$version-linux-$release_arch-binary.tar.gz" \
  --output "$archive"
printf '%s  %s\n' "$sha256" "$archive" | sha256sum --check -
install -d "$install_dir"
tar --extract --gzip --file "$archive" --directory "$install_dir" --no-same-owner
ln -s "$install_dir/cua-driver" /usr/local/bin/cua-driver

# Loading the executable also checks that the image supplies its shared libraries.
test "$(/usr/local/bin/cua-driver --version)" = "cua-driver $version"
