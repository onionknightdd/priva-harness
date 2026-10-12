# Harness 流协议 v3 设计草案

状态：设计草案，未实施、未替换当前 v2。核对日期：2026-09-27。

目标：保留所接入运行时接口的原始输出，同时让 Web 和程序消费方按少量统一字段
连续渲染。当前核对范围是 Codex、Claude Code / Agent SDK、Pi SDK / RPC。

已确认的要求：允许将各 harness 字段归一化到共享 schema，但不能省略输出内容；
Claude 继续使用当前 tmux/TUI。当前 Chat / TUI 使用体验已经可用，本轮设计重点是
让非 UI 的 HTTP / WS 调用也能获得完整输出，不要求用户打开浏览器来维持采集。
不要求 JSON 的原始空白、键顺序一致；终端通道仍用字节记录承载其特有输出。

## 1. 推荐结论

使用「统一输出数组 + 完整来源记录」：每个数据帧保留一条完整来源记录，并附带
零到多个有序数组的局部替换。每个替换携带受影响输出项当前的完整状态，消费方
只执行数组操作，不建立 provider 专用的消息 / block / 工具关联表。

共享的 output 是面向调用方的主要契约。native 保存来源对象，用于承接无法归一化
的额外字段和新事件；普通组件无需解析它。保留完整 native 是本草案为实现“不丢
内容”选择的方案，不表示用户要求重复保留两套字段或要求字节级 JSON 回放。

```text
Codex App Server    Claude SDK    Claude TUI channels    Pi SDK / RPC
       \                |                |                  /
        +---------------+----------------+-----------------+
                                |
                 Capture: clone / serialize immediately
                                |
                 Ordered native journal: streamId + seq
                         /                  \
                 native replay          provider adapter
                                             |
                                   ordered output items
                                             |
                           Frame { native, output.edits[] }
                                      /            \
                                     WS            SSE
                                      \            /
                                 shared validator
                                          |
                     items.splice(index, deleteCount, ...items)
                                          |
                                       UI / code
```

保留原始事件不依赖映射器理解该事件。新增或未知事件允许没有专用组件，但必须
仍能读取、导出并按原序回放；通用事件查看器可显示 native。组件投影可以重新生成，
原始记录保持不变。不能把“API 返回完整内容”和“每条记录都显示为聊天气泡”混同。

## 2. 原生接口对比

版本基线：本机 Codex CLI `0.158.0-alpha.2.1`；项目安装的
`@anthropic-ai/claude-agent-sdk` 为 `0.3.278`，Pi coding-agent / ai 为 `0.84.2`。
Codex App Server 类型另由本机 `generate-ts` 导出核对；没有启动模型调用。
官方 main 分支文档可能领先于项目版本，适配器必须记录实际版本。

| 接入面 | 公开输出形状 | 对本设计的启发 / 限制 |
| --- | --- | --- |
| Codex App Server | JSON-RPC 风格的 notification、server request、response；`item/started`、`item/agentMessage/delta`、`item/completed` 等 | item 的生命周期和最终权威状态很清晰；消费者仍需关联 thread / turn / item。审批是 server request，不能只记录 notifications。 |
| Codex `exec --json` / TypeScript SDK | JSONL / SDK 事件；`thread.started`、`turn.*`、`item.*` | 属于另一种接入面，不能把它和 App Server 的字段、事件覆盖范围混为一谈。 |
| Claude Agent SDK / CLI stream-json | `system`、`assistant`、`user`、`result` 等；启用 partial 后另有 `stream_event.event` | 原始外层字段与内层 API 事件都需要保留；完整 assistant 消息可能只交付一个 block，不能按消息 ID 覆盖整条回答。 |
| 当前 Claude tmux/TUI | hooks、MessageDisplay、原生 transcript JSONL、终端字节 | 是多个有不同语义的观察通道；终端字节适合终端回放，hooks / transcript 适合结构化投影。它们不是 SDK 事件全集。 |
| Pi SDK | `message_update.message` 和 `assistantMessageEvent.partial` 等累计状态，加 message / tool / retry / compaction 事件 | 累计状态对嵌入式 UI 很方便；复制和序列化前必须防止后续对象修改影响已记录内容。 |
| Pi JSON / RPC | JSONL；message_update 移除累计 message / partial，保留 delta 和 usage；另有 command response / extension UI 协议 | 网络流降低重复数据，但接收方必须组装内容；这项组装应由适配层承担。 |

