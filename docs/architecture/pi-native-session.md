# Pi 原生 MCP、Codemode 与共享会话

Pi 固定使用 `@earendil-works/pi-ai` / `pi-coding-agent` 1.2.0。
Web Chat 与 Terminal 共享同一个原生 `AgentSessionRuntime` / `AgentSession`，
由原生 `InteractiveMode` 提供终端。程序化 `AgentHarness.run/launch` 仍使用 SDK；
同一会话的终端与独立 SDK 写入通过现有会话租约互斥。

```text
浏览器                             Runner                       tmux 中的 Pi Host
Chat ── WS /ws/session ──> TerminalChatSessions ── 私有 HTTP ──> AgentSession
  ▲                              ▲                                ▲  │
  └── AgentEvent ─────────────────┴── 私有 JSONL 事件日志 <─────────┘  │
Terminal ── WS /ws/terminal ──> TerminalService ── PTY ──> InteractiveMode
                                                                  │
                                              原生会话 JSONL <─────┘
                                                   │
                              完成/重新连接时的 Chat 历史 <─────────┘
```

## 会话与控制

- 每个会话只启动一个 Host；切换视图和多个浏览器标签只附加查看者。
- Chat 通过类型化命令提交消息、回答问题、取消和停止后台任务，不解析 TUI 画面。
  消息携带稳定 runId；TUI 消息由 Host 分配 runId。
- 原生 `agent_settled` 决定轮次结束。状态文件只用于存活、配置和会话换绑，
  不能把快速完成的回合或暂时空闲误当作新的模型回复。
- Host 的 localhost HTTP 端点使用每次启动生成的 token。配置、状态、事件文件
  位于终端私有目录，配置权限为 0600；token 和模型凭据不进入命令参数。
- Runner 重启后重新认领终端；空闲时跳过旧事件，运行时回放当前回合。
  Pi 状态快照记录事件字节偏移，跳过已结束回合时只跳过快照覆盖的字节；
  快照之后追加的新回合仍会交付。运行中采用流式扫描定位最后的 `run.started`，
  避免大于单次读取上限的旧日志被重新计费。退出状态也不回放已完成回合。
  完成后以原生转录校正历史，避免第二个写入者或双份消息。
- 普通原生确认、选择、输入通过统一交互协调器在两端处理；任一端回答后取消
  另一端等待。自定义原生 UI 保留在终端，并向 Chat 发出“打开终端”提示。
- Chat 的 `/compact`、`/new` 有结构化入口；需要原生选择器的内建命令送到
  终端编辑器并提示用户继续。扩展命令仍由原生扩展处理。
- 模型、effort、context window 可在空闲时更新；连接、凭据、图片/分类配置或
  资源改变时重启同一个空闲终端。存在活动后台任务时禁止这类重启。

## Thinking effort

Profile 聊天连接使用 Responses。按精确模型 ID 从 Pi 内置目录读取 reasoning 与
thinkingLevelMap；多个 provider 的同名模型只有能力一致时才采用。不猜测网关别名，
未知或能力冲突的模型仅提供 `off`，不向其发送未经确认的推理参数。
目录能力通过模型列表的 `pi_effort_levels` 提供给新会话；已启动会话以
原生 `getAvailableThinkingLevels()` 和实际 `thinkingLevel` 为准。

```text
模型目录 -> 新会话菜单
Chat 选择 -> configure -> Pi AgentSession <- TUI 选择
                             |
                       原生实际档位 + 支持列表
                             |
                       session.config -> Chat
```

