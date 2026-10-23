# Agent API v1：第三方会话、消息与事件接口

状态：设计已确认；Part A 的 A1–A4、A4.5 已在 agent-runner 实现，A5–A7 未实现（§12.1）。日期：2026-10-23。
完整输入输出示例见 [Agent API v1 示例](../api/agent-api-v1-examples.md)。同一组示例的可筛选画布见 [agent-runner-api-io-examples.canvas.tsx](../api/agent-runner-api-io-examples.canvas.tsx)（Cursor Canvas）。

本文定义 Agent Runner 面向第三方客户端的 HTTP / SSE / WebSocket 接口。它服务两个场景：

- **自用（Part A）**：用户通过自己的 API key，从第三方客户端调用自己 Sandbox 中的 Agent。
  在本仓库的 `services/agent-runner/ts` 中实现。
- **发布调用（Part B）**：用户在隔离目录中构建好 Agent 并发布，其他用户通过 API 调用。
  在 agent-workshop 的 agent-studio 子系统中实现，复用本仓库 Agent API 模块的代码；
  访问控制、权限与文件系统隔离不放在 agent-runner。

两个场景共用同一套契约（路径后缀、对象、事件、错误）和同一套实现模块，差别只在部署位置、
鉴权方式和策略（Policy）。

调用方都是程序，按拿结果的方式分三类，同一个发送接口用 `response` 字段区分（§6.6）：

| 调用方 | 典型形态 | 拿结果的方式 |
| --- | --- | --- |
| 交互式客户端 | 自建聊天前端或 App、IM 机器人 | `response = stream`，流式渲染过程；`allow_interrupt = true`，由人回答提问 |
| 无人值守的程序 | 脚本与自动化（CI、定时任务、批处理）、其他 Agent 或编排系统 | `response = wait` 或 `accepted` + 轮询；读 `run.output_text` |
| 平台外 Agent 的 skill | Cursor、Claude Code、Codex 等本地工具中的 skill，经网关与 API key 调用 | 同无人值守；只把 `output_text` 交给调用方 Agent，避免事件流占满它的上下文 |

对外 API 是 WebUI / TUI 的**超集**：它使用程序化的 SDK 驱动，能提供比 WebUI 更细的事件和更完整的控制。
与 WebUI / TUI 之间只要求**可回放**：API 产生的会话写入同一份原生转录和会话元数据，
可以在 WebUI 和原生 TUI 中打开、回放并继续，但不复制 WebUI / TUI 的交互行为（§10）。

## 0. 阅读指引

| 读者 | 必读章节 |
| --- | --- |
| 在 agent-runner 实现自用 API | 全文；实施步骤见 §12.1 |
| 在 agent-studio 实现发布调用 | §1–§10、§12.2、§13，以及示例文档 |
| 只需要了解对外契约的客户端开发者 | §4–§9 与示例文档 |

## 1. 范围

```text
场景 A：自用                                       场景 B：发布调用
第三方客户端（用户自己的 API key）                  第三方客户端（发布者签发的 API key）
   |  /api/agent/v1/sandbox/...                       |  /api/agent/v1/published/{agt}/...
   v                                                  v
AgentGateway -> Runtime Access（鉴权、选址）         AgentGateway -> agent-studio（鉴权、会话令牌、配额）
   |                                                  |
用户 Sandbox Pod                                   隔离的发布执行环境（发布目录快照的会话副本）
  agent-runner                                       agent-runner 同一套代码
   ├─ Agent API 模块（PrivatePolicy）                  ├─ Agent API 模块（ReleasePolicy）
   └─ SDK 驱动：Claude Agent SDK / Pi SDK              └─ SDK 驱动：Claude Agent SDK / Pi SDK
        |                                                   （不需要 tmux）
   原生转录 + 会话元数据 <── WebUI / TUI 打开时回放并继续
```

范围内：

- 会话创建、查询、修改、删除或关闭；会话内文件上传。
- 发送消息（立即返回 202、等待结果最多 60 秒，或在同一请求内以 SSE 流式返回），以及运行中再次发送时的投递方式。
- 查询单个 run，可以等待它结束；无人值守时自动拒绝 Agent 的提问与审批（`allow_interrupt`）。
- 会话事件流（SSE、WebSocket）、断线续传、会话快照和历史读取。
- 回答 Agent 的提问、审批与 MCP 授权请求；取消运行；停止后台任务。

不在范围内：

- WebUI 不迁移，继续使用 `/api/sandbox/agent/ws/session` 的 v2 协议，由 TUI 驱动。
- 不遵循 A2A；`docs/design/harness-stream` 的 v3 协议草案不再推进。
- 不提供 fork、资源编辑、文件浏览、终端字节流、OpenAI 兼容接口。
- 不提供文件下载。场景 A 的调用方用 Sandbox 现有的 `/api/sandbox/files` 接口（`list`、`download` 等）
  取回 Agent 生成的文件；场景 B 的文件取回由 agent-studio 实现（§12.2）。
- 场景 A 没有"具名 Agent"：调用方在整个 Sandbox 中自选目录、harness、模型创建会话。
  把目录与配置保存为可调用的 Agent，与场景 B 的发布单元一起设计（§12.2）。
- API key、会话令牌的签发与校验不在 agent-runner 实现：场景 A 由 agent-workshop 的
  Runtime Access 完成，场景 B 由 agent-studio 完成。

## 2. 决策记录

| # | 决策 | 结论 | 主要理由 |
| --- | --- | --- | --- |
| D1 | 受众 | 只面向第三方客户端；WebUI 不使用本接口 | WebUI 依赖终端视图、可视化、输入建议等内部能力，迁移没有收益 |
| D2 | 标准 | 不遵循 A2A；不再推进 harness-stream v3 | A2A 已放弃；v3 的路径补丁和每帧内嵌原生记录不可读 |
| D3 | 路径 | `/api/agent/v1/sandbox/…` 与 `/api/agent/v1/published/{agt}/…`，两者子路径完全一致 | 沿用 AgentGateway 的 `/api/agent/*` 运行时入口；带版本号，与 WebUI 不带版本的内部路由区分；同一 SDK 只需切换 base 和凭证 |
| D4 | 场景 B 承载 | agent-studio 提供 API；Gateway 把 `/api/agent/v1/published/*` 路由到 agent-studio | 访问控制、权限隔离、文件系统隔离属于 agent-workshop |
| D5 | 发布单元 | 整个隔离目录（CLAUDE.md / AGENTS.md、skills、MCP 配置、资料）作为快照发布 | 发布者在目录中调好的效果就是发布后的效果 |
| D6 | 会话标识 | 平台签发 `ses_` ID，内部映射到 harness 与原生会话 ID；接口不需要 `?harness` | 原生 ID 可能变化，对外 ID 必须稳定 |
| D7 | 驱动 | 对外 API 使用程序化 SDK 驱动（`AgentHarness.launch` / `AgentRuntime`），是 WebUI / TUI 的超集 | SDK 提供逐 token 增量、按 ID 停止任务、结构化审批与 MCP 授权、准确用量；发布执行环境不需要 tmux |
| D8 | 与 WebUI / TUI 的关系 | 只保证可回放：同一原生转录与会话元数据，WebUI / TUI 可以打开、回放并继续 | 不复制 WebUI / TUI 的交互行为与限制 |
| D9 | 单写者 | 同一会话同一时刻只有一种驱动写入；API 不接管仍由 TUI 持有的会话（409）；WebUI 可在 API 会话空闲且无后台任务时接管 | 沿用现有会话驱动互斥 |
| D10 | 输入 | `parts` 数组；V1 只支持 `text`、`image`、`file` | 保留数组形式便于以后扩展，V1 不做复杂输入 |
| D11 | 图片与文件来源 | image：`image_url`（data URL）或 `image_path`；file：`file_path` 或 `file_data` + `filename` | 第三方可以内联发送，也可以引用会话工作目录中的文件 |
| D12 | 输入编码 | 复用后端已有的 `UserTurn`（`<priva-attachments>` 清单 + `imagePaths`） | 后端已有编码与历史解析，WebUI 能正确回放 API 发送的附件 |
| D13 | 返回方式 | 同一个 `POST …/messages`，用请求体的 `response` 字段三选一：`accepted` 返回 202；`wait` 最多等 60 秒后返回结束或暂停的 run，超时退回 202；`stream`（默认）返回本次 run 的 SSE | 聊天客户端、脚本与外部 Agent 的 skill 都能直接使用；60 秒低于常见代理的默认超时 |
| D14 | 运行中发送 | `delivery`：`follow-up` / `steer` / `interrupt`，两个场景一致；省略时取 agent profile 的 `queueBehavior` | 与 WebUI 的投递语义一致 |
| D15 | WebSocket | 给第三方客户端用；每个会话一条连接；子协议 `agent-workshop.v1`；命令帧等于 HTTP 请求体加 `type`、`request_id`；每条命令都有 `reply` | 双向通道，同时与 HTTP 保持一一对应 |
| D16 | 对象模型 | Session → Thread → Run（input + items）；Task；Interaction | 参照 OpenAI Responses / Codex app-server / Anthropic Managed Agents 收敛出的对象模型 |
| D17 | 事件模型 | 持久事件携带一个完整对象并带 `seq`；增量（`item.delta`）只出现在叶子上，临时、不持久化 | 只应用持久事件即可得到与 GET 一致的状态；增量丢失不影响最终结果 |
| D18 | 命名 | 用 `run` 而不是 `turn`；事件类型 `{domain}.{action}`；字段 snake_case；时间 RFC 3339；ID 带类型前缀 | 沿用现有术语，可读、可辨识 |
| D19 | 默认订阅 | 增量默认下发；所有线程（含子 Agent）默认内联在主流；原生事件默认关闭，可按连接开启，仅实时 | 第三方聊天客户端开箱即用；原生事件只用于排查 |
| D20 | 历史 | `GET …/sessions/{ses}/runs`，每个 run 含 `input` 与 `items` | 历史与事件携带同构对象 |
| D21 | 错误 | HTTP 与 WS `reply` 使用同一个 `error` 结构：`type`、`code`、`message`、`param`、`request_id` | 一套错误处理代码 |
| D22 | 无人值守 | 发送消息时用 `allow_interrupt` 声明是否允许 run 为等人回答而暂停；默认 `false`：提问、审批、授权自动拒绝并告诉 Agent 没有人可以回答，run 继续到完成；`true` 时暂停并把问题返回给调用方，10 分钟未回答按超时拒绝。子 Agent 线程跟随父 run，后台任务结果触发的 run 一律按 `false` | 多数调用方是程序，没有人能回答；聊天客户端与 IM 机器人显式开启 |
| D23 | 最终回复 | 结束的 run 带 `output_text`：该 run 最后一条 assistant 消息的文本 | 调用方不必解析 items 就能拿到结论 |
| D24 | 运行模式 | 创建会话时可选 `run_mode`（`agent` / `code`，默认 `agent`），创建后不可变；只对 Claude 生效，Pi 会话忽略 | 运行模式属于 Agent 配置，与 WebUI 首条消息后锁定一致 |

