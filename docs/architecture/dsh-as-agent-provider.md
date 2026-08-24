# 将 DeepSeek Harness（dsh）作为 Agent Provider 的调研

状态：可行性调研（不实施）  
范围：`services/agent-runner` 与 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的衔接  
相关基线：`docs/architecture/agent-runner-ts-implementation.md`  
调研日期：2026-08-19

## 结论

1. **可以作为第三套 Agent Provider**，与现有的 `claude` / `pi` 同级接入，而不是当成模型供应商。
2. **正确嵌入面是官方 JSON-RPC SDK**（`@deepseek-ai/dsh-sdk-client` + `dsh-jsonrpc-agent` 子进程），不是 `dsh web`，也不是 `dsh --profile headless`。
3. **DSH 插件系统可以融入，但只能挂在 DSH 子进程的 Cordis 树上**，不能变成 runner 自己的插件内核，也不能让 Claude / Pi 直接加载 Cordis 插件。
4. 当前 runner 仍停在 MVP 1：`main.ts` 硬编码 Claude、单轮、无 provider registry。加 DSH 不需要改 `AgentEvent` 语义，但用户可选 provider 要等 registry；和 Claude/Pi 对齐的 MCP / skills / hooks 投影要等 `ProviderConfigAdapter`。

本文只记录调研结论与建议边界，不包含实现。

## 1. 先分清两层 provider

前端 `KnownModelProviderId` 里已经有 `deepseek`，那是 **模型厂商**（从 model id 猜图标）。Runner 的 `ProviderId` 是 **Agent 运行时**：

```ts
export type ProviderId = 'claude' | 'pi'
```

DSH 必须使用独立 id（建议 `'dsh'`），不要和 UI 的 `deepseek` 混用。一份 Model Profile（`baseUrl` + `authToken` + 模型名）仍然可以喂给 DSH，去打 DeepSeek Official 或其它兼容端点。

```text
用户 / UI
    │  WS /api/sandbox/agent/ws/run
    ▼
AgentHarness          ← 产品侧编排（事件归一；以后才有 registry / session / permission）
    │  AgentProvider.openSession()
    ▼
┌─────────┬─────────┬─────────┐
│ claude  │   pi    │   dsh   │  ← 真正的 agent loop + 工具
└─────────┴─────────┴─────────┘
    │
    ▼
LLM 端点（Anthropic / 自建 / DeepSeek Official / OpenAI-compat）
```

## 2. 当前 runner 实际状态

目标架构见 `docs/architecture/agent-runner-ts-implementation.md`：`transport → harness → provider`，provider 只做 SDK 适配，事件统一成 `AgentEvent`。落地比文档小。

已有：

- 契约：`AgentProvider` / `AgentRuntime` / `AgentEvent`
- Claude：`@anthropic-ai/claude-agent-sdk` 进程内 `query()`，带 event mapper
- Pi：代码和 mapper 齐了，`main.ts` 未接线
- WS 单轮：`init { text }` → 流式 `AgentEvent` → 关连接
- Model Profile HTTP CRUD，和 run 还没连上

没有：

- `provider-registry`（文档有，代码没有）
- session resume / fork（契约有 `resume`，Claude/Pi 都直接拒绝）
- permission、steer、MCP adapter、多 transport

组装根现在写死 Claude：

```text
main.ts
  ├── ClaudeProvider(globalConfigDir = $RUNTIME_HOME/harness/.claude)
  ├── AgentHarness({ provider: claude, cwd })
  └── HTTP + WS /api/sandbox/agent/ws/run
```

一次 turn：

```text
WS init.text
  → AgentHarness.run()
      yield run.started
      provider.openSession({ kind:'new' })
      runtime.run(UserTurn) ──async iterable──► AgentEvent
      runtime.release('dispose')
  → encodeServerFrame → 关 socket
```

加 DSH 不需要改 core 语义，只要再做一个 `provider/dsh/*`，模式照抄 Claude/Pi。要让用户选择 provider，还得先有 registry；当前切片只能像 Claude 一样在 `main.ts` 硬切。

