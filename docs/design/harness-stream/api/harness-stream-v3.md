# 共享会话流 v3：完整返回契约与示例

> 2026-10-17 范围更正：该协议只供平台外部客户端使用，当前 Chat UI 不消费它。
> 可复用现有运行驱动和事件来源；下文旧方案中的 Chat WS 直接订阅 v3、共用 reducer、
> Chat UI 协议迁移及删除 v2 的步骤不再适用。最新调用约定见
> [HTTP API 参考](harness-http-api-reference.md)。其 `returnImmediately=true` 路径将提交与可选的消费连接分开。

状态：设计草案，2026-10-17；没有替换当前生产 v2。本文定义输出契约，不新增运行驱动。
后续的请求与返回说明见 [Harness HTTP API 参考草案](harness-http-api-reference.md)，
其中采用 `splice / set / text.append` 增量修订。本文及所附机器 schema 仍记录前一版
完整组件替换方案，不能用于验证增量修订示例。
JSON Schema 是唯一机器校验源：[harness-stream-v3.schema.json](harness-stream-v3.schema.json)。
下方 TypeScript 声明由该 schema 展开，便于阅读；整数范围、字符串非空等仍以 JSON Schema 为准。

## 1. 一条事件源，多个消费者

```text
Claude hooks / 主与子转录 / Pi Host / Codex 接口
                     |
           mapper 前完整捕获、持久提交
                     |
             共享 SessionStream v3
          /             |              \
     Chat WS        完整 HTTP SSE       A2A 标准投影
          \             /              |
          相同帧、相同 reducer         Task / Artifact SSE
                     |
             同一日志用于断线重放
```

HTTP 直接订阅 Chat 使用的会话服务，不另开一次 harness 运行，不为每个子 agent 开连接。
已有会话级 observer 持续观察主/子转录及后台状态；本次设计补齐的是映射前完整保存、
统一 v3 schema 和 HTTP 传输。UI 页面不是保持采集的前置条件。

四种根帧：event 是可回放数据；snapshot 是某个精确游标的显示基线；reply 是内部 WS
命令回执；control 是连接提示。A2A 标准操作仍使用 A2A 响应，而非 reply。
所有定义过的产品对象禁止额外属性；只有 native.value、JSON 内容、工具参数、交互
schema/回答、错误与通知 details 等明确的数据位置允许任意 JSON。

## 2. 完整共享类型

这里是完整返回 schema 的可读展开，包含所有帧、组件、嵌套内容与错误分支。
时间使用 UTC epoch 毫秒，所有序号、数组位置和计数都是非负安全整数。

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type Id = string

type Sequence = number

type StreamError = {
  code: string
  message: string
  details: JsonValue
}

type Timing = {
  startedAt: number | null
  endedAt: number | null
  durationMs: number | null
  basis: "native_reported"
} | {
  startedAt: number
  endedAt: null
  durationMs: null
  basis: "host_observed"
} | {
  startedAt: number
  endedAt: number
  durationMs: number
  basis: "host_observed"
} | {
  startedAt: number | null
  endedAt: number | null
  durationMs: null
  basis: "unknown"
}

type NativeSource = {
  harness: "codex" | "claude" | "pi"
  interface: string
  version: string | null
  instanceId: string
  channel: string
}

type NativeRecord = {
  source: NativeSource
  format: "json"
  value: JsonValue
} | {
  source: NativeSource
  format: "bytes"
  encoding: "base64"
  value: string
}

type IntegrityIssue = {
  code: "capture_lost" | "encoding_failed" | "storage_failed" | "source_unavailable"
  message: string
  atSeq: number | null
  source: NativeSource | null
}

type IncompleteIntegrity = {
  status: "incomplete"
  issues: Array<IntegrityIssue>
}

type Integrity = {
  status: "complete"
  issues: []
} | IncompleteIntegrity

