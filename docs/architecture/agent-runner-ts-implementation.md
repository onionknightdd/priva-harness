# Agent Runner 的 TypeScript `core` 架构

状态：迁移基线提案  
范围：仅 `services/agent-runner`  
首个 `provider`：Claude Agent SDK  
第二个 `provider`：Pi

## MVP 清单

以下顺序以 API 对 Agent 运行主链的重要程度、与 `/ws/run` 的相关性，以及前后依赖
为依据。这里的 `/ws/run` 是简写，当前完整路由为
`WS /api/sandbox/agent/ws/run`。每个 MVP 都必须形成可独立验收的纵向切片，不能按
现有 Python router 文件逐个翻译。

```text
MVP 1  最小文本对话 /ws/run
  │
  ├──→ MVP 2  session 连续性 ──→ MVP 3  live run 恢复 ──→ MVP 4  permission / queue
  │
  └──→ MVP 5  profile + MCP adapter ──→ MVP 6  Pi provider
                                                    │
                                                    ▼
MVP 7  其他 transport / 输入 ──→ MVP 8  高级 session ──→ MVP 9  harness 资源
                                                    │
                                                    ▼
                                              MVP 10  scheduler
```

编号表示建议验收顺序；图中的分支表示依赖关系。MVP 2–4 和 MVP 5–6 在 MVP 1
通过后可以并行推进。

### MVP 1：最基础的 `/ws/run`

API：

- `WS /api/sandbox/agent/ws/run`。

范围：

- 客户端只发送一条 `{"type":"init","message":"..."}` 文本消息。
- 每个连接只执行一次全新的单轮对话；固定使用 Claude `provider` 和服务端内置运行
  环境，禁用工具调用，不保存 session。
- 调用链只包含 `transport → harness → Claude provider`；返回助手文本后关闭 WebSocket。

完成定义：

- 非空文本能够得到非空 `assistant_message` 和一个 `result`，随后连接正常关闭。
- 非法消息或 Claude `provider` 失败时返回 `stream_error` 并关闭连接，不留下悬挂任务。

明确不包含：

- 任何配置字段或配置 API，包括 `cwd`、model、profile、`provider` 选择、system prompt
  和 MCP。
- session 持久化、多轮对话、恢复、`attach`、`abort`、permission、queue 和事件重放。
- 工具、文件、图片、Pi、其他 `transport`，以及 `/ws/run` 之外的任何业务 API。

MVP 1 只在开发或测试环境中证明最短对话链路，不承担生产兼容性。

### MVP 2：session 连续性

API：

- `/ws/run` 的 `session_id` 恢复语义。
- `GET /api/sandbox/agent/sessions`。
- `GET /api/sandbox/agent/sessions/{session_id}/messages`。

范围：

- 引入 `{ provider, id }` 形式的 `SessionRef` 和 `ProviderSessionStore`。
- 支持“新建 → 列出 → 读取消息 → 恢复运行 → 再次读取”的完整链路。
- 恢复 session 时锁定原 `cwd`，继承 `add_dirs`，并校验不可变的 `run_mode`。
- session 列表和消息由 `harness` 聚合；`transport` 不读取 Claude JSONL。

完成定义：

- Claude 和 Pi 可以拥有相同的原生 session ID，而不会在 `core` 中发生冲突。
- 恢复运行不会重复提交已经成功发送的用户输入。
- session 响应通过黄金测试夹具验证，不暴露 SDK 原始对象。

明确不包含 live run 的 `attach`、元数据修改、fork、rewind、recap 和 transcript
修复。

### MVP 3：live run 生命周期、断线重连与停止

API：

- `/ws/run` 的 `attach`、`since_seq` 和 `abort` 帧。
- `GET /api/sandbox/agent/sessions/running`。

范围：

- 实现 `LiveRunRegistry`、有界 replay buffer、subscriber fan-out 和 activity lease。
- WebSocket 断开只解除订阅，不终止 run；客户端可以按 `since_seq` 重放并继续跟随。
- 支持显式停止、同一 session 仅有一个 live run、keepalive、进程关闭排空和取消。
- 保留 replay gap、慢消费者隔离，以及终止记录短期保留语义。

完成定义：

- 断线后 run 继续执行；重新 `attach` 不重复事件，也不遗漏仍在 buffer 内的事件。
- 超出 buffer 时明确返回 `replay_gap`，不得伪装成完整回放。
- 慢订阅者只断开自身，不阻塞 run 或其他订阅者。
- 并发运行同一 session 被稳定拒绝；`abort` 最终只产生一个终止状态。

明确不包含跨进程 run 恢复、分布式 registry、permission 待处理快照和暖运行时池。

### MVP 4：permission 与运行中输入

API：

- `/ws/run` 的 `permission_response`、`queue` 和 `queue_cancel` 帧。
- `POST /api/sandbox/agent/permission/respond`。

范围：

- 实现与 `provider` 无关的 `PermissionBroker`。
- 支持允许/拒绝、更新工具输入、超时、取消时默认拒绝，以及重复响应幂等。
- reconnect 时从权威 pending snapshot 恢复 permission 请求，而不是依赖 replay
  buffer。