讨论过但未采用的方案：

| 方案 | 未采用原因 |
| --- | --- |
| A2A 1.0 兼容（`message:send`、`contextId`、Task / Artifact） | 已放弃 A2A |
| v3：每帧携带原生记录 + 显示树路径补丁（`splice` / `set`） | 人类不可读；客户端与显示树布局耦合 |
| 直接对外暴露 v2 帧 | 约 50 种扁平事件，事件形状与快照模型不一致 |
| 对外 API 复用 WebUI 的 TUI 驱动 | 增量只能按行、思考与工具参数没有增量、Claude 不能按 ID 停止任务、URL 授权只能在终端处理、费用常常未知；发布执行环境还要运行 tmux |
| 按 run 分离的事件流 | 后台任务、排队消息、子 Agent 都跨越单个 run |
| 增量默认关闭（Anthropic 的做法） | 第三方聊天客户端需要开箱即用的流式文本 |
| 主流只发子线程生命周期 | 选择与 WebUI 实时展示一致的内联方式 |
| 原生事件持久化并占用 `seq` | 存储与重连成本高，收益只在排查场景 |
| 由前端或客户端编码引用、批注等富输入 | V1 只支持 text / image / file |
| `stream` 布尔值 + 调用方指定的 `wait_seconds` | 三种返回方式用一个枚举表达更清楚；等待上限由服务端统一决定 |
| 交互策略作为会话级设置 | 是否有人在等待回答取决于每次调用的调用方 |
| webhook 回调 | 现有调用方用等待、轮询或事件流即可 |

## 3. 架构与代码复用

### 3.1 运行链路

```text
WebUI ── WS /api/sandbox/agent/ws/session（v2，不变）── TerminalChatSessions ── tmux（Claude TUI / Pi Host）
                                                                 |                        |
                                                                 v                        v
第三方 ── HTTP / SSE / WS /api/agent/v1/... ── Agent API 模块   SessionStream      原生转录 + 会话元数据
                                               │                   ^   ^                 ^
                                               ├─ MessageService ──┼───┼─> AgentHarness.launch / abortLive /
                                               │                   │   │   stopTask / respondPermission
                                               │                   │   │        └─ WarmRuntimePool ─ SDK runtime ─┘
                                               ├─ ObjectProjector ─┘   └── SDK 帧发布到同一个 SessionStream
                                               ├─ SessionRegistry      ses_ ↔ 原生会话、run 索引、设置
                                               └─ EventLog             持久事件与 seq
```

- 发送消息走 SDK 驱动：`AgentHarness.launch` 打开或复用 `WarmRuntimePool` 中的运行时（Claude Agent SDK
  `query()` / Pi `AgentSession`），帧发布到会话的 `SessionStream`。
- ObjectProjector 读取 `SessionStream` 的状态并投影为对外对象和事件。它与驱动无关：
  即使会话当前由 WebUI 的 TUI 驱动，API 也能只读订阅它的事件。
- 两种驱动写入同一份原生转录（Claude：`$CLAUDE_CONFIG_DIR/projects/**.jsonl`；Pi：原生会话 JSONL）
  和同一套会话元数据（运行模式、模型、后台任务状态），这是可回放的基础（§10）。

### 3.2 模块与端口

建议的代码位置（均相对 `services/agent-runner/ts/src/`）：

```text
core/agent-api/                       契约与纯函数（无 IO）
  objects.ts / input.ts / events.ts   对象、请求体、事件的 zod schema 与类型
  responses.ts / errors.ts            响应体、错误外壳与错误码
  ids.ts / tool-kind.ts               平台 ID（签发与确定性派生）、工具类别映射
  thread-projection.ts                SessionStream 状态 → 对象图（run / item / task / interaction）
  graph-diff.ts                       两个对象图之间的持久事件（§8.5 顺序）与会话状态
  run-lineage.ts                      子线程 run → 启动它的主线程 run；某个 run 待回答的交互
  json-schema.ts                      生成 docs/api/agent-api-v1.schema.json
core/contract/agent-api-*.ts          端口：session-registry、event-store（事件日志 + 投影状态）、workspace
harness/agent-api/
  agent-api-service.ts                门面：会话、文件、发送消息、快照、历史、订阅；不依赖 HTTP / WS
  message-input.ts                    parts → UserTurn 与回显的 content
  session-projector.ts                每个会话一个：订阅 SessionStream，产生持久事件与增量
  event-subscription.ts               续传：补发 → resync → 实时；response=stream 的 run 范围过滤
  run-wait.ts                         response=wait 与 GET run 的等待：结束、待回答的交互或超时
  unattended-interactions.ts          allow_interrupt=false：自动拒绝无人回答的交互
infrastructure/agent-api/             场景 A 的适配器：JSON 会话注册表、JSONL 事件日志、工作目录文件
transport/agent-api/                  Fastify 插件：HTTP 路由、SSE 编码；挂载前缀可配置
```

依赖方向与现有代码一致：`core` 只含类型、端口和纯函数；`harness` 依赖端口；文件和存储实现在
`infrastructure`；`transport` 只做协议转换。`buildRunSpec` 位于 `harness/config/run-spec.ts`，
WebUI 入口与 Agent API 共用。投递队列（A5）将加入 `harness/agent-api`。

场景 B 复用的边界：

| 部分 | 场景 A（agent-runner） | 场景 B（agent-studio） |
| --- | --- | --- |
| 契约 `core/agent-api` | 使用 | 原样复用 |
| `harness/agent-api`（服务、投影、投递） | 使用 | 原样复用，运行在隔离执行环境内 |
| `AgentHarness` + provider 的 SDK 驱动 | 使用 | 原样复用；不启用 TerminalChatSessions |
| `transport/agent-api`（HTTP / SSE / WS） | 挂载在 `/api/agent/v1/sandbox` | 挂载在 `/api/agent/v1/published/{agt}`，或由 agent-studio 代理到执行环境 |
| AgentApiPolicy | PrivatePolicy | ReleasePolicy（§12.2） |
| 鉴权 / 主体 | 由 Runtime Access 完成，runner 只信任网关转发 | agent-studio：API key → 会话令牌 |
| SessionRegistry / EventLog | 本地 JSON / JSONL | agent-studio 的持久存储 |
| WorkspaceFiles | 用户 Sandbox 工作区 | 发布目录快照的会话副本 |

## 4. 资源模型

```text
Session  ses_…    status: idle | running | requires_action；settings；active_tasks
 ├─ Thread thr_…  执行上下文：主线程，以及子 Agent / Workflow Agent 的线程
 │                不单独发事件；作为 run 与 item 的作用域（thread_id），主线程省略
 │   └─ Run run_…  一次"输入 → Agent 工作 → 停下"
 │        ├─ input   user_message | task_result | agent_task | inbox_message
 │        └─ items[] message | reasoning | tool_call | subagent | compaction | context_reset
 ├─ Task  task_…  后台工作：shell | agent | workflow | monitor | other
 │                生命周期独立于 run；结果回送给模型时触发一个新 run
 └─ Interaction int_…  approval | question | open_url；挂起时会话进入 requires_action
```

### 4.1 ID 规则

| 前缀 | 对象 | 来源 |
| --- | --- | --- |
| `ses_` | Session | API 创建的由平台生成，注册表映射到原生会话；WebUI 创建、API 尚未写入的会话由原生会话 ID 派生 |
| `run_` | Run | API 发起的 run 由 API 生成并作为 harness runId 传入；其他 run 由原生 runId 派生 |
| `msg_` | 用户消息 | API 发起的由 API 生成；其他由原生转录 UUID 派生 |
| `itm_` | Item | 由原生消息 ID、block ID 或工具调用 ID 派生 |
| `thr_` | Thread | 由子 Agent 的 `parentToolUseId` / `agentId`、Workflow Agent ID 派生 |
| `task_` | Task | 由原生 taskId 派生 |
| `int_` | Interaction | 由 harness 的 `requestId` 派生 |
| `file_` / `chg_` / `req_` | 上传、设置变更、请求 | 平台生成 |