type BinaryData = {
  kind: "inline"
  encoding: "base64"
  data: string
} | {
  kind: "reference"
  uri: string
  sha256: string
  sizeBytes: number
}

type Content = {
  kind: "text"
  text: string
} | {
  kind: "json"
  value: JsonValue
} | {
  kind: "image" | "file" | "audio" | "video"
  mediaType: string
  name: string | null
  blob: BinaryData
}

type ToolInput = {
  status: "streaming" | "invalid"
  text: string
  value: null
} | {
  status: "complete"
  text: string
  value: JsonValue
}

type MessageItem = {
  id: string
  runId: string | null
  kind: "message"
  role: "user" | "assistant" | "system"
  phase: "input" | "commentary" | "final" | "notification"
  status: "streaming" | "complete" | "failed" | "cancelled"
  content: Array<Content>
}

type ThinkingItem = {
  id: string
  runId: string | null
  kind: "thinking"
  status: "running" | "complete" | "failed" | "cancelled"
  summary: string | null
  timing: Timing
}

type ToolItem = {
  id: string
  runId: string | null
  kind: "tool"
  name: string
  status: "pending" | "running" | "complete" | "failed" | "cancelled"
  input: ToolInput
  output: Array<Content>
  children: Array<OutputItem>
  timing: Timing
  error: StreamError | null
}

type AgentItem = {
  id: string
  runId: string | null
  kind: "agent"
  name: string
  originRunId: string | null
  completionPolicy: "joined" | "detached"
  status: "pending" | "running" | "waiting" | "complete" | "failed" | "cancelled" | "unknown"
  children: Array<OutputItem>
  timing: Timing
  error: StreamError | null
}

type TaskItem = {
  id: string
  runId: string | null
  kind: "task"
  title: string
  taskKind: "command" | "agent" | "workflow" | "monitor" | "other"
  originRunId: string | null
  completionPolicy: "joined" | "detached"
  status: "pending" | "running" | "paused" | "complete" | "failed" | "cancelled" | "unknown"
  control: "api" | "terminal" | "none"
  children: Array<OutputItem>
  timing: Timing
  error: StreamError | null
}

type PlanStep = {
  id: string
  text: string
  status: "pending" | "running" | "complete" | "skipped" | "failed"
}

type PlanItem = {
  id: string
  runId: string | null
  kind: "plan"
  steps: Array<PlanStep>
}

type InteractionChoice = {
  id: string
  label: string
  value: JsonValue
}

type InteractionItem = {
  id: string
  runId: string | null
  kind: "interaction"
  requestId: string
  requestKind: "approval" | "question" | "form" | "authentication"
  status: "pending" | "resolved" | "cancelled"
  prompt: string
  inputSchema: { [key: string]: JsonValue }
  choices: Array<InteractionChoice>
  response: JsonValue
}

type NoticeItem = {
  id: string
  runId: string | null
  kind: "notice"
  severity: "info" | "warning" | "error"
  code: string
  text: string
  details: JsonValue
}

type UsageValues = {
  inputTokens: number | null
  outputTokens: number | null
  thinkingTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  totalTokens: number | null
  cost: {
    amount: string
    currency: string
  } | null
}

type UsageItem = {
  id: string
  runId: string | null
  kind: "usage"
  scope: "call" | "run" | "session"
  mode: "delta" | "cumulative"
  model: string | null
  values: UsageValues
}

type RunItem = {
  id: string
  runId: string
  kind: "run"
  status: "queued" | "running" | "input_required" | "auth_required" | "complete" | "failed" | "cancelled" | "rejected"
  model: string | null
  timing: Timing
  error: StreamError | null
}

type OutputItem = MessageItem | ThinkingItem | ToolItem | AgentItem | TaskItem | PlanItem | InteractionItem | NoticeItem | UsageItem | RunItem

type OutputEdit = {
  index: number
  deleteCount: number
  items: Array<OutputItem>
}

