# 返回对象与流式事件

> 修订草案，2026-10-17。本文采用最新讨论的 `splice`、`set`、`text.append` 增量方案，尚未实现为运行时接口。仓库现有 `harness-stream-v3.schema.json` 仍定义旧版完整组件替换操作，不能用于验证本文的增量操作。增量路径白名单、路径与值类型的关联约束，以及对应机器 schema 仍待同步。

## 阅读约定

本文每条返回帧记为 `frame`，客户端已累积的显示状态记为 `state`。它们是文档中的变量名，不是额外的 JSON 包装字段。`i`、`j`、`k` 表示数组元素位置。

表格中的“必填”指当前联合分支存在时必须返回。`string | null` 表示字段必须出现，但允许值为 `null`；不等于可以省略。标为“条件必填”的字段只存在于对应的联合分支。

`JSON` 表示任意合法 JSON 值；`object` 表示 JSON 对象。时间戳使用 UTC epoch 毫秒。序号、数组索引、计数使用非负安全整数；事件序号从 `1` 连续递增，初始快照游标为 `0`。

已定义的帧、组件和内容对象不接受额外字段。只有 `native.value`、JSON 内容、工具解析值、交互输入结构与回答、错误与提示详情等指定位置允许任意 JSON。扩展来源信息应保留在原始记录中，不能随意增加产品字段。

```text
SSE data / WS text
        |
       frame
        |
        +-- snapshot --> state.items = frame.items
        |
        +-- event ----> 检查 streamId 与 seq
        |                    |
        |               顺序执行 output.edits
        |                    |
        |               原子提交 state.items
        |                    |
        |               记录已提交的 seq
        |
        +-- control --> 连接提示 / 恢复处理

frame.native ----------------> 独立保存原始事件
```

`state.items` 只保存显示投影。读取全部原始事件需要持久事件日志，不能从最终显示树恢复。

## 返回帧类型

HTTP SSE 的 `data` 返回以下三种帧。SSE 的 `event` 字段等于 `frame.kind`；只有 `event` 帧使用 `id: <streamId>:<seq>` 表示可重放游标。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.v` | integer，固定 `3` | 是 | 共享帧契约版本。 |
| `frame.kind` | enum | 是 | `event`、`snapshot` 或 `control`。 |
| `frame.streamId` | string | 是 | 非空日志身份；不同日志不能共用同一套序号。 |

内部 WS 命令的 `reply` 回执不属于这里的 HTTP 返回契约。本文不定义新的 WS 请求。

## EventFrame

一条已持久化的事件，包含来源内容、完整性状态，以及零个或多个显示操作。

### 事件外壳

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.v` | integer，固定 `3` | 是 | 契约版本。 |
| `frame.kind` | string，固定 `event` | 是 | 可重放事件。 |
| `frame.streamId` | string | 是 | 事件所属日志。 |
| `frame.seq` | integer | 是 | 该日志内严格递增的序号。 |
| `frame.ts` | integer | 是 | 服务端记录事件的时间；来源自己的时间保留在 `native`。 |
| `frame.context` | object | 是 | 事件的会话与逻辑运行上下文。 |
| `frame.context.sessionId` | string | 是 | 会话身份。 |
| `frame.context.runId` | string 或 null | 是 | 当前逻辑运行；脱离主运行的后台事件可以为 `null`。 |
| `frame.native` | NativeRecord 或 null | 是 | 映射前保留的原始记录；宿主自行产生且没有来源记录的事件可以为 `null`。 |
| `frame.integrity` | Integrity | 是 | 采集边界内持续保存的完整性状态。 |
| `frame.output` | Projection | 是 | 原始事件到显示操作的映射结果。 |

事件顺序是服务端提交顺序；并发来源之间不宣称存在额外的全局因果顺序。

### 原始记录：NativeRecord

