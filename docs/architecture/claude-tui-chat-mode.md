# Claude Code TUI 作为 UI 聊天驾驭方式

状态：Claude 原生 UI 驱动、产品 MCP、配置与交互镜像、转录用量和工具审计已接通；原生接口边界见 §5
范围：`services/agent-runner/ts` 与 `agent-ui/`  
相关基线：[agent-runner-ts-implementation.md](agent-runner-ts-implementation.md)

## 1. 目标

UI 的输入核心交互是：用户既可以在消息气泡区的 ChatComposer 中输入，也可以在
完全同步的 Claude Code 原生 TUI 镜像（浏览器内嵌终端）中发送消息，并且可以随时
切换。两侧看到的是同一个 Claude Code 进程和同一份转录。

现有 Agent SDK `query()` 路径保留，继续服务 `AgentHarness.run/launch` 程序化调用，
包括 HTTP subagent 测试入口；Claude UI 的 `/ws/session` 不再调用 SDK。

```
 用户浏览器（远端）                        后台主机（单机单进程 runner）
 ┌──────────────────────┐   WS /ws/session    ┌──────────────────────────────────────┐
 │ ChatComposer ────────┼────────────────────►│ AgentHarness ── TerminalChatSessions   │
 │ 消息气泡  ◄──────────┼── AgentEvent ───────│        │  paste/Enter    ▲ hooks(HTTP)  │
 │                      │                     │        ▼                │ + jsonl tail │
 │ xterm.js  ◄──────────┼── WS /ws/terminal ──┼──► tmux pane: claude TUI ─────────────│
 │ (TUI mirror)         │   二进制 PTY 帧      │        │                              │
 └──────────────────────┘                     │        ▼ ~/.claude/projects/**.jsonl  │
                                              │   (程序化 SDK 调用也使用原生转录)     │
                                              └──────────────────────────────────────┘
```

## 2. 已确认的决策

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 轮次生命周期的权威信号 | 服务端 `session.state(running/idle)`；终端发起的轮次由服务端合成 `runId`；`run.start` 退化为"请求注入一条消息" |
| Q2 | 权限模式 | 默认 `bypassPermissions`；镜像 `AskUserQuestion`，用户在 TUI 改权限模式后出现的普通工具审批也走同一 coordinator；MCP 基础表单复用问答卡片 |
| Q3 | 凭证暴露 | 单用户产品，token 直接注入 pane 环境变量 |
| Q4 | `claude` 可执行文件 | 复用 `@anthropic-ai/claude-agent-sdk` 依赖的原生二进制，两种驾驭方式永远同版本 |
| Q5 | pane 生命周期 | 懒启动；空闲且无查看者时回收；runner 重启后按会话键重新认领 |
| Q6 | SDK 与 TUI 对同一会话 | 会话级 driver 租约，冲突方返回明确错误 |
| Q7 | 用户 SSH 后本地 `tmux attach` | 不在范围，socket 路径为内部实现 |
| Q8 | 多标签尺寸 | 最近一次 resize 的查看者决定窗口大小（`window-size manual` + `resize-window`） |
| Q9 | 租户模型 | 单用户 |
| Q10 | 功能对等 | 产品工具走 stdio MCP；context / 模型 / effort 走 statusLine；delta 走 MessageDisplay；fork 用原生参数；用量从转录汇总。原生任务卡片打开 `/tasks`，不冒充 SDK 的按 ID 停止。promptSuggestions 设置应用于 CLI，气泡建议列表仍需结构化事件 |
| Q11 | 队列仲裁 | 队列由服务端持有，`Stop` hook 到达时先 flush 再置 idle |
| Q12 | 线协议 | 可演进，不保留旧帧兼容 |
| Q13 | 首次启动对话框 | runner 预写 `~/.claude.json`（项目信任、onboarding、bypass 确认、自定义 API key 批准） |
| — | Pi TUI | 留到下一个 MVP |

## 3. 分层