type Projection = {
  status: "applied"
  edits: Array<OutputEdit>
} | {
  status: "unmapped"
  edits: []
} | {
  status: "failed"
  edits: []
  error: StreamError
}

type Context = {
  sessionId: string
  runId: string | null
}

type EventFrame = {
  v: 3
  kind: "event"
  streamId: string
  seq: number
  ts: number
  context: Context
  native: NativeRecord | null
  integrity: Integrity
  output: Projection
}

type SnapshotFrame = {
  v: 3
  kind: "snapshot"
  streamId: string
  atSeq: number
  ts: number
  sessionId: string
  sources: Array<NativeSource>
  integrity: Integrity
  items: Array<OutputItem>
}

type ReplyFrame = {
  v: 3
  kind: "reply"
  requestId: string
  command: "submit"
  ok: true
  result: {
    sessionId: string
    runId: string
    streamId: string
  }
} | {
  v: 3
  kind: "reply"
  requestId: string
  command: "subscribe"
  ok: true
  result: {
    streamId: string
    atSeq: number
  }
} | {
  v: 3
  kind: "reply"
  requestId: string
  command: "cancel"
  ok: true
  result: {
    runId: string
    accepted: boolean
  }
} | {
  v: 3
  kind: "reply"
  requestId: string
  command: "respond"
  ok: true
  result: {
    interactionId: string
    accepted: boolean
  }
} | {
  v: 3
  kind: "reply"
  requestId: string
  command: "submit" | "subscribe" | "cancel" | "respond"
  ok: false
  error: StreamError
}

type ControlFrame = {
  v: 3
  kind: "control"
  streamId: string
  code: "replay.unavailable"
  details: {
    requestedAfterSeq: number
    availableFromSeq: number | null
    latestSeq: number | null
    reason: "expired" | "unknown_stream" | "invalid_cursor"
  }
} | {
  v: 3
  kind: "control"
  streamId: string
  code: "stream.incomplete"
  details: {
    integrity: IncompleteIntegrity
  }
} | {
  v: 3
  kind: "control"
  streamId: string
  code: "stream.closed"
  details: {
    atSeq: number
    reason: "export_complete" | "session_closed" | "server_shutdown"
  }
} | {
  v: 3
  kind: "control"
  streamId: string
  code: "stream.replaced"
  details: {
    nextStreamId: string
    reason: string
  }
}