- 实现有界 queued input、取消排队项，以及 `steer`/`follow-up` capability 映射。
- 本阶段 queued input 仅支持文本。

完成定义：

- permission 超时和 run 取消均 fail closed；两个客户端重复回答不会执行两次。
- 即使发生 replay gap，reconnect 后仍能恢复所有未决 permission 请求。
- 队列保持当前 32 条和 8 MiB 双重上限；取消后该输入不会送达模型。
- `provider` 不支持对应行为时返回 `UnsupportedCapabilityError`，不得静默模拟。

### MVP 5：profile、持久化 MCP 与双 provider 投影

API：

- `/api/sandbox/credentials/profiles` 下的 CRUD、默认 profile、模型列表、连接测试和图片
  能力探测。
- `/api/sandbox/resource/mcp` 下的列表、读取、创建、更新和删除。
- `/ws/run` 的 `mcp_servers = auto | disable | string[]`。

范围：

- 通过 `ModelProfileResolver` 解析模型、凭证和目标 `provider`，敏感值不得进入
  `core` 事件或日志。
- 启动层从统一的 `runtimeConfig` 导出产品运行根（默认 `~/.bambuddy`，`main.ts`
  可用环境变量 `RUNTIME_HOME_DIR` 覆盖）和配置文件路径
  `$RUNTIME_HOME/bambuddy.settings.yml`；配置文件内容与 YAML 解析契约留到后续实现。
- Claude 全局配置目录为 `$RUNTIME_HOME/harness/.claude`，项目配置为 `<cwd>/.claude`。
- Pi 产品化后的全局配置目录为 `$RUNTIME_HOME/harness/.bambuddy`（替代 `~/.pi/agent`），
  项目配置为 `<cwd>/.bambuddy`（替代 `<cwd>/.pi`）。不读取旧的 `~/.pi` 与 `<cwd>/.pi`。
- profile 以 `$RUNTIME_HOME/model-profiles.json` 为唯一事实来源；文件读改写和图片能力
  缓存更新使用非阻塞异步 I/O、跨进程锁与原子替换。
- model profile 只保存模型端点、凭证、通用默认模型和按模型缓存的能力，不包含
  `opus`、`sonnet`、`haiku`、`vision` 等特定 `harness` 的固定模型档位。需要模型角色
  映射的 `harness` 使用自己的通用 `modelBindings`，并由对应 `provider` 边界解释。
- 建立规范化 `HarnessConfigStore`，作为持久化 MCP 配置的唯一事实来源。
- 实现 `ConfigDistributor`；Claude 与 Pi 的 MCP 投影放在 `provider/<id>/config-adapter`。
- 创建、更新和删除 MCP 后，对选定 `provider` 执行幂等 reconcile。
- 每次运行只解析 MCP 选择；不得把单次运行选择写回持久化配置。

```text
ModelProfile（端点 / 凭证 / 默认模型 / 能力）
                         │
                         ▼
              ModelProfileResolver
                         │
                         ▼
Harness 运行配置（可选 modelBindings: Record<string, string>）
       ├── Claude provider 解释 Claude 所需角色
       ├── Pi provider 解释 Pi 所需角色
       └── 其他 provider 解释自己的角色
```

```text
$RUNTIME_HOME = ~/.bambuddy            产品根（RUNTIME_HOME_DIR 可覆盖）
├── bambuddy.settings.yml
├── model-profiles.json
└── harness/
    ├── .claude/                       Claude 全局
    └── .bambuddy/                     Pi 全局（替代 ~/.pi/agent）

<cwd>/
├── .claude/                           Claude 项目
└── .bambuddy/                         Pi 项目（替代 <cwd>/.pi）
```

完成定义：

- 同一份 MCP 定义能够生成有效的 Claude 和 Pi 投影；第二次 reconcile 不产生变更。
- 删除 MCP 只删除 manifest 拥有的投影，保留用户手工创建的原生配置。
- 不支持字段和单个 `provider` 的失败必须进入 `DistributionReport`。
- `auto`、`disable` 和指定名称列表在两个 `provider` 下保持一致语义。

MCP capability 探测、连接验证和工具测试 API，以及 skills、commands、agents、hooks、
memory 的投影留到后续 MVP。

### MVP 6：真正的 Pi `provider`

API：

- 复用 MVP 1–4 的同一个 `/ws/run`，不新增 Pi 专用 endpoint。

范围：

- 实现 Pi 的新建 session、恢复、流式事件和中止。
- 复用同一 `RunCommand`、`AgentEvent`、`PermissionBroker`、`LiveRunRegistry` 和线协议
  mapper。
- 显式声明 Pi 对 permission、`steer`、`follow-up`、partial stream 等能力的真实
  支持情况。
- 首轮由组装配置或内部路由选择 `provider`，不改变现有公开 WebSocket schema。

完成定义：

- Claude 和 Pi 通过同一套 `provider` contract tests。
- 两个 `provider` 的等价文本 run 产生相同类别和生命周期顺序的规范化事件。
- 公开事件中不出现任一 SDK 的原始类型。
- capability 不支持时返回可识别错误，不退化为模糊的运行失败。

不得为了表面兼容而模拟 Pi 不支持的能力，也不得创建 Claude/Pi 共享基类。