## 3. DSH 是什么

DSH 自己也是完整 harness：Cordis 插件树里，agent loop、工具、session log、sandbox、LLM adapter 全是插件。对外三档入口：

| 入口 | 用途 | 适不适合当 runner provider |
|---|---|---|
| `dsh web` | 自带 UI（默认 `:3080`） | 不适合，会再开一套产品面 |
| `dsh --profile headless "task"` | 一次性任务，stdout 打最后一段助手文本 | 不适合，没有流式、没有多轮 |
| `@deepseek-ai/dsh-sdk-client` + `dsh-jsonrpc-agent` | 子进程 stdio JSON-RPC | **适合**，就是给外部程序嵌 runtime 用的 |

SDK 线协议很窄：

```text
client → initialize(cwd, provider, model, maxTokens?)
client → session/prompt(sessionId, contentBlocks)  → 立刻返回 messageId
client → shutdown
server → session.event     完整 SessionEvent
server → session.status    idle | running
server → subagent.started / subagent.finished
```

高阶 API：`DeepSeekHarness.run(text)` = 入队 prompt → 等到 inbox receipt → 等到整 agent `idle`。

调研时的 npm 版本（均为 RC；DSH 处于 developer preview，**明确会破兼容**）：

| 包 | 版本 | 角色 |
|---|---|---|
| `@deepseek-ai/dsh-sdk-client` | `0.0.1-rc.1` | TS 客户端 |
| `@deepseek-ai/dsh-sdk-protocol` | `0.0.1-rc.1` | 线协议类型 |
| `@deepseek-ai/dsh-sdk-jsonrpc-demo` | `0.0.1-rc.5` | bin `dsh-jsonrpc-agent` |
| `@deepseek-ai/dsh` | `0.1.0-rc.7` | CLI / 产品入口 |

TS 侧 **没有** 打包好的 runtime（Python SDK 有）。调用方必须自己指定 `command`/`args`，并给一份包含 `dsh-sdk-jsonrpc-server` 的 `cordis.yml`。stdout 只能走 JSON-RPC，诊断必须打 stderr。

## 4. 推荐嵌法：DSH 当 Claude 那种 SDK 边界

```text
priva AgentHarness
        │
        │  DshProvider.openSession()
        ▼
   DshRuntime  持有 DeepSeekHarness / HarnessClient
        │  spawn
        ▼
dsh-jsonrpc-agent + cordis.yml     （子进程，stdout 纯 JSON-RPC）
        │
        ├── dsh-base（工具 / sandbox / session log）
        ├── llm adapter（deepseek-official 或自定义）
        └── sdk-jsonrpc-server
```

对照现有 provider：

| 点 | Claude | Pi | DSH（建议） |
|---|---|---|---|
| 集成面 | 进程内 Agent SDK | 进程内 session 对象 | **子进程 SDK** |
| 流式 | `query()` async iterable | subscribe | `session.event` + `session.status` |
| 结束 | SDK `result` | `agent_end` | 根 session `idle`，或 `turn/end` |
| abort | `query.interrupt()` | `session.abort()` | **协议没有 cancel，只能关进程** |
| resume | 本切片不支持 | 同左 | SDK 可用同一 `sessionId` 再 prompt |
| 工具 | Claude 自己的 | Pi 自己的 | **DSH 自己的 bash / editor / …** |
| 配置目录 | `$RUNTIME_HOME/harness/.claude` | `$RUNTIME_HOME/harness/.pi/agent` | 应隔离到 `$RUNTIME_HOME/harness/.dsh` |

这符合基线文档的边界：`core` / `harness` 不 import SDK；DSH 类型只出现在 `provider/dsh`。

这是套娃 harness，不是薄 LLM 客户端。DSH 自带 loop、工具、sandbox、session log。Runner 只负责：开会话、推用户文本、把事件归一化给 UI。工具执行、权限、MCP 都在 DSH 里。这和 Claude / Pi 一样，不是新问题。

