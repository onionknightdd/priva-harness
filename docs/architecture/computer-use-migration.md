# Agent Runner Computer Use 组件对照

本文记录 2026-11-20 核对的本机 Codex 实现，以及 Runner 迁移需要交付的组件。第一版的本地目标是 Runner Pod 内现有的 Xfce 桌面，远程目标先实现 macOS。远程 Linux 和 Windows 沿用同一设备协议，按各自平台产物和实机结果发布。

## 对照基准

```text
本机 Codex
  模型
    +-- 通用 node_repl.js                         通用 JS 入口
    |
    +-- cua_repl.js                               计算器用的 MCP 入口
          -> cua_node/bin/node_repl               持久 JS worker
          -> @oai/cua/tinyskyAlt                  预加载全局 cua
               +-- 原生应用 -> sky RPC -> @oai/sky/service -> 原生服务 -> 应用
               +-- 浏览器   -> browser RPC -> @oai/browser-desktop/service
          <- 控件树、文本、图片、错误

  桌面宿主管理应用权限、锁屏任务授权和任务结束通知
```

计算器实测有三次模型工具调用。第一次 `getApp("Calculator")` 取得窗口和初始控件树。第二次复用同一个应用对象，按控件编号点击四次，再用 `getAXState()` 读到表达式和结果。第三次提交 `completion_summary`。同一次任务另有 macOS 系统日志确认临时解锁及重新锁屏。浏览器路由、显式截图和 `js_reset` 有配置或接口依据，此次计算没有使用它们。

## 插件、MCP 入口与可选功能

以下状态取自本机 ChatGPT.app 随包插件目录、Codex 插件缓存、用户配置中的插件启用项和当次调用记录。随包清单说明功能可以提供；配置说明宿主选择了哪些入口；实际调用记录能确定一次任务走了哪条路径。

```text
本机已配置的入口                                工具或服务
unified-computer-use  ----------------------> cua_repl.js  ----> Sky（计算器实测）
computer-use skill / 独立浏览器 skills ------> node_repl.js ----> Sky 或浏览器服务
用户配置另列 mcp_servers.computer-use -------> SkyComputerUseClient mcp

随包的可选入口
computer-history ---------------------------> computer-history MCP
record-and-replay --------------------------> event-stream MCP
```

| 名称 | 本机观察 | 对 Runner 的意义 |
|---|---|---|
| `unified-computer-use` | 配置已启用。插件声明 `cua_repl` 和结束钩子，计算器的三次调用均走此入口 | 首版桌面操作对齐这一条，保留结果及中断语义 |
| `computer-use` 插件、`node_repl` MCP | 插件配置已启用，清单注册 skill。另有通用 `mcp_servers.node_repl` 配置，指向 `cua_node/bin/node_repl`。统一运行时可对已接管的平台隐藏旧 skill 提示 | 保留通用 JS 能力，按所选入口提供一致的初始化说明。不要据插件开关推断模型同时加载了两套 skill |
| `computer-use` 原生 MCP（与插件同名） | 用户配置还启用了 `mcp_servers.computer-use`，启动声明为 `SkyComputerUseClient mcp`。从本机客户端的安装目录独立发起 MCP 元数据探测，两次独立探测均超时，第二次在 MCP initialize 阶段等待了 12 秒。 | 记录为并行入口。公司项目若有直接消费者，需要独立完成握手验证。此前的计算器调用走统一入口。 |
| `browser`、`chrome` | 两个插件均配置启用。`browser` 指导使用内置浏览器，`chrome` 指导使用用户 Chrome，并随包提供扩展的本地通信宿主。两份插件清单的结束钩子指向 `node_repl.turn_ended`，统一插件的钩子指向 `cua_repl.turn_ended` | 浏览器验收区分内置浏览器、Chrome 扩展连接与原生窗口操作。按实际 worker 分派结束通知；插件启用状态不能证明扩展当前已连接 |
| `computer-history`、`record-and-replay` | 应用随附两个独立插件。前者声明 `computer-history` MCP，提供用户启用后的近期活动查询；后者声明 `event-stream` MCP，将用户主动演示的操作转为可复用 skill。本机配置未列出其启用项，此次会话也未暴露这两个 MCP | 作为可选产品功能另列；首版控制桌面、返回截图、验证临时解锁均无须采集用户活动历史 |