派生必须是确定性的：同一个原生对象，在实时事件和历史读取中得到同一个平台 ID。
ID 是不透明字符串，客户端不得解析。

### 4.2 Session

```json
{
  "id": "ses_01JDX4",
  "harness": "claude",
  "workdir": "projects/shop-web",
  "run_mode": "agent",
  "title": "结账页报错排查",
  "settings": { "model": "default:claude-sonnet-4-5", "effort": "high", "context_window": 200000 },
  "status": { "state": "idle", "active_tasks": 0 },
  "last_event_seq": 37,
  "created_at": "2026-10-22T00:20:00.000Z",
  "updated_at": "2026-10-22T00:21:20.010Z"
}
```

| 字段 | 说明 |
| --- | --- |
| `harness` | `claude` 或 `pi`，创建后不可变 |
| `workdir` | 相对 Sandbox 工作区的目录，创建后不可变；场景 B 不返回 |
| `run_mode` | 仅 Claude：`agent` / `code`，创建后不可变（D24）；Pi 会话不返回 |
| `settings.model` | `profileId:modelId`，与 WebUI 的模型引用格式相同 |
| `settings.effort` | Claude：`low` / `medium` / `high` / `xhigh` / `max`；Pi：按模型支持的档位 |
| `settings.context_window` | `200000` 或 `1000000` |
| `status.state` | `idle` / `running` / `requires_action` |
| `status.stop_reason` | 进入 `idle` 时的原因，取值同 run 的 `stop_reason` |
| `status.interaction_ids` | `requires_action` 时待处理的交互（含子线程） |
| `status.active_tasks` | 仍在运行的后台任务数 |
| `driver` | 当前写入驱动：`sdk`（API）/ `terminal`（WebUI 或 TUI）/ `none`；见 §10.3 |
| `agent` | 场景 B：`{ id, name, release }` |

`GET /sessions/{ses}` 另外返回 `active_run`、`queued_runs`、`interactions`（待处理）和
`tasks`（全部已知任务），见示例文档的"会话快照与历史"。

### 4.3 Run

```json
{
  "id": "run_7Ka2",
  "thread_id": "thr_2",
  "status": "completed",
  "model": "claude-sonnet-4-5",
  "input": { "type": "user_message", "message_id": "msg_3fA", "source": "api", "content": [] },
  "stop_reason": "end_turn",
  "output_text": "问题出在 CartTotal：未使用优惠券时 coupon 为 null，读取 amount 抛错。\n已改为空值默认 0，购物车测试 24/24 通过；e2e 已在后台运行。",
  "usage": { "input_tokens": 52310, "output_tokens": 4120, "cache_read_tokens": 38000, "cache_write_tokens": 0, "cost_usd": 0.21 },
  "context": { "used_tokens": 41200, "limit_tokens": 200000 },
  "duration_ms": 48210,
  "created_at": "…", "started_at": "…", "completed_at": "…"
}
```

| 字段 | 说明 |
| --- | --- |
| `thread_id` | 子线程的 run 才有；主线程省略 |
| `status` | `queued` → `in_progress` → `completed` / `failed` / `cancelled` / `interrupted` |
| `position` | 仅 `queued`：在队列中的位置，从 1 开始 |
| `input` | 见下表；后台结果触发的 run 在输入解析完成前可能为 `null`，随后由 `run.updated` 补齐 |
| `stop_reason` | `end_turn` / `cancelled` / `interrupted` / `error` / `max_turns` / `budget_exceeded` |
| `output_text` | run 结束后才有：该 run 最后一条 assistant 消息的文本（D23）；没有文字回复时省略 |
| `interrupted_by` | `status = interrupted` 时：`{ message_id }`，指向打断它的消息 |
| `error` | `status = failed` 时：`{ code, message }` |
| `usage` | 本次 run 的用量；`cost_usd` 未知时省略，不填 0 |

`input` 的四种类型：

| `input.type` | 字段 | 触发方式 |
| --- | --- | --- |
| `user_message` | `message_id`、`source`（`api` / `web` / `terminal`）、`content`（服务端确认后的 parts） | 用户发送的消息；API 订阅 WebUI 驱动的会话时也会看到 `web` / `terminal` |
| `task_result` | `task_id`、`status`、`summary`、可选 `event`（Monitor） | 后台任务结果回送给模型 |
| `agent_task` | `item_id`（父线程的 subagent item）、`prompt` | 父 Agent 下发给子 Agent 的任务 |
| `inbox_message` | `from: { kind: coordinator \| peer, thread_id?, name? }`、`content` | 正在运行的 Agent 收到其他 Agent 的消息 |

### 4.4 Item

所有 item 都有 `id`、`type`、`status`，可选 `created_at` / `completed_at`。

| `type` | 字段 | `status` |
| --- | --- | --- |
| `message` | `content`：text / image / file 块 | `in_progress` / `completed` |
| `reasoning` | `text`（可被策略省略）、`duration_ms` | `in_progress` / `completed` |
| `tool_call` | `tool: { name, kind, server? }`、`input`、`output: { content, is_error }`、`task_id`、`model_calls`、`duration_ms` | `pending` → `running` → `completed` / `failed` / `declined` / `cancelled` |
| `subagent` | `agent: { name, description? }`、`thread_id`、`mode`（`foreground` / `background`）、`input: { prompt }`、`output`、`task_id`、`usage`、`duration_ms` | `running` / `completed` / `failed` / `cancelled` |
| `compaction` | `trigger`（`auto` / `manual`）、`summary`、`context: { tokens_before, tokens_after }` | `in_progress` / `completed` / `failed` / `cancelled` |
| `context_reset` | `reason: "clear"` | `completed` |

`tool_call` 的 `pending` 表示参数仍在生成，或正在等待审批。

`tool.kind` 是给客户端选择渲染方式的归一化类别，`tool.name` 保留原生工具名：

| `kind` | Claude 原生工具 | Pi 原生工具 |
| --- | --- | --- |
| `command` | Bash、BashOutput、KillShell | bash |
| `file_read` | Read、NotebookRead | read、ls |
| `file_edit` | Edit、MultiEdit、Write、NotebookEdit | edit、write |
| `search` | Grep、Glob | grep、find |
| `web` | WebFetch、WebSearch | 对应的 web 工具 |
| `mcp` | `mcp__<server>__<tool>`（`server` 字段给出服务名） | MCP 扩展工具 |
| `question` | AskUserQuestion | ask_user_question |
| `image` | 产品工具 image_gen / image_read / image_edit | codemode 的图片调用 |
| `visualize` | 产品工具 visualize 系列 | 对应工具 |
| `workflow` | Workflow | 对应的 workflow 工具 |
| `other` | 其余 | 其余 |

Agent / Task 类工具不生成 `tool_call`，而是生成 `subagent` item。
映射表维护在 `core/agent-api` 中，未识别的工具一律为 `other`。

### 4.5 内容块

`message.content`、`tool_call.output.content`、`run.input.content` 使用同一组内容块：

| `type` | 字段 |
| --- | --- |
| `text` | `text` |
| `image` | `image_path` 或 `image_url`、`media_type`、可选 `alt` |
| `file` | `file_path`、`name`、`media_type`、`size` |
| `json` | `value`（工具的结构化结果） |

服务端输出中的路径一律相对会话工作目录。

### 4.6 Task

```json
{
  "id": "task_9",
  "kind": "shell",
  "status": "completed",
  "description": "运行 e2e 测试",
  "origin": { "run_id": "run_7Ka2", "item_id": "itm_07" },
  "result": { "summary": "e2e 全部通过（42/42）" },
  "stop_requested": false,
  "started_at": "…", "completed_at": "…", "duration_ms": 182000
}
```

| 字段 | 说明 |
| --- | --- |
| `kind` | `shell` / `agent` / `workflow` / `monitor` / `other`（对应现有 BackgroundTask 的 bash / agent / workflow / monitor / other） |
| `status` | `pending` / `running` / `paused` / `completed` / `failed` / `cancelled` / `unknown` |
| `thread_id` | `kind = agent` 时指向该 Agent 的线程 |
| `workflow` | `kind = workflow`：`{ name, phases: [{ index, title }], agents: [{ label, phase_index, thread_id, status, last_tool, tokens, duration_ms }] }` |
| `last_event` | `kind = monitor`：`{ text, created_at }` |
| `result` | 结束时：`{ summary, output_path? }`；`output_path` 只在输出文件位于会话工作目录内时出现 |

`unknown` 表示原生运行时不再报告该任务、又没有收到终态证据（与现有 BackgroundTasks 语义相同）。

### 4.7 Interaction

```json
{
  "id": "int_6",
  "type": "question",
  "run_id": "run_7Ka2",
  "thread_id": "thr_2",
  "item_id": "itm_05",
  "title": "…",
  "reason": "…",
  "questions": [{
    "id": "q0", "question": "这次修复的范围？", "header": null,
    "options": [{ "label": "只修复问题", "description": null }],
    "multi_select": false, "allow_custom": true, "multiline": false, "initial_text": null
  }],
  "expires_at": "2026-10-22T00:30:41.000Z",
  "status": "resolved",
  "resolution": { "decision": "allow", "reason": "answered", "answers": { "q0": { "selected": ["只修复问题"], "text": "" } } }
}
```