### 4.1 事件映射

Runner 的 `AgentEvent` 和 DSH `SessionEvent` 是同类东西，mapper 工作量和 Claude / Pi 相当：

| DSH | Runner `AgentEvent` |
|---|---|
| `assistant/chunk` `text-delta` | `assistant.text_delta` |
| `assistant/chunk` `reasoning-delta` | `assistant.thinking_delta` |
| `assistant/chunk` `tool-call-delta` | `tool.input_delta` |
| `tool/call` | `tool.started`（`callId` → `id`） |
| `tool/result` | `tool.completed` |
| `assistant/message` | `assistant.message` |
| `turn/end` / `session.status=idle` | `run.completed` / `run.failed` |
| `assistant/message.usage` | `TokenUsage`（字段名要换：`inputTokens` → `input`） |

子 agent 的 `subagent.*` 现在 runner 没有对应事件，第一刀可以丢掉或压成 tool 生命周期。

一次 DSH turn（映射后）：

```text
openSession
  spawn dsh-jsonrpc-agent
  initialize({ cwd, provider, model })
run(text)
  subscribe notifications
  session/prompt({ sessionId, contentBlocks:[{type:text,text}] })
        │
        ├─ session.event assistant/chunk*  → text_delta / thinking_delta
        ├─ session.event tool/call         → tool.started
        ├─ session.event tool/result       → tool.completed
        ├─ session.event assistant/message → assistant.message
        └─ session.status idle             → run.completed
abort  → client.close()（杀子进程，不是 interrupt）
release → shutdown + EOF/SIGTERM/SIGKILL
```

### 4.2 合得上，但有几处硬缝

**权限对不齐。** DSH 有 `approval/asked`，但 SDK 写明 server→client request 是死能力，审批流还没接到 JSON-RPC。Runner 的 `PermissionBroker` 也还没做。第一刀只能让 DSH 自己 auto-approve / bypass，和现在 Claude 的 `bypassPermissions` 同类。

**没有中途 cancel。** 放弃一轮 = 关 runtime。WS 断开时现在 Claude 是 `interrupt()`；DSH 会丢掉整段 session 进程。要真正 abort，得接受「杀进程 ≈ abort」。

**凭证和 Model Profile。** `initialize` 只要 DSH 的 `provider` + `model`（常见 `deepseek-official` + 模型名）。密钥走子进程 env（如 `DEEPSEEK_API_KEY`），不是 runner 的 `model-profiles.json`。要把现有 Profile 接进去，需要把 `authToken` / `baseUrl` 打进 DSH env 或 `cordis.yml`，或给 DSH 挂自定义 LLM adapter。`initialize` 的 fallback **只自动挂 DeepSeek adapter**；其它未注册 route 会初始化失败。

**发布形态脆。** TS 必须自备 `dsh-jsonrpc-agent` + 一份干净 `cordis.yml`（stdout 不能有 logger）。Headless profile 不能当 SDK 用。DSH 还在 developer preview，mapper 会跟 `SessionEvent` 一起破。

**和 MVP 路线的位置。** 基线顺序是 Claude → profile/MCP → Pi。DSH 是第三个同类 provider。现在插进去技术上可行，但会超前：registry、run 绑 model profile、capability 声明都还没有。Pi 已经是「代码在、没接线」的样板。

### 4.3 不建议的嵌入方式

- **把 runner 做成 DSH 插件（反过来嵌）。** 产品面会变成 DSH Web，WS / model-profile / shadcn UI 都要重铺。目标是「dsh 也作为 provider」，不是换产品内核。
- **`dsh --profile headless` 当 provider。** 一次性、非流式、靠 `ctx.appExit`，对不上 `AgentRuntime.run(): AsyncIterable<AgentEvent>`。
- **进程内 `require` Cordis 树。** 没有稳定 in-process SDK；官方嵌入面就是子进程。会把 Cordis 生命周期泄漏进 runner。

## 5. 插件系统能否融入

能融，但只能融进 DSH 这一侧。