```
L1  终端基础设施（本文档 §4，已落地）
    TerminalService 端口 + tmux 实现 + WS /ws/terminal + Claude TUI 启动描述
L2  TerminalChatSessions 最小闭环（已落地）
    UI 首条消息启动 TUI；hooks HTTP 接收；转录 watch/replay；排队注入 + 等 Stop
L3  交互能力补齐（本轮已落地）
    AskUserQuestion 双向镜像；MessageDisplay 增量；/clear 轮转；模型 / effort 切换
L4  Claude 产品能力（已落地）
    产品 stdio MCP；配置与上下文回传；事件审计 / 用量；资源刷新 / 附件 / 后台任务入口
后续独立范围：Pi TUI
```

## 4. L1：终端基础设施

### 4.1 组件

```
transport/websocket/terminal-route.ts   WS /api/sandbox/agent/ws/terminal
        │  buildRunSpec(run-spec.ts，与 /ws/session 共用)
        ▼
harness/terminal/session-terminals.ts   SessionTerminals：{provider,id} → 终端键
        │  provider.terminalLaunch(target, spec, {scratchDir, cols, rows})
        ▼                                            ▲
core/contract/terminal-service.ts       TerminalService 端口   provider/claude/
        ▲                                                       claude-terminal-launch.ts
        │                                                       claude-executable.ts
infrastructure/terminal/                                        claude-project-trust.ts
  tmux-terminal-service.ts   一会话一 tmux server（私有 socket）
  tmux-control-client.ts     `tmux -C attach` 控制模式客户端（无需 PTY 原生模块）
  tmux-control-protocol.ts   %begin/%end/%output 编解码（纯函数）
  tmux-screen-snapshot.ts    画面、备用屏幕与终端模式恢复（纯函数）
```

依赖方向不变：`core` 只含端口；`harness` 依赖端口；tmux 实现在
`infrastructure`；Claude 启动细节只在 `provider/claude`。

### 4.2 终端键与持久化

终端键为 `${provider}:${sessionId}`，socket 位于
`$RUNTIME_HOME/terminals/<terminalId>/tmux.sock`。`terminalId` 是稳定的 24 位十六进制目录名，
最初由会话键计算；目录已被 /clear 后的新会话占用时，打开旧转录会分配不同目录。
`terminals/bindings.json` 保存会话键到目录的映射；更新串行执行，以独立临时文件原子替换。
runner 重启后读取映射并通过 `has-session` 认领 pane。同目录保存启动配置和 hooks 文件。
文件权限为 0600、目录 0700；凭证留在运行目录内，不进入 argv。

新会话在启动前分配 UUID 并通过 `--session-id` 交给 Claude，因此 `SessionRef` 与
转录文件名一致。fork 预分配独立 UUID，并使用 `--resume <source> --fork-session
--session-id <new>` 创建原生分支。程序化 SDK 可以在 TUI 退出后 resume 同一转录，
会话级互斥阻止两种 driver 同时写入。

### 4.3 pane 环境

tmux server 与 pane 继承的是经 `paneEnvironment` 清洗过的 runner 环境：去掉描述 runner
自身（往往是非交互）终端的变量 `NO_COLOR`、`FORCE_COLOR`、`CI`、`TERM`、`TERM_PROGRAM*`、
`TMUX*`，固定 `COLORTERM=truecolor`，缺少 UTF-8 locale 时补 `LANG=C.UTF-8`；pane 的
`TERM` 由 `default-terminal screen-256color` 决定，并在创建首个 pane 之前通过
`start-server ; set-option` 生效。provider 从进程环境复制过来的同名变量在 `-e` 传递时
再过滤一次。否则一个由 systemd / CI 启动的 runner 会让 Claude Code 判定"不支持颜色"，
浏览器里的 TUI 变成纯黑白。

### 4.4 tmux 控制模式

查看者不通过伪终端 attach，而是起一个 `tmux -S <sock> -C attach` 子进程：

- 输出：stdout 按原始字节分行，`%output %<pane> <octal-escaped>` 只还原八进制
  转义，随后转发为 WebSocket 二进制帧；中文 / emoji 的 UTF-8 字节可能跨多条
  `%output`，必须留给 xterm 的流式解码器拼接，不能先对控制流做 UTF-8 解码；