### MVP 7：其他 `transport` 与丰富输入

API：

- `POST /api/sandbox/agent/run`。
- `POST /api/sandbox/agent/run/stream`。
- `POST /api/sandbox/agent/image-route`。
- `/api/sandbox/agent-attachments` 下的上传、列表、读取和删除。
- `/ws/run` 的 attachments、images、model 和 partial message 等可选输入。

范围：

- HTTP、SSE 和 WebSocket 都只负责把输入转换为同一个 `RunCommand`。
- 实现与 `provider` 无关的 input builder、附件引用解析，以及图片数量、大小和 MIME
  校验。
- 根据 capability 将图片路由到 direct image 或 vision MCP。
- 保持现有 HTTP 响应及 SSE/WebSocket 事件格式。

完成定义：

- 同一请求通过三种 `transport` 时进入同一个 `harness`，不存在三套运行实现。
- 三种 `transport` 的结果和事件均通过当前线协议黄金测试。
- 非法附件在启动 `provider` 前被拒绝，临时文件不能跨用户引用。
- `transport` 不导入 SDK，也不编译 `provider` options。

### MVP 8：session 管理与高级 `provider` 能力

API：

- session 的 recap、删除、重命名、tag、`add_dirs`、pin 和 archive。
- workdir 的 pin 和 archive。
- `POST /api/sandbox/agent/fork` 和 `POST /api/sandbox/agent/rewind`。
- `GET /api/sandbox/agent/workflow-agent/{agent_id}`。
- `GET /api/sandbox/agent/workflow-state/{run_id}`。

范围：

- 将产品元数据移入 `SessionMetadataRepository`。
- 通用的读取、删除和 fork 走 `ProviderSessionStore`。
- rewind、file checkpoint、Claude workflow transcript 等按 capability 实现。
- 补齐 Claude transcript 修复、重试分类、后台 workflow 排空、recap 和暖运行时池。

完成定义：

- 产品元数据不写入 `provider` 原生 transcript，也不以 Claude 原生 session ID 作为
  全局键。
- 删除、fork、rewind 与 live run 互斥，失败时不会留下半写状态。
- 不支持 rewind/checkpoint 的 `provider` 明确返回 capability 错误。
- 开启 Claude 高级能力不改变 `core` 或公开线协议。

### MVP 9：其余 `harness` 资源

API：

- skills、commands、subagents、hooks 和 memory 的现有 CRUD 及测试接口。
- `GET|PATCH /api/sandbox/resource/runtime-settings`。

范围：

- 将这些资源纳入规范化 `HarnessConfig`，再由各 `provider/<id>/config-adapter` 投影。
- `subagents/{name}/test/stream` 也必须调用同一个 `harness`，不能建立旁路运行实现。
- 按 provider profile → MCP → runtime settings → skills → hooks →
  commands/memory/subagents 的顺序迁移和验收。

完成定义：

- CRUD 修改的是 `HarnessConfigStore`，不是直接修改某个 `provider` 的原生文件。
- 同一资源重复 reconcile 幂等；删除只清理 manifest 管理的投影。
- 不支持的资源语义在 `DistributionReport` 中可见。

### MVP 10：scheduler

API：

- `/api/sandbox/scheduler/jobs` 下的 CRUD、pause、resume 和 trigger。
- `POST /api/sandbox/scheduler/validate-trigger`。
- `GET /api/sandbox/scheduler/runs`。
- `POST /api/sandbox/agent/scheduled-run` 及其 abort 接口。

范围：

- scheduler 只负责解析触发条件和 admission，实际执行必须调用同一个 `harness`。
- 保留幂等接收、同 job 防重入、账户并发上限、超时、abort、retention 和历史记录。
- Claude 和 Pi 共用 scheduler 任务模型；任务中只保存 `SessionRef` 和规范化运行配置。

完成定义：

- job CRUD、pause/resume、立即触发、历史分页和所有权隔离通过 contract tests。
- 重复 dispatch 不产生两次 run；同 job overlap 和账户超限返回稳定错误。
- 两个 `provider` 至少各有一条 scheduler dispatch integration test。

以下长尾 API 不阻塞 Agent 运行主链切换，在 MVP 10 之后迁移：

- skill hub、quick actions、recap setting 和用户文件浏览器；
- user overview、stats、audit、analytics 和 recent activities；
- API docs UI 及其他不影响运行语义的服务外围接口。

第 9 节汇总 MVP 1–5 的累计工程基线，第 10 节描述生产迁移与切换；它们不是另一套
并行的 MVP 顺序。

## 1. 目标

将当前 Claude Runner 已实现的产品级运行时能力抽取到与 `provider` 无关的 TypeScript `core` 和 `harness` 中，再将各个 Agent SDK 放到 `provider` 下。Pi 必须能够实现相同的契约，而无须导入或模拟 Claude 特有的类型、路径、会话记录或私有 API。每个 `provider/<id>/config-adapter` 把一份统一的 `HarnessConfig` 投影为该 runtime 的原生配置格式和目录。HTTP、SSE 和 WebSocket 仍位于独立的 `transport` 边界。

迁移期间，TypeScript 实现与当前 Python 服务并存。在兼容性测试证明替代实现可行之前，现有 Python 文件仍作为生产实现。

