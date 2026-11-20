# Computer Use 的实现

2026-11-21 重做。Computer Use 是 Runner 的一个内置插件，与 `agent-dashboard` 同级同结构。它复用 ChatGPT 桌面应用里的原版运行包 `cua_node`：`node_repl` 提供持久的 JS 会话，`@oai/cua` 提供统一的桌面 API，Sky 负责读控件树、截图和发送输入。Runner 只做三件事：声明入口、把入口交给 Claude 和 Pi、把远程电脑的 worker 接进来。

此前按环境变量启用、同时支持三套入口的实现，以及旧的 Cua Driver，已全部删除。

## 整体结构

```text
Agent UI「＋」菜单勾选 Computer Use
        │ enabledPluginIds
        ▼
内置插件 registry ── plugin.json + skills/* + mcp/servers.json
        │
        ├─ Claude SDK   plugins + mcpServers + Stop / SubagentStop 钩子
        ├─ Claude TUI   --plugin-dir + --mcp-config + 同样的钩子
        └─ Pi           additionalSkillPaths + registerMcpServer
                │
   ┌────────────┼──────────────────────────────┐
   ▼            ▼                              ▼
cua_repl     node_repl                 registered_computers
   │            │                              │ 私有 Unix socket
mcp/cua-repl.mjs   通用 JS，                设备服务（SSH 子系统）
   │               会话工作区                    │ SSH 通道
node_repl worker                            Mac 托盘
   │                                            │
Sky ─> 本机桌面                        同一个 cua-repl.mjs ─> Sky ─> Mac 应用
（Pod 里是 Xfce :99，
  本机开发时是这台 Mac）
```

「本机」指运行当前会话的那台机器：部署环境里是 Runner Pod 自己的 Xfce，本地开发时是开发者的 Mac。远程电脑永远通过 `registered_computers` 操作，并且每次调用都带设备 ID。

## 插件目录

```text
services/agent-runner/ts/src/resources/plugins/computer-use/
├── plugin.json                           id / name / description / icon
├── .claude-plugin/plugin.json            skills: ./skills
├── skills/
│   ├── computer-use/SKILL.md             本机桌面入口、目标与结果验证
│   └── registered-computers/SKILL.md     远程设备发现、选择与断线处理
└── mcp/
    ├── servers.json                      三个 MCP 服务的声明
    ├── cua-repl.mjs                      cua_repl 的启动入口
    └── runtime/<平台>-<架构>/             cua_node 运行包（不入库）
```