- 输入：浏览器键击以 `send-keys -H <hex...>` 写入，每条命令最多 2048 字节；
- 尺寸：`refresh-client -C WxH` + `resize-window`，`window-size manual`；
- 快照：attach 接收查看者的 `cols/rows`，在同一组同步 tmux 命令中先设置尺寸，再
  读取光标与模式、当前画面、备用屏幕保存的普通画面，以及 `capture-pane -P -C`
  返回的未完成 ANSI 指令。画面用 `capture-pane -p -e -N -S -2000` 保留颜色和行尾
  单元格；恢复普通 / 备用屏幕、滚动区域、原点 / 换行 / 插入模式、光标位置与显隐、
  键盘模式、鼠标追踪与 SGR 坐标、括号粘贴，再接上未完成指令和实时输出。

```text
tmux: [resize ; state ; active screen ; saved screen ; pending ANSI] -> %end
       |                                                                   |
       +-- preceding output is included in the snapshot                    +-- later output is buffered

viewer: restore snapshot at cols/rows -> subscribe -> buffered output -> live output
```

快照边界在最后一条回复的 `%end` 被解析时同步标记，不能等 Promise 的 `await`
续体才丢弃输出，否则同一个 stdout 分片中紧随快照的输出会丢失。调用方先写入
`attachment.screen`，再注册 `onOutput`；注册时按序交付快照之后缓存的所有字节。

tmux 的 `capture-pane -P` 不暴露其未完成的 UTF-8 字符。若快照后的首字节是 UTF-8
续字节，暂停交付增量输出并重新捕获 tmux 已更新的画面，随后继续按相同边界同步，
避免在首次接入恰好切中一个中文字符时遗漏该字符。

命令回复按 FIFO 匹配，仅匹配 `fromClient` 标志为 1 的 `%begin/%end`；回复体只由
对应序号的 `%end/%error` 终止，其中 `%output`、`%exit` 等文字均视为画面内容。
同组命令出错时移除 tmux 跳过的剩余回复，避免错配下一组命令。

### 4.5 WS 线协议

`GET /api/sandbox/agent/ws/terminal?harness=claude&cwd=…&model=…[&sessionId=…][&effort=…][&cols=…&rows=…][&theme=light|dark]`

| 方向 | 帧 | 内容 |
|---|---|---|
| 服务端 → 客户端 | 文本 | `{type:'ready', harness, sessionId, adopted, cols, rows}` |
| 服务端 → 客户端 | 二进制 | 终端输出（先快照，再实时） |
| 服务端 → 客户端 | 文本 | `{type:'rebound', sessionId}`（/clear 轮转；现有字节连接保留） |
| 服务端 → 客户端 | 文本 | `{type:'exit', reason}`、`{type:'error', kind, message}` |
| 客户端 → 服务端 | 二进制 | 键击 |
| 客户端 → 服务端 | 文本 | `{type:'resize', cols, rows}` |

未带 `sessionId` 时创建新会话终端并在 `ready` 中返回 id；带 `sessionId` 时
`--resume`。同一会话第二个查看者收到 `adopted: true`，不会重复启动。
首次启动尚未完成时，并发查看者等待同一个预检 / 启动任务；启动失败会通知所有
等待者并释放任务，后续重连可重新启动。

### 4.6 Claude TUI 启动

`ClaudeProvider.terminalLaunch` 与 `resolveClaudeQueryOptions` 保持同一套配置来源：

- 二进制：`@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`；
- 参数：`--session-id|--resume`、`--model`、`--permission-mode bypassPermissions`、
  `--settings <scratch>/claude-settings.json`（`resolveClaudeQuerySettings` +
  `skipDangerousModePermissionPrompt`）、`--disallowedTools`、`--effort`；
- 环境：`resolveClaudeQueryEnv` + `DISABLE_AUTOUPDATER=1`；
- 预置 `~/.claude.json`：`hasCompletedOnboarding`、`bypassPermissionsModeAccepted`、
  `projects[cwd].hasTrustDialogAccepted`、`customApiKeyResponses.approved`
  （API key 末 20 位指纹）；查看者带 `theme` 时同步写入 Claude Code 的 `theme`
  （`light` / `dark`），只在实际启动时生效，认领已运行的终端不改主题。