DSH 插件是 Cordis 模块：`apply(ctx)` 里往 `ctx.tools` / `ctx.llm` / `ctx.agents` 上挂能力。它们依赖 **正在跑的 DSH 进程**。当前 runner 没有 Cordis，也没有自己的插件树；规划中的扩展面是「一份 `HarnessConfig`，再投影到各 provider 的原生格式」。两套东西层级不同。

```text
生态插件（dsh-plugin / MCP / skill / hook / LLM adapter）
        │  只能挂在这里
        ▼
┌──────────────────────────────────────┐
│  DSH 子进程（Cordis 树）              │
│  ctx.tools  ctx.llm  ctx.agents ...   │
└──────────────────────────────────────┘
        │  JSON-RPC / AgentEvent
        ▼
priva AgentHarness     ← 没有 ctx，不能 mount Cordis 插件
        │
   ┌────┴────┐
 Claude     Pi         ← 同样听不懂 Cordis
```

### 5.1 三条路

**A. DSH 当 provider 时，在它的 `cordis.yml` 里装插件 —— 推荐**

SDK 拉起来的本来就是完整 harness，组合由 `cordis.yml` / `DSH_CORDIS_CONFIG` / patch 决定。工具、MCP、skill、LLM adapter、sandbox、社区 `dsh-plugin` 都在子进程里生效。Runner 只看到归一化后的 `AgentEvent`。

```text
HarnessConfig / 运行时选项          以后才有
        │
        ▼
adapter/dsh  ──写出──►  $RUNTIME_HOME/harness/.dsh/cordis.yml
                              │
                              ▼
                    dsh-jsonrpc-agent
                      ├── dsh-base
                      ├── sdk-jsonrpc-server
                      ├── dsh-mcp-client（MCP）
                      ├── 某个 @dsh-external/xxx
                      └── 产品自己的 tool 插件
```

这和 Claude 吃 `.claude/`、Pi 吃 `.pi/` 是同一类事：插件留在 provider 原生世界，不要穿到 `core`。

能直接用的类别：

| DSH 插件类型 | 挂在 DSH 里 | 对 runner / UI 的影响 |
|---|---|---|
| 工具 `ctx.tools.register` | 能 | 变成 `tool.started/completed` |
| MCP client | 能 | 同上，工具名来自 MCP |
| Skill / prompt section | 能 | 只改变模型看到的上下文 |
| LLM adapter | 能 | `initialize.provider` 要指到已注册 route |
| Hook（`tools/pre-execute` 等） | 能 | 审批若走 `ask`，SDK 还接不回 UI |
| Sandbox / fs / shell backend | 能 | 执行世界留在子进程 |
| 子 agent provider | 部分 | runner 没有 subagent 事件，第一刀会丢 |
| Web UI / ConversationNode | 不能当产品 UI | 产品走 shadcn + `AgentEvent` |
| 换掉 `agent-loop` | 技术上能 | 等于换掉 DSH 内核，不要从 runner 去开这个口 |

社区插件用 `dsh plugin add` 或 patch 插一行；路径必须是 DSH 进程能解析的绝对路径 / 包名。

**B. 把 Cordis 装进 runner，让 Claude/Pi 也吃 DSH 插件 —— 不建议**

插件要的是 `ctx.agents`、waterfall（`agent/pre-step`、`tools/pre-execute`）、session log。Claude Agent SDK 和 Pi 没有这套缝。硬接等于：

- `core` / `harness` 开始依赖 `@deepseek-ai/cordis`（和「provider SDK 不得越界」冲突）
- 或者在 runner 里再跑一棵 DSH 树，Claude/Pi 变成这棵树里的 subagent，产品内核就换成 DSH 了

DSH 自己已经用反方向桥接证明了这一点：`dsh-hooks-claude-code` 是把 Claude 的 `hooks.json` **翻译进** Cordis 事件，不是让 Cordis 插件在 Claude 里跑。

**C. 以后做第三个 `ProviderConfigAdapter`，把产品配置投影成 DSH 插件行 —— 和架构文档一致，但现在还没到**