## 2. 设计约束

1. 在最初几个迁移阶段保持现有 HTTP、SSE 和 WebSocket 线协议不变。
2. `core` 和 `harness` 均不得导入任何 `provider` SDK。
3. `provider` SDK 的值不得越过 `provider` 边界。
4. 会话始终通过 `{ provider, id }` 寻址；只有 `provider` 原生会话 ID 不能构成 `core` 身份标识。
5. `provider` 能力必须显式声明。不支持的功能应抛出 `UnsupportedCapabilityError`，不得静默采用近似实现。
6. 热运行时、`provider` 会话记录及私有或原始 SDK 协议都属于 `provider` 实现细节。`.claude`、产品化后的 Pi `.bambuddy` 和原生资源格式只能出现在对应 `provider` 的路径模块或配置 `adapter` 中。不得再使用 `~/.pi` 或 `<cwd>/.pi`。
7. HTTP、SSE、WebSocket、定时运行和子 Agent 测试共用一个 `harness` 入口。
8. 规范化运行时事件与公开线协议事件使用彼此独立的 schema。
9. 随附的技能资源及其 Python 辅助脚本继续作为资源保留；迁移 Runner 不要求重写这些脚本。
10. 持久化的 `harness` 配置是唯一事实来源。`provider` 原生文件是生成的投影，绝不能成为第二个权威来源。
11. 配置分发必须具备幂等性，并按 `provider` 报告已应用、已跳过、不支持和失败的资源。

## 3. 现有能力清单

### 3.1 与 `provider` 无关的 `core` 和 `harness`

`core` 定义与 `provider` 无关的领域词汇、契约、能力和错误。`harness` 负责基于这些契约构建运行时行为。下列现有行为应归入 `harness`：

- 运行的所有权、生命周期、取消和终止状态；
- 同时受条目数与字节数限制的有界队列；
- 断开/重连、序列回放、扇出、回放缺口检测、慢消费者隔离和终止事件保留；
- 排队的用户输入轮次及队列取消；
- 权限请求生命周期、超时、权威的待处理快照、重复响应幂等性，以及取消时的默认拒绝；
- 重试策略和退避决策，但不包括 `provider` 会话记录修复；
- 后台任务排空策略和终止任务跟踪；
- 面向文本、附件和已验证图片的请求输入组装；
- 会话产品元数据，例如运行模式、标签、置顶/归档标记、附加目录、摘要、上次响应模型和近期活动；
- 运行、工具和技能的审计边界与活动租约；
- 与 `transport` 无关的错误和能力协商。

### 3.2 由 `provider` 实现的 `core` 契约

契约归属于 `core/contract`，但每个 SDK 都需要在 `provider` 下提供自己的实现：

- 创建、恢复、派生和关闭会话；
- 执行流式输入轮次；
- 引导输入或将后续输入加入队列；
- 中止正在执行的输入轮次；
- 将 SDK 消息映射为规范化事件；
- 将权限决策转换为 SDK 特有的结果；
- 将规范化 `HarnessConfig` 投影为该 runtime 的持久化配置（MCP、skills 等）；
- 列出、读取、删除、派生及回退 `provider` 会话；
- 从 `provider` 错误中恢复，并判断会话是否可以恢复；
- 根据已经解析的运行规格，编译临时且仅供单次运行使用的 SDK 选项。

### 3.3 Claude `provider` 的能力

以下现有行为必须保留在 `provider/claude` 内：

- `ClaudeSDKClient`/CLI 生命周期，以及与会话绑定的热运行时池；
- 运行时租约、cgroup 容量策略、LRU 驱逐、内存压力保护、单会话并发，以及重叠写入作用域保护；
- 原始消息接收、`_query` 控制访问、提示建议排空，以及原生对等输入轮次；
- Claude 消息解析和序列化；
- Claude 权限结果映射和权限模式转换；
- Claude 选项编译、设置覆盖、CLI 参数，以及动态 SDK 兼容性元数据；
- Claude 会话 API 和 JSONL 会话记录读取；
- 检查点回退、孤立工具调用修复、合成记录清理，以及 Claude 特有的重试分类；
- 工作流/子 Agent 会话记录重建和投递旁路记录。

### 3.4 跨 `provider` 配置投影

每个 `provider/<id>/config-adapter` 实现 `ProviderConfigAdapter`，把一份规范化
`HarnessConfig` 落到该 runtime 的原生文件。`ConfigDistributor` 只循环已注册实例，
不出现 provider 名字的分支。加一个 harness 时，落盘代码只新增 `provider/<id>/`，
公共层只多一次注册。

投影覆盖：

- 持久化 MCP 服务定义；
- 技能；
- 命令和提示词；
- 子 Agent/Agent 定义；
- 钩子；
- 用户/项目记忆；
- 持久化工具策略和 `provider` 支持的资源设置。

Claude 投影写入 `$RUNTIME_HOME/harness/.claude` 与 `<cwd>/.claude`。Pi 投影写入
`$RUNTIME_HOME/harness/.bambuddy` 与 `<cwd>/.bambuddy`。不支持的语义必须写入
`DistributionReport`，不得静默丢弃。