type SharedFrame = EventFrame | SnapshotFrame | ReplyFrame | ControlFrame
```

## 3. 身份、顺序与状态不变量

- `streamId` 标识一份不可变日志；`seq` 从 1 连续递增，snapshot 的初始 atSeq=0。
  `context.sessionId` 与 A2A contextId 对应；逻辑 runId 与 A2A Task.id 对应。
- `item.id` 是产品组件 / 执行身份，全树唯一。agent/task 的 id 不是 A2A Task.id，
  provider 的 agentId、toolCallId、taskId 保留在 native 中，由服务端关联。
  run 组件自身的 id 与其非空 runId 一致；其它组件 id 不复用这个值。
- 每个组件的 runId 是当前逻辑归属。joined 子工作属于主 run；detached 工作从创建
  起 runId=null，originRunId 固定记录发起 run。后台自主启动且无发起 run 时可为 null。
- `completionPolicy=joined` 的未完成子工作阻止父 run 成功结束；detached 不阻止。
  父任务失败或取消时须先明确处理 joined 子工作。后台运行、暂停或状态未知都不能
  自动当作完成。同一实体不重复渲染成两个 agent/task 容器。
- `agent.children`、`task.children`、`tool.children` 使用同一个 OutputItem 联合。
  更新嵌套工具时替换最外层受影响容器的完整 children，客户端无需递归寻找 provider ID。
  所有数组顺序就是显示顺序；容器不能包含自身或重复 id。
- 每帧按 edits 顺序执行 `splice(index, deleteCount, ...items)`；后一条 index 基于
  前一条结果。先在暂存树校验边界和身份，再一次提交整帧。不能只应用半帧。
- `message.phase=final` 标识最终答复，`status=streaming` 仍可增量显示；complete 表示
  该消息完成。它与 run.status=complete 分开。通知使用 phase=notification。
  一个 joined 子 agent 的 final 只结束它自己的回答，不结束父 run。
- tool.input 在 streaming/invalid 时 value=null，text 保留尚未完成或无法解析的内容；
  complete 时 value 可以是任何 JSON，包括 null。工具失败与部分 output 可以同时存在。
- Usage mode=cumulative 表示累计值，替换而非再次累加；未知 token 数或费用为 null。
  精确费用用十进制字符串。JSON 不支持的原生数值须显式 codec 或原始字节保存。

## 4. 思考时间与公开摘要

`thinking` 是可独立渲染的组件，允许只有计时而没有文本。summary 仅来自 harness 实际
公开的内容，没有内容时为 null；不能补造模型内部推理。

| timing 字段 | 含义 |
| --- | --- |
| startedAt / endedAt | 可用的阶段开始 / 结束时间；未知为 null，执行中 endedAt=null。 |
| durationMs | 该阶段耗时；尚未结束或无法确定为 null，结束后固定。 |
| basis=native_reported | 来源接口提供的阶段计时，不能将捕获时间冒充来源时间。 |
| basis=host_observed | 宿主观察到明确阶段边界，用单调钟测量；不是模型内部计算时长。 |
| basis=unknown | 无可靠依据；durationMs 为 null，不显示成 0 ms。 |

宿主观察计时的 startedAt / endedAt 用于展示，durationMs 用单调钟确定，避免系统时间调整。
不能把“收到首 token 前的等待时间”或“总耗时减工具耗时”称为思考时间。多个思考片段
分别计时；并行子 agent 的时长不直接相加作为父任务耗时。UI 可根据开始时间临时显示
进行中的计时，完成时以服务端 durationMs 为准，不每毫秒新增日志事件。

## 5. 完整推送实例

全部是合成数据，时间起点为 2026-10-17 10:00:00（Asia/Shanghai）。native 的来源明确
标为 `example.synthetic`，用于演示原始字段不丢失，不声称这是 Pi 实际 API 的原生格式。
所有原始对象均完整保留在样例中，没有省略号或假装真实采集。

- [基础输出实例](examples/harness-stream-v3/basic-session.sse)：snapshot + 8 条事件，只展示思考、工具、流式最终回复和 run 结束；独立于下面的复杂场景。
- [完整 HTTP SSE](examples/harness-stream-v3/session.sse)：snapshot + 16 条事件。
- [相同帧 JSONL](examples/harness-stream-v3/session.jsonl)：每一行 JSON 等于对应 SSE data，也就是 WS text payload。
- [最终显示快照](examples/harness-stream-v3/final-snapshot.json)：重放得到的完整组件树。
- [断线重连 SSE](examples/harness-stream-v3/reconnect.sse)：snapshot(8) + 9..16。
- [数据缺失与过期游标](examples/harness-stream-v3/integrity-and-gap.jsonl)：独立故障场景。
- [同源 A2A 1.0 SSE](examples/harness-stream-v3/a2a.sse)：标准任务投影。

| seq | 到达时间 | 内容与渲染操作 |
| --- | --- | --- |
| 1 | +0 ms | 插入 run-1，状态 running。 |
| 2 | +0 ms | 插入 thinking-1，正在思考，耗时尚未确定。 |
| 3 | +1200 ms | 替换 thinking-1，耗时 1200 ms，basis=host_observed。 |
| 4 | +1200 ms | 插入 read_file 工具，完整输入 path=README.md。 |
| 5 | +1500 ms | 替换工具，执行耗时 300 ms，返回正文及结构化结果。 |
| 6 | +1500 ms | 插入 joined 子 agent，父任务继续运行。 |
| 7 | +1600 ms | 替换 agent 容器，children 中出现执行中的目录工具。 |
| 8 | +1600 ms | 插入 detached 后台测试任务，originRunId=run-1。 |
| 9 | +2700 ms | 子 agent 完成，children 包含工具结果与自己的最终答复。 |
| 10 | +2900 ms | 主 agent 最终答复开始流式输出，phase=final、status=streaming。 |
| 11 | +3200 ms | 最终答复完整，status=complete；后台测试仍在运行。 |
| 12 | +3300 ms | run-1 完成；会话连接保持。 |
| 13 | +4000 ms | 同一流推后台工具进度，runId=null，不重新打开 run-1。 |
| 14 | +5600 ms | 后台任务及其工具完成，结果为 12 项测试通过。 |
| 15 | +5700 ms | 插入 phase=notification 的后台完成通知。 |
| 16 | +5800 ms | 未知原始事件保留，projection=unmapped，edits=[]。 |

最终组件顺序：

```text
items[]
  [0] run-1: complete (3300 ms)
  [1] thinking-1: complete (1200 ms, host_observed)
  [2] read_file: complete (300 ms)
  [3] agent-1: complete, joined
        children[0] list_directory: complete
        children[1] message: final
  [4] background-1: complete, detached, originRunId=run-1
        children[0] bash: complete -> 12 tests passed
  [5] answer-1: final / complete
  [6] background-notice-1: notification / complete