`servers.json` 的字段含义见 [随源码分发的产品插件](skills-mcp-migration.md#随源码分发的产品插件)。provider 代码只遍历「已启用插件声明的服务」，不出现具体的服务名；隐藏工具和结束钩子都从声明里取。

| MCP 服务 | 启动的程序 | 提供给模型的工具 | 宿主专用工具 |
|---|---|---|---|
| `cua_repl` | 运行包的 Node 执行 `mcp/cua-repl.mjs` | `js`、`js_reset` | `turn_ended`、`js_add_node_module_dir` |
| `node_repl` | 运行包的 `bin/node_repl` | `js`、`js_reset`、`js_add_node_module_dir` | `turn_ended` |
| `registered_computers` | Runner 模块 `infrastructure/computer/device-mcp` | `list_devices`、`device_status`、`js`、`js_reset` | `turn_ended` |

Claude 的 Stop 和 SubagentStop 钩子会调用每个服务的 `turn_ended`。Pi 目前只在会话关闭时断开 MCP 连接，逐轮的结束通知没有映射。

## 启动入口 `cua-repl.mjs`

运行包自带一个启动器 `@oai/cua-repl`。我们没有直接用它，而是用同一个包生成同样的启动环境，再做两处改动：

```text
宿主（Claude / Pi / 远程托盘）
        │ MCP stdio
   mcp/cua-repl.mjs ── 去掉完成摘要
        │              替宿主声明支持表单确认；没有字段的确认直接回 accept
        │              其余消息原样转发
   bin/node_repl ── 预加载 @oai/cua/tinyskyAlt，创建全局 cua
```

- **去掉完成摘要**：自带启动器固定开启它，这让 `js` 工具的输入 schema 顶层出现 `oneOf`。Claude 不向模型提供这样的工具，实测即使去掉所有禁用规则，模型也拿不到 `mcp__cua_repl__js`。去掉后模型不再需要提交 `completion_summary`。
- **使用应用不询问用户**：macOS 上 worker 在使用每个应用前，会向 MCP 客户端发一个没有表单字段的确认请求。产品决定所有入口都不询问，由入口直接接受。Pi 的 MCP 客户端只应答 `ping` 和 `roots/list`（核对到 1.6.0），本来也无法应答。应答不带持久化选项：桌面服务把「始终允许」存在 `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/…/ComputerUseAppApprovals.json`，按 macOS 用户共享，ChatGPT 桌面应用也会读到。

入口只需要一个参数，即运行包目录；worker 用到的 Node、模块目录和受信代码路径都由它从这个目录推出。因此本机会话和远程托盘用的是同一个文件。

被接受的是 worker 发出的所有是/否确认。运行时里「录制电脑音频」的确认也属于这一类，目前没有开启音频所以触发不到。桌面服务自身按策略禁止的应用仍然打不开。运行时在首次调用时返回的确认策略文档只是给模型的指引，不是强制拦截。

## 运行包

运行包是 ChatGPT 桌面应用的 `cua_node` 目录，每个平台一份，约 210 到 270 MB，其中 `bin/node` 超过 100 MB。它不进入 git，路径已加入 `.gitignore`；长期怎么存放尚未决定。

| 平台 | 来源 | 放置方式 |
|---|---|---|
| macOS 本地开发 | `/Applications/ChatGPT.app/Contents/Resources/cua_node` | `bash scripts/computer-use/copy-runtime.sh` 复制到 `mcp/runtime/darwin-arm64/` |
| Linux 镜像 | 官方 deb `chatgpt_26.1111.71704`，SHA-256 固定 | `docker/install-chatgpt-cua-runtime.sh` 放到 `/opt/cua_node`，在源码树和编译产物的插件目录各建一个 `mcp/runtime/linux-<架构>` 链接 |
| 远程 Mac | 那台 Mac 上安装并且正在运行的 ChatGPT 桌面应用 | 托盘直接使用，不复制 |

当前平台的运行包不存在时，启用插件的会话启动失败，错误里给出应放置的目录。镜像构建的下载源可以用 `CUA_RUNTIME_REPOSITORY` 换成镜像站，校验值不变。`dev.sh sync` 不同步本机的运行包，也不删除 Pod 里的链接；Docker 构建上下文同样排除它。

macOS 上实际执行操作的是 ChatGPT 桌面应用安装并已授权的 Sky 服务，而且 ChatGPT 必须正在运行，否则所有桌面操作失败。原因和后续处理见 [待办：Mac 脱离 ChatGPT](#待办mac-脱离-chatgpt)。Linux 没有这个依赖。

## 启用

插件是否启用只由会话的 `enabledPluginIds` 决定，环境变量不再隐式启用任何东西。界面上它是 Composer 左侧「＋」菜单「插件」分组里的一个勾选项，详见 [前端规范](../front-end-desgin.md)。勾选状态要等服务端确认后才改变；在已有会话里勾选，当前回答结束后生效。

## 首次调用返回的文档

`cua_repl` 在每个会话的第一次调用（以及 `js_reset` 之后的第一次）会返回约两万字符的平台文档：接口、流程、截图读取和确认策略。这是原版运行时的行为，取代了 Codex 旧入口里的那份 skill；之后的调用只返回界面状态。我们的 `computer-use` skill 只写运行时不知道的内容。

平台之间有一处实测差异：macOS 可以用名称直接打开应用，`cua.getApp("Calculator")`；Linux 必须先取清单，再用窗口 ID，`cua.getApp({ windowId })`，传名称会被拒绝。运行时自带的 Linux 工具描述没有体现这一点，skill 里写明了。各平台都可用的起手式是 `await cua.getState()`。

## 远程设备

一台登记过的 Mac 运行的是和本机会话完全相同的桌面 worker，它的 MCP 消息经 SSH 通道原样送到 Runner。

```text
会话 ── js(deviceId, code) ──> registered_computers（Runner 进程，MCP 服务端 + MCP 客户端）
                                   │ 私有 Unix socket：open 成功后承载 worker 的 MCP 行
                                   ▼
                               设备服务（broker）── 一台设备同一时刻一个 worker
                                   │ SSH 子系统 priva-computer
                                   ▼
                               Mac 托盘 ── 启停 worker，锁屏即停
                                   │ 管道
                               cua-repl.mjs ─> node_repl ─> Sky ─> Mac 应用
```

设备通道上每条消息占一行：

| 方向 | 消息 | 含义 |
|---|---|---|
| 托盘 → Runner | `{"type":"hello","version":2,"name":…,"platform":"darwin"}` | 登记；设备 ID 由 SSH 公钥决定 |
| Runner → 托盘 | `{"type":"ready","deviceId":…}` | 登记完成 |
| Runner → 托盘 | `{"type":"request","id":…,"method":"status"}` | 查询是否解锁、运行包版本 |
| Runner → 托盘 | `{"type":"request","id":…,"method":"open"}` | 启动 worker |
| 托盘 → Runner | `{"type":"result","id":…,"ok":…}` | 上面两种请求的回执 |
| 双向 | 以 `=` 开头的行 | worker 的一条 MCP 消息，原样透传 |
| Runner → 托盘 | `{"type":"close"}` | 会话结束，停止 worker |
| 托盘 → Runner | `{"type":"worker-exit","reason":…}` | worker 结束及原因 |

控制消息很小；worker 行带截图，单行上限 32 MiB。SSH 用户名固定为 `device`，只接受这个子系统，拒绝 shell、exec、SFTP、PTY 和端口转发。

`registered_computers` 的每个 `js` 调用都必须带 `deviceId`，所以输入不可能落到别的桌面上。它为每台设备保持一个 worker：

- **断线**：设备锁屏、断开或 worker 退出时，正在进行的调用带着原因失败，并说明动作结果未知；下一次调用告知 JavaScript 绑定已丢失，再下一次才重新启动 worker。
- **设备忙**：另一个会话正在使用时，`open` 被拒绝。
- **没有设备服务**：`list_devices` 明确说明，而不是报连接错误。

设备服务由容器入口在设置了 `PRIVA_COMPUTER_HOST_KEY` 和 `PRIVA_COMPUTER_DEVICES` 时启动，配置步骤见 [Mac 设备接入 Runner](../../deploy/agent-runner/computer-device/README.md)；托盘见 [Priva Computer for macOS](../../apps/computer-tray-macos/README.md)。托盘连接本身就是 Mac 主人的同意，连接后使用应用不再逐个询问。

## 待办：Mac 脱离 ChatGPT

**尚未实现。在完成之前，Mac 上使用 Computer Use（本机会话和托盘）要求 ChatGPT 桌面应用保持运行。**

2026-11-21 把一台 Mac 登记到 Pod 后发现：退出 ChatGPT，所有桌面操作（包括列应用）都返回 `Computer Use server error -10005: codex app-server exited before returning a response`。

```text
现状（macOS）                                    Linux（不受影响）
node_repl ─ Sky JS 客户端                        node_repl ─ Sky JS 代码
      │ Unix socket，7 种请求                          │ 子进程，stdio 每行一条 JSON
      ▼                                                ▼
Codex Computer Use.app（独立常驻，持有系统权限）  sky_linux_<架构> server（只连 X11）
      │ 每个请求先读策略和登录状态
      ▼
codex app-server（只在 ChatGPT 运行时找得到）

目标（macOS 托盘）
node_repl ─ Sky JS 客户端                        （不变，模型看到的 cua API 不变）
      │ 私有 Unix socket，同样 7 种请求
      ▼
托盘内的适配层 ─ cua-driver（内置）─ 应用         权限记在 Priva Computer 名下
```

问题有三处，都只在 macOS：

- **依赖 ChatGPT 运行**：Sky 服务处理每个请求前都启动 `codex app-server`，读取组织策略（`configRequirements/read`、`config/read`）和登录状态（`getAuthStatus`、`account/read`）。它找 `codex` 的途径实测有三个：正在运行的 ChatGPT、`CODEX_CLI_PATH`、`PATH`。ChatGPT 退出后都找不到。
- **依赖 ChatGPT 安装和它的版本**：托盘直接使用 `/Applications/ChatGPT.app` 里的 `cua_node`。ChatGPT 自动更新会整个替换它（当天从 Sky 0.7.21 换成了 0.7.24）。
- **权限不在托盘名下**：辅助功能和屏幕录制记在 `Codex Computer Use`（`com.openai.sky.CUAService`）名下，托盘自己不持有。

Linux 的 Sky 是 worker 自己拉起的命令行子进程，没有策略、账号和授权这一层，镜像里也没有 `codex`，所以不受影响，保持不变。

已定的方向：保留 OpenAI 的 `cua` API 和 `cua_repl` / `node_repl` 这套形式，Mac 托盘底下的原生服务换成内置的 [cua-driver](https://github.com/trycua/cua/tree/main/libs/cua-driver)（MIT），由托盘里的一层适配把 Sky 的 7 种请求翻译成 cua-driver 调用。Linux 不换。

当天已验证、可以直接作为依据的事实：

| 事实 | 结果 |
|---|---|
| 运行时是否接受非 OpenAI 的桌面服务 | 接受。`SKY_CUA_SERVICE_NATIVE_PIPE_PATH` 指向私有 socket，一个假服务就让 `listApps`、`getApp`、`getAXState`、`click`、`typeText` 走通，对端身份不被校验 |
| socket 协议 | 4 字节小端长度头 + JSON-RPC；`ping` 核对版本 `CodexComputerUseIPC-5`；`request` 带 `requestType`，共 7 种：`ListApps`、`AppPolicy`、`AppStart`、`AppGetSkyshot`、`AppPerformAction`、`StartAudioRecording`、`StopAudioRecording`（前缀 `ComputerUseIPC`，后缀 `Request`） |
| 只保留 Sky、用替身代替 `codex` 是否可行 | 可行：`PATH` 里一个只回答上述 5 个方法的替身，11 项操作的结果与真 Codex CLI 相同。没有采用，因为权限仍记在 OpenAI 的服务名下 |
| 引擎速度（Pod 内读同一个窗口的控件树和截图） | Sky 约 360 ms，cua-driver 0.34.1 约 350 ms，没有差别 |
| 最初直接使用 cua-driver 的 MCP 为什么慢 | 它暴露 62 个工具，定义合计约 190 KB，每次模型请求都携带，而且每个动作一次模型往返。慢在形式，不在引擎 |

开始实现前要先验证的：

- cua-driver 内置或由托盘拉起后，系统是否把辅助功能和屏幕录制记在 Priva Computer 名下，能否读到并操作一个应用。
- 7 种请求能否完整对应：控件树的文本和编号、截图、选中文字、粘贴、次要动作。录音可以不做。
- 固定 cua-driver 的版本（当天最新是 0.55.0，三天发了三个版本）。
- 托盘需要一个固定的签名身份。现在是临时签名，每次重新构建系统都当成新应用，授权要重来。
- 运行包要随托盘一起打包，不再读取 `/Applications/ChatGPT.app`。

本机 Mac 会话（不经托盘）是否也改用托盘里的服务，尚未决定。

## 验证

以下均为 2026-11-21 实际运行的结果。

| 环境 | 检查 | 结果 |
|---|---|---|
| macOS 本机 | Claude SDK 会话（本地模型替身）打开计算器 | 无审批请求，返回 39 行控件树，宿主专用工具未提供给模型，skill 已列出 |
| macOS 本机 | 完整 Runner + Claude TUI 打开计算器 | 通过，无审批卡片也无终端对话框 |
| macOS 本机 | Pi 会话打开计算器 | 通过，返回 39 行控件树 |
| macOS 本机 | 远程链路：本地设备服务 + 托盘（真实 SSH）+ `registered_computers` | 设备登记，读到运行包版本，打开计算器返回 39 行控件树，绑定跨调用保留；会话结束后托盘停止了 worker |
| Linux arm64 镜像 | 用改后的 Dockerfile 构建并启动 | 镜像内没有 Cua Driver 和旧环境变量，插件目录里的运行包链接存在 |
| Linux arm64 镜像 | `computer-use-linux-desktop.ts` | 在 Mousepad 输入含中文的文本，从控件树读回，取得 640 × 480 截图，保存后文件一致，窗口已关闭 |
| Linux arm64 镜像 | Claude SDK 会话与 Pi 会话取应用清单 | 均通过，三个服务的工具可见性正确 |
| minikube 开发环境 | 部署新镜像后运行 `dev.sh verify-computer`、Claude SDK 会话与 Pi 会话取应用清单 | 均通过 |
| minikube 开发环境 | 把这台 Mac 登记到 Pod 的设备服务，从 Pod 内运行 `computer-device-smoke.ts app` | 设备登记，读到运行包版本，打开计算器返回 39 行控件树。ChatGPT 当时在运行 |
| 自动化测试 | 插件、provider、设备服务、启动入口的单元与集成测试 | 通过；设备服务的测试使用真实 OpenSSH 客户端 |
| macOS 托盘 | `apps/computer-tray-macos/test.sh` | 8 项通过，含 4 MiB 消息、锁屏停止 worker 及其子进程 |

没有验证的部分：

- 用真实模型从界面发起并完成一次桌面任务。后端链路已用模型替身验证，界面只验证了勾选项。
- amd64 镜像。下载和校验路径存在，没有运行。
- 集群外的 Mac 经公司内网入口接入。远程链路验证过两种：同一台 Mac 上的本地设备服务，以及这台 Mac 经端口转发登记到 minikube 的 Pod。
- ChatGPT 未运行时的 macOS。此时所有桌面操作失败，见 [待办：Mac 脱离 ChatGPT](#待办mac-脱离-chatgpt)。
- Mac 锁屏时的行为只在托盘的夹具测试里验证，没有真实锁屏。
- 全量 `npm test` 在开发机上不是绿的：四十多个 tmux、TUI 和 git 集成测试超时，未改动的 HEAD 同样如此。

## 命令

确切命令维护在 [AGENTS.md](../../AGENTS.md)。常用的几个，从 `services/agent-runner/ts/` 运行：

```sh
bash scripts/computer-use/copy-runtime.sh
node --import tsx tests/fixtures/resources/computer-use-probe.ts runtime
node --import tsx tests/fixtures/resources/computer-use-probe.ts session Calculator
node --import tsx tests/fixtures/resources/computer-use-pi-probe.ts Calculator
node --import tsx tests/deployment/computer-device-smoke.ts app DEVICE_ID Calculator
```