| 字段 | 说明 |
| --- | --- |
| `type` | `approval`：工具审批；`question`：提问，包括 MCP 表单（`onElicitation` 的 form 模式）；`open_url`：MCP 要求用户在浏览器中完成授权（`onElicitation` 的 url 模式） |
| `item_id` | 关联的 tool_call；Pi 扩展的独立确认、MCP 授权可能没有 |
| `tool`、`input` | `approval` 时：被审批的工具及其原始参数 |
| `questions` | `question` 时：与现有 InteractionQuestion 相同的结构 |
| `url`、`server` | `open_url` 时：要打开的地址与 MCP 服务名 |
| `status` | `pending` / `resolved` |
| `resolution` | `{ decision: allow \| deny, reason: answered \| skipped \| timeout \| cancelled \| unattended, answers? }`；`unattended` 表示按 `allow_interrupt = false` 自动拒绝（§6.6） |

`open_url` 的回答：用户在浏览器中完成授权后回答 `allow`，放弃则回答 `deny`。
Pi 扩展的自定义终端 UI（`ui.custom`）无法表示为交互，按 Pi SDK 的现有行为向扩展返回错误。

## 5. 输入

### 5.1 UserMessage

```json
{
  "parts": [
    { "type": "text", "text": "结账页报错了，帮我查一下并修复" },
    { "type": "image", "image_url": "data:image/png;base64,iVBORw0KGgo…" },
    { "type": "image", "image_path": "screenshots/checkout.png" },
    { "type": "file", "file_path": ".priva-attachments/file-8f2c/checkout-error.log" },
    { "type": "file", "file_data": "data:application/pdf;base64,JVBERi0…", "filename": "支付流程.pdf" }
  ]
}
```

规则：

- 至少一个 part；所有 text 都为空时，至少要有一个 image 或 file。
- `image` 的 `image_url` 与 `image_path` 二选一；`file` 的 `file_path` 与 `file_data` 二选一，
  `file_data` 必须同时给出 `filename`。
- `image_url` 只接受 `data:` URL；V1 不下载远程地址。
- 路径必须相对会话工作目录；绝对路径、`..` 越界、指向工作目录外的符号链接返回 422
  `path_outside_workspace`。
- 内联的 base64 内容由服务端写入 `<workdir>/.priva-attachments/file-<unique>/<name>`，
  与 WebUI 上传附件的约定相同；`run.started` 的 `input.content` 以路径回显。
- 当前模型不支持图片输入时返回 422 `image_input_unsupported`，不静默降级为文件。
- 未知的 part 类型或字段返回 422。

### 5.2 映射到 UserTurn

```text
parts[]                                   UserTurn（core/run/user-turn.ts）     进入 SDK
text  ── 按顺序以空行拼接 ─────────────>  text                          ──>  提示文本
file  ── 解析为工作目录内的文件 ────────>  attachments                   ──>  <priva-attachments> 清单
image ── 解析为工作目录内的文件 ────────>  imagePaths                    ──>  Claude：SDK 用户消息中的图片块
                                                                              Pi：piImageContents（已有）
```

V1 的顺序语义：图片在前，文本居中，文件清单在后（`userTurnText` 的现有行为）。
数组形式为以后支持真正的交错顺序或新的 part 类型保留。

Claude SDK 驱动目前只发送文本（`claudeUserMessage`），需要补上 `imagePaths` → base64 图片块的转换（§12.1）。
原生转录中的 base64 图片块已能被 WebUI 历史提取为附件，因此回放不受影响。

场景 B 额外要求：文本开头的 `/命令` 与文本中的 `@路径` 不得被原生解析为命令或文件引用（§12.2）。

## 6. HTTP 接口

### 6.1 基础约定

- base：场景 A 为 `/api/agent/v1/sandbox`，场景 B 为 `/api/agent/v1/published/{agt}`。下文用 `{base}` 表示。
- 请求与响应为 `application/json`（上传为 `multipart/form-data`，事件流为 `text/event-stream`）。
- 每个响应带 `Request-Id` 头，错误体中的 `request_id` 与之相同。
- 未知字段返回 422。
- 鉴权头由部署决定（§12）；agent-runner 自身不校验 API key。

### 6.2 路由

| 方法 | 路径 | 说明 | 场景 B |
| --- | --- | --- | --- |
| GET | `{base}` | 能力描述：可用 harness 与模型、是否支持图片、文件限额、功能开关 | 返回 Agent 描述 |
| POST | `{base}/sessions` | 创建会话，可带首条消息 | 请求体只允许 `message` |
| GET | `{base}/sessions` | 列出会话（含 WebUI 创建的会话） | 不提供 |
| GET | `{base}/sessions/{ses}` | 会话快照 | 提供 |
| PATCH | `{base}/sessions/{ses}` | 修改标题、设置 | 不提供 |
| DELETE | `{base}/sessions/{ses}` | 删除会话，成功返回 204 | 关闭会话 |
| POST | `{base}/sessions/{ses}/files` | 上传一个文件 | 提供 |
| POST | `{base}/sessions/{ses}/messages` | 发送消息 | 提供 |
| GET | `{base}/sessions/{ses}/runs` | 历史：run 及其 items | 提供 |
| GET | `{base}/sessions/{ses}/runs/{run}` | 单个 run 与它待回答的交互；`?wait=true` 时等待它结束或暂停 | 提供 |
| GET | `{base}/sessions/{ses}/events` | SSE 事件流 | 提供 |
| GET | `{base}/sessions/{ses}/ws` | WebSocket | 提供 |
| POST | `{base}/sessions/{ses}/runs/{run}/cancel` | 取消排队中或运行中的 run | 提供 |
| POST | `{base}/sessions/{ses}/interactions/{int}` | 回答提问、审批或授权请求 | 提供 |
| POST | `{base}/sessions/{ses}/tasks/{task}/stop` | 停止后台任务 | 提供 |

能力描述（场景 A）列出 harness、默认模型、各 profile 支持图片输入的模型、限额，以及当前版本已提供的功能；
`features.deliveries` 是会话忙碌时可用的投递方式，A5 之前为空（会话忙碌时发送返回 409 `session_busy`）：

```json
{
  "api_version": "v1",
  "harnesses": ["claude", "pi"],
  "defaults": { "harness": "claude", "model": "default:claude-sonnet-4-5" },
  "profiles": [{ "id": "default", "label": "Default", "default_model": "claude-sonnet-4-5", "image_input_models": ["claude-sonnet-4-5"] }],
  "limits": { "max_upload_bytes": 104857600, "max_inline_bytes": 20971520, "max_queued_runs": 3, "max_wait_seconds": 60 },
  "features": { "websocket": false, "native_events": false, "interactions": false, "task_stop": false, "settings_update": false, "deliveries": [] }
}
```

### 6.3 创建会话

```text
POST {base}/sessions
{ "harness": "claude", "workdir": "projects/shop-web", "run_mode": "agent",
  "settings": { "model": "default:claude-sonnet-4-5", "effort": "high" },
  "message": { "parts": [ … ] }, "delivery": "follow-up", "response": "wait", "allow_interrupt": false }
→ 201 { session }                                                  未带 message
→ 201 { session, message, run, last_event_seq }                    response=accepted，或 wait 超时
→ 201 { session, message, run, interactions, last_event_seq }      response=wait，run 已结束或暂停
→ 200 text/event-stream                                            response=stream（默认）
```

- 所有响应都带 `Location: {base}/sessions/{ses}`；`response = stream` 时客户端从这个头得到会话 ID。
- `delivery`、`response`、`stream_options`、`allow_interrupt` 只能与 `message` 一起出现，含义同 §6.6。
- 场景 A 的所有字段都可省略：`harness` 默认取用户默认值；`workdir` 默认为工作区根目录；
  `settings` 默认取用户默认 profile 与模型；`run_mode` 默认 `agent`。
- `run_mode` 只对 Claude 生效，创建后不可变；Pi 会话忽略该字段，会话对象中也不返回。
- 创建会话只登记并预分配原生会话 UUID；首条消息才打开 SDK 运行时，与 WebUI 新对话的懒创建一致。
- 新会话的内部配置固定为：`visualizeMode = false`、`promptSuggestions = false`、
  `contextWindow = 200000`（未指定时）。这些值与 `run_mode` 写入会话元数据，WebUI 回放时沿用。

### 6.4 修改会话

```text
PATCH {base}/sessions/{ses}
{ "title": "…", "settings": { "model": "…", "effort": "…", "context_window": 1000000 } }
→ 200 { session }                                                         只改标题
→ 202 { session, settings_change: { id: "chg_01", status: "pending" } }    改设置
```

设置在会话空闲时立即应用，运行中排队到当前 run 结束。SDK 运行时能就地应用的变更（例如 Claude 通过
`applyFlagSettings` 切换模型）直接生效；需要重建运行时的变更（凭证、上下文窗口等）在后台任务运行时失败。
成功时发出 `session.settings_changed`（`source: "api"`，`change_id`）；失败时发出 `session.error`
（`code: settings_change_failed`，`change_id`），会话保持原设置。

### 6.5 上传文件

```text
POST {base}/sessions/{ses}/files      multipart，恰好一个文件
→ 201 { "id": "file_2Hc", "path": ".priva-attachments/file-8f2c/checkout-error.log",
        "name": "checkout-error.log", "media_type": "text/plain", "size": 18342 }
```

文件写入 `<workdir>/.priva-attachments/file-<unique>/<原文件名>`。返回的 `path` 用于消息中的
`file_path` / `image_path`。大小限制由能力描述给出。

### 6.6 发送消息

