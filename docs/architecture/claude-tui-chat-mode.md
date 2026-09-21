# Claude Code TUI 作为 UI 聊天驾驭方式

状态：已确认方案，分层实施中（L1 已落地）  
范围：`services/agent-runner/ts` 与 `agent-ui/`  
相关基线：[agent-runner-ts-implementation.md](agent-runner-ts-implementation.md)

## 1. 目标

UI 的输入核心交互是：用户既可以在消息气泡区的 ChatComposer 中输入，也可以在
完全同步的 Claude Code 原生 TUI 镜像（浏览器内嵌终端）中发送消息，并且可以随时
切换。两侧看到的是同一个 Claude Code 进程和同一份转录。

现有 Agent SDK 进程内 `query()` 路径保留，继续服务 HTTP `/run`、scheduler 与
subagent 测试等程序化调用。

```
 用户浏览器（远端）                        后台主机（单机单进程 runner）
 ┌──────────────────────┐   WS /ws/session    ┌──────────────────────────────────────┐
 │ ChatComposer ────────┼────────────────────►│ AgentHarness ── ClaudeTuiRuntime (L2) │
 │ 消息气泡  ◄──────────┼── AgentEvent ───────│        │  paste/Enter    ▲ hooks(HTTP)  │
 │                      │                     │        ▼                │ + jsonl tail │
 │ xterm.js  ◄──────────┼── WS /ws/terminal ──┼──► tmux pane: claude TUI ─────────────│
 │ (TUI mirror)         │   二进制 PTY 帧      │        │                              │
 └──────────────────────┘                     │        ▼ ~/.claude/projects/**.jsonl  │
                                              │   (SDK 模式的 HTTP/scheduler 也写这里) │
                                              └──────────────────────────────────────┘
```

## 2. 已确认的决策

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 轮次生命周期的权威信号 | 服务端 `session.state(running/idle)`；终端发起的轮次由服务端合成 `runId`；`run.start` 退化为"请求注入一条消息" |
| Q2 | 权限模式 | TUI 以 `--permission-mode bypassPermissions` 启动，与 SDK 一致；只镜像 `AskUserQuestion` |
| Q3 | 凭证暴露 | 单用户产品，token 直接注入 pane 环境变量 |
| Q4 | `claude` 可执行文件 | 复用 `@anthropic-ai/claude-agent-sdk` 依赖的原生二进制，两种驾驭方式永远同版本 |
| Q5 | pane 生命周期 | 懒启动；空闲且无查看者时回收；runner 重启后按会话键重新认领 |
| Q6 | SDK 与 TUI 对同一会话 | 会话级 driver 租约，冲突方返回明确错误 |
| Q7 | 用户 SSH 后本地 `tmux attach` | 不在范围，socket 路径为内部实现 |
| Q8 | 多标签尺寸 | 最近一次 resize 的查看者决定窗口大小（`window-size manual` + `resize-window`） |
| Q9 | 租户模型 | 单用户 |
| Q10 | 功能对等 | `promptSuggestions`、`task.stop` 仅 SDK；context usage 走 statusLine；自定义图片/canvas 工具改为 stdio MCP；流式 delta 走 `MessageDisplay` hook；`/model` 注入切模型；fork 用 `--resume --fork-session`；用量从转录汇总 |
| Q11 | 队列仲裁 | 队列由服务端持有，`Stop` hook 到达时先 flush 再置 idle |
| Q12 | 线协议 | 可演进，不保留旧帧兼容 |
| Q13 | 首次启动对话框 | runner 预写 `~/.claude.json`（项目信任、onboarding、bypass 确认、自定义 API key 批准） |
| — | Pi TUI | 留到下一个 MVP |

## 3. 分层

```
L1  终端基础设施（本文档 §4，已落地）
    TerminalService 端口 + tmux 实现 + WS /ws/terminal + Claude TUI 启动描述
L2  ClaudeTuiRuntime 最小闭环
    hooks HTTP 接收；转录 tail → 已有 ClaudeEventMapper；run() = 注入 + 等 Stop
L3  交互能力补齐
    AskUserQuestion 镜像；steer/interrupt；MessageDisplay 流式；/clear 轮转；模型切换
L4  工具与第二 harness
    自定义工具改 stdio MCP；Pi TUI
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
```

依赖方向不变：`core` 只含端口；`harness` 依赖端口；tmux 实现在
`infrastructure`；Claude 启动细节只在 `provider/claude`。

### 4.2 终端键与持久化

