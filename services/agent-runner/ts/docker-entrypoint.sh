#!/usr/bin/env bash
set -euo pipefail
umask 077
mkdir -p "$HOME" "$RUNTIME_HOME_DIR" "$WORKSPACE_DIR" "$CLAUDE_CONFIG_DIR" "$PI_CODING_AGENT_DIR"
mkdir -p "$XDG_RUNTIME_DIR" "$HOME/Desktop" "$HOME/.local/share/applications"
chmod 700 "$XDG_RUNTIME_DIR"
touch "$XAUTHORITY"
xauth -f "$XAUTHORITY" add "$DISPLAY" MIT-MAGIC-COOKIE-1 "$(node -p "require('node:crypto').randomBytes(16).toString('hex')")"

# Seed launchers only once; the HOME volume keeps the person's desktop choices.
if [[ ! -e "$HOME/Desktop/Browser.desktop" ]]; then
  cp /usr/local/share/applications/priva-browser.desktop "$HOME/Desktop/Browser.desktop"
  chmod 700 "$HOME/Desktop/Browser.desktop"
fi

desktop_pid=
runner_pid=
computer_pid=
cleanup() {
  trap - EXIT
  [[ -z "$computer_pid" ]] || kill -TERM "$computer_pid" 2>/dev/null || true
  [[ -z "$runner_pid" ]] || kill -TERM "$runner_pid" 2>/dev/null || true
  [[ -z "$desktop_pid" ]] || kill -TERM "$desktop_pid" 2>/dev/null || true
  [[ -z "$runner_pid" ]] || wait "$runner_pid" 2>/dev/null || true
  [[ -z "$desktop_pid" ]] || wait "$desktop_pid" 2>/dev/null || true
  [[ -z "$computer_pid" ]] || wait "$computer_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

/usr/local/bin/clear-stale-browser-locks
supervisord -n -c /etc/agent-runner/supervisord.conf &
desktop_pid=$!
ready=false
for _ in {1..150}; do
  if xdpyinfo >/dev/null 2>&1 && pgrep -x xfwm4 >/dev/null && pgrep -x xfdesktop >/dev/null \
    && (exec 3<>/dev/tcp/127.0.0.1/5900) 2>/dev/null; then
    ready=true
    break
  fi
  kill -0 "$desktop_pid" 2>/dev/null || { echo 'Desktop supervisor exited during startup.' >&2; exit 1; }
  sleep 0.2
done
[[ "$ready" = true ]] || { echo 'Desktop did not become ready within 30 seconds.' >&2; exit 1; }

# Seed native MCP settings before either provider can start a session.
node /opt/agent-runner/docker/configure-computer.mjs

if [[ -n "${PRIVA_COMPUTER_HOST_KEY:-}" || -n "${PRIVA_COMPUTER_DEVICES:-}" ]]; then
  node /opt/agent-runner/dist/infrastructure/computer/cli.js serve \
    --host-key "${PRIVA_COMPUTER_HOST_KEY:?Set PRIVA_COMPUTER_HOST_KEY to the broker key file}" \
    --devices "${PRIVA_COMPUTER_DEVICES:?Set PRIVA_COMPUTER_DEVICES to the enrolled device registry}" \
    --bind-address "${PRIVA_COMPUTER_BIND_ADDRESS:-127.0.0.1}" \
    --port "${PRIVA_COMPUTER_PORT:-2222}" &
  computer_pid=$!
fi

# tsx watch can restart the Runner without closing windows or the session bus.
"$@" &
runner_pid=$!
result=0
children=("$desktop_pid" "$runner_pid")
[[ -z "$computer_pid" ]] || children+=("$computer_pid")
wait -n -p finished_pid "${children[@]}" || result=$?
if [[ "$finished_pid" != "$runner_pid" && "$result" = 0 ]]; then
  echo 'A configured desktop service exited while the Runner was active.' >&2
  result=1
fi
exit "$result"