```text
POST {base}/sessions/{ses}/messages
Idempotency-Key: <客户端生成>
{ "message": UserMessage,
  "delivery": "follow-up" | "steer" | "interrupt",
  "response": "accepted" | "wait" | "stream",
  "allow_interrupt": false | true,
  "stream_options": { "deltas": true, "threads": "all" | "main", "native": false } }
```

```text
POST …/messages { message, response, allow_interrupt }
   │
   ├─ response = accepted ─────────────────────────────> 202 { message, run: { id, status }, last_event_seq }
   ├─ response = wait（最多 60 秒）
   │     ├─ run 结束 ──────────────────────────────────> 200 { message, run（含 output_text）, interactions: [], last_event_seq }
   │     ├─ allow_interrupt = true 且有问题待回答 ─────> 200 { message, run（in_progress）, interactions: [...], last_event_seq }
   │     └─ 超过 60 秒 ────────────────────────────────> 202，与 accepted 相同；之后 GET …/runs/{run}?wait=true
   └─ response = stream（默认）────────────────────────> 200 text/event-stream，本次 run 的事件
```

`response = accepted`：

```json
202 Accepted
{ "message": { "id": "msg_3fA" }, "run": { "id": "run_7Ka2", "status": "in_progress" }, "last_event_seq": 0 }
```

- `run.status` 为 `queued` 表示前面还有 run；否则为 `in_progress`。
- `last_event_seq` 是本消息产生任何事件之前的游标；客户端随后用它订阅，不会漏事件。

`response = wait`：等待本次 run 结束，或者（`allow_interrupt = true` 时）出现待回答的交互，最多 60 秒
（能力描述的 `limits.max_wait_seconds`）。等到时返回 `200`，`run` 是完整的 Run 对象（不含 items），
`interactions` 是本次 run 及其子线程中待回答的交互；超时返回与 `accepted` 相同的 `202`，调用方改用
`GET …/runs/{run}?wait=true` 继续等待（§6.8）。客户端断开只结束等待，不取消运行。

```json
200 OK
{ "message": { "id": "msg_3fA" },
  "run": { "id": "run_7Ka2", "status": "completed", "stop_reason": "end_turn", "output_text": "问题出在…", "…": "…" },
  "interactions": [],
  "last_event_seq": 0 }
```

`response = stream`（省略 `response` 时的默认值）：返回 `200 text/event-stream`，内容为以下事件，在本次 run 的 `run.completed` 之后关闭：

- 本次 run 的 `run.*`、`item.*`、`item.delta`、`interaction.*`。
- 本次 run 派生的子线程的 run 与 item（`threads = all` 时）。
- 本次 run 启动的任务的 `task.started`。
- 期间的 `session.status_changed`。

连接断开不会取消运行。

`allow_interrupt`（默认 `false`）决定 run 能否为等人回答而暂停，三种 `response` 都适用：

| 值 | Agent 提问、请求审批或 MCP 授权时 |
| --- | --- |
| `false` | 立即自动拒绝（`resolution.reason = unattended`），并告诉 Agent 没有人可以回答；run 继续到完成 |
| `true` | run 暂停，会话进入 `requires_action`，交互返回给调用方；10 分钟内未回答按 `timeout` 拒绝 |

- 自动拒绝同样产生 `interaction.requested` 与紧随其后的 `interaction.resolved`，调用方能看到 Agent 问过什么。
- 子 Agent 线程中的交互跟随父 run 的值；后台任务结果触发的 run 没有调用方在等待，一律按 `false` 处理。
- 只作用于 API 写入的会话；由 WebUI / TUI 驱动的会话按 WebUI 的方式处理交互。
- A5 之前 API 还不能回答交互（`features.interactions = false`），`true` 时只能等待超时或在 WebUI 中回答。

`delivery`：

| 值 | 会话忙碌时的行为 |
| --- | --- |
| `follow-up` | 排队，当前 run 结束后开始（发出 `run.queued`） |
| `steer` | 等当前正在执行的工具结束，中断当前 run，再开始新 run |
| `interrupt` | 立即中断当前 run，再开始新 run |

省略 `delivery` 时取 agent profile 的 `queueBehavior`。会话空闲时三者相同。
队列长度有上限，超过时返回 429 `queue_full`。会话当前由 TUI 持有时返回 409 `session_driven_by_terminal`（§10.3）。

### 6.7 幂等

- `Idempotency-Key` 可选，强烈建议使用；作用域为"主体 + 会话 + 键"，保存 24 小时。
- 相同键、相同请求体：返回首次结果（`response = stream` 时从该 run 的第一个事件开始重放；
  `response = wait` 时重新等待同一个 run）。
- 相同键、不同请求体：409 `idempotency_conflict`。
- WS 中对应字段为 `idempotency_key`。

### 6.8 历史

```text
GET {base}/sessions/{ses}/runs?thread=all|main&order=desc&limit=20&cursor=…
→ 200 { "data": [ Run & { "items": Item[] } ], "next_cursor": "…" | null }
```

默认返回主线程与所有子线程的 run，最新的在前。对象与事件中携带的对象完全同构。
历史从原生转录读取，因此 WebUI / TUI 中产生的 run 也会出现（`input.source` 为 `web` / `terminal`）。

```text
GET {base}/sessions/{ses}/runs/{run}?wait=true
→ 200 { "run": Run, "interactions": Interaction[] }
```

单个 run（不含 items；需要过程时读历史）与它及其子线程中待回答的交互。`wait = true` 时与
`response = wait` 相同：等到 run 结束、出现待回答的交互（仅 `allow_interrupt = true` 的 run）或 60 秒，
超时也返回 `200` 和当前状态，调用方可以再次等待。run 不存在返回 404 `not_found`。

### 6.9 取消、回答、停止

```text
POST {base}/sessions/{ses}/runs/{run}/cancel
→ 202 { "run": { "id": "run_8Lm", "status": "cancelling" } }
```

排队中的 run 直接移出队列；运行中的 run 被中断。最终结果以 `run.completed` 为准：
用户取消为 `status = cancelled`，被 `steer` / `interrupt` 打断为 `status = interrupted`。

```text
POST {base}/sessions/{ses}/interactions/{int}
{ "decision": "allow" | "deny", "answers": { "q0": { "selected": ["…"], "text": "" } } }
→ 202 { "interaction": { "id": "int_6", "status": "submitted" } }
```

请求体与 WebUI 的 `permission.respond` 相同（不含 requestId）。服务端先按 `questions` 同步校验结构
（422）；异步拒绝（例如 MCP 表单的 schema 校验）以 `session.error`（`code: interaction_rejected`，
`interaction_id`）通知，交互保持待处理。卡片以 `interaction.resolved` 为准移除。

```text
POST {base}/sessions/{ses}/tasks/{task}/stop
→ 202 { "task": { "id": "task_9", "status": "running", "stop_requested": true } }
```

Claude 与 Pi 都支持按 ID 停止（SDK 的 `stopTask`）。任务所属的运行时已经释放时返回 409 `task_runtime_unavailable`。

## 7. WebSocket

```text
GET wss://{host}{base}/sessions/{ses}/ws?after=N&deltas=true&threads=all&native=false
Sec-WebSocket-Protocol: agent-workshop.v1
```

- 每条连接对应一个会话。连接建立后，服务端从 `after` 之后开始推送事件，规则与 SSE 相同（§8.6）。
- 凭证放在 `Authorization` 头。浏览器类客户端无法设置该头，由部署方提供一次性 ticket
  （不在 agent-runner 实现）。
- 每个 text 帧是一个 JSON 对象。

客户端命令：

| `type` | 字段 | 对应 HTTP |
| --- | --- | --- |
| `message.send` | `request_id`、`idempotency_key?`、`message`、`delivery?`、`allow_interrupt?` | `POST …/messages`（`response` 不适用：回执等于 `accepted` 的响应体，过程从连接上的事件得到） |
| `run.cancel` | `request_id`、`run_id` | `POST …/runs/{run}/cancel` |
| `interaction.respond` | `request_id`、`interaction_id`、`decision`、`answers?` | `POST …/interactions/{int}` |
| `task.stop` | `request_id`、`task_id` | `POST …/tasks/{task}/stop` |
| `settings.update` | `request_id`、`settings` | `PATCH …/sessions/{ses}` 的 settings 部分 |

服务端发送：

```text
{ "type": "reply", "request_id": "r1", "ok": true,  "result": <对应 HTTP 响应体> }
{ "type": "reply", "request_id": "r2", "ok": false, "error":  <§9 的 error 对象> }
{ "seq": 26, "type": "run.queued", … }          事件，与 SSE 的 data 同构
```

服务端每 15 秒发送 WebSocket ping。断线后用最后处理的 `seq` 作为 `after` 重新连接；断开不取消运行。

## 8. 事件

### 8.1 外壳

```json
{
  "seq": 57,
  "type": "item.completed",
  "created_at": "2026-10-22T00:20:12.400Z",
  "run_id": "run_7Ka2",
  "thread_id": "thr_2",
  "item": { }
}
```

| 字段 | 说明 |
| --- | --- |
| `seq` | 会话内单调递增；只有持久事件有 |
| `type` | `{domain}.{action}` |
| `created_at` | 只有持久事件有 |
| `run_id` | item / interaction / 子线程事件所属的 run |
| `thread_id` | 子线程才有；省略表示主线程 |
| 对象字段 | 每个持久事件携带一个完整对象：`status`、`settings`、`error`、`run`、`item`、`interaction`、`task` 之一 |

### 8.2 持久事件