```text
HarnessConfigStore（事实来源）
             │
             ▼
     ConfigDistributor（只循环已注册实例）
       ├── provider/claude/config-adapter ──→ .claude
       └── provider/pi/config-adapter     ──→ .bambuddy
```

会话目标、模型、凭证、权限模式、附件、选中的 MCP 子集，以及限定于单次运行的生成工具等每次运行值，不属于持久化投影。它们仍属于 `harness` 运行规格，由各个运行时 `provider` 负责编译。

### 3.5 外围功能

以下功能属于 Agent Runner，但并非第一个 Runtime Core 里程碑的前置条件：

- 配置档案和凭证 CRUD；
- 用户文件和临时附件 CRUD；
- 技能、命令、子 Agent、钩子、MCP 和记忆 CRUD API；
- 计划任务 CRUD、保留策略和回调；
- 技能中心和用户统计 API；
- 视觉路由和生成的内置工具。

在第一阶段，Python 可以继续解析这些功能，并将得到的运行规格传递给 TypeScript 运行时边界。

## 4. 目标目录结构

```text
services/agent-runner/
├── pyproject.toml                         # 迁移期间使用的 Python 包
├── src/priva_agent_runner/                # 当前生产实现
└── ts/
    ├── package.json
    ├── tsconfig.json
    ├── eslint.config.js
    ├── src/
    │   ├── main.ts
    │   ├── runtime-config.ts              # 启动层统一运行目录与配置文件路径
    │   ├── provider/claude/claude-paths.ts
    │   ├── provider/pi/pi-paths.ts
    │   ├── core/                         # 仅包含术语体系与契约
    │   │   ├── run/
    │   │   │   ├── run-command.ts
    │   │   │   ├── run-state.ts
    │   │   │   └── run-error.ts
    │   │   ├── session/
    │   │   │   ├── session-ref.ts
    │   │   │   ├── session-target.ts
    │   │   │   └── session-info.ts
    │   │   ├── event/agent-event.ts
    │   │   ├── permission/permission.ts
    │   │   ├── resource/
    │   │   │   ├── resource.ts
    │   │   │   └── model-profile.ts
    │   │   ├── config/
    │   │   │   ├── harness-config.ts
    │   │   │   ├── projection-plan.ts
    │   │   │   └── distribution-report.ts
    │   │   ├── capability/provider-capability.ts
    │   │   └── contract/
    │   │       ├── agent-provider.ts
    │   │       ├── agent-runtime.ts
    │   │       ├── provider-session-store.ts
    │   │       ├── session-metadata-repository.ts
    │   │       ├── harness-config-store.ts
    │   │       ├── config-distributor.ts
    │   │       ├── provider-config-adapter.ts
    │   │       ├── resource-resolver.ts
    │   │       ├── model-profile.ts
    │   │       ├── audit-sink.ts
    │   │       └── activity-lease.ts
    │   ├── harness/                      # provider 中立的运行时引擎
    │   │   ├── agent-harness.ts          # 唯一执行入口
    │   │   ├── provider-registry.ts
    │   │   ├── run/
    │   │   │   ├── live-run-registry.ts
    │   │   │   ├── input-queue.ts
    │   │   │   ├── retry-policy.ts
    │   │   │   ├── workflow-drain.ts
    │   │   │   └── input-builder.ts
    │   │   ├── permission/permission-broker.ts
    │   │   ├── config/
    │   │   │   ├── config-distributor.ts
    │   │   │   ├── harness-config-service.ts
    │   │   │   └── model-profile-service.ts
    │   │   ├── session/
    │   │   │   ├── session-service.ts
    │   │   │   └── session-enrichment.ts
    │   │   └── concurrency/
    │   │       ├── bounded-async-queue.ts
    │   │       └── replay-buffer.ts
    │   ├── provider/                     # SDK 运行时 + 该 runtime 的配置投影
    │   │   ├── claude/
    │   │   │   ├── index.ts
    │   │   │   ├── claude-provider.ts
    │   │   │   ├── claude-runtime.ts
    │   │   │   ├── claude-event-mapper.ts
    │   │   │   ├── claude-options-compiler.ts
    │   │   │   ├── claude-permission-mapper.ts
    │   │   │   ├── private-api-bridge.ts
    │   │   │   ├── config-adapter/
    │   │   │   │   ├── claude-config-adapter.ts
    │   │   │   │   ├── mcp.ts
    │   │   │   │   ├── skills.ts
    │   │   │   │   ├── commands.ts
    │   │   │   │   ├── subagents.ts
    │   │   │   │   ├── hooks.ts
    │   │   │   │   └── memory.ts
    │   │   │   ├── runtime/
    │   │   │   │   ├── runtime-pool.ts
    │   │   │   │   ├── session-runtime.ts
    │   │   │   │   ├── runtime-lease.ts
    │   │   │   │   ├── admission-policy.ts
    │   │   │   │   └── options-fingerprint.ts
    │   │   │   ├── session/
    │   │   │   │   ├── claude-session-store.ts
    │   │   │   │   ├── transcript-reader.ts
    │   │   │   │   ├── transcript-healer.ts
    │   │   │   │   ├── retry-classifier.ts
    │   │   │   │   └── delivery-log.ts
    │   │   │   └── compatibility/private-api-version.ts
    │   │   └── pi/
    │   │       ├── pi-provider.ts
    │   │       ├── pi-runtime.ts
    │   │       ├── pi-event-mapper.ts
    │   │       ├── pi-permission-mapper.ts
    │   │       ├── pi-session-store.ts
    │   │       └── config-adapter/
    │   │           ├── pi-config-adapter.ts
    │   │           ├── mcp.ts
    │   │           ├── skills.ts
    │   │           ├── commands.ts
    │   │           ├── agents.ts
    │   │           ├── hooks.ts
    │   │           └── memory.ts
    │   ├── transport/                    # 外部请求/事件协议
    │   │   ├── http/
    │   │   │   ├── server.ts
    │   │   │   ├── schema/
    │   │   │   │   └── model-profile-schema.ts
    │   │   │   └── route/
    │   │   │       └── model-profiles.ts
    │   │   ├── sse/
    │   │   ├── websocket/
    │   │   ├── scheduler/
    │   │   └── compatibility/legacy-agent-event-mapper.ts
    │   └── infrastructure/
    │       ├── persistence/
    │       ├── data-spine/
    │       ├── filesystem/
    │       ├── model-profile/
    │       │   ├── json-model-profile-store.ts
    │       │   └── compatible-model-endpoint-client.ts
    │       ├── observability/
    │       └── activity/
    └── tests/
        ├── unit/core/
        ├── unit/harness/
        ├── contract/
        │   ├── provider-contract.ts
        │   ├── claude-provider.contract.test.ts
        │   └── pi-provider.contract.test.ts
        ├── compatibility/
        ├── integration/claude/
        └── integration/pi/
```