`deepseek-flash` 显示 `off / low / high / max`。关闭明确发送
`reasoning.effort: "none"`，其余三档原样发送；`max` 不再转成 `xhigh`。
这与 [DeepSeek Responses API](https://api-docs.deepseek.com/api/create-response/)
的原生档位一致。模型切换时沿用 Pi 的档位夹取规则，例如 `medium` 在该模型上
变为 `high`；Chat 回显实际结果。普通 Chat 消息保留 TUI 最新档位，重新打开
会话从 Pi 原生记录恢复档位。用户切换 Profile 引起重启时，恢复完成后再应用
本次明确选择的档位；差异判断依据原生状态。Claude 仍只接受原有五档。

## 原生 MCP 与 Codemode

```text
Pi 原生资源加载器
  ├── MCP extension ── 全局 mcp.json + 已信任项目 .pi/mcp.json
  ├── tool_search ── 搜索后加载工具说明
  └── codemode ── QuickJS 脚本
                  ├── tools.mcp__服务__工具(...)
                  ├── models.generateImages(...)
                  └── models.classify(...)
```

旧 `pi-mcp-adapter` 已移除；原生配置来源、工具调用方式、OAuth 和项目可信规则
见 [Skills / MCP 资源](skills-mcp-migration.md)。旧 adapter 的 `disabled`、
`excludeTools` 等字段会报告重配错误，避免原生忽略字段后意外开启工具。
不自动迁移用户配置，也不导入其它客户端的配置文件。

MCP 详情的“工具调用方式”包含代码调用（codemode）、搜索后调用（deferred）、
直接调用（direct）；单个工具开关通过原生 toolExposure 的 hidden 控制。
两种间接方式可以交叉发现工具；direct 工具也可在代码中组合调用。

## 图片、分类与用量

图片沿用当前 Profile 的 OpenAI Images 兼容连接，支持生成和编辑。
分类可配置协议、模型及连接来源，并提供连接测试；支持
`typesafe-system-one`、`cloudflare-workers-ai-system-one`、`llama-cpp-classify`
和 `openai-decisions`，需要相应的分类端点。
分类连接可引用已有 Profile；删除被引用的 Profile 会返回明确错误。
聊天、图片和分类在 Pi 中使用独立的 provider ID，防止聊天网关凭据被内置
同名 provider 错用。凭据通过 `ModelRuntime.setRuntimeApiKey` 按字面值注入，
每次运行的 models.json 不保存 API key。

Codemode 使用公开 provider/extension API 装饰模型调用，记录独立 invocation ID、
父工具 ID、模型、结果及用量。原生工具结果的 usage 在父回合汇总一次，
模型调用明细用于归因，不能再次叠加收费。未提供价格的网关保留未知费用。
图片保存在工作区 `.images/`；Chat 元数据用文件引用，原生结果保留原始图片内容。

```text
Codemode 卡片
  ├── MCP 子调用：状态 / 结果
  ├── 图片调用：模型 / 图片文件预览
  └── 分类调用：模型 / 结构化分类结果
         │
         └── 原生自定义审计记录 ──> 重新打开会话时恢复
```

Pi 原生嵌套调用摘要有数量和内容长度上限；历史卡片保留完整性标志，
不声称能恢复未持久化的全部子调用结果。计费规则见
[用量数据存储](usage-data-store.md)。

## 验证

从 `services/agent-runner/ts/` 运行 `npm run lint`、`npm run typecheck`、
`TMPDIR=/tmp npm test` 和 `npm run build`。原生集成使用隔离临时 HOME、
本地模型 HTTP fixture 和 MCP fixture，不依赖用户模型凭据：

```sh
TMPDIR=/tmp node --import tsx tests/fixtures/terminal/pi-native-probe.ts
TMPDIR=/tmp node --import tsx tests/fixtures/terminal/pi-native-probe.ts dist/provider/pi/pi-terminal-launch.js
node --import tsx tests/fixtures/resources/pi-mcp-probe.ts dist/provider/pi/pi-resource-loader.js
node --import tsx tests/fixtures/resources/pi-subagent-model-probe.ts dist/provider/pi/pi-resource-loader.js
```

前端验证与已批准布局记录在 [前端规则](../front-end-desgin.md)。