`format=json` 保留完整 JSON 内容；`format=bytes` 用于需要保留字节的来源。JSON 对象的空白和键顺序不作为内容保证。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.native.source` | NativeSource | 条件必填 | `frame.native` 非空时的来源标识。 |
| `frame.native.source.harness` | enum | 条件必填 | `codex`、`claude`、`pi`。 |
| `frame.native.source.interface` | string | 条件必填 | 具体来源接口，例如宿主事件、转录或 hooks；用于区分采集边界。 |
| `frame.native.source.version` | string 或 null | 条件必填 | 来源版本；未知为 `null`。 |
| `frame.native.source.instanceId` | string | 条件必填 | 来源实例身份。 |
| `frame.native.source.channel` | string | 条件必填 | 实例内的来源通道。 |
| `frame.native.format` | enum | 条件必填 | `json` 或 `bytes`。 |
| `frame.native.value` | JSON 或 string | 条件必填 | `json` 时为任意 JSON；`bytes` 时为 Base64 字符串。 |
| `frame.native.encoding` | string，固定 `base64` | 条件必填 | 仅 `format=bytes` 时存在。 |

未知事件也必须保留。来源事件携带可变对象时，采集层应立即复制或序列化冻结，防止后续修改污染已记录事件。

完整性保证始于声明的来源接口：接口本身没有输出的内容不能凭空恢复；来源读取或保存发生缺失时必须明确报告。

### 完整性：Integrity

`complete` 表示采集边界内没有已知缺失，不表示投影器认识全部原始事件。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.integrity.status` | enum | 是 | `complete` 或 `incomplete`。 |
| `frame.integrity.issues` | IntegrityIssue[] | 是 | `complete` 时必须为空；`incomplete` 时至少一项。 |
| `frame.integrity.issues[i].code` | enum | 条件必填 | `capture_lost`、`encoding_failed`、`storage_failed`、`source_unavailable`。 |
| `frame.integrity.issues[i].message` | string | 条件必填 | 缺失或故障说明。 |
| `frame.integrity.issues[i].atSeq` | integer 或 null | 条件必填 | 已知时记录关联日志序号，否则为 `null`。 |
| `frame.integrity.issues[i].source` | NativeSource 或 null | 条件必填 | 能定位时记录来源，否则为 `null`。 |
| `frame.integrity.issues[i].source.harness` | enum | 条件必填 | `codex`、`claude`、`pi`。 |
| `frame.integrity.issues[i].source.interface` | string | 条件必填 | 发生问题的来源接口。 |
| `frame.integrity.issues[i].source.version` | string 或 null | 条件必填 | 来源版本。 |
| `frame.integrity.issues[i].source.instanceId` | string | 条件必填 | 来源实例。 |
| `frame.integrity.issues[i].source.channel` | string | 条件必填 | 来源通道。 |

完整性问题持续出现在后续事件和快照中，不能只依靠临时连接提示。投影失败与原始数据缺失分别报告。

### 显示投影：Projection

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.output.status` | enum | 是 | `applied`、`unmapped`、`failed`。 |
| `frame.output.edits` | OutputEdit[] | 是 | 按数组顺序执行的显示操作；`unmapped` 和 `failed` 时必须为空。 |
| `frame.output.error` | StreamError | 条件必填 | 仅 `status=failed` 时存在。 |
| `frame.output.error.code` | string | 条件必填 | 可编程识别的错误代码。 |
| `frame.output.error.message` | string | 条件必填 | 错误描述。 |
| `frame.output.error.details` | JSON | 条件必填 | 错误上下文；无额外信息可为 `null`。 |

- `applied`：映射成功，操作可以为空，例如来源事件不改变显示。
- `unmapped`：尚无显示映射，原始事件仍保留在 `frame.native`。
- `failed`：映射器出错，本帧不提交显示变更，原始事件仍保留。

## 增量操作：OutputEdit

以下操作替代旧方案“根数组 splice + 完整父组件替换”。`path` 定位当前显示树；后一个操作使用前一个操作执行后的状态。

`path` 是字符串和非负整数组成的数组，例如 `["items",3,"children",0,"output",0,"text"]` 对应 `state.items[3].children[0].output[0].text`。后端负责将 provider ID 关联为位置，前端无需维护 provider 专用索引。

### 插入、删除或替换数组元素：splice

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.output.edits[i].op` | string，固定 `splice` | 是 | 数组修改操作。 |
| `frame.output.edits[i].path` | Array<string 或 integer> | 是 | 指向允许修改的数组；例如 `["items"]` 或 `["items",3,"children"]`。 |
| `frame.output.edits[i].index` | integer | 是 | 从当前数组的哪个位置开始操作；插入到末尾时等于数组长度。 |
| `frame.output.edits[i].deleteCount` | integer | 是 | 删除多少个已有元素；`0` 表示只插入。 |
| `frame.output.edits[i].items` | array | 是 | 插入的完整新元素；类型须符合目标数组；空数组表示只删除。 |