基线文档里的模型是：

```text
HarnessConfigStore（MCP / skills / hooks / memory）
        │
 ConfigDistributor
   ├── ClaudeConfigAdapter → .claude/
   ├── PiConfigAdapter     → .pi/
   └── DshConfigAdapter    → cordis patch / 插件行   ← 还没写，位置就是这里
```

到 MVP 5/9 时，DSH 的「原生格式」不是再写一份 `.claude.json`，而是 Cordis 行，例如 MCP → `dsh-mcp-client` 配置，hooks → 原生 listener 或 Claude 方言桥。不支持的语义进 `DistributionReport`，不要静默丢。

当前代码里 adapter、HarnessConfig、distributor 都还不存在，所以这条是路线图，不是现成能力。

### 5.2 做不到的「同一套插件到处跑」

一份 DSH 插件 **不能** 同时给 Claude 和 Pi 用。产品侧要跨 provider 的扩展，只能继续走规范化资源：

```text
产品 MCP / skill / hook 定义
        │  投影
   ┌────┼────────────┐
   ▼    ▼            ▼
Claude  Pi    DSH（变成 Cordis 插件/配置）
文件    文件   进程内 ctx.*
```

三边能力也不齐：DSH 的 Code Mode、plan mode、`ctx.jobs`、Creator 热加载，Claude/Pi 没有对应物；Claude 的 permission 往返，DSH SDK 也还没有。投影层必须显式报差距。

热加载（HMR / `ctx.effect` 卸载）只存在于 DSH 进程内。Runner 这边一次 run 结束就 `release('dispose')`，现在还是杀进程；插件生命周期跟 WS 连接不是一回事。

## 6. 两层怎么叠

| 层级 | 是否融入 | 何时有意义 |
|---|---|---|
| Provider：用 SDK 跑 DSH | 插件自动跟着 runtime 走 | 接 DSH 的第一天 |
| 固定 `cordis.yml`（官方工具 + DeepSeek adapter） | 用 DSH 默认插件集 | 最小切片 |
| 允许用户/产品往 DSH 树加 out-of-tree 插件 | 真正「融入插件生态」 | provider 稳定之后 |
| `DshConfigAdapter` 投影 MCP/skills/hooks | 和 Claude/Pi 同一套产品配置 | MVP 5 一类工作 |
| Runner 自己变成 Cordis 宿主 | 不融入，是换内核 | 不走这条 |

## 7. 若以后实现，建议的最小切片

只描述范围，本文不实施：

1. `ProviderId` 增加 `'dsh'`。
2. `provider/dsh/`：`dsh-provider` / `dsh-runtime` / `dsh-event-mapper` / `dsh-paths`。
3. 依赖：`@deepseek-ai/dsh-sdk-client`，运行时启动 `dsh-jsonrpc-agent`。
4. 第一刀只做 **new session + 单轮文本 + 流式映射 + dispose 杀进程**，和现在 Claude 切片对称。
5. `resume` / permission / 子 agent 事件：按契约丢 `UnsupportedCapabilityError`，不要假装有。
6. 测试：纯 mapper 单测（对 Claude/Pi 那套），不要在单测里真拉 DSH。

会改变实现、需要先拍板的点：

- 默认 LLM route：死绑 `deepseek-official`，还是从 Model Profile 投影？
- `dsh-jsonrpc-agent` 是 npm 依赖还是环境里自备 bin？
- abort 是否接受「杀进程」？

## 8. 参考

- 本仓库基线：`docs/architecture/agent-runner-ts-implementation.md`
- 当前契约：`services/agent-runner/ts/src/core/contract/agent-provider.ts`、`core/event/agent-event.ts`
- 当前组装：`services/agent-runner/ts/src/main.ts`
- DSH 架构：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md>
- DSH SDK：<https://deepseekdocs.com/en/docs/guides/drive-harness-from-program>
- Cordis 插件：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md>
- 扩展 cookbook：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/extension-cookbook.md>