```

未知事件 seq=16 不创建气泡，但仍可从 native 导出，不能因为没有专用组件而丢弃。
正文工具路径和结果只是演示数据，没有实际运行 shell 或调用模型。

## 6. 断线、重连与完整性

```text
connection A: snapshot(0) -> 1 -> ... -> 8 -> disconnect
client:       atomically saved native + items + lastSeq=8
connection B: GET ...?afterSeq=8  (or Last-Event-ID: stream-1:8)
server:       snapshot(8) -> 9 -> ... -> 16 -> live tail
client:       replace display baseline -> apply 9..16 once
```

SSE event 字段等于根 kind；只有 event 帧带 `id: streamId:seq`，其它帧没有新日志 ID。
正常读同一连接不会故意重复事件；网络重试导致重投时按 (streamId,seq) 幂等处理。
若最后可靠提交是 7，就从 7 重连，即使浏览器已接收 8。原始导出写入也需同键去重。

从头重放与 snapshot(8)+9..16 必须得到相同树。快照只恢复显示，不证明 1..8 的 native
已被调用方收到；导出游标与显示游标不能混同。SDK 封装连接与游标，页面只接收 items。
日志保存晚于执行提交期间产生的事件，读取 snapshot 与接入 live tail 的边界必须原子，
不能在两者之间漏事件。

收到重复 seq 忽略；收到未来但不连续的 seq，暂停应用并补齐，不能自行跳过；streamId
变化时建立新基线，不能把新日志 seq=1 拼到旧日志。游标过期返回 replay.unavailable，
包含 requestedAfterSeq、availableFromSeq、latestSeq；本协议不以最新快照伪装原始补齐。
需要只恢复显示时，调用方须显式接受不完整原始历史。

integrity 是采集边界内的持久完整性状态，不是“投影器理解了全部事件”的标志。
未知事件仍可完整，projection.failed 也不自动意味着原始数据缺失。真正漏源数据时，
状态变为 incomplete，记录 issue 并在后续 event / snapshot 中持续返回；同时可发即时
control 提示。它不能只存在于会丢失的连接控制帧中。

如果日志存储本身不可写，停止发布已确认帧和接受新执行；恢复后先持久记录不完整
边界再继续，不能恢复为 complete。保留期导致的读取缺口通过 replay.unavailable 表达，
不篡改历史帧的 integrity。完整性保证始终以声明的来源通道和已提交的记录范围为界。

## 7. 与 A2A 1.0 兼容

固定发布版 v1.0.1，wire version=1.0。普通 A2A 客户端使用 AgentCard 和标准操作；
完整客户端激活 Harness Stream 扩展，标准 SendMessage 返回 Task.metadata 内的流指针，
随后直接订阅同一个 SessionStream。首版完整调用只需一个会话 SSE，不需要再开标准
任务 SSE，更不用为子 agent、工具、后台任务各开连接。

```text
A2A SendMessage(returnImmediately=true, extension active)
                 |
        Task + session stream pointer
                 |
      same SessionStream as Chat -> complete SSE