这是完整的目标目录树，并不意味着要在一开始就创建其中所有目录。只有在添加某个目录的首个实现文件时，才创建该目录。

## 5. 依赖方向

```text
transport ──→ harness ──→ core
provider ─────────────────→ core
infrastructure ───────────→ core
runtime-config.ts ─────────→ main.ts
main.ts ──→ harness + provider + transport + infrastructure
```

运行时，`main.ts` 会将 `AgentProvider` 与 `ProviderConfigAdapter` 实例注入
`harness`。这属于运行时组装，而不是源码对具体实现的依赖。加一个 harness 时，
只新增 `provider/<id>/` 并在 `main.ts` 注册，不改 `ConfigDistributor` 内部。

- `core` 不引入任何框架、持久化库、传输层模式定义或 SDK。
- `harness` 只依赖 `core`；具体的 `provider` 通过 `core` 契约传入。
- `provider` 包含 Agent SDK 集成，以及该 runtime 的配置投影（`provider/<id>/config-adapter`）。
  它不能引入 `harness` 或 `transport`。Claude 和 Pi 不能相互引入。
- `transport` 将 HTTP、SSE、WebSocket 和调度器输入映射为 `harness` 调用。
- `infrastructure` 实现存储、文件系统、data-spine、日志、指标和活动记录端口。
- `runtime-config.ts` 固定并导出启动层共享的运行目录和配置文件路径；配置文件内容解析后
  也从同一对象进入组装根，不允许各模块自行推导路径。
- `main.ts` 是组装根，也是唯一允许同时引入 `harness`、`provider`、
  `transport` 和 `infrastructure` 具体实现的文件。

使用 ESLint boundaries 或 dependency-cruiser 强制执行这些规则。

## 6. `core` 契约

```ts
export type ProviderId = 'claude' | 'pi';

export type ProviderCapability =
  | 'session.resume'
  | 'session.fork'
  | 'session.rewind'
  | 'stream.partial'
  | 'input.steer'
  | 'input.follow-up'
  | 'permission.intercept'
  | 'hooks'
  | 'mcp'
  | 'skills'
  | 'subagents.native'
  | 'tasks.background'
  | 'checkpoint.file'
  | 'prompt.suggestion'
  | 'session.peer-message';

export interface SessionRef {
  provider: ProviderId;
  id: string;
}

export type SessionTarget =
  | { kind: 'new'; provider: ProviderId; requestedId?: string }
  | { kind: 'resume'; session: SessionRef }
  | { kind: 'fork'; source: SessionRef; requestedId?: string };
```

```ts
export interface RunCommand {
  runId: string;
  actor: {
    username?: string;
    authMethod: 'jwt' | 'api-key' | 'anonymous';
  };
  session: SessionTarget;
  input: UserTurn;
  workspace: { cwd: string; addDirs: string[] };
  model: { profileId?: string; modelId?: string };
  policy: {
    runMode: 'agent' | 'code';
    permissionMode: PermissionMode;
    maxTurns?: number;
    allowedTools: string[];
    disallowedTools: string[];
  };
  features: {
    partialMessages: boolean;
    promptSuggestions: boolean;
    fileCheckpointing: boolean;
    keepRuntimeWarm: boolean;
  };
}
```

这个按职责分组的命令取代了当前执行函数的冗长参数列表，并为重试尝试
创建一个稳定的快照。