同一 runner 内的预置操作按配置文件路径串行执行完整的读 / 改 / 写，避免并发首次
连接丢失项目信任或 API key 批准记录。每次写入使用独立临时文件并原子重命名，结束
后清理临时文件；失败保留错误并释放队列，不阻塞后续重试。

```text
Concurrent preflights -> per-file queue -> read latest -> update -> atomic rename
```

### 4.7 回收

`TmuxTerminalService.sweepIdle` 每分钟扫描：无 attach 客户端且
`window_activity` 距今超过 30 分钟的终端 `kill-server` 并删除目录；已死的目录
直接清理。

### 4.8 验证

在 `services/agent-runner/ts` 运行 `TMPDIR=/tmp npm test`；tmux 缺失时以下用例自动跳过：

- `tests/integration/infrastructure/terminal/tmux-terminal-service.test.ts`
- `tests/integration/transport/websocket/terminal-route.test.ts`

纯协议编解码与 Claude 启动描述的单测不依赖 tmux。

终端回归用 `@xterm/headless`（仅开发依赖）解析实际 tmux 快照与实时字节，并比较屏幕
单元格；覆盖中文 / emoji 跨消息分片、备用屏幕及普通画面恢复、滚动区域、输入模式、
快照前后的半条 ANSI / UTF-8 字符、延后订阅、不同查看者尺寸和同一 stdout 分片的
快照边界。它验证终端状态和数据，不覆盖浏览器 WebGL 绘制。

macOS 默认临时目录较长，可能超过 Unix socket 路径限制；从
`services/agent-runner/ts/` 使用 `TMPDIR=/tmp npm test`。

### 4.9 前端视图