组件首次创建时发送完整组件。向 `children` 插入子组件不需要重发父组件或既有兄弟组件。内容块数组可以单独插入新结果块。

### 更新字段：set

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.output.edits[i].op` | string，固定 `set` | 是 | 替换指定字段值。 |
| `frame.output.edits[i].path` | Array<string 或 integer> | 是 | 指向允许更新的字段；例如 `["items",2,"status"]`。 |
| `frame.output.edits[i].value` | JSON | 是 | 替换后的完整字段值；其类型由目标字段决定。 |

`set` 不做隐式深合并，不负责自动创建缺失的祖先。状态、计时、结构化值以及权威终稿校正均可使用字段替换；不能通过它修改组件身份、原始记录或日志序号。

### 追加文本：text.append

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.output.edits[i].op` | string，固定 `text.append` | 是 | 向允许追加的字符串字段追加文本。 |
| `frame.output.edits[i].path` | Array<string 或 integer> | 是 | 目标字符串字段；例如 `["items",5,"content",0,"text"]`。 |
| `frame.output.edits[i].text` | string | 是 | 本次新增文本，不包含此前已经发送的前缀。 |

适用于消息正文、文本工具输出以及尚未完成的工具参数文本等已声明位置。`null` 不是空字符串；例如思考摘要当前为 `null` 时，须先设置为字符串，才能追加。

完成事件只更新完成状态和必要字段。若来源给出完整终稿，服务端核对后仅追加缺少的后缀；终稿修改了既有内容时，使用 `set` 校正正文。

### 路径与执行限制

这三种操作是产品专用协议，不是 RFC 6902 JSON Patch；其中 `text.append` 是自定义操作。

以下是修订方案的语义要求，尚未全部编码进机器 schema：

1. 路径只能进入显示树的已声明位置；不能执行任意对象属性写入，也不能写入 `__proto__`、`constructor` 等不在字段白名单中的属性。
2. `splice` 插入元素和 `set` 替换值必须符合目标位置的类型；宽泛的 `JSON` 表格类型不等于任意位置都允许任意值。
3. 数组位置必须在当前边界内。客户端不能重排或删除同步状态中的数组；过滤、排序后的展示应使用派生视图。
4. 整帧先验证并应用到暂存状态，全部成功后原子提交；失败时不推进已提交游标。
5. 后端发生迟到插入后，后续帧使用更新后的位置；客户端按序执行，不自行维护位置迁移表。

## SnapshotFrame

指定游标处的完整显示状态。初次连接、显式请求显示恢复或读取快照时使用。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.v` | integer，固定 `3` | 是 | 契约版本。 |
| `frame.kind` | string，固定 `snapshot` | 是 | 显示快照。 |
| `frame.streamId` | string | 是 | 快照所属日志。 |
| `frame.atSeq` | integer | 是 | 快照准确包含到哪个事件序号；空初始状态为 `0`。 |
| `frame.ts` | integer | 是 | 快照生成时间。 |
| `frame.sessionId` | string | 是 | 所属会话。 |
| `frame.sources` | NativeSource[] | 是 | 快照记录的来源集合。 |
| `frame.sources[i].harness` | enum | 条件必填 | `codex`、`claude`、`pi`。 |
| `frame.sources[i].interface` | string | 条件必填 | 来源接口。 |
| `frame.sources[i].version` | string 或 null | 条件必填 | 来源版本。 |
| `frame.sources[i].instanceId` | string | 条件必填 | 来源实例。 |
| `frame.sources[i].channel` | string | 条件必填 | 来源通道。 |
| `frame.integrity` | Integrity | 是 | 字段展开与上文 `frame.integrity` 一致。 |
| `frame.items` | OutputItem[] | 是 | 完整有序组件树；替换本地显示基线。 |

快照不包含之前各条 `native`。用快照恢复显示，不等于原始事件历史已经完整交付。

## 输出组件：OutputItem

完整组件存在于快照 `frame.items[i]`、插入操作 `frame.output.edits[i].items[j]` 及嵌套 `children`。为避免联合路径混淆，以下统一展开客户端应用后的完整路径 `state.items[i]`。

嵌套组件使用相同字段结构，例如 `state.items[i].children[j].content[k].text`。每个组件只出现一次，所有组件的 `id` 在整棵显示树中唯一。

### 公共字段

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items` | OutputItem[] | 是 | 按显示顺序排列的根组件数组。 |
| `state.items[i].id` | string | 是 | 稳定组件身份，供 UI key 使用；不是 provider 原生 ID。 |
| `state.items[i].kind` | enum | 是 | `message`、`thinking`、`tool`、`agent`、`task`、`plan`、`interaction`、`notice`、`usage`、`run`。 |
| `state.items[i].runId` | string 或 null | 是 | 当前逻辑运行归属；`kind=run` 时必须为字符串并等于 `id`。 |

