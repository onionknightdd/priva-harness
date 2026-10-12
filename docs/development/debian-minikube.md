# Debian 13 Agent Runner 开发环境

这里运行的是本仓库 `services/agent-runner/ts/` 的 TypeScript Runner。专用镜像
`priva-harness/agent-runner:debian13-dev`、命名空间 `priva-harness-dev` 和 PVC
`runner-data` 与其他 priva 项目独立。脚本不会启动、删除或重建 minikube，也不会清理
其他镜像或工作负载。单独启动一个 Agent UI 实例，在 Workspace「电脑」中查看并操作
同一容器内的完整 Linux 桌面。

```text
macOS                                            minikube / Debian 13 Pod
Agent UI http://127.0.0.1:15173
  /api + WebSocket -> 127.0.0.1:18001 --forward--> Runner :8001
  Workspace 电脑 -- VNC over WebSocket ------------+ |
                                                    | +--> x11vnc 127.0.0.1:5900
                                                    |        |
                                                    |      Xvfb :99 + Xfce
                                                    |        +-- Chromium / Thunar / Mousepad
                                                    |        `-- session D-Bus
Node debugger     -> 127.0.0.1:19229 --forward--> inspector 127.0.0.1:9229
                                                     |
                                                     +-- Claude / Pi / tmux
                                                     +-- /data/workspace
                                                     +-- /data/runtime       --+
                                                     `-- /data/home          --+--> PVC
                                                           |
                                                     model API requests
                                                           +--> remote API
                                                           `--> host.minikube.internal:8000
                                                                Mac model server