三项不能忽略的语义：

- Codex 的最终 item 是权威结果；例如 plan 最终文本不保证等于所有 delta 的简单拼接。
- Claude 公开的流式接口并不保证转发子 Agent 的 token 级增量，完整消息与流事件的
  `parent_tool_use_id` 能力也不同。协议不能虚构未收到的输出。
- Pi 的 `agent_end` 只结束一个底层运行；之后可能重试或继续处理队列。
  `agent_settled` 才表示该次会话级处理没有待自动继续的工作。

参考：

- [Codex App Server events](https://developers.openai.com/codex/app-server#events)
- [Codex App Server approvals](https://developers.openai.com/codex/app-server#approvals)
- [Codex non-interactive output](https://developers.openai.com/codex/noninteractive)
- [Claude Agent SDK streaming](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [Pi JSON events](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)
- [Pi RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)

## 3. 两种顺序，两种完整性

`seq` 是原始记录被捕获后的总顺序，用于事件回放、去重和断点续传。
多个独立通道之间不存在天然全局因果顺序；这里定义的是捕获顺序，不是根据
时间戳猜出的执行顺序。同一来源通道的原始先后顺序必须保留。

`output.edits[].index` 是对当前输出数组应用操作的位置，不是组件身份。
`deleteCount` 表示删除多少项，`items[]` 表示在该位置插入的完整新状态。
语义与 JavaScript 的 `splice` 一致，但不允许越界或负数。组件内部的 `content[]`、
`children[]`、`steps[]` 本身就是显示顺序。

```text
frame seq=40: first text    -> insert(0, [text A])
frame seq=41: another text  -> insert(1, [text B])
frame seq=42: late tool     -> insert(1, [tool])
frame seq=43: B updated     -> replace(2, [updated text B])

native replay: [40, 41, 42, 43]
output items: [text A, tool, updated text B]
```

消费方只需要一个续传游标和顺序执行数组替换，不负责追踪各 provider 的
message ID、block index、tool-call ID 之间的关系。这些关系仍然存在，由后端适配层管理。

使用局部数组替换而不是固定 slot 的原因：当前 Claude 的 MessageDisplay 可先于
transcript 到达，后者可能带来需要插在已显示文本之间的工具或其他内容。固定且
不可重排的 slot 无法表达这种修正；数组替换支持插入、更新、删除和最终纠正。

完整性分为：

- **原始记录完整**：所声明采集通道的每条记录、所有原始字段与原始顺序均保留。
- **显示状态完整**：组件状态是某个游标之前已处理记录的投影。

显示快照不能补回丢失的原始事件。把结构化消息拼成最终文本，也不等于还原原始
事件序列。前者消费 `output`，后者直接读取 `native`。

## 4. 核心数据帧

下面是控制字段的核心契约。`OutputItem` 在独立的按 `kind` 区分的共享 schema
中定义；例子展示 message 和 tool。产品对象不能任意扩展顶层字段。任意来源字段
集中于 `native.value`；工具参数、结构化结果等指定的数据字段也允许 JsonValue。

```ts
type JsonValue = null | boolean | number | string
  | JsonValue[] | { [key: string]: JsonValue }

type NativeSource = {
  harness: 'codex' | 'claude' | 'pi'
  interface: string       // codex.app-server / claude.sdk / claude.transcript / pi.sdk ...
  version: string         // 实际运行版本
  instanceId: string      // 实际进程或 SDK 实例身份
  channel: string         // notifications / requests / transcript / display ...
}

type NativeRecord = { source: NativeSource } & (
  | { format: 'json'; value: JsonValue }
  | { format: 'bytes'; encoding: 'base64'; value: string }
)

type OutputEdit = {
  index: number           // 当前数组的位置；非负整数
  deleteCount: number     // 删除项数；非负整数
  items: OutputItem[]     // 在 index 插入的完整当前状态
}

type Projection =
  | { status: 'applied'; edits: OutputEdit[] }
  | { status: 'unmapped'; edits: [] }
  | {
      status: 'failed'
      edits: []
      error: { code: string; message: string }
    }

type EventFrame = {
  v: 3
  kind: 'event'
  streamId: string
  seq: number
  ts: number              // 捕获时间，UTC epoch 毫秒；原生时间仍在 native.value 内
  context: {
    sessionId: string | null
    runId: string | null
  }
  native: NativeRecord | null // null 明确表示 host 生成的记录
  output: Projection
}
```

约束：

1. 一条原始记录对应一条 event frame，序号由单一序列器分配。
   一个原始事件可以更新多个组件，按 `edits[]` 顺序应用后一次提交显示。
   同一帧内后一条 edit 的 index 以应用前一条后的数组为准。创建、更新、删除分别
   表达为 `(index, 0, [item])`、`(index, 1, [item])`、`(index, 1, [])`。
2. `native.value` 保留整个原始对象，包含最外层包装、未知字段、签名、usage、
   tool result details、原生请求 ID 等。不能从已归一化的 `AgentEvent` 反向生成它。
3. 原始数据在 SDK 回调 / JSONL 解码入口立即复制或序列化；不能保存可继续变化的引用。
4. 同一个 stream 内 `seq` 从 1 开始连续递增并持久化，所有序号和位置均为安全整数；
   重启如果无法继续该日志，使用新 streamId 并明确报告边界，不能复用旧 ID 后把
   序号归零。
5. `runId: null` 表示记录不归属某次 run，不使用空字符串。native 内的原生 ID
   原样保留，context 中的产品归属由适配层决定。
6. `unmapped` 表示原始记录已保存，但当前没有可渲染映射；`failed` 表示投影失败。
   二者都不能导致原始记录被丢弃。host 的告警和生命周期记录使用 native=null。
7. bytes 变体用于终端等字节来源。JSON 变体保证 JSON 数据语义一致，
   不保证原始空白、键顺序或数字字面量写法一致。若要求这些也一致，
   应保存字节。SDK 的非 JSON 值需要显式 codec 或报告编码失败，不能静默丢字段。

## 5. 组件状态的边界

每个 OutputItem 必须有稳定 `id`、`kind` 和具体类型的状态字段。产品 ID 不直接
等于 provider message ID，避免 TUI 临时显示记录与落盘 ID 对齐时重建 UI。

核心组件种类可包括 message、tool、agent、plan、interaction、notice、usage 和
run。每种都有独立的严格 schema，不使用一个包含所有可选字段的大对象。

| kind | 主要内容 | 状态语义 |
| --- | --- | --- |
| message | role、按顺序排列的 content[] | streaming / complete / failed / cancelled |
| tool | name、input、output[]，保留结构化参数与结果 | pending / running / complete / failed / cancelled |
| agent | name、children[] | 子 Agent 自身生命周期，不替代主 run 状态 |
| plan | steps[] | 每步的状态和顺序 |
| interaction | requestId、请求类型与 schema、选择项或问题 | pending / resolved / cancelled |
| notice | severity、code、text、必要的结构化 details | 瞬时通知或持久通知由具体子类型规定 |
| usage | token 分类、模型、费用及原始精度 | 明确是某次调用值还是累计值，不能重复累加 |
| run | runId、model、phase、outcome、error | phase 与最终 outcome 分开，不把 accepted 当 complete |

文本、思考摘要、工具调用按原始内容顺序保留；不要先收集所有文本，再把工具统一
放在后面。一个 provider message 可以归一化为多个相邻输出项；provider messageId
不是强制的 UI 容器边界。工具之间出现新文本时创建新片段，不把它拼回前面的文本项。

示例 message：

```json
{
  "id": "item-2",
  "kind": "message",
  "role": "assistant",
  "status": "streaming",
  "content": [
    { "kind": "text", "text": "Hello world" }
  ]
}
```

示例 tool：

```json
{
  "id": "item-3",
  "kind": "tool",
  "name": "read_file",
  "status": "running",
  "input": {
    "status": "complete",
    "text": "{\"path\":\"README.md\"}",
    "value": { "path": "README.md" }
  },
  "output": [
    { "kind": "text", "text": "# Project\n" }
  ]
}
```

未完成的工具参数允许 `input.status = streaming`、`text` 是不完整 JSON、
`value = null`；完整参数到达后才标记 complete 并提供解析值。参数是合法的 JSON null
时，完整标记可以将它与「尚未解析」区分。原生最终值在适配器中覆盖暂存拼接值。

`content[]` / `output[]` 应支持文本、可显示的思考摘要、图片、文件、结构化 JSON
等判别类型。工具的结构化结果不应统一转成字符串。大对象可以有明确的附件引用，
但引用不等于完整保留：原始内容必须仍可取回，且不能悄悄截断 native。

子 Agent 由 agent 组件的 `children[]` 表达，数组顺序即显示顺序。初版更新该组件
的完整状态，把复杂关联留在后端。若测量发现单个子树太大，再定义更细的组件粒度。

id 作为组件身份和 UI key 保持稳定，位置可随数组替换移动。删除不复用旧 id 给新
组件；撤回记录仍保存在 native 日志。晚到的过期源事件不能复活已撤回内容，由适配器
依据来源语义处理。原生 fallback / supersedes、历史补插和最终重排均使用同一套
数组替换，不增加 provider 专用的客户端指令。

## 6. 一条实际数据帧示例

下面是依据 Codex App Server 字段构造的示例，不是真实用户会话数据。

```json
{
  "v": 3,
  "kind": "event",
  "streamId": "stream-1",
  "seq": 42,
  "ts": 1790496000000,
  "context": { "sessionId": "session-1", "runId": "run-1" },
  "native": {
    "source": {
      "harness": "codex",
      "interface": "codex.app-server",
      "version": "0.158.0-alpha.2.1",
      "instanceId": "process-1",
      "channel": "notifications"
    },
    "format": "json",
    "value": {
      "method": "item/agentMessage/delta",
      "params": {
        "threadId": "native-thread-1",
        "turnId": "native-turn-1",
        "itemId": "native-item-1",
        "delta": " world"
      }
    }
  },
  "output": {
    "status": "applied",
    "edits": [
      {
        "index": 2,
        "deleteCount": 1,
        "items": [{
          "id": "item-2",
          "kind": "message",
          "role": "assistant",
          "status": "streaming",
          "content": [{ "kind": "text", "text": "Hello world" }]
        }]
      }
    ]
  }
}
```

native 中的 `delta` 是原始增量，output 中的 text 是该组件的累计状态。二者不可混合
拼接，否则会重复显示文本。

```ts
// 从同一 stream 的完整事件区间读取；断线后从 lastSeq 续传。
const items: OutputItem[] = []
let lastSeq = 0

for await (const frame of events) {
  if (frame.seq <= lastSeq) continue
  if (frame.seq !== lastSeq + 1) throw new Error('需要补齐事件缺口')

  if (frame.native !== null) {
    await recordNative(frame.seq, frame.native)
  }
  for (const edit of frame.output.edits) {
    items.splice(edit.index, edit.deleteCount, ...edit.items)
  }
  lastSeq = frame.seq
  render(items)
}
```

示例省略了共享 schema 校验、edit 边界检查、连接管理和错误展示，但没有隐藏 provider 专用索引。
共享 reducer 应在暂存数组上校验并应用整帧，再提交状态和游标；非法 edit 不能留下
只应用了前半帧的状态。UI 所需不可变数组也由共享 reducer 提供。
导出原始事件只需要按 seq 读取 native.value；无需从组件恢复原始事件。

## 7. 快照、命令与传输

```text
event       { streamId, seq, native, output } -> 有序日志记录
snapshot    { streamId, atSeq, items[] }    -> 到 atSeq 的完整显示状态
reply       { requestId, ok, result/error } -> 单个命令的处理结果
control     { streamId, code, details }    -> 缺口、采集中断等连接 / 完整性状态
```

snapshot、reply、control 使用独立 kind 的严格联合，不冒充新的原始事件。
它们也有协议版本，但不领取日志 seq。control 的 code 使用受控联合，并由 code
确定 details schema；例如 replay.unavailable、stream.incomplete、stream.closed。
snapshot 的 items 是紧凑的完整有序数组，不能擅自筛选或重排。
快照要在 atSeq 处原子生成，接收后只应用该 stream 中晚于 atSeq 的组件更新。
如果程序还需要全部原始记录，仍按自己的原始游标补齐日志，不能把 atSeq 当成已收到
所有 native。共享客户端负责连接级游标，页面组件无需维护它。

命令接受不代表执行完成；审批请求、自动重试、压缩、后台任务必须独立建模。
从原生 run / turn / result / settled 事件推导产品 run 状态的规则应按入口版本测试。
组件完成、前台 run 完成、后台任务完成、会话断开是不同状态。

WS 一条 text message 发送一条协议帧。SSE 使用相同 JSON 数据帧；event 的 SSE id
可以编码 streamId 和 seq，但重放必须由实际日志查询实现，增加 id 字段本身不产生
重连保证。SSE 命令通过独立 HTTP 请求提交；订阅连接不能承担双向交互。

```text
same EventFrame -> WS text message
               -> SSE id: <streamId>:<seq> / data: <JSON>

commands       -> WS command / HTTP POST -> reply(requestId)
```

### 7.1 公共 HTTP 与现有 Chat 共用运行服务

HTTP / WS 是传输选择，tmux / SDK / App Server 是运行驱动选择。二者解耦。
按已确认要求，公共 Claude HTTP 调用默认复用 tmux 驱动与其会话租约、输入队列和
交互处理，从同一来源生成共享帧。

当前 `/ws/session` 的 `run-route.ts` 内负责 openTerminal、订阅、观察转录和
submitTerminal；程序化 `AgentHarness.run/launch` 的 Claude 路径则仍为 SDK。
这部分编排应放入 harness 的共享会话运行服务，让 HTTP / WS 路由仅负责解码命令、
调用和编码返回。现有 SDK 专用调用场景需明确驱动身份，不能冒充同一 tmux 会话。

```text
Chat WS ----+
            +--> shared session commands --> Claude tmux / Pi runtime / Codex
HTTP -------+               |                              |
                            |                       persistent capture
                            |                              |
                            +------------------ shared ordered stream
                                                   /          \
                                             Chat WS        API SSE / WS

Claude tmux -- terminal bytes --> existing terminal WS --> current TUI
```

建议 HTTP 表面如下，路径为拟议接口，并非当前已实现接口：

| 接口 | 行为 |
| --- | --- |
| `POST /api/sandbox/agent/run/stream` | 提交一条消息并订阅会话 SSE；首个 reply 交付 requestId、runId、sessionId、streamId 与起始游标，随后交付该游标处的 snapshot，再发送同一 EventFrame。 |
| `GET /api/sandbox/agent/sessions/:sessionId/events` | 带 harness、streamId 和 afterSeq，补齐事件后持续订阅；也支持 SSE Last-Event-ID。 |
| `POST /api/sandbox/agent/runs/:runId/abort` | 显式取消；返回 reply，最终运行结果继续在事件流中发布。 |
| `POST /api/sandbox/agent/sessions/:sessionId/interactions/:requestId/respond` | 提交审批、问题或表单回答；更新同一交互状态。 |

订阅和起始游标必须在启动 / 注入 prompt 前确定，不能先执行再开始监听。
新 session 可以先分配宿主身份，原生身份到达后由适配层关联。HTTP 请求中的 requestId
用于幂等提交，同一 ID 与同一请求复用原 run，不重复向 tmux 注入 prompt；ID 相同但
内容不同返回明确冲突。

没有浏览器连接时也要采集；关闭订阅连接只取消订阅，不隐式取消 run。会话采集的
生命周期跟随运行时，由共享服务持有，不能跟随某个 WebSocket viewer 的开关。
采集订阅也不能被误计成 UI 查看者，从而破坏当前 tmux 空闲回收行为。

完整订阅发送会话内连续 seq，调用方通过 context.runId 区分运行。初版不提供会制造
seq 缺口的服务端 runId 过滤；客户端可以在共享 reducer 处理完整序列之后筛选显示。
新订阅从创建时的 snapshot + 游标开始；如果要求原始历史，则明确从可用日志起点
重放。HTTP 和 WS 使用同一日志范围时，原始记录及最终 output 必须一致。

run 完成不会代表会话或后台任务结束。持续会话订阅仍发送晚到的转录、usage 和后台
事件；调用方可以在达到自己的结束条件后断开。历史不可用应报告明确范围，不能
自动用 snapshot 冒充完整回放。

## 8. 流式效率与「直接使用」的取舍

组件状态仍可在生成途中持续更新，因此全量的单组件状态也支持流式显示。
它的收益是消费方替换数组片段即可渲染，代价是重复传输累计内容。

| 形式 | 消费方复杂度 | 数据成本 |
| --- | --- | --- |
| 原生 delta 直接给页面 | 需要 provider 专用关联和合并规则 | 通常较低 |
| 每次发送整个 session | 简单 | 随整个历史增长，成本最高 |
| 本草案：只发变动组件的完整状态 | 统一 splice 操作，数组顺序渲染 | 取决于活动组件大小；有明确边界 |

不能把「累计状态」宣传为线性带宽：一个文本组件长度持续增长时，反复发送完整
内容仍可能累计到平方级。Pi SDK 自身的原始 partial 也有这个成本，完整保留它就
必须承担或无损压缩这部分数据。

建议初版选择组件状态作为默认消费接口，测量事件大小、序列化时间和慢客户端积压。
可以合并 transport 写入、启用无损压缩；若按时间窗口合并显示更新，必须仍保存和
传送每条 native，且窗口结束、等待交互、取消、失败、完成时立即发送最后状态。
原始事件不能因为 UI 合帧而被丢弃。

后续只有数据支持时才增加受控的 text append 优化，并由共享 reducer 对外继续暴露
同一个有序 items[]。该优化不是本草案核心契约的实施前提。

## 9. 「不能漏事件」必须落实的采集和存储约束

```text
source callback / wire read
          |
      immutable capture
          |
    durable ordered journal --- failure ---> explicit incomplete / stop
          |
        projector ---------- failure ------> retain native + projection error
          |
       WS / SSE ------------ disconnect ---> replay from last committed seq
```

- 在 source 层开始接收之后才启动任务，在真正结束订阅之前持续捕获，包括 retry、
  compaction、usage、后台通知、错误与未知事件。不能在第一个 result / agent_end 后
  统一停止所有来源。
- Claude 保持 tmux；采集 hooks、MessageDisplay、transcript、statusLine 等已接入的
  结构化通道，并保留终端通道特有输出。普通回答与工具尽量归一化，只有 ANSI 输出
  的内容保持 terminal 来源记录，不声称获得了 TUI 未公开的 SDK 内部事件。
  必须在 hook relay 的裁剪、过滤之前保存完整输入。MessageDisplay 也不能先丢弃
  agent_id 记录，再声称子 Agent 输出完整。可覆盖哪些原生 hook 必须按当前 Claude
  版本核对，不能把“现有代码订阅的少数事件”定义为全部来源能力。
- Codex 的 server request 和 response、Pi 的 extension UI、Claude 的控制回调不是
  普通文本 delta，应按接口实际开放的入口采集，声明覆盖范围。
- 未识别的记录原样写入；识别失败不是忽略事件的理由。JSONL 解析失败若要求保持
  输入证据，需要先存原始字节再报告错误。
- 原始日志先持久化，再发布可确认的帧。投影结果可单独保存或按固定适配器版本重建。
  这不等于可以保证捕获到进程崩溃前尚未送达宿主的字节；完整性保证以声明的采集
  边界和已提交记录为准。
- 同一 (streamId, seq) 的对外帧在重放时必须一致。共享 schema 或适配器升级后不能
  在旧游标下发布另一组 edits；保留已发布投影，或固定投影版本重建。需要改变历史
  投影定义时，以显式的新 stream / snapshot 边界切换。
- 原始日志路径不能使用「满了丢最旧」队列。现有 DataRecorder 明确是尽力记录，
  队列上限 10,000、关闭时有 flush 超时，因此不能直接承诺满足本目标。
  可以复用数据库技术，但需要具有提交确认和明确背压语义的记录契约。
- SDK 若不能等待写入或提供背压，需要落盘缓冲和明确的失败策略；内存积压、磁盘
  写入失败、retention 导致历史不可得时，必须显式报告不完整，不能用 snapshot
  假装原始事件已经恢复。
- 保留期限、是否包含终端字节、是否包含入站命令，需要明确声明；本草案不把
  “完整”解释为无期限保存所有进程内部状态。

## 10. 与当前项目的衔接及验收

第一阶段：将当前 WS 中的终端运行编排收进共享服务；在 hook relay、原始 transcript
读取、SDK callback 等裁剪和 mapper 之前增加完整记录捕获和版本 / 来源标识，确保
无 UI 连接时也能采集；引入共享边界 schema。保持现有聊天可用。

第二阶段：增加有序组件投影和公共 HTTP / WS 接口，用无浏览器的调用验证同样的
完整输出。加入协议 v3 消费端，一起切换前后端；完成后删除旧的
可选字段 StreamFrame 和旧协议分支，不长期保留双协议兼容层。

Codex 是本次对比与 schema 覆盖对象，实际接入可在之后单独推进，并非完善现有
Claude / Pi HTTP 接口的前置条件。不同驱动保持准确来源标识。

```text
shared runtime commands + capture + shared schema
          |
ordered output projection + HTTP / WS + v3 client
          |
remove v2 paths + verify parity + measure transport cost
```

至少验证以下场景：

- 逐条原始输入与导出记录 deep-equal；未知事件和额外字段也相等。
- SDK 后续修改 partial 对象不能改变已保存记录。
- 文本 / 思考 / 工具 / 子 Agent 交错时，输出顺序正确、组件 id 稳定且不串线。
- 重复投递不会重复文本；缺失 seq 触发补齐，不直接跳过。
- 最终权威内容修正流式内容、fallback 撤回和 supersedes 可正确更新视图。
- 工具参数尚不完整、结构化工具结果、图片、usage、审批与错误保留原值。
- Pi agent_end 后的 retry / agent_settled、Claude 后台通知、Codex server request
  都不会导致过早结束采集。
- 从头投影与 snapshot(atSeq) + 后续事件的视图一致；snapshot 不顶替 native 日志。
- 断线、进程重启、落盘失败和超过保留期具有明确结果。
- 不打开 Chat / TUI 页面，通过 HTTP 完成启动、流式输出、交互回答、取消和续传。
- 对同一运行同时订阅 WS 与 SSE，日志范围相同则逐帧语义相同、最终 items[] 相同。
- MessageDisplay 先到、transcript 后到时，中间补插工具不打乱文本顺序、不重复内容。
- HTTP 重试同一 requestId 不重复执行；断开 HTTP 不终止后台采集。

当前限制：此文是协议草案，尚无生产实现或负载测试；跨 harness 的采集完整性
必须逐入口验收，不能仅凭共有 schema 判断已经满足。

草案验证：三个 JSON 示例均可解析。用临时参考模型验证了采集时复制、晚到记录插入、
文本替换、未知事件保留、最终纠正、撤回、结构化工具结果、重复回放、快照加后续事件、
序号缺口拒绝与 edit 越界拒绝，共 11 项。这些是合成数据下的协议操作验证，不代表
当前应用已实现这些能力，也没有验证实际 harness 的端到端输出覆盖率。