`detached` 后台工作的 `runId` 从创建起为 `null`；`originRunId` 记录发起它的运行，不会因为父运行完成而丢失。

### MessageItem：消息

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `message` | 是 | 消息组件。 |
| `state.items[i].role` | enum | 是 | `user`、`assistant`、`system`。 |
| `state.items[i].phase` | enum | 是 | `input`、`commentary`、`final`、`notification`。 |
| `state.items[i].status` | enum | 是 | `streaming`、`complete`、`failed`、`cancelled`。 |
| `state.items[i].content` | Content[] | 是 | 按顺序展示的内容块。 |

`phase=final` 可以与 `status=streaming` 同时出现，表示正在流式生成最终回答。消息完成不等于父运行或整个会话结束。

### ThinkingItem：公开思考摘要与计时

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `thinking` | 是 | 思考阶段组件。 |
| `state.items[i].status` | enum | 是 | `running`、`complete`、`failed`、`cancelled`。 |
| `state.items[i].summary` | string 或 null | 是 | 来源实际公开的摘要；没有公开文本时为 `null`。 |
| `state.items[i].timing` | Timing | 是 | 该阶段计时，见下文。 |

不根据首字延迟或“总耗时减工具耗时”推导内部思考时间，不补造来源未公开的推理文本。

### ToolItem：工具执行

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `tool` | 是 | 工具组件。 |
| `state.items[i].name` | string | 是 | 工具名称。 |
| `state.items[i].status` | enum | 是 | `pending`、`running`、`complete`、`failed`、`cancelled`。 |
| `state.items[i].input` | ToolInput | 是 | 工具输入及解析状态。 |
| `state.items[i].input.status` | enum | 是 | `streaming`、`invalid`、`complete`。 |
| `state.items[i].input.text` | string | 是 | 完整累计输入文本；流式阶段通过文本追加更新。 |
| `state.items[i].input.value` | JSON | 是 | `streaming` 或 `invalid` 时为 `null`；`complete` 时为解析值，解析结果也可合法为 `null`。 |
| `state.items[i].output` | Content[] | 是 | 工具输出内容块。 |
| `state.items[i].children` | OutputItem[] | 是 | 工具执行内需要呈现的子组件。 |
| `state.items[i].timing` | Timing | 是 | 工具阶段计时。 |
| `state.items[i].error` | StreamError 或 null | 是 | 错误；失败工具可以同时保留部分输出。 |

### AgentItem：子 agent

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `agent` | 是 | 子 agent 容器。 |
| `state.items[i].name` | string | 是 | 显示名称。 |
| `state.items[i].originRunId` | string 或 null | 是 | 发起运行；后台自主启动且无发起运行时为 `null`。 |
| `state.items[i].completionPolicy` | enum | 是 | `joined` 或 `detached`。 |
| `state.items[i].status` | enum | 是 | `pending`、`running`、`waiting`、`complete`、`failed`、`cancelled`、`unknown`。 |
| `state.items[i].children` | OutputItem[] | 是 | 子 agent 的消息、工具及其它子组件，按显示顺序排列。 |
| `state.items[i].timing` | Timing | 是 | 子 agent 计时。 |
| `state.items[i].error` | StreamError 或 null | 是 | 子 agent 错误。 |

`joined` 的未完成工作阻止父运行成功结束；`detached` 继续通过会话流报告，不重新打开已结束的父运行。子 agent 自己的最终消息只完成它自己的答复。

