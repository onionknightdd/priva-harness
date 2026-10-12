#!/usr/bin/env bash
set -euo pipefail

# Run as the desktop user; assets and xfconf settings persist in the HOME volume.
[[ "$HOME" = /data/home && "${DISPLAY:-}" = :99 ]] || { echo 'Run through dev.sh theme-colloid in the Xfce container.' >&2; exit 1; }
command -v sassc >/dev/null || { echo 'Rebuild and deploy the Debian image to install the Colloid dependencies first.' >&2; exit 1; }
[[ "$(dpkg-query -W -f='${Status}' librsvg2-common 2>/dev/null)" = 'install ok installed' ]] || {
  echo 'Rebuild and deploy the Debian image to enable SVG icons and window buttons.' >&2
  exit 1
}

gtk_revision=fe11342f37f124f1b29d44cf33e9a06053f4bba2
gtk_sha=385d29fcf256b69891b3e43e81695c938b4ec3a46628fc4efbfbed06bd4c1520
icon_revision=ceac6608ecd0e40025cbc2ebbd32bf0e0f4ebc6a
icon_sha=3f731f9f13b1c1403893561ff92adec7b3ab07c5495f55c78c111b07a10a296e
themes="$HOME/.themes"
icons="$HOME/.local/share/icons"
mkdir -p "$themes" "$icons" "$HOME/.cache"

check_existing() {
  local destination=$1 sha=$2
  if [[ -e "$destination" || -L "$destination" ]]; then
    [[ ! -L "$destination" && -f "$destination/.priva-source-sha256" && "$(cat "$destination/.priva-source-sha256")" = "$sha" ]] || {
      echo "Existing theme is not managed by this installer; move it aside first: $destination" >&2
      exit 1
    }
  fi
}
check_existing "$themes/Colloid-Dark" "$gtk_sha"
for name in Colloid Colloid-Light Colloid-Dark; do check_existing "$icons/$name" "$icon_sha"; done

staging=$(mktemp -d "$HOME/.cache/colloid-install.XXXXXX")
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/home" "$staging/themes" "$staging/icons"

fetch_source() {
  local repository=$1 revision=$2 sha=$3 destination=$4
  mkdir -p "$destination"
  curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 \
    "https://codeload.github.com/vinceliuice/$repository/tar.gz/$revision" \
    --output "$destination/source.tar.gz"
  printf '%s  %s\n' "$sha" "$destination/source.tar.gz" | sha256sum --check -
  tar --extract --gzip --file "$destination/source.tar.gz" --directory "$destination" --strip-components=1 --no-same-owner
}

if [[ ! -d "$themes/Colloid-Dark" ]]; then
  fetch_source Colloid-gtk-theme "$gtk_revision" "$gtk_sha" "$staging/gtk-source"
  # Upstream cleans other theme locations in HOME. Use a temporary HOME so it
  # cannot remove or change the desktop user's existing themes or panel config.
  env HOME="$staging/home" XDG_DATA_HOME="$staging/home/.local/share" \
    bash "$staging/gtk-source/install.sh" --dest "$staging/themes" --color dark --size standard
  test -s "$staging/themes/Colloid-Dark/gtk-3.0/gtk.css"
  test -s "$staging/themes/Colloid-Dark/xfwm4/themerc"
  cp "$staging/gtk-source/LICENSE" "$staging/themes/Colloid-Dark/LICENSE"
  printf '%s\n' "$gtk_sha" > "$staging/themes/Colloid-Dark/.priva-source-sha256"
  mv "$staging/themes/Colloid-Dark" "$themes/Colloid-Dark"
fi

if [[ ! -d "$icons/Colloid" || ! -d "$icons/Colloid-Light" || ! -d "$icons/Colloid-Dark" ]]; then
  fetch_source Colloid-icon-theme "$icon_revision" "$icon_sha" "$staging/icon-source"
  env HOME="$staging/home" bash "$staging/icon-source/install.sh" --dest "$staging/icons"
  # The dark icon variant links to the light variant's shared application icons.
  for name in Colloid Colloid-Light Colloid-Dark; do
    test -s "$staging/icons/$name/index.theme"
    cp "$staging/icon-source/LICENSE" "$staging/icons/$name/LICENSE"
    printf '%s\n' "$icon_sha" > "$staging/icons/$name/.priva-source-sha256"
    if [[ ! -d "$icons/$name" ]]; then mv "$staging/icons/$name" "$icons/$name"; fi
  done
fi

test -s "$themes/Colloid-Dark/gtk-3.0/gtk.css"
test -s "$themes/Colloid-Dark/xfwm4/themerc"
test -s "$icons/Colloid-Dark/places/scalable/folder.svg"
test -d "$icons/Colloid-Dark/apps/scalable"
xfconf-query -c xsettings -p /Net/ThemeName -s Colloid-Dark
xfconf-query -c xfwm4 -p /general/theme -s Colloid-Dark
xfconf-query -c xsettings -p /Net/IconThemeName -s Colloid-Dark
printf 'GTK: %s\n' "$(xfconf-query -c xsettings -p /Net/ThemeName)"
printf 'Window manager: %s\n' "$(xfconf-query -c xfwm4 -p /general/theme)"
printf 'Icons: %s\n' "$(xfconf-query -c xsettings -p /Net/IconThemeName)"