same committed session events -> A2A projection -> standard task SSE
```

| 共享内容 | A2A 表达 |
| --- | --- |
| sessionId / runId | contextId / Task.id；子 agent/task 的组件 id 不冒充标准 Task.id。 |
| run 状态 | TASK_STATE_*；joined 子工作未结束时父任务保持 WORKING。 |
| 正在思考、工具和子 agent 进度 | statusUpdate.status.message 可读说明；精确计时留在共享 thinking.timing。 |
| 最终回复、文件和结构化业务产物 | Artifact.parts，流更新使用 artifactUpdate。 |
| 全部原始字段、组件树、计时、seq、edits | 声明并激活的完整输出扩展；不是标准顶层字段。 |
| 父任务结束后的 detached 工作 | 继续会话流；不更新已终态的标准 A2A Task。 |

标准 SSE 根对象只含 task / message / statusUpdate / artifactUpdate 四选一，Part 使用
text/raw/url/data oneof，role 使用 ROLE_AGENT / ROLE_USER，状态使用 TASK_STATE_*。
标准进度消息也必须有 messageId、contextId、taskId。示例中先 Task，再状态和产物，
最后 COMPLETED；lastChunk 只结束产物。后台 seq=13..16 不出现在已结束的 run-1 标准流。
只有需要独立业务地址、取消与继续的工作，才另建 A2A Task；不自动拆分每个子 agent。

扩展 required=false 允许普通客户端使用基础接口。完整客户端检查 A2A-Extensions 激活
确认，日志访问沿用会话权限。扩展 URI、接口路由、发现与 GET/POST subscribe 的上游
差异详见 [设计草案第 7 节](../architecture/harness-stream-protocol-v3-draft.md#7-完整输出扩展与-a2a-传输)。

依据：[A2A v1.0.1 proto](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto)、
[扩展规则](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/topics/extensions.md)。

## 8. 验证记录

2026-10-17，使用项目已安装的 Ajv 2020 与 TypeScript，通过临时参考检查器完成：

- JSON Schema 2020-12 严格编译；样例文件内 56 个共享帧均通过校验。
- 8 个反例被拒绝：额外顶层 / 组件字段、缺少 native、seq=0、未完成工具输入却有
  解析值、未知计时却有时长、runId=null 的 run、complete 状态的 incomplete control。
- 12 项语义检查通过：WS/SSE 帧一致、全量重放等于最终快照、快照加尾部等于全量、
  重复去重、缺口拒绝、非法 edit 原子拒绝、跨 stream 拒绝、重复组件 id 拒绝、
  后台跨 run 结束继续、计时值、未知原始字段保留、A2A 最终正文一致。
- 可读 TypeScript 声明与完整 JSONL 示例的严格类型检查通过。
- 7 条 A2A 帧解析通过，并对照固定 v1.0.1 proto 核对包装、身份、枚举及 Part；
  标准终态后没有追加后台更新，最终 Artifact 与共享流最终回复相同。

这是设计契约与合成数据验证。未运行实际 Claude/Pi 模型、应用测试、负载测试或
官方 A2A SDK 互操作测试；尚不能据此声明当前生产接口已实现无损采集或 A2A 兼容。