| 事件 | 携带 | 何时发出 |
| --- | --- | --- |
| `session.status_changed` | `status` | `idle` / `running` / `requires_action` 变化，或 `active_tasks` 变化 |
| `session.settings_changed` | `settings`、`source`（`api` / `web` / `native_command`）、`change_id?` | 设置生效 |
| `session.error` | `error: { code, message, retry?, change_id?, interaction_id? }` | 会话级错误；`retry.status` 为 `retrying` / `exhausted` / `terminal` |
| `run.queued` | `run` | 消息进入队列 |
| `run.started` | `run` | 运行开始 |
| `run.updated` | `run` | 用量、上下文变化，或补齐 `input` |
| `run.completed` | `run` | 结束，`status` 为终态 |
| `item.started` | `item` | 新 item 出现 |
| `item.updated` | `item` | 非增量的状态变化（例如工具开始执行、子 Agent 进展） |
| `item.completed` | `item` | item 结束，携带最终完整内容 |
| `interaction.requested` | `interaction` | 等待用户回答 |
| `interaction.resolved` | `interaction` | 已回答、跳过、超时或取消 |
| `task.started` | `task` | 后台任务启动 |
| `task.updated` | `task` | 后台任务进展（含 Workflow、Monitor 事件、`stop_requested`） |
| `task.completed` | `task` | 后台任务结束，或变为 `unknown` |

### 8.3 临时事件

不带 `seq` 和 `created_at`，不持久化，重连不补发：

| 事件 | 字段 |
| --- | --- |
| `item.delta` | `run_id`、`thread_id?`、`item_id`、`delta` |
| `item.updated`（`resync: true`） | 重连时为进行中的 item 补发当前累积内容（§8.6） |
| `native` | `thread_id?`、`harness`、`source`、`refs?: { run_id, item_id }`、`event`（原样转发） |

`delta` 的类型：

| `delta.type` | 字段 | 适用 item |
| --- | --- | --- |
| `text` | `index?`、`text` | `message`（`index` 指内容块）、`reasoning` |
| `input_json` | `text` | `tool_call` 参数生成中 |
| `output` | `stream`（`stdout` / `stderr`）、`text` | `tool_call` 执行中 |

SDK 驱动下各 harness 提供的增量：

| 增量 | Claude（Agent SDK） | Pi（SDK） |
| --- | --- | --- |
| message 正文 | 有，逐 token（`includePartialMessages` 的 `text_delta`） | 有，逐 token |
| reasoning 正文 | 有（`thinking_delta`） | 有 |
| 工具参数 `input_json` | 有（`input_json_delta`） | 有 |
| 工具输出 `output` | 仅上报进度的产品工具；Bash 等内置工具完成时一次给出 | 工具上报进度时有 |

`native.source`：SDK 驱动下为 `sdk`（Claude 的 SDKMessage、Pi 的 AgentSession 事件）；
从原生转录读取的记录（例如后台任务回送的通知、Workflow Agent 的转录）为 `transcript`。

当 API 只读订阅一个由 WebUI 的 TUI 驱动的会话时，增量粒度与 WebUI 相同（Claude 正文按行，
没有思考与工具参数增量），`native.source` 为 `hook` / `transcript` / `display` / `status_line` / `host`。

### 8.4 SSE 编码

```text
id: 57
event: item.completed
data: {"seq":57,"type":"item.completed",…}

event: item.delta
data: {"type":"item.delta","run_id":"run_7Ka2","item_id":"itm_08","delta":{"type":"text","index":0,"text":"问题出在"}}

: keep-alive
```

持久事件带 `id:`（值为 `seq`）；临时事件不带。每 15 秒发送一次注释心跳。
响应头 `Cache-Control: no-store`、`X-Accel-Buffering: no`。

### 8.5 顺序与不变式

- 同一会话内，持久事件按 `seq` 严格递增，不重复、不跳号。
- 一个对象的事件顺序：`started` → `updated`* → `completed`。
- `run.started` 先于其 items；item 的 `item.started` 先于引用它的 `interaction.requested`；
  run 的所有 items 结束后才发 `run.completed`；`session.status_changed(idle)` 在 `run.completed` 之后。
- 启动后台任务的 `tool_call` 的 `item.completed` 先于对应的 `task.started`。
- **核心不变式**：只按顺序应用持久事件，得到的对象与同一时刻 `GET` 会话快照、`GET` 历史返回的完全一致。
  增量、resync 与原生事件只用于展示和排查。

### 8.6 订阅与续传

```text
GET {base}/sessions/{ses}/events?after=N&deltas=true&threads=all&native=false
Last-Event-ID: N
```

- `after` 与 `Last-Event-ID` 二选一；同时给出且不一致返回 400 `cursor_invalid`。省略表示 `0`。
- 服务端先补发 `seq > N` 的持久事件；再为进行中的 item 各补发一条 `item.updated`（`resync: true`，
  不带 `seq`）；然后接实时事件。
- `N` 大于当前最新 `seq` 返回 400 `cursor_invalid`；`N` 已超出保留范围返回 410 `cursor_expired`
  （含 `last_event_seq`）。客户端此时先 `GET` 会话快照和历史，再从 `last_event_seq` 继续订阅。
- 订阅参数：`deltas`（默认 `true`）、`threads`（`all` 默认 / `main`）、`native`（默认 `false`）。
  `threads = main` 时过滤掉带 `thread_id` 的事件，`seq` 会出现间隔，这是预期行为。

### 8.7 策略裁剪

Policy 可以省略字段，但不改变事件形状和对象结构。例如场景 B 默认省略 `reasoning.text`，只保留
`duration_ms`；默认不允许 `native = true`（§12.2）。

## 9. 错误

```json
{
  "error": {
    "type": "invalid_request",
    "code": "image_input_unsupported",
    "message": "当前模型 glm-4.6 不支持图片输入",
    "param": "message.parts[1]",
    "request_id": "req_4Hk2"
  }
}
```

| `type` | HTTP 状态 | 说明 |
| --- | --- | --- |
| `invalid_request` | 400 / 410 / 413 / 422 | 请求结构或语义错误、游标问题、文件过大 |
| `authentication` | 401 | 由部署方返回 |
| `permission` | 403 | 由部署方或 Policy 返回 |
| `not_found` | 404 | 对象不存在或不可见（越权一律 404） |
| `conflict` | 409 | 与当前状态冲突 |
| `rate_limit` | 429 | 队列已满、限流；带 `Retry-After` |
| `unavailable` | 503 | 运行时无法启动 |
| `internal` | 500 | 未预期错误 |

| `code` | 场景 |
| --- | --- |
| `validation_failed` | 字段校验失败，`param` 指向字段 |
| `image_input_unsupported` | 当前模型不支持图片 |
| `path_outside_workspace` | 路径越出会话工作目录 |
| `file_too_large` | 超过文件或内联大小限制 |
| `queue_full` | 排队消息达到上限 |
| `idempotency_conflict` | 相同幂等键、不同请求体 |
| `cursor_invalid` / `cursor_expired` | 事件游标非法 / 已过期 |
| `session_driven_by_terminal` | 会话当前由 WebUI / TUI 的原生终端持有，API 不能写入（§10.3） |
| `interaction_resolved` / `interaction_rejected` | 交互已处理 / 异步校验失败 |
| `task_runtime_unavailable` | 任务所属的运行时已释放，无法停止 |
| `settings_change_failed` | 设置未能应用（含后台任务运行中需要重建运行时的情况） |
| `session_busy` | 当前状态不允许该操作（例如删除运行中的会话） |
| `not_found` | 会话或对象不存在或不可见 |
| `feature_unavailable` | Policy 不允许或当前版本尚未提供的功能 |
| `runtime_start_failed` | SDK 运行时启动失败 |

事件流建立之后的错误用事件表达（`session.error`、`run.completed` 的 `failed`），不在流中拼接 HTTP 错误体。

## 10. 与 WebUI / TUI 的关系：超集与可回放

### 10.1 原则

```text
              API（SDK 驱动）                         WebUI / TUI（终端驱动）
  逐 token 增量、按 ID 停止任务、            按行增量、/tasks 管理任务、
  MCP 表单与 URL 授权、准确用量               终端处理 URL 授权、可视化、输入建议
                    \                                  /
                     +---- 同一份原生转录 + 会话元数据 ----+
                                      |
                       任一侧都能打开、回放并继续（同一时刻只有一种驱动写入）
```

API 不复制 WebUI / TUI 的交互行为和限制。约束只有一条：API 产生的会话必须能在 WebUI 和原生 TUI 中
正确回放并继续。

### 10.2 可回放的要求

- **RP1 原生会话。** API 通过 provider 的 SDK 驱动创建和续写原生会话：Claude 使用预分配 UUID 的
  会话（与 TUI 的 `--session-id` / `--resume` 相同），Pi 使用原生会话文件。不另建私有消息存储。
- **RP2 元数据。** 运行模式、最近使用的模型、后台任务状态通过现有 `SessionMetadataRepository` 写入，
  与 WebUI 读取的是同一份。API 新会话的 `visualizeMode = false`、`promptSuggestions = false` 同样记录。
- **RP3 输入编码。** 附件使用 `<priva-attachments>` 清单，图片使用原生图片块（§5.2）。
  WebUI 的历史解析（`fold-thread.ts` 的 `userTurnFromText`、原生图片提取）已能还原两者。