### TaskItem：后台任务

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `task` | 是 | 后台或嵌套任务容器。 |
| `state.items[i].title` | string | 是 | 任务标题。 |
| `state.items[i].taskKind` | enum | 是 | `command`、`agent`、`workflow`、`monitor`、`other`。 |
| `state.items[i].originRunId` | string 或 null | 是 | 发起运行。 |
| `state.items[i].completionPolicy` | enum | 是 | `joined` 或 `detached`。 |
| `state.items[i].status` | enum | 是 | `pending`、`running`、`paused`、`complete`、`failed`、`cancelled`、`unknown`。 |
| `state.items[i].control` | enum | 是 | `api`、`terminal`、`none`；描述控制入口，不等同于具体取消请求已经成功。 |
| `state.items[i].children` | OutputItem[] | 是 | 任务产生的有序子组件。 |
| `state.items[i].timing` | Timing | 是 | 任务计时。 |
| `state.items[i].error` | StreamError 或 null | 是 | 任务错误。 |

暂停或状态未知不等于完成。同一执行实体不能同时重复显示为 agent 和 task 两个容器。

### PlanItem：计划

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `plan` | 是 | 计划组件。 |
| `state.items[i].steps` | PlanStep[] | 是 | 按执行展示顺序排列的步骤。 |
| `state.items[i].steps[j].id` | string | 是 | 步骤身份。 |
| `state.items[i].steps[j].text` | string | 是 | 步骤内容。 |
| `state.items[i].steps[j].status` | enum | 是 | `pending`、`running`、`complete`、`skipped`、`failed`。 |

### InteractionItem：等待输入或授权

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `interaction` | 是 | 交互请求组件。 |
| `state.items[i].requestId` | string | 是 | 请求身份。 |
| `state.items[i].requestKind` | enum | 是 | `approval`、`question`、`form`、`authentication`。 |
| `state.items[i].status` | enum | 是 | `pending`、`resolved`、`cancelled`。 |
| `state.items[i].prompt` | string | 是 | 用户需要回应的说明。 |
| `state.items[i].inputSchema` | object | 是 | 输入结构描述。 |
| `state.items[i].choices` | InteractionChoice[] | 是 | 预设选择；没有选择时为空数组。 |
| `state.items[i].choices[j].id` | string | 是 | 选项身份。 |
| `state.items[i].choices[j].label` | string | 是 | 选项显示文本。 |
| `state.items[i].choices[j].value` | JSON | 是 | 选项提交值。 |
| `state.items[i].response` | JSON | 是 | 已记录的响应；尚无响应时可以为 `null`。 |

### NoticeItem：提示

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `notice` | 是 | 提示组件。 |
| `state.items[i].severity` | enum | 是 | `info`、`warning`、`error`。 |
| `state.items[i].code` | string | 是 | 可编程识别的提示代码。 |
| `state.items[i].text` | string | 是 | 提示正文。 |
| `state.items[i].details` | JSON | 是 | 补充内容。 |

### UsageItem：用量

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `usage` | 是 | 用量组件。 |
| `state.items[i].scope` | enum | 是 | `call`、`run`、`session`。 |
| `state.items[i].mode` | enum | 是 | `delta` 或 `cumulative`。 |
| `state.items[i].model` | string 或 null | 是 | 模型；未知为 `null`。 |
| `state.items[i].values` | UsageValues | 是 | 用量值；未知值不冒充 `0`。 |
| `state.items[i].values.inputTokens` | integer 或 null | 是 | 输入 token 数。 |
| `state.items[i].values.outputTokens` | integer 或 null | 是 | 输出 token 数。 |
| `state.items[i].values.thinkingTokens` | integer 或 null | 是 | 来源报告的思考 token 数。 |
| `state.items[i].values.cacheReadTokens` | integer 或 null | 是 | 缓存读取 token 数。 |
| `state.items[i].values.cacheWriteTokens` | integer 或 null | 是 | 缓存写入 token 数。 |
| `state.items[i].values.totalTokens` | integer 或 null | 是 | 来源报告的总 token 数。 |
| `state.items[i].values.cost` | object 或 null | 是 | 费用；未知为 `null`。 |
| `state.items[i].values.cost.amount` | string | 条件必填 | 十进制字符串，避免二进制浮点误差。 |
| `state.items[i].values.cost.currency` | string | 条件必填 | 来源报告的币种标识。 |

`cumulative` 表示累计值，更新时替换对应累计值，不能再次相加。不同来源对 token 分类的定义可能不同，原始统计仍保留在 `native`。