相邻功能也有明确归属。`codex-app-tools` 提供 `codex_app` 客户端管理工具；`messages` 是随包的消息应用专用 MCP；`cloud-environment` 面向附加到 Codex 聊天的云电脑。Appshots 是桌面宿主主动附加前台窗口截图与文本的功能。这些功能均未出现在计算器工具调用链中。Locked Use 对应 macOS 系统授权插件 `CodexComputerUseAuthorizationPlugin.bundle` 和辅助应用 `CUALockScreenGuardian.app`，单独验收。[Appshots 官方说明](https://learn.chatgpt.com/docs/appshots) · [Locked Use 官方说明](https://learn.chatgpt.com/docs/computer-use#locked-use)

本机复核入口为 ChatGPT.app 下的 `Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json`、同目录树内各插件的 `.codex-plugin/plugin.json` 与 `.mcp.json`、生效缓存中的统一插件清单，以及 `~/.codex/config.toml` 中相应的 `plugins` 和 `mcp_servers` 条目。浏览器后端的配置值为 `chrome,iab,mcpapps`。`mcpapps` 是侧栏浏览器后端标识。`edge` 与 `dot` 是工具接口可识别的其他目标名称，本机这份后端配置只列出前三项。此次未读取个人活动历史或查询后台录制状态。

### 随包清单复核与迁移缺口

本机 ChatGPT.app 版本为 `26.1111.71704`（build `29030`）。其 `openai-bundled` 市场列出 **11 个插件**。与桌面和浏览器控制相关的四个启用项是 `unified-computer-use`、`computer-use`、`browser`、`chrome`。另有两个可选桌面功能 `computer-history`、`record-and-replay`。余下五项是 `codex-app-tools`、`messages`、`latex`、`deep-research`、`visualize`。其中 `codex-app-tools` 和 `visualize` 也在本机启用，`messages` 的启动命令也用到 Mac 原生客户端，服务的是独立的消息工具。其他市场安装的 `cloud-environment` 0.2.1 提供 `cloud-desktop`、`cloud-environment-runtime` 两份技能，依赖单独的云环境连接器。此次计算器使用本机原生窗体。

| 在 Runner 验收时容易漏掉的部分 | 本机证据与验收边界 |
|---|---|
| 统一入口的动态配置 | `unified-computer-use` 随包仅有 manifest 和占位 MCP 配置，没有独立 SKILL.md。桌面宿主生成的有效清单才配置了 `browser,computer` 和 `sky`、`browser` 两个服务。复制随包目录后需要分别验证原生应用与浏览器。|
| 五份独立 skill | 对应目录名为 `computer-use`、`control-in-app-browser`、`control-chrome`、`computer-history`、`record-and-replay`。把文件送入 Pod、让 Claude/Pi 加载它们、让其依赖的宿主服务执行动作，是三个可分别验证的结果。 |
| 轮次结束钩子 | 统一插件把 `Stop`、`Interrupt`、`SubagentStop` 发给 `cua_repl.turn_ended`。两种独立浏览器插件把相应事件发给 `node_repl.turn_ended`。子代理事件使用该子代理的 ID。模型提交的 `completion_summary` 和宿主发送的结束通知各有调用方。 |
| 浏览器客户端、后端和宿主 | 独立浏览器插件包含 `browser-client.mjs`、`browser-service.mjs`、API 文档和资源。Chrome 另带 `extension-host/macos/arm64/ChatGPT for Chrome`。迁移时分别验证浏览器扩展连接、原生消息宿主、目标平台依赖、内置浏览器及侧栏的实际提供方。 |
| Node 及原生应用版本 | `cua_node/manifest.json` 指定 `darwin-arm64`、Node `24.22.1-cua.1`、归档版本 `local`。Mac 原生分发还涉及服务、客户端、安装器、Guardian 和系统授权插件。系统实际安装的授权插件 Info.plist 显示 `0.1.0`（build `799`）。平台包、系统安装状态及第三方托盘的授权须逐项核验。 |

在这台 Mac 上还独立验证了两个不操作界面的行为。通用 `node_repl` 在连续两次工具调用间保留了 JS 变量，统一 `cua_repl` 完成预加载且 `typeof cua.getApp` 返回 `function`。这两项可通过运行包探针复验。官方将锁屏临时解锁限定在 ChatGPT 发起的受信任 Computer Use 轮次。Runner 的托盘使用本机已解锁的桌面进行独立验证。[运行包探针](../../services/agent-runner/ts/scripts/computer-use/probe.mjs) · [官方 Locked Use 说明](https://learn.chatgpt.com/docs/computer-use#locked-use)

当前参考实现的远端入口为 `registered_computers`。真实菜单栏应用已从 Mac 主动注册到 minikube Pod。Pi 经该 MCP 列出了在线 Mac，设备状态查询返回控制台已锁。五个原版 skill 打包后的 95 份资源（含五份 Runner 生成的 Claude 插件清单）已在该 Linux Pod 内逐项核对 SHA-256。Claude SDK 和 Pi 原生加载器已分别发现全部五份 skill，Claude TUI 生成的五个插件路径与 SDK 一致。该验证只读取插件命令及说明。此前计算器显示 `2` 的验证发生在 Codex 自己的 `cua_repl` 上。Runner 操作远程 Mac 计算器仍等桌面解锁。Linux 原版驱动、浏览器与可选桌面服务的验收结果见下表。[Runner 端设备验收探针](../../services/agent-runner/ts/tests/deployment/computer-device-smoke.ts)

Runner 还自带 `computer-desktop` skill 和 `computer` MCP。它们对应现有 Pod Xfce 的 Cua Driver。本次在隔离的 Linux arm64 Pod 验证了该驱动 0.34.1 的 62 个工具、桌面 PNG、中文输入及 Pi 经 `codemode` 读取真实截图。这套检查可在迁移前后核对桌面归属。其他针对办公软件的入口（如 `excel-live-control`、`codex_document_control`）服务于各自已连接的文档会话。桌面菜单中能选到一个应用，并不足以说明该应用的专用连接器参与过操作。

## 组件清单

| 组件 | Codex 本机依据与职责 | Runner 的交付方式 |
|---|---|---|
| 插件打包与启动 | `unified-computer-use` 26.1111.71704 声明 MCP 和宿主钩子。桌面宿主根据选中的 `cua_node` 运行包生成有效清单，配置 worker、模块目录和可用能力 | 新建 Runner 内置 `computer-use` 插件。把本机已安装运行包作为外部依赖发现，校验版本、平台、可执行文件和服务入口。仓库提交接线代码、配置模板和探针 |
| 通用 NodeREPL | 引擎为 `node_repl`，使用配套 Node 和模块目录；跨调用保留变量并处理异步代码、文本和图片输出 | 提供 Runner 工作区的 `node_repl` MCP。按会话管理 worker 和重置，不让通用 REPL 因用户选择远端桌面而移到 Mac |
| CUA MCP | `@oai/cua-repl` 0.1.5 提供启动逻辑、模板和说明；实际生效的 MCP 服务名为 `cua_repl`，直接启动配置好的 `node_repl` | 复用同版本运行包。模型入口为 `js`、`js_reset`；`turn_ended` 留给宿主。Claude/Pi 面向同一工具契约 |
| 统一 JS API | `@oai/cua` 0.2.7 的 `tinyskyAlt` 预加载入口创建全局 `cua`。应用对象与控件编号由执行端管理 | 复用原 API 与平台说明。验收应包括发现应用/窗口、读取完整与增量控件树、截图、按元素或坐标点击、键盘/文本、滚动、拖动及平台支持的其他操作 |
| 原生桌面服务 | 可信服务名 `sky` 映射到 `@oai/sky/service` 0.7.21。Mac 端经本机 IPC 到 `SkyComputerUseService`；Linux 适配器需要匹配平台的 `sky_linux` 原生进程 | Mac 优先使用本机已有的原版 JS 与原生包，验证由公司托盘合法启动和使用的路径。Pod 需单独取得和验证 Linux worker、原生驱动及桌面连接 |
| 浏览器服务 | `browser` 映射到 `@oai/browser-desktop/service` 0.1.1。此机器的配置列有 Chrome、内置浏览器 IAB 和 MCP Apps | 原生方式操作浏览器窗口与 `cua.getTab()` / DOM 操作分别验收。只有目标宿主提供的浏览器连接能够注册；Codex 的 IAB 和侧栏归桌面宿主管理 |
| Skill 与首次使用说明 | 独立的 `computer-use` skill 描述通用 NodeREPL 手动导入 Sky 的用法。统一入口通过预加载、工具描述和平台 Markdown 提供说明 | Runner 提供一份指导统一入口的 skill。保留运行包提供的 API 说明、截图/坐标规则及状态刷新规则，避免模型对同一个 worker 重复初始化 |
| 结果与生命周期 | `nodeRepl.write`、图片输出、状态差异与错误返回模型；`completion_summary` 表示界面任务完成。Stop、Interrupt、SubagentStop 分别通知 `turn_ended` | 保留文本和 MCP image 内容块、错误、取消和结果摘要。轮次结束释放本轮控制权；重置使 JS 引用失效；会话销毁或断线清理 worker。聊天与同一会话的 TUI 共用绑定 |
| 系统权限与 Locked Use | macOS 桌面宿主负责系统权限、按应用授权与受信任轮次；Locked Use 另外涉及本机授权插件和屏幕保护组件 `CUALockScreenGuardian` | 托盘报告设备在线、应用是否获准、锁屏及当前任务可用性。本机已有插件和成功的 Codex 解锁记录；第三方宿主可用的授权入口仍需独立核验。[官方 Locked Use 说明](https://learn.chatgpt.com/docs/computer-use#locked-use) |

核对时，运行包位于 ChatGPT.app 的 `Contents/Resources/cua_node`，统一插件生效配置位于 Codex 插件缓存的 `unified-computer-use/<version>/.mcp.json`，原生服务位于 Codex 的 `computer-use/Codex Computer Use.app`。配套 `@oai/cua-repl/README.md` 解释了匹配版本的清单、预加载和生命周期。当前本机的 `node_repl` 为 macOS arm64 Mach-O，已安装的 JS 模块含 Linux 适配代码，未携带 Linux 原生驱动。配套的 Linux 二进制另随官方 Debian 包分发，实测见下表。

## Linux 原版运行包实测

OpenAI 的 Debian ARM64 桌面预览包 `chatgpt` 版本 `26.1111.71704` 包含 Linux 原生 `bin/node_repl`、`@oai/cua-repl` 和 `@oai/sky/bin/linux/sky_linux_arm64`，另有 Linux ARM64 的 Chrome 原生消息宿主。实测包 SHA-256 为 `f0550dee1f99127d357ad760aef739c557d49bd67728d2f105d00a7a4780f740`。官方把面向用户的 Linux 桌面 Computer Use 列为预览版尚未支持；下列结果描述 Runner 对随包组件的实测。[Linux 桌面包及支持范围](https://learn.chatgpt.com/docs/linux/linux-app#compatibility-and-limitations)

| 入口 | Debian 13 / arm64 实测 |
|---|---|
| 通用 NodeREPL | 从 Runner 的运行配置启动原版 MCP，在连续两次工具调用之间保留绑定，`js_reset` 后确认绑定已清空。 |
| 独立 Linux Computer Use skill | Linux 版原文位于 `@oai/sky/docs/skills/oai_sky_lib/linux/SKILL.md`。显式选用这份技能时，Runner 为工作区的通用 `node_repl` 注册 Sky 服务；在 Xfce 实测使用原文指定的 `import("@oai/sky")` 和 `sky.list_windows()`，读到了真实窗口列表。普通工作区 JS 使用默认配置。 |
| 随镜像发布的技能 | 仓库标准构建成功后，用该镜像重启了隔离的 minikube Runner 容器。`/opt/chatgpt-cua-skills` 直接来自镜像。非 root 用户核对了 browser、chrome、Linux computer-use 的 88 个文件。Claude SDK 和 Pi 均枚举到三份技能，Claude CLI 的插件目录与 SDK 完全一致。 |
| 统一 CUA | `computer`、`browser`、`browser,computer` 三种设置分别成功预加载对应 API。 |
| 原生 Xfce | 原版 Sky 在隔离的 Runner Pod 的 `:99` 桌面启动 Mousepad，同一 MCP worker 输入文本后从可访问性树读回，取得原始 JPEG 窗口截图并确认窗口关闭。全过程以 Pod 自己的桌面权限运行。 |
| 浏览器 | 独立 browser-only worker 的 `cua.getState()` 返回空浏览器列表，`errors` 明确指出缺少 Codex 宿主的 `session_id` 和 `turn_id`。Chrome 原生消息宿主已随包提供，实际浏览器会话与扩展授权仍需由其宿主建立。[Chrome 扩展说明](https://learn.chatgpt.com/docs/chrome-extension) |
| 生命周期 | 在真实 Claude SDK 与 CLI 中，`Stop` 和 `SubagentStop` 均送达同一会话的测试 MCP worker，携带 Claude 实际的会话或子代理 ID 和 prompt ID。测试中 SDK 主动中断流式推理时没有触发结束通知。Pi 1.2.0 的 `agent_settled` 提供 `aborted`，缺少顶层 `turn_id`。当前 Pi 适配会随会话关闭 MCP 连接，尚未将正常结束、中断和独立子会话结束映射到逐轮 `turn_ended`。[Claude 实测](../../services/agent-runner/ts/tests/integration/provider/claude/repl-lifecycle.test.ts) · [Pi 适配](../../services/agent-runner/ts/src/provider/pi/pi-resource-loader.ts) |
| 公网以外的设备接入 | 同集群的独立客户端通过真实 ClusterIP、固定主机公钥和 OpenSSH 进入注册子系统，在正常 Runner 镜像中看到设备在线。该传输测试使用临时设备身份。Mac 托盘的实机测试使用已登记的 Mac 身份。 |

## 已经运行的 Runner 和托盘

```text
Claude SDK / TUI 或 Pi SDK / TUI
                |
        Runner 内置 computer-use 插件
                +-- node_repl -> Pod 工作区的持久 JS worker
                +-- cua_repl  -> Pod 内 worker -> Sky -> Xfce :99 <- noVNC
                +-- registered_computers -> Pod 内设备服务
                                                |
                         +----------------------+ 已由 Mac 主动建立的 SSH 连接
                         v
                     Mac 菜单栏应用
                         +-- device_status    -> 控制台锁屏状态、原包版本
                         +-- calculator_check -> 本机原版 CUA -> Calculator
```

新镜像默认使用 `/opt/cua_node` 的原版运行包，启用 `computer` 桌面。在全新 ARM64 Pod 上，正常镜像入口启动了 Xfce、Runner HTTP 和已配置的 SSH 设备服务。原版 worker 在 Mousepad 输入含中文和随机标记的文本，从可访问性树读回并保存，经文件核对一致。worker 返回 640 × 480 的窗口截图并关闭测试窗口。真实 Mac 托盘通过这个 Pod 的 SSH 入口注册，Pi 列出该设备，设备状态回传了 Node `24.22.1-cua.1`、CUA REPL `0.1.5`、CUA `0.2.7` 和 Sky `0.7.21`。在锁屏状态发起的计算器请求返回需要解锁的错误，远程结果仍待实测。

镜像安装器从同一 Linux Debian 包提取运行时和三份原版 skill：两个浏览器插件的技能及 Linux 版 `computer-use`。默认只启用统一桌面；选择独立入口时使用 `PRIVA_CUA_ENABLED_SKILLS`。Mac 安装可另导出包含五份 skill 的快照。两种 `computer-use` 同名，但 Linux 文档使用 `list_windows` / `get_window_state`，Mac 文档使用 `get_app_state`。Runner 在把独立技能交给本机 worker 前校验平台。统一入口会略过其已覆盖的旧技能。浏览器插件的扩展通信宿主需要独立部署。构建脚本在 arm64 和 amd64 Debian 环境均已校验运行包并启动原版 Node，原版桌面输入与读回的实机结果来自 arm64。[安装脚本](../../services/agent-runner/ts/docker/install-chatgpt-cua-runtime.sh) · [技能选择规则](../../services/agent-runner/ts/src/core/plugin/session-plugin-resources.ts)

### 公司项目后续接入项

下表包含后续设计。当前远端协议提供登记、查询和固定计算器验证。会话级通用目标路由、远端画面和其他操作系统客户端尚待实现。

| 交付件 | 责任及验收重点 |
|---|---|
| Claude/Pi 插件适配 | 复用内置插件目录。Claude 覆盖 SDK 与 CLI 的本地插件入口；Pi 通过原生 MCP 扩展注册服务并加载 skill。Web Chat、TUI 和程序化会话使用相同的目标与工具配置。[内置插件](../../services/agent-runner/ts/src/core/plugin/builtin-plugins.ts) · [Pi 加载器](../../services/agent-runner/ts/src/provider/pi/pi-resource-loader.ts) |
| SSH 接入与设备注册 | Mac 托盘主动连接；沙箱从已认证的设备身份确定归属并记录在线连接。稳定设备 ID、显示名称、平台和运行包版本与临时连接分开管理。开发环境默认发布 Runner HTTP；有设备接入需求时可以单独部署 SSH ClusterIP Service。[现有部署](../../deploy/agent-runner/minikube.yaml) |
| 会话路由和 MCP 代理 | 将 `computerTarget` 存入会话配置、恢复路径和 warm-runtime 身份。远端 `cua_repl` 转发给绑定设备上的同一个 worker，以保持原生 API 和跨调用对象。设备切换使旧引用失效；离线时向该会话报告目标不可用。[会话元数据](../../services/agent-runner/ts/src/core/resource/session.ts) · [运行时缓存](../../services/agent-runner/ts/src/harness/run/warm-runtime-pool.ts) |
| Mac 托盘参考应用 | 管理连接、设备注册、运行包发现、worker 生命周期、本机授权、活动会话展示和本地停止。公司项目可复用这部分协议和行为。Windows、Linux 远端客户端日后实现同一协议，各自上报实际支持能力 |
| 控制并发和故障处理 | 同一桌面上的输入由设备端协调。取消、重复请求、断线、Pod 重建与托盘退出均可测试。动作已执行而回执丢失时记录“结果未知”，重新观察后再决定下一步 |
| Agent UI 与旧部署切换 | 更新旧 `mcp__computer__*` 工具识别、动作标题、目标选择以及画面归属。对照现有 Cua Driver 的桌面、浏览器及图像用例逐项验收；用新旧 PVC 验证，只清理可认定为 Runner 生成的旧项。[现有 Computer 集成](../development/debian-minikube.md#runner-原生-computer-mcp-集成) · [旧配置生成器](../../services/agent-runner/ts/docker/configure-computer.mjs) |

## 剩余验收

1. **远程 Mac 计算器。** 在设备正常解锁时，从 Runner 的 `registered_computers.calculator_check` 发起检查。成功需要 Mac 原版 CUA 读到 Calculator 显示的表达式和结果，再通过现有 SSH 连接返回。
2. **浏览器和可选服务。** 有对应宿主接入时，分别验证 Chrome 扩展、内置浏览器、侧栏浏览器。历史和演示录制服务各自需要提供此功能的 Mac 客户端与用户授权。
3. **宿主和平台等价性。** 分别验证 provider 取消、恢复及子会话清理，正式环境的会话目标与画面归属，以及远程 Windows、远程 Linux 的平台适配。第三方托盘使用 Locked Use 的能力需要宿主提供受支持的接入方式。

## 本机 Xfce 上线与提交文件

2026-11-20，现有 `agent-runner` Deployment 已切换到与测试 Pod 相同的镜像 `priva-harness/agent-runner:cua-linux-skills-261120`。沿用 `runner-data` PVC 和原 Agent UI 地址。业务 Pod 默认注册 `node_repl`、`cua_repl`，Xfce 使用 `:99`，远程设备 SSH 入口关闭。实际通过 Agent UI 的 HTTP 和 RFB 握手验证，并通过原版 `cua_repl` 在业务桌面输入中文、从控件树读回、保存、截图及关闭测试窗口。

```text
Agent UI -> agent-runner Service -> 业务 Runner Pod
                                      +-- cua_repl -> Sky -> Xfce :99
                                      +-- node_repl -> Pod 工作区
```

以下是相对 Git 基线 `1565d11` 的提交范围，按仓库根目录列出。`M` 表示修改，`A` 表示新增。复现这次已验证的交付共 **58 个文件**，包括 Runner 目录 46 个、Agent UI 7 个、部署脚本 1 个及文档 4 个。下面列出全部路径。

前 19 个文件负责本机运行时打包、原版技能和 Claude/Pi 接入。已单独验证将这 19 个文件叠加到基线可编译，并能在默认配置生成两个本机 MCP。当前共享插件还保留可选设备分支；显式选择设备插件会引用 `device-mcp.js`。要保留这个已验证版本的全部配置与测试，可连同其余 Runner 文件一起提交。

### Runner 本机运行核心（19）

```text
M  services/agent-runner/ts/.dockerignore
M  services/agent-runner/ts/Dockerfile
M  services/agent-runner/ts/docker/configure-computer.mjs
A  services/agent-runner/ts/docker/install-chatgpt-cua-runtime.sh
A  services/agent-runner/ts/scripts/computer-use/stage-linux-sky-skill.ts
A  services/agent-runner/ts/scripts/computer-use/stage-skills.ts
M  services/agent-runner/ts/src/core/plugin/builtin-plugins.ts
A  services/agent-runner/ts/src/core/plugin/computer-use.ts
A  services/agent-runner/ts/src/core/plugin/original-computer-skills.ts
A  services/agent-runner/ts/src/core/plugin/session-plugin-resources.ts
M  services/agent-runner/ts/src/provider/claude/claude-runtime.ts
M  services/agent-runner/ts/src/provider/claude/claude-tool-policy.ts
M  services/agent-runner/ts/src/provider/claude/terminal/claude-terminal-hooks.ts
M  services/agent-runner/ts/src/provider/claude/terminal/claude-terminal-launch.ts
M  services/agent-runner/ts/src/provider/claude/tools/native-product-launch.ts
M  services/agent-runner/ts/src/provider/pi/pi-resource-loader.ts
A  services/agent-runner/ts/src/resources/plugins/computer-use/.claude-plugin/plugin.json
A  services/agent-runner/ts/src/resources/plugins/computer-use/plugin.json
A  services/agent-runner/ts/src/resources/plugins/computer-use/skill/SKILL.md
```

### Runner 镜像中的设备支持与旧驱动基线（13）

```text
M  services/agent-runner/ts/docker-entrypoint.sh
M  services/agent-runner/ts/docker/skills/computer-desktop/SKILL.md
M  services/agent-runner/ts/package-lock.json
M  services/agent-runner/ts/package.json
A  services/agent-runner/ts/scripts/computer-use/calculator
A  services/agent-runner/ts/scripts/computer-use/calculator-state.ts
A  services/agent-runner/ts/scripts/computer-use/probe.mjs
A  services/agent-runner/ts/src/infrastructure/computer/broker.ts
A  services/agent-runner/ts/src/infrastructure/computer/cli.ts
A  services/agent-runner/ts/src/infrastructure/computer/client.ts
A  services/agent-runner/ts/src/infrastructure/computer/device-mcp.ts
A  services/agent-runner/ts/src/infrastructure/computer/protocol.ts
M  services/agent-runner/ts/tests/deployment/computer-mcp-smoke.ts
```

### Runner 测试与部署探针（14）

```text
A  services/agent-runner/ts/tests/deployment/computer-device-smoke.ts
M  services/agent-runner/ts/tests/deployment/computer-model-smoke.ts
A  services/agent-runner/ts/tests/deployment/original-linux-desktop.ts
A  services/agent-runner/ts/tests/fixtures/resources/original-computer-skills-probe.ts
A  services/agent-runner/ts/tests/fixtures/resources/original-computer-surface-probe.ts
A  services/agent-runner/ts/tests/fixtures/terminal/repl-lifecycle-server.ts
A  services/agent-runner/ts/tests/integration/provider/claude/repl-lifecycle.test.ts
M  services/agent-runner/ts/tests/unit/core/plugin/builtin-plugins.test.ts
A  services/agent-runner/ts/tests/unit/core/plugin/computer-use.test.ts
M  services/agent-runner/ts/tests/unit/docker/configure-computer.test.ts
A  services/agent-runner/ts/tests/unit/infrastructure/computer/broker.test.ts
A  services/agent-runner/ts/tests/unit/scripts/computer-use/calculator-state.test.ts
A  services/agent-runner/ts/tests/unit/scripts/computer-use/stage-linux-sky-skill.test.ts
A  services/agent-runner/ts/tests/unit/scripts/computer-use/stage-skills.test.ts
```

### Agent UI 与前端测试（7）

```text
M  agent-ui/src/features/agent-message/components/mcp-tool-item.tsx
M  agent-ui/src/features/agent-message/computer-tool-data.ts
M  agent-ui/src/features/agent-message/use-agent-message.ts
M  agent-ui/tests/features/agent-message/mcp-tool-data.test.ts
M  agent-ui/tests/features/agent-message/mcp-tool-item.test.tsx
M  agent-ui/tests/features/workspace/workspace-computer-navigation.test.tsx
M  agent-ui/tests/features/workspace/workspace-computer-view.test.tsx
```

### 部署命令与仓库文档（5）

```text
M  AGENTS.md
M  deploy/agent-runner/dev.sh
A  docs/architecture/computer-use-migration.md
M  docs/development/debian-minikube.md
M  docs/front-end-desgin.md
```

远程 Mac 托盘在 `apps/computer-tray-macos/` 下另有 12 个文件，SSH 接入的 `deploy/agent-runner/computer-device/README.md` 和 `service.yaml` 也可随远程功能单独交付。`deploy/agent-runner/minikube.yaml` 此次没有源码改动。日常使用仓库流程时先 `bash deploy/agent-runner/dev.sh build`，再 `bash deploy/agent-runner/dev.sh deploy`，以便集群取得最新的 `debian13-dev` 镜像。