```ts
export interface AgentProvider {
  readonly id: ProviderId;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  readonly sessions: ProviderSessionStore;

  openSession(
    target: SessionTarget,
    spec: ProviderRunSpec,
  ): Promise<AgentRuntime>;
}

export interface AgentRuntime {
  readonly session: SessionRef;

  run(turn: UserTurn, context: TurnContext): AsyncIterable<AgentEvent>;
  enqueue(turn: UserTurn, behavior: 'steer' | 'follow-up'): Promise<void>;
  abort(reason?: string): Promise<void>;
  release(retention: 'warm' | 'dispose'): Promise<void>;
}

export interface TurnContext {
  signal: AbortSignal;
  requestPermission: PermissionHandler;
}
```

`harness` 可以请求让运行时保持热驻留，但不能获取 Claude 特有的运行时租约。

```ts
export interface ProviderSessionStore {
  list(query: SessionQuery): Promise<ProviderSessionInfo[]>;
  read(ref: SessionRef): Promise<ProviderSessionInfo>;
  messages(ref: SessionRef): Promise<AgentMessage[]>;
  delete(ref: SessionRef): Promise<void>;
  fork(ref: SessionRef, requestedId?: string): Promise<SessionRef>;
  rewind(ref: SessionRef, checkpoint: string): Promise<void>;
}
```

标签、置顶/归档状态、`add-dirs`、回顾摘要和上次响应所用模型等产品元数据，应归属于
`SessionMetadataRepository`，而不是 `provider` 的会话记录存储。

持久化配置与 `provider` 无关：

```ts
export interface HarnessConfig {
  revision: string;
  scope: HarnessConfigScope;
  mcpServers: readonly McpServerDefinition[];
  skills: readonly SkillDefinition[];
  commands: readonly CommandDefinition[];
  agents: readonly AgentDefinition[];
  hooks: readonly HookDefinition[];
  memory: readonly MemoryDefinition[];
  toolPolicy: ToolPolicy;
}

export interface ConfigDistributor {
  reconcile(
    config: HarnessConfig,
    targets?: readonly ProviderId[],
  ): Promise<DistributionReport>;
}

export interface ProviderConfigAdapter {
  readonly provider: ProviderId;

  plan(
    config: HarnessConfig,
    context: ConfigProjectionContext,
  ): Promise<ProjectionPlan>;

  apply(plan: ProjectionPlan): Promise<ProviderProjectionResult>;
}
```

`ConfigDistributor` 会先为每个目标生成计划，再以逐目标原子写入的方式应用各个
`provider` 的计划。它的报告会明确呈现部分成功；跨目录写入不会被包装成一个虚假的
全局事务。

生成的文件会携带所有权清单和内容哈希。协调过程只能更新或删除受管理的投影；
用户或 `provider` CLI 直接创建的非托管文件应予以保留，除非显式执行导入操作，将其
纳入 `HarnessConfig` 管理。

## 7. 规范化事件边界

`AgentEvent` 是由 `core/event/agent-event.ts` 定义并拥有的可辨识联合类型。它至少
应覆盖：

- 运行开始/完成/失败/重试；
- 会话已识别/已重置；
- 用户消息和助手消息的生命周期；
- 文本增量；
- 工具已请求/已开始/进行中/已完成/失败；
- 权限已请求/已解决/已超时；
- 后台任务已开始/进行中/已结束；
- 提示词建议；
- 队列已接受/已清空/已取消；
- 保活事件。

各 `provider` 的事件映射器负责生成这一联合类型。旧版线协议 `adapter` 再将其转换为
现有的事件标签和载荷结构。`core` 和 `harness` 代码决不能根据 `AssistantMessage`、
Claude 原始消息类型或 Pi 事件名称进行分支判断。

## 8. 从现状到目标的映射

| 当前 Python 源文件 | 目标职责 |
|---|---|
| `claude_sdk/service.py` | `harness`、输入构建器、工作流排空、审计调用，以及 Claude 运行时/事件 `provider` |
| `claude_sdk/options.py` | 与 `provider` 无关的运行规格解析，以及 Claude 选项编译器 |
| `claude_sdk/session_runtime_pool.py` | `provider/claude/runtime` 子树 |
| `claude_sdk/run_registry.py` | `harness/run/live-run-registry.ts` 及重放缓冲区 |
| `claude_sdk/bounded_queue.py` | `harness/concurrency/bounded-async-queue.ts` |
| `claude_sdk/permission_coordinator.py` | `harness` 权限代理，以及 Claude 结果映射器 |
| `claude_sdk/retry.py` | 与 `provider` 无关的重试策略，以及 Claude 会话记录恢复 |
| `claude_sdk/session_heal.py` | Claude 会话记录修复器 |
| `claude_sdk/session_meta.py` | 感知 `provider` 的产品元数据仓库/服务 |
| `claude_sdk/session_add_dirs.py` | 会话产品元数据 |
| `claude_sdk/session_title.py` | 会话信息增强 |
| `claude_sdk/session_recap.py` | 会话信息增强及回顾策略 |
| `claude_sdk/system_prompt.py` | `harness` 提示词组合，以及逐次运行的 `provider` 编译 |
| `claude_sdk/agent_communication_log.py` | Claude `provider` 投递日志 |
| `routers/agent.py` 运行端点 | `transport` HTTP、SSE 和 WebSocket |
| `routers/agent.py` 会话记录/重放解析 | Claude 会话记录读取器 |
| `routers/agent.py` 回退/会话 SDK 调用 | Claude 会话存储 |
| `scheduled_runs/executor.py` | 调用同一个 `harness` 的调度器 `transport` |
| `mcp/config_manager.py` | 规范化 MCP 持久化，以及旧版 Claude 配置导入 |
| `commands.py`、`skills.py`、`subagents.py`、`memory.py` | 规范化资源模型，以及 Claude 配置 `adapter` |
| `hooks/config_manager.py` | 规范化钩子配置，以及 Claude 配置 `adapter` |
| 持久化的 `.claude` 路径和格式 | `provider/claude/config-adapter` 投影 |
| 持久化的 Pi 路径和格式 | `provider/pi/config-adapter` 投影到 `harness/.bambuddy` 与 `<cwd>/.bambuddy` |
| 运行作用域内生成的 MCP/工具 SDK 对象 | 运行时 `provider` 实现 |
| `claude_sdk/client.py` | 删除；由 `core` 契约和 Claude `provider` 取代 |