页头 Chat / Terminal 分段控件、xterm.js 终端镜像、视图状态与重置规则、主题/字体/尺寸
同步的实现细节维护在
[front-end-desgin.md](../front-end-desgin.md#会话视图切换与-claude-code-终端镜像)。
前端只依赖 §4.5 的线协议；`harnessSupportsTerminal` 列表须与实现了 `terminalLaunch`
的 provider 保持一致。

### 4.10 TUI 消息回显到聊天气泡

气泡订阅、终端连接或活动轮次通过 `AgentHarness.observeTerminalHistory` 为该会话共享一个
`TerminalHistoryMirror`。Claude 的 session store 以 250ms 间隔观察转录文件元数据，
文件发生变化时才读取并沿用现有 replay / fold 解析；同时观察所属 subagents/*.jsonl，
支持首次消息后创建文件和原子替换。
最新记录更新现有 `SessionStream` 并广播带递增游标的 `session.snapshot`，因此已打开的
气泡订阅及后续重连都能收到 TUI 用户消息和回复。新建 TUI 会话拿到 id 后即可订阅，
无需等待 HTTP 历史加载。

```text
TUI -> native JSONL -> provider watch/replay -> TerminalHistoryMirror
                                               |
                                               v
                             SessionStream -> /ws/session -> message bubbles
```

原生会话自身、查看者和活动轮次共享观察器。关闭终端查看者后，会话仍持有观察器，
以接收后台子代理的转录；进程退出或 runner 关闭后释放。最后一个持有者释放时补读一次并停止观察。读取期间的再次
变化会排队补读；真正的读取错误通过会话错误帧报告，已有消息保留。SDK 有活动轮次时
不以落盘历史覆盖实时响应。TUI 实时文本同时通过 MessageDisplay 推送，随后与转录对齐，
细节见 §4.12；气泡输入见下一节。

### 4.11 Claude UI 从首条消息起由 TUI 驱动

`/ws/session` 的 Claude `run.start` 总是先通过 `TerminalChatSessions.open` 创建、
恢复或 fork 原生会话，再排队注入消息。新对话仍懒创建：首条气泡发送时才启动 TUI，
无需先访问 Terminal 视图；直接进入 Terminal 也可创建同一种会话。后续切换视图仅
附加查看者。新进程使用首条请求的模型、effort 和主题；气泡启动的默认尺寸为 120×40，
终端查看者接入后按实际尺寸调整。

进程已退出时，下次发送从同一转录重新启动 TUI。终端不可用或启动失败会明确报错，
不会切换到 SDK。首次打开旧 SDK 会话前释放空闲 SDK runtime；SDK 尚有活动轮次或
后台任务时返回 busy。程序化 `AgentHarness.run/launch` 保留 SDK，但不能同时写入
已由 TUI 控制的会话。Pi 的 UI 路径保持原状。

```text
Claude UI run.start -> open/resume/fork TUI -> queue -> ready composer -> paste + Enter
Terminal view       -> attach viewer -------------------------------> same process
Programmatic call   -> AgentHarness.run/launch -> SDK (session exclusion)

Claude hooks -> local HTTP -> run.started / session.state / run.completed
native JSONL -> shared watch -> session.snapshot -> both connected chat viewers
```

注入前等待带边框的原生输入框出现，用原生 stash 保存并腾空已有草稿，粘贴后等待内容显示并提交。
不会向启动对话框、历史搜索或尚未就绪的画面盲发 Enter；超时提示用户打开 Terminal
处理。`UserPromptSubmit` 仍是 Claude 接收消息的权威确认。

Claude 启动配置增加 `SessionStart`、`UserPromptSubmit`、`Stop`、`StopFailure`、
`SessionEnd` command hooks。小型 Node relay 先原子保存生命周期状态，再 POST 到
runner 的本机 HTTP 路由；[官方 hooks 参考](https://code.claude.com/docs/en/hooks)
明确 SessionStart 不支持直接 HTTP hook，因此统一使用 command relay。
状态文件位于终端私有 scratch 目录，runner 重启后可认领原进程及 running / idle 状态。
每次启动有独立 `instanceId`；relay、读取器和 HTTP 接收处校验它，丢弃旧进程迟到的事件。
服务端每秒检查存活状态及落盘 hook 状态，因此纯气泡会话也能发现进程退出和遗漏的回调。
旧终端连接关闭时会复核当前进程是否仍存活，避免误结束刚恢复的进程。这些文件属于
运行产物，不进入 Git。

气泡请求使用客户端 runId；原生 TUI 输入由服务端生成 runId。`UserPromptSubmit`
确认注入被 Claude 接收；提交后 15 秒内没有确认时报告失败且不自动重发。Stop / StopFailure
先补读历史再发送完成 / 错误事件。Claude 在用户中断时不发送 Stop，因此气泡停止键和
终端单独的 Escape / Ctrl+C 同步持久化 idle 并结束轮次；方向键不视为中断。
排队消息和活动消息在终端退出时分别收到请求错误和轮次失败。

终端 `run.started` 带 `driver: terminal`，允许原生快照更新活动轮次，并让前端释放
对应乐观气泡，避免客户端 ID 与原生转录 UUID 形成重复消息。纯气泡查看者也保持
历史观察器，因此 Stop 回调后稍晚写入的最终回复仍会回显。断线重连时，已收到
`run.started` 的请求可由权威 idle 快照结清，不要求原生消息 UUID 等于客户端 runId；
尚未获确认的请求不会自动重发。

升级前已经运行的 TUI 没有当前 hooks / instanceId。需在该终端执行 `/exit` 并重新打开一次，
继续使用原会话记录；仅刷新浏览器不会替换后台进程。不会为了升级强行关闭活动终端。
运行中模型与交互同步见以下各节；统一的 TUI 用量归集仍未完成。

真实 Claude TUI 回归使用隔离的 `CLAUDE_CONFIG_DIR`、临时项目和本地模拟模型端点，
覆盖首条气泡创建、随后附加终端、中文 / 多行输入、双向交替、断线重连、进程退出后
恢复和原生 fork；断言全过程未调用 SDK。独立单测确认程序化调用仍走 SDK。不访问真实模型：

```sh
TMPDIR=/tmp npm test -- --run tests/integration/transport/websocket/terminal-chat.test.ts
```

### 4.12 原生增量文本

MessageDisplay 是原生渲染 hook，按新完成的行分批输出，最后一次可携带不完整行或空文本。
它不是模型的逐 token 协议；单行长回复可能到该行结束才回显，工具与思考过程仍来自转录。
[官方 MessageDisplay 说明](https://code.claude.com/docs/en/hooks#messagedisplay)定义了这一边界。

```text
MessageDisplay -> 快速追加 JSONL -> 80ms 读取新增完整记录 -> assistant.delta / snapshot
native transcript -----------------> 文本前缀按顺序对齐 ----> SessionStream
                                                            -> 气泡 / 重连
```

每个 UserPromptSubmit 清空当前轮次的临时增量日志，随后发布 prompt 状态。热路径只运行
shell 追加，不等待网络，也不启动 Node relay；读端只提交完整 UTF-8 JSON 行的字节游标。
消息按 message_id / index 去重并等待连续片段。Display ID 与转录 ID 不同，不能直接
按 ID 合并：`TerminalTextProjection` 在当前用户轮次内按文本顺序消费已落盘前缀，
保留未落盘的尾部。历史刷新、空 final、工具后的第二段回答、断线快照均走同一投影。
Stop 先等待在途读取并补读最后一批，随后补读转录，再完成轮次。

### 4.13 气泡模型与 effort

气泡选择在下一条消息注入前应用。相同服务配置下向原生输入框提交 `/model <id>`、
`/effort <level>`；只自动确认这两个命令的明确确认对话框。statusLine 写入带当前
instanceId 的 model / effort，收到原生确认后才发送用户消息。超时或不支持的值报错，
不悄悄用旧模型发送；TUI 内手动改过模型时也读取实际状态再应用气泡选择。

```text
气泡选择 -> 等当前轮次完成 -> /model、/effort -> statusLine 确认 -> 注入消息
         -> 服务地址 / 凭证 / 图片模型 / 建议设置变化 -> 原 pane respawn --resume -> 注入消息
```

环境配置不能通过 /model 更新，因此换服务地址、凭证、图片模型或建议设置时，在轮次空闲且
没有后台任务后重启同一 pane，resume 同一转录。查看者连接保留。`[1m]` 选择通过 `/model`
应用，原生 context window 确认后回传扩展上下文标志，无需单独重启。

statusLine 同时回传 model / effort / cwd / context，`session.config` 和重连快照更新气泡选择器、
工作目录及上下文环。上下文频繁刷新不会覆盖用户尚未提交的新模型选择；仅原生选择本身变化时
更新选择器。模型元数据只在模型或 profile 变化时保存。

### 4.14 AskUserQuestion 镜像

PermissionRequest command hook 接收原生工具审批及 AskUserQuestion。relay 挂起本机 HTTP 请求，
`InteractionCoordinator` 把问题投影为已有问答卡片。气泡回答使用同一请求的 updatedInput
返回原生工具；多选和自定义答案复用既有校验。重复回答幂等，等待最多 600 秒。

```text
Claude AskUserQuestion -> PermissionRequest -> coordinator -> 气泡问答卡片
          |                                      ^               |
          | 原生 TUI 回答                         +---- 答案 ------+
          v                                      |
取消等待的 hook / HTTP ----> 收起卡片       allow(updatedInput) -> Claude 继续
native tool_result ------> 权威回答记录 ------> 两侧历史
```

浏览器断开不会取消原生问答；重新订阅从 session.snapshot 恢复待答卡片。在 TUI 回答时，
Claude 取消等待中的 hook，HTTP 关闭信号撤销气泡请求；最终答案以原生 tool_result 为准。
停止、终端退出和 /clear 撤销挂起请求，不遗留无法提交的卡片。

普通工具审批只返回 allow / deny，不允许气泡修改原生工具输入。子代理的权限与问答使用
同一通道。`Elicitation` 的 string / number / integer / boolean 表单复用既有问答 UI，
枚举与可选字段提供选项；提交时按 MCP JSON Schema 验证，错误保留请求以便修改后重试。
URL 认证或复杂表单通过 `terminal.focus` 打开同一终端，由原生界面处理。

### 4.15 /clear 重绑定

SessionEnd(reason=clear/resume/fork) 不作为终端退出；SessionStart(source=clear/resume/fork) 带来新的原生
sessionId。稳定 terminalId 的 hook 地址不包含旧 sessionId；服务端更新 bindings 后
继续复用 socket 与启动文件，旧转录保留。并发的 HTTP 回调与状态轮询共享重绑定操作。

```text
旧 session A -- /clear --> 原生 session B（同一 pane）
terminalId -- bindings --> B
stream A -- session.rebound(B) --> 气泡连接订阅 B / 清空旧投影
viewer A -- rebound(B) --------> 更新地址，保留 xterm、连接和当前视图
```

当前 /clear 请求结束，其余排队请求转移到 B。终端内直接 clear 会中止 A 的活动轮次。
两个 WebSocket 都切换到 B 的历史观察器；前端重置旧游标、问题和上下文状态，后续发送、
重连与终端重新打开使用 B。用户主动打开 A 的历史时仍能单独 resume A。

回归在隔离目录中启动真实 Claude / tmux 与本地模拟模型，检查中间增量、重连去重、模型 /
effort / profile、气泡及 TUI 回答、连续双向 /clear；不使用真实模型服务：

```sh
TMPDIR=/tmp npm test -- --run tests/integration/transport/websocket/terminal-chat.test.ts tests/integration/transport/websocket/terminal-streaming.test.ts tests/integration/transport/websocket/terminal-model.test.ts tests/integration/transport/websocket/terminal-interactions.test.ts tests/integration/transport/websocket/terminal-clear.test.ts
```

### 4.16 产品工具与配置注入

`ClaudeProvider.terminalLaunch` 将现有 `productTools` 编译为私有 stdio MCP 配置，
通过 `--mcp-config product-mcp.json` 加入原生 CLI。`visualize`、`canvas`、`image_gen`、
`image_read`、`image_edit` 复用现有实现；没有另开 SDK 对话。

```text
UI 模型 / effort / 图片模型 / 建议设置 -> buildRunSpec -> ClaudeProvider.terminalLaunch
UI MCP / skills / memory / subagents -> 原生文件 -------> CLI 自身加载
                                               |
     argv (--model, --effort, --settings, --mcp-config) + pane env
                                               |
                                          tmux -> Claude
                                               |
                             stdio MCP agentWorkshop -> 现有 productTools
                                               |
                           原生 tool_result -> replay -> JSX / 图片 / Canvas 卡片
```

settings、run spec、产品工具 profile 文件均以 0600 写入 scratchDir，凭证不放在 argv。
MCP 配置只引用私有文件路径；stdio 服务的 cwd / session 每次调用从当前 lifecycle state
读取，跟随 /clear、/resume、/fork、/cd，而非固定为进程启动时的值。图片模型设置在
profile 变化后随原生进程重启加载。CLI 取消 MCP 调用或关闭进程时，工具 AbortSignal 同步取消。

TUI 中 JSX 只显示工具结果文本；切到气泡后，相同转录的 MCP 别名由既有 JSX sandbox 渲染。
实时 PostToolUse 和历史回放共用输出归一化，避免把 MCP 的 content 包装对象当成 JSX。

### 4.17 事件、上下文和用量

```text
Pre/PostToolUse / Failure / SubagentStart/Stop / Pre/PostCompact
                     -> instanceId 隔离的事件日志 -> SessionStream + RunLedger
statusLine           -> session.config / context  -> 气泡选择器与上下文环
主转录 + 已归属子代理 -> 按 API message.id 去重差值 -> run.finished -> SQLite
```

`PreToolUse` 维护 runningToolIds，快照恢复后“等待工具结束再插入”仍有依据。
子代理工具按父工具转录归属展示，不把单独 agent_id 当成父工具地址。Stop 的 background_tasks
刷新任务成员状态，旧转录重读不会把较新的 unknown 状态恢复成 running。进程运行 / 空闲状态
同时接入 running / warm 列表和历史接口的 liveRunId。

context 使用最新请求的 input + cache_read + cache_creation，排除输出与累计 token。
每轮账本按 API message.id 合并分块的 usage，再计算本轮增量和 byModel；忽略 synthetic
消息。UserPromptSubmit 在 API 调用前采集费用基线；Stop hook 先返回，等最终 statusLine
刷新后计算同一实例的费用 / API 时长差值，最多等待 2 秒。拿不到新状态时费用保持未知，
不能把旧状态的差值 0 当成免费调用。转录同步失败也会结清气泡为失败，避免永远 running。

### 4.18 资源、原生附件与命令

```text
资源文件保存 -> invalidateResources -> 标记原生会话待刷新
                    |
     无活动轮次 / 后台任务 + 空输入框 -> 同一 pane respawn --resume
                    |
                下一条消息使用新资源

TUI 粘贴图片 -> 原生 base64 image -> 按内容哈希的 0600 附件文件 -> 气泡附件卡片
/context -> 原生本地命令输出 -> 完成气泡请求
/compact -> Pre/PostCompact -> 压缩状态；原生拒绝 -> 明确失败
```

原生输入框有草稿或对话框时不自动刷新。启动与资源重启共享按会话的进行中任务，刷新期间
发送气泡不会误报“旧终端缺少桥接”，也不会启动两个进程。气泡接管非空输入时使用原生
stash，保留整份多行草稿，避免 Ctrl+A/K 只删除最后一行而拼接错消息。
[原生快捷键说明](https://code.claude.com/docs/en/interactive-mode#general-controls)定义了 Ctrl+S 的暂存语义。

原生图片从转录提取成可重复生成的附件投影，只支持内嵌 base64 图片，不自动下载 URL。
图片独立成条时也保留用户气泡。资源刷新不关闭仍运行的后台任务；卡片的“终端管理”
打开同一会话 `/tasks`，由用户在原生列表中选择并停止任务。

真实 CLI 集成回归增加 `terminal-capabilities.test.ts`、`terminal-elicitation.test.ts`、
`terminal-resources.test.ts`：本地模拟模型验证产品 MCP / JSX、typed 表单、用量 / 工具账本、
草稿保护、MCP 资源刷新、/context 和 /compact 成功 / 拒绝。构建后验证生产 stdio 入口：

```sh
node --import tsx tests/fixtures/terminal/native-product-probe.ts dist/provider/claude/tools/native-product-server.js
```

## 5. 已知限制

- Pi TUI 不在本轮范围；Pi UI 与程序化 Claude 调用仍使用各自原有 runtime。
- MessageDisplay 按原生行 / 片段推送，不提供严格逐 token、thinking 或工具参数增量。
- 原生 prompt suggestion 留在 CLI 输入框；CLI 没有向此桥接提供 SDK 的 `suggestion.prompts` 列表。
- statusLine 仅给出上下文总占用和窗口上限；分类计数未知时保留 null，不伪造为 0。
- 后台任务的直接键盘取消不一定写入转录。任务卡片进入原生管理后标为 unknown，
  只有后续原生通知才确认为完成 / 取消；不能可靠绑定单个任务的自动停止。
- 用量是转录可见的轮次统计，不等同供应商账单：未进入转录的辅助请求、主轮次结束后继续
  产生的后台用量，以及中断时尚未落盘的 usage，无法完整归属。工具内部的图片服务费用
  也不计入 Claude statusLine。工具的最终结果可镜像，图片理解的内部进度没有独立气泡增量。
- `CLAUDE_DISALLOWED_TOOLS` 中的 `RefreshMcpTools` 在交互模式会打印一条
  "matches no known tool" 提示，与 SDK 模式传入的清单一致，仅为噪音。
- 模型 profile 同时设置 `ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN`，TUI 会显示
  一条"both set"提示；行为与 SDK 模式一致。
- 终端 WebSocket 与 `/ws/session` 一样没有额外鉴权层（单用户前提）。