### RunItem：逻辑运行

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `run` | 是 | 逻辑运行组件。 |
| `state.items[i].id` | string | 是 | 等于该组件的 `runId`。 |
| `state.items[i].runId` | string | 是 | 非空逻辑运行身份。 |
| `state.items[i].status` | enum | 是 | `queued`、`running`、`input_required`、`auth_required`、`complete`、`failed`、`cancelled`、`rejected`。 |
| `state.items[i].model` | string 或 null | 是 | 模型信息；未知为 `null`。 |
| `state.items[i].timing` | Timing | 是 | 运行计时。 |
| `state.items[i].error` | StreamError 或 null | 是 | 运行错误。 |

`input_required` 和 `auth_required` 允许后续继续同一运行。运行结束不自动结束会话事件流，后台任务可以继续产生事件。

## 内容块：Content

以下使用消息内容路径。工具内容的对应完整路径为 `state.items[i].output[j]`，内容类型相同。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].content[j].kind` | enum | 是 | `text`、`json`、`image`、`file`、`audio`、`video`。 |
| `state.items[i].content[j].text` | string | 条件必填 | 仅 `kind=text`；正文累计值。 |
| `state.items[i].content[j].value` | JSON | 条件必填 | 仅 `kind=json`；完整结构化内容。 |
| `state.items[i].content[j].mediaType` | string | 条件必填 | 图片、文件、音频、视频的媒体类型。 |
| `state.items[i].content[j].name` | string 或 null | 条件必填 | 媒体名称；未知为 `null`。 |
| `state.items[i].content[j].blob` | BinaryData | 条件必填 | 媒体内容或可验证引用。 |
| `state.items[i].content[j].blob.kind` | enum | 条件必填 | `inline` 或 `reference`。 |
| `state.items[i].content[j].blob.encoding` | string，固定 `base64` | 条件必填 | 仅 `blob.kind=inline`。 |
| `state.items[i].content[j].blob.data` | string | 条件必填 | 仅内联分支；Base64 数据。 |
| `state.items[i].content[j].blob.uri` | string | 条件必填 | 仅引用分支；内容地址。 |
| `state.items[i].content[j].blob.sha256` | string | 条件必填 | 仅引用分支；内容 SHA-256 校验值。 |
| `state.items[i].content[j].blob.sizeBytes` | integer | 条件必填 | 仅引用分支；内容字节数。 |

多模态块保持来源顺序。将二进制内容改为引用时，需要独立保证内容可取回；仅保留失效 URL 不构成完整内容交付。

## 计时：Timing

适用于 thinking、tool、agent、task 和 run。嵌套组件使用同样字段，例如 `state.items[i].children[j].timing.durationMs`。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].timing.startedAt` | integer 或 null | 是 | 开始时间；没有可靠信息时允许 `null`。 |
| `state.items[i].timing.endedAt` | integer 或 null | 是 | 结束时间；执行中或未知时为 `null`。 |
| `state.items[i].timing.durationMs` | integer 或 null | 是 | 阶段耗时；执行中或无法确定时为 `null`。 |
| `state.items[i].timing.basis` | enum | 是 | `native_reported`、`host_observed`、`unknown`。 |

| 计时分支 | 字段约束 |
| --- | --- |
| `native_reported` | 使用来源提供的计时；三个数值字段均允许未知。 |
| `host_observed`，执行中 | `startedAt` 为数值，`endedAt` 和 `durationMs` 为 `null`。 |
| `host_observed`，已结束 | 三个数值字段均存在；`durationMs` 用单调钟计算。 |
| `unknown` | `durationMs` 必须为 `null`；开始和结束时间允许未知。 |

客户端可以临时显示进行中的计时，完成后以服务端值为准。并发子任务耗时不能直接相加当作父运行耗时。

## 组件错误：StreamError

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].error` | StreamError 或 null | 是 | 适用于带错误字段的 tool、agent、task、run；无错误为 `null`。 |
| `state.items[i].error.code` | string | 条件必填 | 错误代码。 |
| `state.items[i].error.message` | string | 条件必填 | 错误描述。 |
| `state.items[i].error.details` | JSON | 条件必填 | 结构化上下文。 |

错误不会自动删除已输出的文本、工具部分结果或子组件。

## ControlFrame

连接提示不占用新的事件序号，不参与显示树 reducer。数据缺失还必须写入持久完整性状态。

### 公共字段

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.v` | integer，固定 `3` | 是 | 契约版本。 |
| `frame.kind` | string，固定 `control` | 是 | 连接控制提示。 |
| `frame.streamId` | string | 是 | 对应日志身份。 |
| `frame.code` | enum | 是 | `replay.unavailable`、`stream.incomplete`、`stream.closed`、`stream.replaced`。 |
| `frame.details` | object | 是 | 由 `code` 决定的严格分支。 |

