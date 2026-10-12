#!/usr/bin/env bash
set -euo pipefail

# Run only before supervisord starts the desktop. This deployment has one PVC
# owner (Recreate), while Chromium's hostname-PID lock survives Pod replacement.
config_home="${CHROME_CONFIG_HOME:-${XDG_CONFIG_HOME:-"$HOME/.config"}}"
profile="${CHROME_USER_DATA_DIR:-"$config_home/chromium"}"
lock="$profile/SingletonLock"
socket="$profile/SingletonSocket"
cookie="$profile/SingletonCookie"
[[ "$profile" == /* && -L "$lock" && -L "$socket" ]] || exit 0
[[ ! -e "$cookie" || -L "$cookie" ]] || exit 0

owner=$(readlink "$lock")
[[ "$owner" =~ ^([a-zA-Z0-9][a-zA-Z0-9.-]*)-([1-9][0-9]*)$ ]] || exit 0
[[ "${BASH_REMATCH[1]}" != "$(hostname)" ]] || exit 0
socket_target=$(readlink "$socket")
# Chromium keeps the actual socket in temporary storage. An existing endpoint,
# or an unexpected target, is not evidence that this lock can be removed.
[[ "$socket_target" == /tmp/*/SingletonSocket ]] || exit 0
[[ ! -e "$socket_target" && ! -L "$socket_target" ]] || exit 0
if pgrep -x chromium >/dev/null; then
  exit 0
else
  result=$?
  [[ "$result" == 1 ]] || exit "$result"
fi

# Unlink only the three singleton symlinks, never their targets or profile data.
rm -f -- "$lock" "$socket" "$cookie"
printf 'Removed stale Chromium singleton links from an earlier Pod.\n' >&2