终端键为 `${provider}:${sessionId}`，socket 位于
`$RUNTIME_HOME/terminals/<sha256(key)[:24]>/tmux.sock`。路径可由会话引用推导，
runner 重启后 `has-session` 即可认领仍在运行的 pane，不需要映射表。同目录保存
启动文件（Claude 的 `claude-settings.json`，携带凭证，因此不进 argv）。

新会话在启动前就由 `SessionTerminals` 生成 UUID 并通过 `--session-id` 交给
Claude，因此 `SessionRef` 与转录文件名一致，SDK 驾驭方式可以 `resume` 同一会话。

### 4.3 tmux 控制模式

查看者不通过伪终端 attach，而是起一个 `tmux -S <sock> -C attach` 子进程：

- 输出：`%output %<pane> <octal-escaped>` 解码为字节后转发到 WebSocket 二进制帧；
- 输入：浏览器键击以 `send-keys -H <hex...>` 写入，每条命令最多 2048 字节；
- 尺寸：`refresh-client -C WxH` + `resize-window`，`window-size manual`；
- 快照：attach 时先用 `capture-pane -p -e -S -2000` 加光标定位序列生成当前画面，
  快照之前到达的 `%output` 丢弃（已包含在快照中）。

命令回复按 FIFO 匹配，仅匹配 `fromClient` 标志为 1 的 `%begin/%end`；回复体内以
`%` 开头的行（如 pane id `%0`）不当作协议行。

### 4.4 WS 线协议

`GET /api/sandbox/agent/ws/terminal?harness=claude&cwd=…&model=…[&sessionId=…][&effort=…][&cols=…&rows=…]`

| 方向 | 帧 | 内容 |
|---|---|---|
| 服务端 → 客户端 | 文本 | `{type:'ready', harness, sessionId, adopted, cols, rows}` |
| 服务端 → 客户端 | 二进制 | 终端输出（先快照，再实时） |
| 服务端 → 客户端 | 文本 | `{type:'exit', reason}`、`{type:'error', kind, message}` |
| 客户端 → 服务端 | 二进制 | 键击 |
| 客户端 → 服务端 | 文本 | `{type:'resize', cols, rows}` |

未带 `sessionId` 时创建新会话终端并在 `ready` 中返回 id；带 `sessionId` 时
`--resume`。同一会话第二个查看者收到 `adopted: true`，不会重复启动。

### 4.5 Claude TUI 启动

`ClaudeProvider.terminalLaunch` 与 `resolveClaudeQueryOptions` 保持同一套配置来源：

- 二进制：`@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`；
- 参数：`--session-id|--resume`、`--model`、`--permission-mode bypassPermissions`、
  `--settings <scratch>/claude-settings.json`（`resolveClaudeQuerySettings` +
  `skipDangerousModePermissionPrompt`）、`--disallowedTools`、`--effort`；
- 环境：`resolveClaudeQueryEnv` + `DISABLE_AUTOUPDATER=1`；
- 预置 `~/.claude.json`：`hasCompletedOnboarding`、`bypassPermissionsModeAccepted`、
  `projects[cwd].hasTrustDialogAccepted`、`customApiKeyResponses.approved`
  （API key 末 20 位指纹）。

### 4.6 回收

`TmuxTerminalService.sweepIdle` 每分钟扫描：无 attach 客户端且
`window_activity` 距今超过 30 分钟的终端 `kill-server` 并删除目录；已死的目录
直接清理。

### 4.7 验证

在 `services/agent-runner/ts` 运行 `npm test`；tmux 缺失时以下用例自动跳过：

- `tests/integration/infrastructure/terminal/tmux-terminal-service.test.ts`
- `tests/integration/transport/websocket/terminal-route.test.ts`

纯协议编解码与 Claude 启动描述的单测不依赖 tmux。

## 5. 已知限制（L1）

- 自定义图片 / canvas 工具在 TUI 会话中不可用，等 L4 的 stdio MCP。
- `fork` 目标在终端驾驭方式下尚未支持。
- `CLAUDE_DISALLOWED_TOOLS` 中的 `RefreshMcpTools` 在交互模式会打印一条
  "matches no known tool" 提示，与 SDK 模式传入的清单一致，仅为噪音。
- 模型 profile 同时设置 `ANTHROPIC_API_KEY` 与 `ANTHROPIC_AUTH_TOKEN`，TUI 会显示
  一条"both set"提示；行为与 SDK 模式一致。
- 终端 WebSocket 与 `/ws/session` 一样没有额外鉴权层（单用户前提）。
