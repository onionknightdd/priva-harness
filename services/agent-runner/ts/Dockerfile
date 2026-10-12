FROM node:24-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66

ARG DEBIAN_MIRROR=https://deb.debian.org

# Development image: agents need a real shell and the same native Claude
# executable as the SDK. Never copy the host's node_modules into Linux.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends ca-certificates \
    && sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
      curl git openssh-client tini \
      bash build-essential python3 python3-venv ripgrep rsync \
      bison pkg-config libevent-dev libncurses-dev \
      jq procps sqlite3 unzip less file \
      supervisor dbus-x11 at-spi2-core xvfb xauth x11-utils x11-xserver-utils x11vnc \
      libx11-6 libxi6 libxkbcommon0 \
      xfce4-session xfce4-panel xfce4-settings xfwm4 xfdesktop4 thunar \
      mousepad xterm chromium xdotool maim \
      fonts-noto-cjk fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/agent-runner /data \
    && chown node:node /opt/agent-runner /data

ARG TARGETARCH
COPY --chmod=755 docker/install-cua-driver.sh /usr/local/bin/install-cua-driver
RUN /usr/local/bin/install-cua-driver "$TARGETARCH"

# Debian's tmux 3.5a lacks bracket_paste_flag and cannot initialize the
# Runner's manual window sizing. Pin the version used by the terminal tests.
RUN curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 \
      https://github.com/tmux/tmux/releases/download/3.7c/tmux-3.7c.tar.gz \
      --output /tmp/tmux.tar.gz \
    && echo '7c60cae9a0e25288e2e24750aafc9e8800fc7fd4555e447e1b29ee4201cfb3bf  /tmp/tmux.tar.gz' | sha256sum --check - \
    && tar -xzf /tmp/tmux.tar.gz -C /tmp \
    && cd /tmp/tmux-3.7c && ./configure && make -j2 && make install \
    && cd / && rm -rf /tmp/tmux-3.7c /tmp/tmux.tar.gz \
    && test "$(tmux -V)" = 'tmux 3.7c'

WORKDIR /opt/agent-runner
COPY --chown=node:node package.json package-lock.json ./
ARG NPM_REGISTRY=https://registry.npmjs.org
USER node
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000,sharing=locked \
    npm ci --registry="$NPM_REGISTRY" --no-audit --no-fund
COPY --chown=node:node tsconfig.json tsconfig.build.json eslint.config.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node tests ./tests
RUN npm run build

USER root
RUN node --input-type=module -e 'import { symlinkSync } from "node:fs"; import { resolveBundledClaudeExecutable } from "./dist/provider/claude/claude-executable.js"; const executable = resolveBundledClaudeExecutable(); if (!executable) throw new Error("Linux Claude executable is missing"); symlinkSync(executable, "/usr/local/bin/claude");' \
    && ln -s /opt/agent-runner/node_modules/.bin/pi /usr/local/bin/pi
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/runner-entrypoint
COPY --chmod=755 docker/desktop-service.sh /usr/local/bin/desktop-service
COPY --chmod=755 docker/desktop-browser.sh /usr/local/bin/desktop-browser
COPY --chmod=755 docker/clear-stale-browser-locks.sh /usr/local/bin/clear-stale-browser-locks
COPY docker/supervisord.conf /etc/agent-runner/supervisord.conf
COPY docker/priva-browser.desktop /usr/local/share/applications/priva-browser.desktop
COPY docker/chromium-flags /etc/chromium.d/priva-desktop
COPY docker/configure-computer.mjs /opt/agent-runner/docker/configure-computer.mjs
COPY docker/skills/computer-desktop /opt/agent-runner/docker/skills/computer-desktop

ENV HOME=/data/home \
    RUNTIME_HOME_DIR=/data/runtime \
    WORKSPACE_DIR=/data/workspace \
    CLAUDE_CONFIG_DIR=/data/home/.claude \
    PI_CODING_AGENT_DIR=/data/home/.pi/agent \
    HOST=0.0.0.0 \
    PORT=8001 \
    LANG=C.UTF-8 \
    TMPDIR=/tmp \
    DISPLAY=:99 \
    XAUTHORITY=/tmp/priva-desktop/Xauthority \
    XDG_RUNTIME_DIR=/tmp/priva-desktop \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/priva-desktop/bus \
    XDG_CURRENT_DESKTOP=XFCE \
    XDG_SESSION_TYPE=x11 \
    COMPUTER_VNC_HOST=127.0.0.1 \
    COMPUTER_VNC_PORT=5900 \
    DISABLE_AUTOUPDATER=1
USER node
EXPOSE 8001 9229
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/runner-entrypoint"]
CMD ["node", "node_modules/tsx/dist/cli.mjs", "watch", "--clear-screen=false", "--inspect=127.0.0.1:9229", "src/main.ts"]