- **RP4 列表可见。** API 创建的会话出现在 WebUI 的会话列表中（按 cwd 分组），标题来自首条消息。
- **RP5 回放验证。** 每类 item（正文、思考、工具、子 Agent、后台任务通知、压缩、交互结果）都要有
  回归测试：API 会话结束后，WebUI 的 `/thread` 结果完整，且在 WebUI 中继续发送时能以 TUI `--resume`
  接着同一会话运行。

### 10.3 驱动互斥与切换

现有 `AgentHarness` 保证同一会话同一时刻只有一种驱动写入：SDK 有活动 run 时不能打开终端；
终端进程存活时 SDK 拒绝写入。API 沿用这条规则：

| 情况 | 结果 |
| --- | --- |
| API 会话空闲、没有后台任务，用户在 WebUI 中打开并发送 | WebUI 按现有逻辑释放空闲 SDK 运行时，以 TUI resume 继续 |
| API 会话有活动 run 或后台任务时，用户在 WebUI 中发送 | WebUI 收到现有的 busy 提示；可以只读查看实时过程 |
| 会话的原生终端仍存活（WebUI 正在使用或尚未回收），API 发送消息 | 409 `session_driven_by_terminal`；终端退出或空闲回收后可再发送 |
| API 订阅一个由 TUI 驱动的会话 | 可以，只读；事件来自同一个 `SessionStream`，增量粒度与 WebUI 相同 |

`session.driver` 字段告诉客户端当前由谁写入。API 主动关闭空闲终端以接管会话不在 V1 范围内。

### 10.4 超出 WebUI / TUI 的能力

| 能力 | WebUI / TUI | API |
| --- | --- | --- |
| Claude 正文增量 | 按行（MessageDisplay） | 逐 token |
| Claude 思考 / 工具参数增量 | 无 | 有 |
| Claude 按 ID 停止后台任务 | 打开原生 `/tasks` | 支持 |
| MCP URL 授权 | 在终端中处理 | `open_url` 交互 |
| 用量与费用 | 转录与 statusLine 推算，费用可能未知 | SDK `result` 给出 |
| 模型不支持图片 | 静默作为文件 | 422 |
| 可视化回答、输入建议 | 支持 | 不提供（新会话关闭） |
| 无人值守 | 提问一直等到有人回答或 10 分钟超时 | 默认自动拒绝并告诉 Agent 没有人可以回答（`allow_interrupt`）；WebUI 回放时显示为"已跳过" |
| 一次请求拿到最终回复 | 无 | `response = wait` 与 `output_text` |

### 10.5 与 WebUI 行为保持一致的部分

为了让同一用户在两侧的体验可预期，以下语义与 WebUI 相同：

- `delivery` 三种方式的含义与 agent profile 的 `queueBehavior` 相同。
- 交互的请求与回答结构与 `permission.requested` / `permission.respond` 相同，同一个 `InteractionCoordinator`。
- 附件落在 `.priva-attachments/file-*/`。
- 模型引用使用 `profileId:modelId`，模型选择逻辑使用同一个 `buildRunSpec`。
- 运行模式（`agent` / `code`）在会话创建时确定、之后不可变，默认 `agent`，与 WebUI 新对话相同。

## 11. 实现要点

### 11.1 ObjectProjector：从状态到事件

`SessionStream` 维护会话的完整状态：`messages`（ThreadMessage[]）、`tasks`、待处理 interactions、
`activeRunId`、`config`、`runningToolIds`。SDK 驱动的帧和 TUI 驱动的快照都发布到这里。
投影器以状态为输入，不逐条翻译 v2 事件：

```text
SessionStream（WebUI 与 API 共用的实例）
   │ 每一帧
   ├─ assistant.delta / assistant.thinking_delta / tool.input_delta / tool.progress
   │      └──> item.delta（临时，按 ID 映射后直接转发）
   └─ 其余帧（含 session.snapshot）
          └──> 读取 stream 当前状态：messages / tasks / interactions / activeRunId / config / runningToolIds
                  │ toObjects()：ThreadMessage → Run + Items；nestedAgents → 子线程 Run + Items；
                  │              BackgroundTask → Task；InteractionRequest → Interaction
                  v
               新对象图 ── diff(旧对象图) ──> 按 §8.5 顺序排列的持久事件 ──> EventLog(seq) ──> SSE / WS
```

- 对象图只由 `SessionStream` 的状态决定，因此与 WebUI 的展示和历史读取一致。
- diff 以对象 ID 为键：新出现 → `started`（或 `queued`）；字段变化 → `updated`；进入终态 → `completed`。
  `message` 正文的增长不产生 `item.updated`（由 delta 表达），只在完成时由 `item.completed` 给出全文。
- `run.queued` 与排队位置由 MessageService 产生，因为排队发生在 API 层。
- 原生通道（`native = true`）需要 provider 在映射时一并上报原始记录（SDK 驱动下即 SDKMessage /
  AgentSession 事件本身）。

### 11.2 run 与 item 的边界

| 来源 | 映射 |
| --- | --- |
| 用户消息 + 其后的 assistant 消息 | 一个 run；`input.type = user_message` |
| 含 `task_notification` 块的 assistant 轮次（含独立 turnId 的批次） | 一个 run；`input.type = task_result` |
| assistant 的 `blocks` | 按顺序映射为 message / reasoning / tool_call items |
| 子 Agent 的 `tool_use` + `nestedAgents[]`（SDK 的 `parent_tool_use_id` 帧） | 父线程的 subagent item；子线程中的一个 run（`agent_task`）及其 items |
| `inbox` 消息 | 子线程中的新 run（`inbox_message`） |
| `compact` marker | compaction item |
| `session.rebound` | 新原生会话第一个 run 的 context_reset item |
| `run.started` / `run.completed` / `run.failed` / `run.aborted` | run 状态；`activeRunId` 决定 `in_progress` |

### 11.3 run 索引

实时 run 的 ID 是 harness runId；历史重读时 assistant 消息的 ID 是原生转录 UUID。
SessionRegistry 必须持久化 run 索引（run_id ↔ 原生用户消息 UUID、原生会话 ID），
历史读取据此还原相同的 run_id。没有索引的历史（WebUI / TUI 产生、API 从未观察过）
按原生 UUID 确定性派生。

### 11.4 EventLog

- 场景 A：每个平台会话一个目录 `$RUNTIME_HOME/agent-api/sessions/<ses>/`，权限 0700，文件 0600：
  `session.json`（注册信息与设置）、`events.jsonl`（持久事件）、`projection.json`（run 索引与投影记忆）。
- 保留：每个会话最近 10000 条或 7 天，取先到者；超出部分返回 410。
- `seq` 随日志持久化，runner 重启后继续递增（`SessionStream` 的 seq 在重启后重置，不能直接使用）。
- 投影器在会话运行时存活期间（含后台任务）持续运行，不依赖是否有订阅者，保证"执行不依赖连接"。
- **投影记忆**：`projection.json` 记录日志已经为每个对象说过什么（开始、终态）。投影器重新挂到
  `SessionStream` 时（runner 重启、API 首次访问 WebUI 推进过的会话）以记忆为基线做 diff，补发期间
  错过的事件，例如重启前进行中的 run 的 `run.completed`。API 创建的会话从空记忆开始；API 从未观察过的
  WebUI 会话从当前状态开始，之前的历史只通过 `GET` 读取，不重放为事件。
- **run 索引**：API 发起的 run 在 `launch` 之前登记（输入回显、`msg_` ID、幂等键与首次响应），因此
  运行时启动失败也会以 `run.completed`（`failed`）结束。重启后，转录中的用户消息按"文本相同、时间不早于
  上一个匹配"认领索引中的 run，历史中的 run_id 保持不变；认领不到时按原生 UUID 派生。

### 11.5 MessageService

- 校验 parts、解析路径、落盘内联内容，构造 `UserTurn`。
- 处理幂等：`Idempotency-Key` → run_id；harness 的 runId 作为第二层去重。
- 由会话注册表中的设置构建 `ProviderRunSpec`（复用 `buildRunSpec`），调用 `AgentHarness.launch`
  并传入 API 生成的 runId 与预分配的原生会话。
- 持有 API 发起的排队 run，产生 `run.queued`。`AgentHarness` 对同一会话拒绝并发 run，
  因此三种投递在 API 层实现：
  - `follow-up`：活动 run 结束后再 `launch`。
  - `steer`：等 `runningToolIds` 为空 → `abortLive` → 等 run 结束 → `launch`。
  - `interrupt`：`abortLive` → 等 run 结束 → `launch`。
- 发送前检查驱动互斥：原生终端存活时返回 409 `session_driven_by_terminal`。
- run 索引记录每个 API run 的 `allow_interrupt`。自动拒绝订阅会话的 `SessionStream`：出现待处理的
  `InteractionRequest` 时，沿子线程找到它所属的主线程 run；只有该 run 是 `allow_interrupt = true` 的
  API run 时保留，否则以 `reason = unattended` 回答 `deny`。会话由终端驱动时不处理。
- 等待（`response = wait`、`GET …/runs/{run}?wait=true`）只读投影器：每个持久事件之后检查 run 是否结束、
  是否有属于它的待回答交互，与 SSE 看到的是同一份状态。

### 11.6 SDK 驱动需要补齐的能力

| 能力 | 现状 | 需要的工作 |
| --- | --- | --- |
| Claude 图片输入 | `claudeUserMessage` 只发送文本 | 将 `imagePaths` 读为 base64 图片块加入 SDK 用户消息 |
| Claude MCP 表单与 URL 授权 | SDK 驱动未接 `onElicitation` | 接入 `onElicitation`：form → 复用 `terminalElicitationForm` 转换为问题；url → `open_url` 交互 |
| 原生通道 | provider 只输出解析后的 AgentEvent | 映射时附带原始 SDK 消息 |
| Workflow Agent 实时内联 | 两个 harness 都只在请求时读取 Agent 转录 | 运行期间增量读取 Workflow Agent 转录，产生子线程的 run 与 items |

