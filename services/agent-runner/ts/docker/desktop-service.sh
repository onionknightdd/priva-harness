#!/usr/bin/env bash
set -euo pipefail

wait_for_display() {
  for _ in {1..150}; do
    if xdpyinfo >/dev/null 2>&1; then return; fi
    sleep 0.2
  done
  echo 'X11 display was unavailable for 30 seconds.' >&2
  exit 1
}

case "${1:?desktop service required}" in
  dbus)
    exec dbus-daemon --session --nofork --nopidfile --address="$DBUS_SESSION_BUS_ADDRESS"
    ;;
  display)
    exec Xvfb "$DISPLAY" -screen 0 1920x1080x24 -nolisten tcp -auth "$XAUTHORITY" -noreset
    ;;
  session)
    wait_for_display
    for _ in {1..150}; do
      if dbus-send --session --type=method_call --print-reply --dest=org.freedesktop.DBus / org.freedesktop.DBus.ListNames >/dev/null 2>&1; then
        xset s off
        exec xfce4-session
      fi
      sleep 0.2
    done
    echo 'Desktop session bus was unavailable for 30 seconds.' >&2
    exit 1
    ;;
  vnc)
    wait_for_display
    # VNC is reachable only by the Runner in this container. No host/Service port.
    exec x11vnc -display "$DISPLAY" -auth "$XAUTHORITY" -forever -shared -nopw \
      -listen 127.0.0.1 -rfbport 5900 -no6 -xkb -noxdamage
    ;;
  browser)
    wait_for_display
    exec desktop-browser about:blank
    ;;
  *)
    echo "Unknown desktop service: $1" >&2
    exit 2
    ;;
esac