```

Agent 的 shell、读写文件和子进程都在 Debian 容器里。仅代码编辑、Vite 和端口转发在
Mac 上；访问 Mac 的模型服务只是推理 API 请求。没有挂载 Mac 的工作区、HOME、Docker
socket 或 Kubernetes 凭证。桌面属于 Debian 13 容器，不会操作 Mac 桌面，也不验证真实
Debian 宿主机的桌面会话。镜像安装固定版本 Cua Driver，并通过 Claude/Pi 原生 MCP
配置提供电脑工具；Agent UI 可实时查看与手动输入。容器共享 Linux VM 的内核，
不等同于 Debian 宿主机/完整 systemd。

## 初次启动

前提：Docker 可用，已有运行中的 minikube，以及对应 kubectl context。默认使用
`minikube`，可以通过 `MINIKUBE_PROFILE` 指定已有 profile；不会修改当前 kube context。
UI 使用本机 `agent-ui/node_modules`，尚未安装时先在 `agent-ui/` 执行 `npm ci`。

在仓库根目录执行：

```sh
bash deploy/agent-runner/dev.sh build
bash deploy/agent-runner/dev.sh deploy
bash deploy/agent-runner/dev.sh status
bash deploy/agent-runner/dev.sh verify
```

若官方仓库在当前网络下载较慢，可选择 Debian 的镜像站，例如本机已验证的清华镜像：

```sh
DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn \
NPM_REGISTRY=https://registry.npmmirror.com \
bash deploy/agent-runner/dev.sh build
```

默认仍为 `https://deb.debian.org`；APT 保留 Debian 官方签名验证，BuildKit 缓存已下载的包。
镜像站见 [Debian 官方列表](https://www.debian.org/mirror/list)。基础镜像首次安装 CA 证书
使用其原始签名 APT 源，随后系统包使用所选 HTTPS 源。
`NPM_REGISTRY` 默认是 `https://registry.npmjs.org`，可按网络情况单独选择；仍使用
原始 `package-lock.json` 的版本与 integrity 校验，不改写锁文件，也不复制宿主机 npm 配置。

macOS 推荐安装后台服务，只需运行一次；它会立即启动，之后随用户登录自动启动：

```sh
bash deploy/agent-runner/dev.sh background install
bash deploy/agent-runner/dev.sh background status
# 停止并移除自启动，保留日志：
bash deploy/agent-runner/dev.sh background uninstall
```

安装前先停止手工运行的 Xfce `forward` / `ui`，否则安装器会明确报告端口占用，
不会终止未知进程。再次 install 可更新本项目服务配置。脚本在
`~/Library/LaunchAgents/` 安装 `com.priva-harness.xfce.forward.plist` 和
`com.priva-harness.xfce.ui.plist`，使用 `KeepAlive` 及 10 秒启动节流；进程退出后由
launchd 拉起，转发脚本继续处理 Pod 替换时的重连。
日志位于 `~/Library/Logs/priva-harness/xfce-{forward,ui}.log`。
只记录 Node/npm/kubectl 的路径及 minikube profile，不把交互 shell 的密钥环境复制进 plist。
移动仓库或删除当前 Node 安装版本后，需要重新 install。退出 macOS 登录会停止这些用户
服务；Mac 睡眠或 Docker/minikube 停止期间服务仍不可达，恢复条件后会重新连接。

```text
用户登录 -> launchd -> ui :15173 -> forward :18001 -> Runner Pod
               |                    |
               +-- 进程退出后重启 --+
电脑 tab 断线 -> 释放输入 -> 3 秒后重试 -> 同一个桌面
```

如果需要在终端前台调试，也可在两个终端分别运行（不要与后台服务同时占用端口）：

```sh
bash deploy/agent-runner/dev.sh forward
```

```sh
bash deploy/agent-runner/dev.sh ui
```

打开 <http://127.0.0.1:15173>。这个 origin 使用独立的浏览器本地状态，不会复用
`:5173` 的 Mac 项目目录或会话选择。默认目录应显示 `/data/workspace`。如果主动选择
旧项目路径，`/Users/...` 在容器里不存在，应改用 Linux 路径或在容器内 clone 项目。
所有 API 和 WebSocket 经 Vite 的现有 `AGENT_RUNNER_URL` 代理到 `:18001`；不会连接
Mac 上仍在运行的 `:8001` Runner。

Runner 没有独立 `/health` 路由，Kubernetes 使用现有的
`GET /api/sandbox/agent/profile` 做启动/就绪检查。副本数固定为 1，更新策略为
`Recreate`，避免两个 Runner 同时管理 SQLite、会话与 tmux。端口转发仅监听本机
`127.0.0.1`，没有 Ingress/NodePort。调试器只在 Pod 回环接口监听，不经 Service 暴露。

## 镜像与运行环境

- 基础镜像为按 digest 固定的官方 `node:24-trixie-slim`（Debian 13）。构建平台取自
  minikube 节点的实际架构；Dockerfile 更新 digest 后应重新验证。
- 在 Linux 内执行 `npm ci`，保留开发依赖，编译 `dist/`；不复制 Mac 的
  `node_modules`、私人配置、`.env` 或仓库中的其他目录。
- Claude 命令指向锁文件中的 Agent SDK 所带原生二进制，与程序化 SDK/TUI 完全同版；
  Pi 命令来自同一份已安装的 `@earendil-works/pi-coding-agent`。
- tmux 固定为 [上游 3.7c](https://github.com/tmux/tmux/releases/tag/3.7c)，源码包经 SHA-256
  校验后编译安装。Debian 自带的 3.5a 不满足当前终端协议：缺少 `bracket_paste_flag`，
  且首个窗口创建前设置 manual 尺寸策略会导致退出。
- 提供 tmux、git、SSH 客户端、Bash、Python/venv、C/C++ 编译工具、ripgrep、rsync、
  curl、jq、procps、sqlite3、unzip 等开发工具；系统包在构建时安装。
- 桌面使用 Xvfb `:99`、Xfce、Chromium、Thunar 文件管理器、Mousepad 文本编辑器、
  xterm 和中文/Emoji 字体。`xdotool`、`maim` 供后续工具集成与屏幕诊断。
  桌面固定为 1920 × 1080，浏览器端按容器宽度缩放；当前不承诺动态 RandR 分辨率调整。
- `supervisord` 管理 X11、会话 D-Bus、Xfce 和 x11vnc；启动入口等待桌面/VNC 就绪后
  执行 Runner，退出时终止并回收这些子进程。`tsx watch` 只重启 Runner，不重启桌面。
  Chromium 随容器启动，正常关闭后不强行重启，可从桌面「浏览器」图标重新打开。
- X11 使用随机 Xauthority cookie，禁止 TCP 监听。VNC 只监听容器回环
  `127.0.0.1:5900`，没有额外 Service、端口映射或 websockify 进程；Runner 将浏览器
  WebSocket 转发给本机 VNC。允许的开发 UI origins 精确配置为
  `http://127.0.0.1:15173,http://localhost:15173`。
- 会话环境为 `DISPLAY=:99`、`XAUTHORITY=/tmp/priva-desktop/Xauthority`、
  `DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/priva-desktop/bus`；后续桌面工具可直接继承。
  Chromium 在这个禁止提权的专用容器内以 `--no-sandbox` 运行，容器作为隔离边界。
  浏览器配置和登录状态位于 PVC 的 HOME，关闭/重建 Pod 后文件保留。
- 以 UID/GID 1000 非 root 运行，丢弃 capabilities，不挂载 service-account token；
  `tini` 管理进程回收。用户代码与 Agent 共享该容器的权限。
- 2 CPU / 4 GiB 内存上限，250m CPU / 768 MiB 请求；`/dev/shm` 使用最大 512 MiB
  的内存卷，计入 Pod 内存使用。大型编译或多 Agent 并发若出现
  OOM，应根据 minikube 剩余容量调整此 Deployment 的资源额度。

## 代码变更与调试

### Colloid 主题、图标与分辨率

在运行中的 Xfce 主环境应用 [Colloid 官方主题](https://github.com/vinceliuice/Colloid-gtk-theme)
和 [Colloid 图标](https://github.com/vinceliuice/Colloid-icon-theme)：

```sh
bash deploy/agent-runner/dev.sh theme-colloid
```

镜像提供 `sassc`、`gtk2-engines-murrine`、`gnome-themes-extra` 和 `librsvg2-common`；
最后一个提供 SVG 加载器，避免图标回退及窗口按钮缺失。旧镜像先执行 build / deploy。
安装脚本固定官方源码版本并校验归档 SHA-256：

| 内容 | Commit | 归档 SHA-256 |
| --- | --- | --- |
| GTK / Xfwm4 | `fe11342f37f124f1b29d44cf33e9a06053f4bba2` | `385d29fcf256b69891b3e43e81695c938b4ec3a46628fc4efbfbed06bd4c1520` |
| 图标 | `ceac6608ecd0e40025cbc2ebbd32bf0e0f4ebc6a` | `3f731f9f13b1c1403893561ff92adec7b3ab07c5495f55c78c111b07a10a296e` |

```text
theme-colloid -> 官方归档 + SHA-256 -> 临时 HOME 编译
                                      |
                                      v
                              PVC 主题 / 图标目录
                                      |
                                      v
                         xfconf 选择 Colloid-Dark
```

GTK / Xfwm4 使用默认蓝色、标准尺寸的 `Colloid-Dark`，安装到
`/data/home/.themes/Colloid-Dark`。图标安装到 `/data/home/.local/share/icons/`，
选择 `Colloid-Dark`；同时保留上游提供的 `Colloid` / `Colloid-Light`，因为深色图标
通过相对链接复用浅色款的应用图标。安装结果包含上游许可证，壁纸不变。
临时 HOME 隔离上游安装脚本的旧主题清理；已有非本脚本管理的同名目录会报错。
主题文件和 xfconf 设置均随 HOME 保留；空白 PVC 需要显式运行该命令。

当前 Xvfb 启动分辨率为 **1920×1080**。要修改固定分辨率，更新
`docker/desktop-service.sh` 及 `tests/deployment/desktop-smoke.ts` 中的验收尺寸后重新
build / deploy；会关闭当前桌面窗口，已保存的文件仍在 PVC。noVNC 继续按面板尺寸等比
缩放，不修改共享桌面大小；在窄面板里文字会更小，可放大 Workspace。

2026-10-12 实测：两个 LaunchAgent 的 plist 检查通过；分别向实际转发与 Vite 进程
发送 SIGTERM，自动恢复约 1.1 秒、1.3 秒，API 均返回 200。这只验证退出后的恢复，
不是重启 Mac 或睡眠唤醒的实测。主 Pod 已重建为 1920×1080，RFB 握手、截图尺寸及
桌面探针通过。Colloid 安装后再次重建 Pod，GTK / Xfwm4 / 图标设置均保留为
`Colloid-Dark`；SVG 加载器、文件管理器图标和窗口按钮已在实际桌面确认。
同一电脑标签在 Pod 替换后自动恢复连接。最终镜像上的桌面探针及 Cua MCP 探针通过，
包含前台中文输入、GUI 保存和文件内容比对；安装命令重复运行通过。

### 同步与调试器

```text
编辑本机 Runner 源码 -> dev.sh sync -> Pod /opt/agent-runner/src
                                          |
                                          `-> tsx watch 重启 Runner
依赖 / Dockerfile / 系统包变更 -> build -> deploy -> 新 Pod + 原 PVC
```

```sh
# 同步 src、tests、tsconfig 和 ESLint 配置；删除的源码也会同步删除
bash deploy/agent-runner/dev.sh sync

# 或保持此命令运行，保存本机代码后自动同步
bash deploy/agent-runner/dev.sh watch

# 日志与容器 shell
bash deploy/agent-runner/dev.sh logs
bash deploy/agent-runner/dev.sh shell
```

`sync` 是单次同步；`watch` 先同步一次，随后监听 Mac 上源码、测试和配置的修改，合并
短时间内的保存事件并串行同步。同步失败会显示错误；修复后保存文件或重启 `watch` 重试。
`tsx watch` 在容器中自动加载已同步的
运行时源码变更；无源码变更时不重复触发重启。同步不覆盖 `/data`。锁文件变更会被拒绝，
需要重新 `build`/`deploy`；`package.json` 变更也会被拒绝，Dockerfile 或入口脚本变更同样需要重建。
Pod 重建后回到镜像内的源码版本，尚未重新构建的同步内容需要再执行一次 `sync`。
不要把 `/opt/agent-runner` 当作 Agent 项目目录；Agent 项目放在 `/data/workspace`。

源码同步可能中断正在运行的 Pi 回合和 WebSocket。Claude tmux 进程在同一容器内的
Runner 重启后可被重新认领；Pod 重建会终止所有进程。PVC 保留转录，恢复会话仍需重新
启动 Agent。不是运行中任务的迁移或检查点功能。
桌面窗口在 Runner 热重载时继续存在，Pod 重建会重新启动桌面；文件、浏览器配置与
模型配置继续从同一 PVC 读取。

Node inspector 地址：<http://127.0.0.1:19229/json/list>。在 Chrome 的
`chrome://inspect` 中添加 `127.0.0.1:19229`，或在 VS Code 使用：

```json
{
  "type": "node",
  "request": "attach",
  "name": "Debian Runner",
  "address": "127.0.0.1",
  "port": 19229,
  "localRoot": "${workspaceFolder}/services/agent-runner/ts",
  "remoteRoot": "/opt/agent-runner",
  "restart": true,
  "sourceMaps": true,
  "skipFiles": ["<node_internals>/**"]
}
```

没有 liveness probe，暂停断点不会触发容器重启；就绪状态可能暂时变为 false。
`forward` 指向 Deployment 而非 Service，就绪变化不影响当前调试连接。源码重载和
Pod 重建期间，kubectl 可能因目标端口短暂关闭而退出；脚本会显示错误并在 2 秒后重新
连接。端口占用、权限等其他错误会直接退出。调试客户端需要重连；若手动停止了
`forward`，重新运行即可。

## 配置、凭证与数据

| 容器路径 | 用途 | Pod 重建后 |
| --- | --- | --- |
| `/data/workspace` | Agent 项目、生成文件 | 保留 |
| `/data/runtime/bambuddy.settings.json` | 模型连接与产品设置 | 保留 |
| `/data/runtime/.data.db` | SQLite 用量与审计 | 保留 |
| `/data/runtime/terminals` | 终端绑定、hooks、启动文件 | 文件保留，进程重启 |
| `/data/home/.claude` | Claude 原生配置与转录 | 保留 |
| `/data/home/.pi/agent` | Pi 配置与转录 | 保留 |
| `/data/home/.config/chromium` | 浏览器登录、书签与设置 | 保留 |
| `/data/home/Desktop`、`/data/home/.config/xfce4` | 桌面文件与个人设置 | 保留 |
| `/opt/agent-runner` | 镜像中的 Runner 代码与依赖 | 回到镜像版本 |
| `/tmp` | 临时文件、测试 socket | 不保证保留 |

可以直接在新 UI 的模型设置中填写连接。需要从现有产品设置迁移时，显式执行：

```sh
bash deploy/agent-runner/dev.sh import-models "$HOME/.bambuddy/bambuddy.settings.json"

# 经用户选择，同时将 localhost:8000 模型地址映射到 Mac 宿主机
bash deploy/agent-runner/dev.sh import-models "$HOME/.bambuddy/bambuddy.settings.json" --connect-host-models
```

只传输 `modelProfiles`，不复制 Claude/Pi 私人目录、MCP、skills、会话或其他设置。
凭证通过 stdin 进入 Pod，以现有设置存储器的文件锁和私有权限写入 PVC；不写入 argv、
日志、镜像、ConfigMap 或 Git。已有容器模型集合会被源集合替换，其他容器设置保持不变。
普通导入遇到回环模型地址会报错；`--connect-host-models` 只显式改写端口 8000 的回环
地址。Mac 原文件保持不变。

`deploy` 从 minikube 节点解析 `host.minikube.internal`，动态写入 Pod 的 `hostAliases`，
避免将某台 Mac 的 IP 硬编码入仓库。宿主机访问依赖 minikube driver 与 Docker Desktop
网络；其他机器上如果模型仅绑定 loopback 而无法访问，需让模型服务监听可达接口。
不要通过把整个 Mac 配置目录挂进容器解决连接问题。
相关机制见 [minikube 宿主机访问文档](https://minikube.sigs.k8s.io/docs/handbook/host-access/)。

PVC 使用集群默认 storage class。这是本机开发持久化，不是备份；删除 PVC 或 minikube
数据会丢失配置、凭证、会话和项目。导出前停止工作负载并妥善保管含凭证的归档。

## 验证与维护

不依赖模型凭证的 Linux 探针：

```sh
bash deploy/agent-runner/dev.sh verify
```

它检查 Debian 13、非 root、Linux 配置目录、Claude/Pi/tmux 可执行文件；实际调用 Pi
写文件与 Bash 工具；通过真实终端服务启动/接入屏幕快照，并从 `/proc` 检查 tmux
子进程；读取 Runner 的文件 API、连接 WebSocket 并读取真实 SQLite schema。
探针清理自己的临时文件与专用 tmux server。
它不声称验证了真实模型推理。

`verify` 随后执行桌面探针；也可单独执行：

```sh
bash deploy/agent-runner/dev.sh verify-desktop
```

桌面探针只在目标 Linux 容器运行：检查 Xfce/窗口管理器、会话 D-Bus、中文字体和
桌面应用；完成真实 RFB 3.8 握手并检查 1920 × 1080 帧缓冲与回环监听；临时打开一个
xterm 窗口并用 `maim` 截图，检查 HOME/workspace 可读写。它会关闭自己的窗口并清理
临时文件，不调用模型。它不单独证明跨 Pod 重建的数据持久化或 Agent 接管状态机。

从仓库根目录，在镜像的隔离容器里运行完整后端检查（不占用正在调试的 Pod）。
覆盖入口以免启动桌面；锁清理测试使用源码相对路径，因此只读挂载对应脚本，内容应与
本次镜像构建输入一致：

```sh
docker run --rm --cpus=2 --memory=3g --entrypoint bash \
  --mount "type=bind,source=$PWD/services/agent-runner/ts/docker/clear-stale-browser-locks.sh,target=/opt/agent-runner/docker/clear-stale-browser-locks.sh,readonly" \
  priva-harness/agent-runner:debian13-dev \
  -lc 'cmp docker/clear-stale-browser-locks.sh /usr/local/bin/clear-stale-browser-locks && npm run lint && npm run typecheck && npm test -- --maxWorkers=1 && npm run build'

docker run --rm --entrypoint bash priva-harness/agent-runner:debian13-dev -lc '
  node --import tsx tests/fixtures/resources/pi-mcp-probe.ts dist/provider/pi/pi-resource-loader.js &&
  node --import tsx tests/fixtures/resources/pi-subagent-model-probe.ts dist/provider/pi/pi-resource-loader.js &&
  node --import tsx tests/fixtures/terminal/native-product-probe.ts dist/provider/claude/tools/native-product-server.js
'
```

模型验证应在导入配置后，通过新 UI 分别选择 Claude/Pi，要求执行 `uname -a`、读取
`/etc/os-release` 并在 `/data/workspace` 写一个测试文件，再用 Workspace 或
`kubectl exec` 核对。连通性检查与真实模型调用的结论需要分别记录。

也可在 Runner 目录执行以下显式探针。它通过 UI 的 HTTP/WebSocket 代理发起真实模型
调用，要求 shell 工具写出包含唯一 nonce 的 Linux 环境证据，再通过文件 API 验证；
会消耗模型额度，并保留名为 `debian-proof-*.json` 的文件和相应会话。

```sh
node --import tsx tests/deployment/model-smoke.ts claude
node --import tsx tests/deployment/model-smoke.ts pi
# 可选参数：UI origin、模型 profile ID（省略时用默认配置）
node --import tsx tests/deployment/model-smoke.ts pi http://127.0.0.1:15173 PROFILE_ID
```

查看资源、持久卷、重启原因：

```sh
bash deploy/agent-runner/dev.sh status
kubectl --context minikube -n priva-harness-dev describe pod -l app=priva-harness-runner
kubectl --context minikube -n priva-harness-dev logs deployment/agent-runner --previous
```

暂停这个环境但保留 PVC：

```sh
kubectl --context minikube -n priva-harness-dev scale deployment/agent-runner --replicas=0
# 恢复
kubectl --context minikube -n priva-harness-dev scale deployment/agent-runner --replicas=1
```

不要执行集群重建、全局 Docker 清理或删除其他 namespace。
本地镜像按 [minikube image load](https://minikube.sigs.k8s.io/docs/handbook/pushing/)
加载，并设置 `imagePullPolicy: Never`，不会拉取其他项目的近似名称镜像。

## 本机验证记录（2026-10-11）

本轮使用现有 minikube 的 arm64 节点，最终 Pod 为 Debian 13、UID 1000，运行
Node 24.21.0、Claude Code 2.1.278、Pi 0.84.2 和 tmux 3.7c。

| 检查 | 实际结果 |
| --- | --- |
| macOS 后端 lint / typecheck / build / tests | 通过；144 个测试文件、797 项测试 |
| Debian 后端 lint / typecheck / build | 通过 |
| Debian 完整测试，`--maxWorkers=1` | 144 个测试文件、797 项全部通过，无跳过 |
| 编译后的 Pi MCP、Pi 子代理模型、Claude 产品 MCP 探针 | Mac 和 Debian 均通过 |
| 编译后的 `dist/main.js` | 在独立 Debian 容器启动并提供工作区 HTTP API |
| 部署探针 | Linux 文件工具、终端快照、HTTP、WebSocket、SQLite 和配置路径通过 |
| Claude + DeepSeek | 经 UI 代理调用 Bash，在 `/data/workspace` 写入 Debian 环境证据 |
| Pi + DeepSeek | 经 UI 代理调用 Bash，在 `/data/workspace` 写入 Debian 环境证据 |
| Pi + Mac 8000 模型服务 | 真实推理和 Bash 调用通过，执行进程仍位于 Debian Pod |
| 浏览器 UI | 显示 Linux 工作目录、验证消息和已连接的原生 Claude 终端 |
| 自动同步与重载 | 新增/删除文件同步、源码重载、端口转发恢复通过 |
| 远程调试 | 经 `:19229` 读取 Linux 进程信息，并成功暂停/继续 |
| Pod 更换后的持久化 | 3 个模型配置、验证文件和 SQLite 审计记录保留 |
| 原有环境 | 先前 34 个 Pod 的 UID 和重启次数均未变化；Mac 源设置文件哈希未变化 |

并发 `--maxWorkers=2` 的完整 Linux 测试曾出现 1 项失败：
`terminal-resources.test.ts` 在资源刷新后立即发出的模型请求里未看到新 MCP 工具。
该项独立复测和全部串行测试均通过；本轮没有修改其测试或生产逻辑，也未证明并发时序
问题已消失。上述 2 CPU 验证命令使用单 worker，所有断言仍执行。

仅迁移了用户选择的模型连接集合。容器中的回环模型地址改为
`host.minikube.internal:8000`，设置文件权限为 `0600`；没有迁移 Mac 原生 Agent 私人
目录或历史会话。模型探针生成的 `debian-proof-*.json` 与验证会话保留在 PVC 中，
可从新 UI 检查。

## 电脑接口与配置（第一阶段）

本节记录画面传输接口；后续电脑工具接入见文末「Runner 原生 Computer MCP 集成」。

这一阶段提供固定共享桌面的实时画面和人工键鼠操作。不同聊天或浏览器连接同一桌面；
关闭连接只关闭其 VNC 连接，桌面和窗口继续运行。当前没有 Agent 电脑工具、聊天独占、
人工接管状态机或暂停后交还续跑功能。

```text
Agent UI Workspace「电脑」
  | GET /api/sandbox/computer -> { available }
  | WS /api/sandbox/computer/stream (binary RFB)
  v
Runner :8001 -- 固定 TCP 目标 --> 127.0.0.1:5900
                                  x11vnc -> Xvfb :99 / Xfce
```

| 接口 | 行为 |
| --- | --- |
| `GET /api/sandbox/computer` | 返回 `{"available":true}` 或 `{"available":false}`，并设置 `Cache-Control: no-store`。值只表示服务端是否配置了桌面目标；此请求不连接 VNC，也不是桌面健康探针。 |
| `WS /api/sandbox/computer/stream` | 双向透明转发二进制 RFB 字节，不解析聊天消息，不接收目标地址、端口或聊天 ID 等 query 参数。每个浏览器 WebSocket 对应一个服务端 TCP 连接。 |

配置由 Runner 启动时读取，不写入产品模型设置。修改后重启 Runner：

| 环境变量 | 规则 | 当前 Debian 开发环境 |
| --- | --- | --- |
| `COMPUTER_VNC_HOST` | 固定 VNC 主机名或 IP；不含 URL scheme 或端口 | `127.0.0.1` |
| `COMPUTER_VNC_PORT` | 固定 TCP 端口，整数 `1..65535` | `5900` |
| `COMPUTER_ALLOWED_ORIGINS` | 逗号分隔的额外 HTTP(S) origin；按 scheme、主机和端口精确匹配，不支持通配符 | `http://127.0.0.1:15173,http://localhost:15173` |

HOST 和 PORT 都未配置时电脑不可用；只设置其中一个或值无效时启动报错。
WebSocket 默认接受与请求 Host/协议一致的 Origin；Vite 的 `changeOrigin` 会改写 Host，
因此开发 UI 的 `:15173` 必须加入精确 allowlist。缺失、`null` 或不匹配的 Origin 返回
HTTP 403；不信任客户端的 `X-Forwarded-Host`/`X-Forwarded-Proto`。Origin 校验约束浏览器
请求来源，部署仍沿用本机单用户开发环境的访问边界。

未配置目标时升级返回 HTTP 503，带 query 参数返回 HTTP 400。成功升级后，文本帧以
1003 关闭，超过 8 MiB 的完整客户端消息以 1009 关闭；这是路由应用层输入限制，
共用 `ws` 的底层解码上限保持不变。TCP 连接失败或 10 秒内未连接成功以 1011 关闭。
两端使用流背压；正常 VNC EOF 先发送剩余画面数据再关闭。断线、错误和 Runner 关闭
都会回收该连接的 TCP socket 与计时器，不重放未确认的输入。

画面经现有 `:8001` HTTP/WebSocket 入口及 Vite 代理传输，部署没有新增对外 VNC 端口。
浏览器使用 noVNC 缩放固定的 1920 × 1080 桌面；此链路与模型观察屏幕或驱动电脑无关。

## 容器桌面验证记录（2026-10-12）

本轮桌面镜像部署到同一 namespace 的单副本 Runner，未重建 minikube。以下记录
属于新增 Xfce/Xvfb/noVNC 功能；上一节 2026-10-11 的完整测试结果不代表本轮结果。

| 检查 | 实际结果 |
| --- | --- |
| macOS 后端 lint / typecheck / build / tests | 通过；146 个测试文件、822 项测试 |
| Debian 桌面镜像构建 | 通过；arm64 Debian 13，Node 24.21.0，UID 1000 |
| 隔离 Docker 容器桌面探针 | 通过；使用 `--cap-drop=ALL`、`no-new-privileges` 和 512 MiB `/dev/shm` |
| 已部署 Pod 的 `dev.sh verify` | Linux Runner 部署探针与桌面探针均通过 |
| Debian 完整测试，`--maxWorkers=1` | 146 个文件中 144 个通过；822 项中 820 项通过、2 项失败，详见下文 |
| Runner 源码热重载保留桌面 | 通过；只 `touch src/computer-config.ts`，Runner 子进程变化，Xvfb、Xfce、Chromium、窗口管理器与 Thunar 的 PID 均不变 |
| 热重载前后窗口比较 | 8 个窗口的 ID、标题、所属进程、位置及尺寸全部一致，包含 Chromium、Thunar、Mousepad 及其保存对话框 |
| 编译后的 Pi MCP、Pi 子代理模型、Claude 产品 MCP 探针 | Mac 和新 Debian Pod 的 6 项检查均通过 |
| 其他 minikube 工作负载 | 排除本项目 namespace 后，原有 34 个 Pod 的集合、UID 与所有容器重启次数均未变化 |

完整 Linux 测试的失败项为原有 `terminal-elicitation.test.ts` 的 `bubble` 场景
（15 秒内未收到 `permission.requested`）和 `terminal-resources.test.ts` 的资源刷新
场景（下一次模型请求未包含 `mcp__refreshed__form`）。后者与前一轮已记录的失败
签名一致；本轮没有修改这些测试或对应终端逻辑。

对这两个文件的第一次独立复测为 3/4 通过：elicitation 两项通过，resources 刷新
场景仍失败。热重载后的第二次独立复测为 2/4 通过：resources 两项通过，elicitation
两项均等待权限事件超时。复测说明这些原有终端/MCP 场景仍有不稳定行为，不能视为
已经修复，也不能将 Linux 完整测试报告为通过。本轮没有扩大范围修改终端逻辑。

## Cua MCP 专项验证（2026-10-12）

第二阶段只验证 Cua Driver 直接控制同一 Debian 桌面，未把电脑工具接入 Runner
的 Agent，也未增加接管、交还、聊天独占或自动暂停 UI。第一阶段的电脑标签可独立使用。

```text
Codex 中的 MCP 协议客户端
  | stdio / kubectl exec -i
  v
Cua Driver 0.34.1 mcp --direct       Agent UI「电脑」
  | AT-SPI / X11 输入、截图                 ^
  v                                      | noVNC / WebSocket
同一 Xvfb :99 / Xfce 桌面 -> x11vnc -> Runner :8001
```

实测使用官方 `cua-driver-rs-v0.34.1` 的 Linux arm64 binary archive，SHA-256：
`1c839d35401bbdea20f3e1cf50ace926ef17be6f32cea7e821b02b263c4933dc`。
解压在 PVC 的 `/data/tools/cua-driver/0.34.1/`，Pod 重建后仍保留；未写入 Mac 的
全局 Codex MCP 配置，也未安装 Cua Spaces 或浏览器扩展。Cua 使用容器现有
`DISPLAY`、`XAUTHORITY` 和 session D-Bus，不需要新增监听端口。

本次 Codex 通过标准 MCP TypeScript Client 建立持久 stdio 连接，实际执行
`initialize`、`tools/list` 和 `tools/call`，读取 MCP image 内容观察画面。测试不是
使用 shell/xdotool 替代 Cua 输入。任意支持 stdio MCP 的客户端可以使用以下启动器：

```json
{
  "mcpServers": {
    "debian-computer": {
      "command": "bash",
      "args": ["/absolute/path/to/priva-harness/deploy/agent-runner/cua-mcp.sh"]
    }
  }
}
```

上面的项目路径需替换为实际绝对路径。启动器默认选择 `minikube` context 和
`priva-harness-dev` namespace，可通过 `MINIKUBE_PROFILE`、`RUNNER_NAMESPACE`
覆盖；它只启动 MCP 进程，不启动 Agent 任务。启动器现已随文末的 Runner 集成改为
调用镜像内的 `/usr/local/bin/cua-driver`，需要部署包含 Cua 的新镜像。
上文 `/data/tools` 是本次专项验证的历史安装位置；当前启动器不再依赖该副本。

| 实测项目 | 结果 |
| --- | --- |
| `tools/list` | 返回 62 个工具；不是对全部 62 个工具的通过认证 |
| 应用与窗口发现 | `list_apps`、`list_windows` 识别 Chromium、Thunar 和 Mousepad |
| 桌面观察 | `get_desktop_state` 返回真实 1440×900 PNG；`get_window_state` 返回窗口 PNG 和 AT-SPI 元素句柄 |
| 桌面软件 | `launch_app` 启动 Mousepad；通过元素句柄点击保存对话框的 Save |
| 全桌面坐标 | `click(scope: desktop)` 点击浏览器地址栏，配合桌面按键、输入完成导航 |
| 中英文输入 | 不传 `element_token` 的前台 `type_text` 完整写入英文、换行和中文，并通过保存文件的逐字比较确认 |
| 实时观看 | Agent UI 同时显示 Cua 的窗口变化、输入结果和带 `debian-validation` 标签的光标 |
| 人工远程操作 | noVNC 中点击、逐键输入、滚动、拖动窗口、Control 保存、切换标签重连均验证；手机视口验证全宽画面，未验证手机软键盘/IME |
| 双向观察 | 在 Agent UI 输入 `ui ok` 后，Cua 的 AT-SPI 读取同一编辑器立即返回该内容 |

验证文件保留在容器 `/data/workspace/cua-mcp-validation-2026-10-12.txt`，可从
Agent UI 文件标签或桌面编辑器检查。该专项验证时屏幕为 1440×900，后续主环境已改为
1920×1080；桌面重载与 Runner
源码重载的行为不同，前者会关闭应用，后者已验证保留窗口。

### 已知限制：前台输入与上游中文截断

Xvfb 无法动态加入虚拟输入设备，Cua 的部分后台按键会返回
`background_unavailable`；当前专用桌面验证明确使用 `delivery_mode: "foreground"`
或 `scope: "desktop"`。这是同一个桌面的输入，不具备人工/Agent 互斥；本阶段按用户
要求没有实现控制权管理。

Cua 0.34.1 的 targeted AT-SPI `type_text(element_token)` 对非 ASCII 文本有已知
截断问题：[上游 issue #4754](https://github.com/trycua/cua/issues/4754)。本次输入
89 个 Unicode 码点、115 个 UTF-8 字节，实际只保存前 89 字节，恰好停在
`中文输入验证：`。根因见固定版本
[native.rs:2797](https://github.com/trycua/cua/blob/0c69d9a2c8abbb5051a2df4a23f0fa166d5385dc/libs/cua-driver/rust/crates/platform-linux/src/atspi/native.rs#L2797)：
将字符数量传给要求字节长度的 AT-SPI InsertText。这不是 noVNC 或 Runner 传输截断。

本次已验证的路径是先聚焦准确窗口，再调用 **不带 `element_token`** 的前台输入，
并在操作后重新截图/读取、保存后核对文件内容。只增加 `foreground` 而仍保留
`element_token` 不足以避开该路径。未修改或构建第三方 Driver，因此不能把默认
AT-SPI 中文输入报告为通过，也不能把本次验证视为 GNOME Wayland 兼容性认证。

## Runner 原生 Computer MCP 集成

本节取代上述专项验证阶段的手工 PVC 安装方式。主环境继续使用 Debian 13 / Xfce / X11，
GNOME 实验目录独立保留。镜像内固定安装官方 Cua Driver **0.34.1**，按 Docker
`TARGETARCH` 选择 arm64 或 amd64 archive，验证 SHA-256 与 `--version`。二进制放在
`/opt/cua-driver/0.34.1/`，入口为 `/usr/local/bin/cua-driver`；没有修改第三方源码。
新建空 PVC 也可以完成配置，不再依赖 `/data/tools` 中曾经手工安装的副本。

```text
容器入口 -> 检查旧 Pod 的 Chromium singleton 链接
               |
               v
           启动 supervisor -> 桌面就绪
                                 |
                                 v
                         configure-computer.mjs -> 启动 Runner
                            |                     |
                            +-> Claude 原生 MCP <-+-> Claude SDK / TUI
                            `-> Pi 原生 MCP <-----+-> Pi adapter
                                                       |
                                              stdio MCP / computer
                                                       |
                                               Cua Driver mcp --direct
                                                       |
                                                   Xfce :99
                                                       |
Agent UI「电脑」 <- noVNC / WebSocket <- Runner :8001 <- x11vnc :5900
```

启动入口在 supervisor 和 Chromium 启动前检查持久 HOME 中的 singleton 链接。
此处理依赖当前**单副本、单 PVC、`Recreate` 更新**的独占部署约束：旧 Pod 已结束，
新 Pod 的 hostname 改变，但 Chromium 留在 PVC 的锁仍记录旧 hostname/PID。
只有锁为合法符号链接、hostname 与当前容器不同、指向 `/tmp` 的 socket 目标已消失，
并且当前没有 Chromium 进程时，才移除 `SingletonLock`、`SingletonSocket` 和
`SingletonCookie` 的链接；不会跟随链接删除目标，也不会删除书签、登录状态或用户配置。

当前 hostname 的锁、仍存在的 socket 目标、活跃 Chromium 或普通同名文件均保留，
检查进程失败也不会继续清理。该逻辑只在容器入口执行，不在浏览器 launcher 或 Runner
热重载时执行；它不是跨 Pod 共享浏览器 profile 的协调机制，不能用于多个实例同时
挂载同一 HOME 的部署。未满足确认条件的异常锁仍由 Chromium 报错，不强制解锁。

集成复用现有 MCP 发现、配置、执行和图片返回能力；没有新增 Runner API、控制服务或
网络监听端口。Cua 是 provider 启动的 stdio 子进程；HTTP 资源检查器也可能为一次
检查创建独立短连接。需要使用 window/element token 的连续操作必须保持同一 MCP 会话。

桌面就绪后、Runner 启动前运行 `node /opt/agent-runner/docker/configure-computer.mjs`：

| 原生配置 | 新增内容 |
| --- | --- |
| `$CLAUDE_CONFIG_DIR/.claude.json` | `mcpServers.computer`，stdio，`alwaysLoad: true` |
| `$PI_CODING_AGENT_DIR/mcp.json` | `mcpServers.computer`，`lifecycle: eager` |
| 两个目录各自的 `skills/computer-desktop/SKILL.md` | 工具发现、前台输入、中文限制、结果核对及共享桌面说明 |

命令均为 `/usr/local/bin/cua-driver`，参数 `mcp --direct`；显式传入 DISPLAY、
XAUTHORITY、DBUS_SESSION_BUS_ADDRESS、XDG_RUNTIME_DIR、XDG_CURRENT_DESKTOP、
XDG_SESSION_TYPE，以免 provider 的子进程环境过滤遗漏桌面连接信息。
脚本只补缺失项，保留同名用户 MCP、disabled 策略、其他配置和已有 skill；新文件原子
写入且权限为 0600。非法 JSON 或链接配置报错，不会用默认值覆盖。删除 MCP 后重建
Pod 会重新补入；若需长期停用，请使用 provider 原生禁用策略。

在 Agent UI 的 MCP 资源页可查看 `computer`；部署后新建 Claude 或 Pi 聊天即可使用。
已有会话需要通过现有资源刷新流程重新载入；仅在旧聊天继续发消息不保证已加载新配置。
选用支持图像输入的模型才能直接理解截图。文本模型仍可调用提供 AT-SPI 树的工具，
但不能把保存了截图文件视为模型看到了图像。

本轮仍保持现有电脑界面。**没有自动控制权互斥、聊天独占、接管／交还按钮或暂停续跑
状态机**；一次只在一个聊天运行桌面任务，人工输入前先停止该回合。

### 验证命令

不调用模型的真实 Linux MCP 探针（会短暂打开自己的编辑器并输入）：

```sh
bash deploy/agent-runner/dev.sh verify-computer
```

真实模型端到端探针，从 Runner 目录运行；先建空白 fixture 文件，再要求模型仅通过
电脑 MCP 打开编辑器、输入包含中文和唯一 nonce 的内容、保存，最后经文件 API 逐字
核对。保留会话、证明文件和已保存的窗口，便于在电脑 tab 检查。两个 provider 必须
串行运行，避免向同一桌面同时输入。

```sh
node --import tsx tests/deployment/computer-model-smoke.ts claude
node --import tsx tests/deployment/computer-model-smoke.ts pi
# 文本模型：截图写文件，后续依赖 AT-SPI；不声称模型已读取截图。
node --import tsx tests/deployment/computer-model-smoke.ts claude http://127.0.0.1:15173 PROFILE_ID --text-only
```

运行静态分析或完整测试时，使用上文的独立 Docker 容器，避免与桌面和模型任务竞争
minikube 的内存。本机 7 GiB 节点同时运行其他服务、Xfce 和 GNOME 实验时，在运行中的
Runner Pod 再执行 ESLint 曾触及节点内存上限并导致 API/画面连接超时；停止该检查进程
后服务恢复。此现象不应通过重启整个集群或修改无关工作负载来掩盖。

### 本轮验证记录（2026-10-12）

实际构建和部署的平台为 Linux arm64；amd64 下载与校验路径已实现，未在本轮执行
amd64 桌面验证。最终部署镜像的 OCI index 为
`sha256:744fe7aa922a858dce4a395c57499002a91b9a4ba4537dc744a38e33720cd8f8`。

| 检查 | 实际结果 |
| --- | --- |
| macOS 静态检查与构建 | `npm run lint`、`npm run typecheck`、`npm run build` 通过 |
| 新增启动配置与 Chromium 锁测试 | 2 个文件、21 项测试通过 |
| Debian 独立容器 | 静态检查、类型检查、构建和 10 项配置测试通过；最终镜像另执行 11 项锁清理测试通过 |
| 既有编译产物探针 | Pi MCP、Pi subagent model、Claude native product 三项通过 |
| 后端完整测试 | 当次 147 个文件、832 项中 831 项通过；既有 terminal-elicitation 超时，隔离重跑该文件 2/2 通过，未把整套报告为全绿 |
| 最终部署的真实 Cua MCP | 原生配置发现、62 个工具发现、PNG、独立 Mousepad、中文前台输入、GUI 保存逐字比较和自有窗口清理通过；Pi adapter 图像块保留通过 |
| 重建后浏览器 | 启动日志确认清理旧 Pod singleton 链接；MCP 识别真实 `about:blank - Chromium` 窗口，电脑 tab 也显示正常浏览器 |
| Claude 真实模型 | 通过 Runner 的原生 Claude 会话调用 MCP，使用文本模型与 AT-SPI 完成中文输入和 GUI 保存；证明文件逐字比较通过 |
| Pi 真实图像模型 | 最终镜像上的完整探针退出 0；图像模型收到桌面截图，通过 MCP 输入中文、GUI 保存，文件逐字比较通过 |

Claude 的通过会话为 `9a18d66a-b2ad-4009-8069-f9c756beabad`，证明文件为
`/data/workspace/computer-proof-claude-9f58e17c-2fe8-4fc2-9e3d-7ccaf29ded61.txt`。
Pi 的通过会话为 `01a12c31-3438-7055-a890-7d74d4708255`，证明文件为
`/data/workspace/computer-proof-pi-30c2b83d-e3a1-444f-8240-d65e1e17d3ca.txt`；该窗口保留
在电脑 tab，后续重建 Pod 会关闭窗口，但文件仍在 PVC。模型有过无效工具参数并重试
成功，验证通过不代表每次工具调用或每个模型都能一次成功。
本轮还发现一个配置的 DeepSeek 模型在 Pi 的 OpenAI API 路径返回 404；这次失败发生
在调用电脑工具之前，不能算作该模型的桌面验证通过。