### replay.unavailable：无法完整续传

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.details.requestedAfterSeq` | integer | 是 | 请求从哪个已提交游标之后恢复。 |
| `frame.details.availableFromSeq` | integer 或 null | 是 | 可用历史起点；未知为 `null`。 |
| `frame.details.latestSeq` | integer 或 null | 是 | 已知最新序号。 |
| `frame.details.reason` | enum | 是 | `expired`、`unknown_stream`、`invalid_cursor`。 |

不能静默用最新快照冒充丢失历史的补齐。只恢复显示需要调用方明确接受原始历史不完整。

### stream.incomplete：采集不完整

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.details.integrity` | IncompleteIntegrity | 是 | 本提示只能报告不完整状态。 |
| `frame.details.integrity.status` | string，固定 `incomplete` | 是 | 完整性已受损。 |
| `frame.details.integrity.issues` | IntegrityIssue[] | 是 | 至少一项，字段与上文完整性问题一致。 |
| `frame.details.integrity.issues[i].code` | enum | 是 | `capture_lost`、`encoding_failed`、`storage_failed`、`source_unavailable`。 |
| `frame.details.integrity.issues[i].message` | string | 是 | 问题说明。 |
| `frame.details.integrity.issues[i].atSeq` | integer 或 null | 是 | 关联日志位置。 |
| `frame.details.integrity.issues[i].source` | NativeSource 或 null | 是 | 关联来源。 |
| `frame.details.integrity.issues[i].source.harness` | enum | 条件必填 | 来源非空时为 `codex`、`claude`、`pi`。 |
| `frame.details.integrity.issues[i].source.interface` | string | 条件必填 | 发生问题的来源接口。 |
| `frame.details.integrity.issues[i].source.version` | string 或 null | 条件必填 | 来源版本。 |
| `frame.details.integrity.issues[i].source.instanceId` | string | 条件必填 | 来源实例。 |
| `frame.details.integrity.issues[i].source.channel` | string | 条件必填 | 来源通道。 |

### stream.closed：连接流结束

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.details.atSeq` | integer | 是 | 结束时的日志位置。 |
| `frame.details.reason` | enum | 是 | `export_complete`、`session_closed`、`server_shutdown`。 |

`server_shutdown` 不等于所有运行成功结束；它表示本次连接流关闭。

### stream.replaced：日志身份改变

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.details.nextStreamId` | string | 是 | 后续日志身份。 |
| `frame.details.reason` | string | 是 | 变更原因。 |

新日志必须建立新基线，不能将其序号直接拼入旧日志。

## 顺序处理与重连

| 条件 | 客户端处理 |
| --- | --- |
| 收到同一日志的下一条 `seq` | 按 `edits[]` 顺序原子应用，成功后推进显示游标。 |
| 收到已经提交的 `seq` | 去重，不再次执行文本追加。 |
| 收到不连续的未来 `seq` | 暂停应用，先补齐缺失事件。 |
| 路径无效、值类型不符或操作失败 | 不提交半帧，不推进游标；报告错误并恢复一致基线。 |
| 收到匹配游标的快照 | 建立完整显示基线，再执行后续事件。 |
| 原始日志导出与显示渲染进度不同 | 分别记录交付进度，不用显示快照替代原始事件。 |

```text
已保存 state@8：
    afterSeq=8 -> event 9 -> event 10 -> ... -> live tail

没有显示状态，但允许从快照恢复：
    snapshot@8 -> event 9 -> event 10 -> ... -> live tail

原始内容完整导出：
    native event 1 -> native event 2 -> ... -> export cursor
```

完整快照与接入实时尾流之间必须无缝衔接。前台 run 结束后，会话流仍可继续发送子 agent 和 detached 后台任务的事件。

显示增量减少组件树的重复传输，但原生事件本身如果包含累计消息或完整 partial 对象，`native` 仍可能重复。保留原始内容与减少投影流量是两个分别实现的要求。
