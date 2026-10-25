#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 2 ]]; then
  echo 'Usage: bash sandbox.sh /absolute/path/sb-1234 http://127.0.0.1:MODEL_PORT' >&2
  exit 2
fi

poc_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
workspace=$(realpath -e -- "$1")
tenant=$(basename -- "$workspace")
[[ -d "$workspace" && "$tenant" =~ ^sb-[0-9]+$ ]] || {
  echo 'Workspace must be an existing directory named sb-NUMBER' >&2
  exit 2
}

# Start from bwrap's empty root. Never bind /, /home, /tmp or the tenant parent
# from the host. Only the selected tenant directory is a writable host mount.
args=(
  --unshare-user --unshare-pid --unshare-ipc --unshare-uts --disable-userns
  --die-with-parent --new-session --cap-drop ALL --clearenv
  --ro-bind /usr /usr
  --symlink usr/bin /bin --symlink usr/sbin /sbin --symlink usr/lib /lib
  --proc /proc --dev /dev
  --tmpfs /tmp --tmpfs /home --dir /home/worker
  --dir /etc
  --ro-bind /etc/passwd /etc/passwd
  --ro-bind /etc/group /etc/group
  --ro-bind /etc/nsswitch.conf /etc/nsswitch.conf
  --ro-bind /etc/resolv.conf /etc/resolv.conf
  --ro-bind /etc/hosts /etc/hosts
  --ro-bind /etc/ssl/certs /etc/ssl/certs
  --dir /app
  --ro-bind "$poc_dir/worker.mjs" /app/worker.mjs
  --ro-bind "$poc_dir/node_modules" /app/node_modules
  --dir /mnt --dir /mnt/user
  --bind "$workspace" "/mnt/user/$tenant"
  --chdir "/mnt/user/$tenant"
  --setenv HOME /home/worker
  --setenv CLAUDE_CONFIG_DIR /home/worker/.claude
  --setenv TMPDIR /tmp
  --setenv PATH /usr/local/bin:/usr/bin:/bin
  --setenv LANG C.UTF-8
  --setenv ANTHROPIC_BASE_URL "$2"
  --setenv ANTHROPIC_API_KEY fixture-only-not-a-real-key
  --setenv CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC 1
  --setenv DISABLE_AUTOUPDATER 1
)
if [[ -e /usr/lib64 ]]; then args+=(--symlink usr/lib64 /lib64); fi

# Network is shared ONLY to reach the loopback model fixture. This PoC tests
# filesystem isolation, not network isolation. The whole SDK starts in bwrap.
exec bwrap "${args[@]}" --remount-ro / -- /usr/local/bin/node /app/worker.mjs