文件迁移应以行为和测试为依据，而不是逐行翻译代码。

## 9. MVP 1–5 的累计工程基线

完成 MVP 5 时，应累计具备下列工程基线。各项能力随对应 MVP 分步落地，不得把
本节重新合并成一次大规模重写。这个阶段有意不包含完整 API 替换和暖运行时池。

交付内容：

1. 在 `services/agent-runner/ts` 下建立启用严格模式的 TypeScript 软件包；
2. `core` 类型和 `provider` 契约；
3. 规范化事件、错误及 `HarnessConfig` 契约；
4. `ConfigDistributor`，以及 Claude 和 Pi 配置 `adapter` 契约；
5. 一条完整的持久化 MCP 垂直链路，将同一份 MCP 定义投影到 Claude 和 Pi 目标；
6. 投影规划、所有权清单、幂等协调，以及各 `provider` 的分发报告；
7. 有界异步队列和重放缓冲区；
8. 实时运行注册表和权限服务；
9. `harness` 骨架；
10. 一个轻量 Claude `provider`，支持新建会话、恢复会话、流式事件、中止及权限往返；
11. 从规范化事件到旧版线协议事件的映射；
12. 一个最小化的 Pi 运行时 `provider` 测试替身，用以证明 `core` 契约中不存在隐藏的 Claude 类型依赖。

截至 MVP 5 仍不包含：

- 切换生产流量；
- 替换 FastAPI；
- 暖运行时池；
- 高级 session 管理、派生、回退和回顾；
- scheduler 及非 profile/MCP 资源 CRUD API 迁移；
- skills/commands/agents/hooks/memory 投影；
- 完整的 Pi 运行时实现。

### 验收标准

1. TypeScript 严格模式检查通过，公共契约中不含 `any`。
2. `core` 和 `harness` 不包含 SDK 导入，也不包含 `provider` 文件系统名称。
3. Claude SDK 导入只能存在于 `provider/claude` 下。
4. `transport` 与配置投影相互独立；`provider/<id>/config-adapter` 不暴露 HTTP/SSE/WS 关注点，运行时 `provider` 不写入持久化资源配置。
5. 同一份规范化持久 MCP 测试夹具能生成有效的 Claude 和 Pi 投影，并且第二次协调不产生任何变更。
6. 删除该 MCP 时，只删除投影所有权清单所拥有的文件/条目；未托管的 `provider` 配置保持不变。
7. 不支持的字段和 `provider` 的部分失败在分发报告中清晰可见。
8. 契约测试覆盖新建运行、恢复、文本流式传输、工具生命周期、权限、中止及 `provider` 错误映射。
9. 重放、背压和慢消费者测试保持当前行为不变。
10. 现有 Python runner 测试继续通过。
11. 黄金测试夹具表明已迁移的 WebSocket 线协议格式没有变化；HTTP/SSE 仍由
    Python 路径提供。
12. TypeScript 路径仅通过隔离的 `harness` 或影子模式运行。

## 10. MVP 路线的迁移与生产切换顺序

1. 在 MVP 1 前冻结当前线协议黄金测试夹具和 `provider` contract tests。
2. 每个 MVP 都只在隔离环境或影子模式启用；现有 Python runner 继续承载生产流量。
3. MVP 1–4 持续对比 Claude Python/TypeScript 的事件流、session 和错误语义。
4. MVP 5 先以 dry-run 方式核对 Claude/Pi 配置投影和所有权 manifest，再允许写入。
5. MVP 6 的 Pi `provider` 先通过 contract 和 integration tests，再进入影子运行。
6. MVP 7 完成 HTTP、SSE 和 WebSocket 一致性后，开始 Claude 小流量金丝雀发布。
7. MVP 8 在 `AgentRuntime` 背后补齐暖运行时池和高级 session 能力。
8. MVP 9–10 分别完成资源投影和 scheduler 影子验证，不得创建新的运行旁路。
9. 全量回归和浸泡测试通过后切换生产流量，最后移除 Python 运行路径。

不要创建 Claude/Pi 共享基类、通用事件总线，也不要为每个端点创建一个类。优先采用小型契约、可辨识联合类型和组合。