## 12. 实施分工

### 12.1 Part A：agent-runner 自用 API

鉴权不在本次实现：runner 只在内部端口提供 `/api/agent/v1/sandbox`，由 agent-workshop 的
Runtime Access 校验用户 API key 后转发。分层推进，每层都可端到端验收：

| 层 | 内容 | 验收 | 状态 |
| --- | --- | --- | --- |
| A1 | `core/agent-api` 契约：类型、zod schema、错误；对象与事件的 JSON Schema | 示例文档中的全部 JSON 能通过 schema | 已完成 |
| A2 | SessionRegistry、WorkspaceFiles、`POST/GET/DELETE /sessions`、能力描述、上传 | 会话可创建、列出（含 WebUI 会话）、删除；首条消息之后才出现在 WebUI 列表中（与 WebUI 新对话一样懒创建原生会话） | 已完成 |
| A3 | MessageService + `POST /messages`（202）+ Claude 图片输入 | API 会话结束后在 WebUI 中完整回放，并能以 TUI 继续 | 已完成；WebUI 回放与 TUI 续写尚未用真实模型验证 |
| A4 | ObjectProjector + EventLog + SSE + `response = stream` + 续传 | 持久事件回放结果与 GET 快照、历史逐字段一致 | 已完成 |
| A4.5 | 程序化调用：`response` 三种返回方式、`GET …/runs/{run}?wait`、`output_text`、`allow_interrupt` 与自动拒绝、创建时的 `run_mode` | 脚本与外部 Agent 的 skill 只用一次请求（或请求 + 轮询）拿到最终回复；无人值守时提问不会挂起会话 | 已完成 |
| A5 | 取消、三种投递、交互（含 `onElicitation`）、任务停止、PATCH 设置 | 每个操作都有 Claude 与 Pi 的集成测试 | 未开始 |
| A6 | WebSocket | 命令与 HTTP 结果一致 | 未开始 |
| A7 | 原生通道、Workflow Agent 实时内联 | 原生事件与语义对象的 `refs` 对应 | 未开始 |

`GET …/runs` 历史随 A4 一起提供。A5 之前，会话忙碌时发送返回 409 `session_busy`，`native = true`
返回 403 `feature_unavailable`；能力描述的 `features` 如实反映当前提供的功能。

API 发起的 run 在用量统计中记为 `source = 'api'`（[用量与审计数据存储](usage-data-store.md)）。
示例文档的载荷与 JSON Schema 由测试校验，修改契约时重新生成：
`npx vitest run tests/unit/core/agent-api/json-schema.test.ts -u`（在 `services/agent-runner/ts/` 中执行）。

验证方式：

- 遵循 AGENTS.md 的 `npm run lint`、`npm run typecheck`、`TMPDIR=/tmp npm test`、`npm run build`。
- 集成测试使用隔离的 `CLAUDE_CONFIG_DIR` / HOME 与本地模拟模型端点，不访问真实模型。
- 关键回归：
  - API 会话在 WebUI 中回放并以 TUI 继续（RP5）。
  - 原生终端存活时 API 发送返回 409，终端退出后可以继续发送。
  - 持久事件回放与 `GET` 快照、历史逐字段一致。
  - runner 重启后 `seq` 连续、历史中的 run_id 不变。

### 12.2 Part B：agent-workshop 的 agent-studio

agent-studio 只提供 API；agent-ui 中添加对应的 UI 入口。必须满足：

- **契约一致。** 路径子路径、对象、事件、错误与本文相同；只能由 ReleasePolicy 省略字段或拒绝功能，
  不能改变形状。
- **执行一致。** 在隔离执行环境中运行 agent-runner 的同一套 Agent API 模块、`AgentHarness` 与 SDK 驱动；
  不需要 tmux 与 TerminalChatSessions。会话工作目录是发布目录快照的独立副本。
  原生配置只来自快照，不加载用户级 skills、MCP、memory。凭证不进入执行环境，经代理访问；
  参见 [Agent 发布与隔离调用设计](published-agents.md) 中的隔离分析。
- **鉴权。** API key 只用于 `POST …/published/{agt}/sessions`，返回会话令牌；之后的请求使用会话令牌。
  令牌不得出现在 URL 中（WS 用请求头或一次性 ticket）。不同调用方的会话、文件、事件互不可见，
  越权一律 404。
- **ReleasePolicy 默认值：**

| 项 | 默认 |
| --- | --- |
| 创建会话请求体 | 只允许 `message` |
| `PATCH` 设置、列出会话 | 不提供 |
| 文本开头的 `/命令`、文本中的 `@路径` | 中和，不交给原生解析（实现方式需按 Claude / Pi 分别验证） |
| 路径 | 只允许会话工作目录内的相对路径 |
| `reasoning.text` | 省略，只保留 `duration_ms` |
| `native = true` | 不允许（发布者预览可开启） |
| `open_url` 交互 | 由 Release 声明是否允许；不允许时拒绝 MCP 的 URL 授权请求 |
| 排队上限 | 由 Release limits 声明，默认 3 |
| `allow_interrupt` | 与场景 A 相同，默认 `false` |

- **存储。** 会话注册表、run 索引与 EventLog 使用 agent-studio 的持久存储，满足多副本与重启后 `seq` 连续；
  保留策略与 410 语义与本文一致。
- **路由。** AgentGateway 将 `/api/agent/v1/published/*` 路由到 agent-studio；
  agent-studio 完成鉴权后转发到对应会话的执行环境。
- **回放。** 发布调用的会话不出现在发布者的 WebUI 中；发布者需要查看时由 agent-studio 提供只读回放，
  数据来源是同一套历史接口（§6.8）。
- **agent-ui 入口。** 发布管理页面使用 agent-studio 自己的管理接口。发布者的预览对话建议直接使用
  本文的调用接口（以预览令牌创建会话），这样预览与外部调用走同一条路径。
- **文件取回。** 调用方无法访问执行环境的文件系统；Agent 生成的文件（`tool_call.output` 中的
  `image_path` / `file_path`、任务的 `output_path`）由 agent-studio 提供下载，范围限于该会话的工作目录。
  场景 A 不需要这一项，调用方直接使用 Sandbox 的文件接口。
- **具名 Agent。** 场景 A 推迟的"把目录与配置保存为可调用的 Agent"在这里与发布单元（D5）一起设计。
  运行模式属于 Agent 配置：发布时固定在 Release 中，调用方不能修改。

## 13. 已知限制与待定事项

- **JSON Schema** 见 [agent-api-v1.schema.json](../api/agent-api-v1.schema.json)，由契约生成。
- **SDK 驱动需要补齐的能力**见 §11.6：Claude 图片输入已完成；`onElicitation`、原生通道、Workflow Agent 实时内联未完成。
- **A4 实现的已知差距**（在后续层中处理）：
  - 投影器尚未跟随 Claude 原生 `/clear` 产生的 `session.rebound`，也不产生 `context_reset` item。
  - `session.settings_changed` 尚未发出（随 A5 的 PATCH 设置一起实现）；`run.context` 尚未填充。
  - Monitor 任务的 `last_event`、Workflow Agent 线程的 run 尚未产生。
  - API run 的 `run.started` 在受理时发出，provider 报告模型后紧跟一条带 `model` 的 `run.updated`。
  - Claude 内置工具没有执行开始信号：参数完整（assistant 消息结束）即视为 `running`。
  在 Workflow Agent 实时内联完成前，只能通过 `task.updated` 看到进度。
- **Claude 内置工具（如 Bash）的输出没有实时增量**，完成时一次给出。
- **示例画布** `docs/api/agent-runner-api-io-examples.canvas.tsx` 是早期的示意版本，与示例文档有出入
  （例如上传路径、创建会话的响应外壳）；以示例文档为准。
- **API 不接管仍由原生终端持有的会话**；需要先在 WebUI 中退出终端或等待空闲回收。
- **后台结果触发的 run** 在输入解析完成前 `input` 为 `null`，随后由 `run.updated` 补齐。
- **场景 B 中和 `/命令` 与 `@路径` 的具体方式**待 agent-studio 实施时验证。
- **`allow_interrupt = true` 在 A5 之前只能等待**：API 还不能回答交互，暂停的 run 等到 10 分钟超时，
  或由用户在 WebUI 中回答。
- **`response = wait` 的 60 秒上限**低于常见代理的默认超时；部署方的网关超时更短时，调用方会先收到网关错误，
  此时改用 `accepted` + `GET …/runs/{run}?wait=true`。

## 14. 与其他文档的关系

- [Agent 发布与隔离调用设计](published-agents.md)：其调用接口（`/api/v1`、`runs + input`、
  按 run 的公开事件）与逐项挑选资源的发布模型已被本文与 D5 取代。隔离、凭证、网络与沙箱分析仍可参考。
- [Harness 共享流协议设计材料](../design/harness-stream/README.md)：A2A 与 v3 流协议已废弃，由本文取代。
- [会话事件与后台任务](../background-tasks.md)、[Claude TUI 聊天模式](claude-tui-chat-mode.md)、
  [Pi 原生共享会话](pi-native-session.md)：WebUI 的驱动与协议不变；本文依赖其会话互斥、原生转录与
  `SessionStream` 实现。
