# Harness HTTP API 参考草案

状态：2026-10-17 请求与返回说明草案，尚未实现。采用上一轮讨论的增量操作
`splice`、`set`、`text.append`；本文没有修改生产 v2，也没有宣称这些路由已经可用。

本文按 [OpenAI Create Response 参考页](https://developers.openai.com/api/reference/resources/responses/methods/create?site_locale=en)
的组织方式说明方法、请求参数、返回字段和示例。接口语义采用 A2A 1.0，而非 OpenAI Responses API。
A2A 字段固定到规范发布版 v1.0.1；线上 `A2A-Version` 为 `1.0`。

本协议只面向平台外部且有权访问目标会话的客户端，当前 Chat UI 不消费此协议。
对外适配层可以复用现有会话服务、运行驱动和事件采集来源；复用来源不要求 Chat UI
切换到新帧格式，也不要求浏览器保持打开。公开发布 Agent 的隔离调用边界仍由其独立设计定义。

增量修订的完整示例见 [session.jsonl](examples/harness-stream-v3-delta-proposal/session.jsonl)、
[session.sse](examples/harness-stream-v3-delta-proposal/session.sse) 与
[reconnect.sse](examples/harness-stream-v3-delta-proposal/reconnect.sse)。它们是合成示例。
现有 [v3 JSON Schema](harness-stream-v3.schema.json) 描述上一版完整组件替换契约，
尚未升级，不能用它验证本文新增的增量操作。

阅读入口：[发送消息](#方法一-发送消息并创建或继续任务)、
[读取共享流](#方法二-读取完整共享事件流)、
[返回对象字段](#共享返回对象)、[完整流式示例](#流式返回示例)、
[标准查询与订阅](#标准-a2a-查询与流式方法)、[错误返回](#错误返回)。

## 字段来源与平台约定

所有字段按定义来源标注，平台映射/约定可叠加在标准或扩展字段上。

| 标注 | 含义 |
| --- | --- |
| A2A 标准 | A2A 1.0 定义的字段、服务参数或 HTTP binding 采用的错误结构；来源固定到 v1.0.1。 |
| 自定义扩展 | 本方案定义的共享帧、组件、增量操作、日志游标及扩展 URI 命名空间。 |
| HTTP / SSE 标准 | HTTP 头和 SSE 包装；其中具体取值或使用要求仍可能由本方案约定。 |
| 平台映射/约定 | 内部身份映射、产品能力范围及加强规则；不改变字段自身的定义来源。 |

```text
field definition: A2A / shared extension / HTTP-SSE
          |
          +--> optional platform convention
                  contextId <-> sessionId
                  Task.id   <-> runId
```

`metadata` 是标准容器，其中自定义 URI 下的 `streamId` / `eventsUrl` 是扩展。
`native.value` 是扩展容器，其内部字段属于原始 harness 输出；开放 JSON 的业务属性
由对应工具或 inputSchema 定义。文档的来源标签不会添加到真实请求或返回 JSON。
父对象可选不代表对象出现后其内部的标准必填字段也可省略。

## 调用流程

```text
External client                      Platform / runtime
  | POST /message:send                     |
  | configuration.returnImmediately=true   |
  |--------------------------------------->|
  |                    create Task + journal start cursor
  |                    schedule execution + durable capture
  |<---------------------------------------|
  | HTTP 200: { task: { ..., metadata } }   |
  |                                        | execution continues
  | optional: GET eventsUrl?afterSeq=N      |
  |--------------------------------------->|
  | snapshot(N), event(N+1), event(N+2), ... |
  |<---------------------------------------|
  |                                        |
  | alternatively: GET /tasks/{taskId}      |
  |--------------------------------------->|
  | current Task / available Artifacts      |
  |<---------------------------------------|
```

**提交和消费解耦。** 当 `configuration.returnImmediately=true` 时，服务端在创建或
接受任务后尽快返回当前 Task，执行与采集不等待客户端订阅。立即返回不表示固定耗时，
也不保证状态恒为 `TASK_STATE_SUBMITTED`：返回时可能已是 WORKING，快速任务也可能
已经完成。成功响应仍为 HTTP `200`，不是以 HTTP `202` 代替 A2A Task 响应。

客户端拿到 Task 后自行选择：

- 需要完整实时过程：通过 `eventsUrl` 建立一条 SSE，以 `startAfterSeq` 为起点接收
  快照和后续事件；不是每一帧都重新发起 HTTP 请求。
- 只需要状态和最终产物：按需调用 `GET /tasks/{taskId}`，不必建立事件订阅。
  Task / Artifacts 不等同于完整原始事件日志。
- 暂不消费：任务与采集继续运行，之后可在日志保留范围内回放。断开订阅也不会取消任务；
  显式取消使用 CancelTask，业务上的 INPUT_REQUIRED / AUTH_REQUIRED 仍需客户端回应。

`returnImmediately` 的 A2A 默认值是 `false`；省略或传 `false` 时，SendMessage 等待
终态或需要输入/认证的中断态后返回。不能将本产品推荐的异步示例误解为标准默认行为。

Task 的 metadata 在实际 JSON 中位于 `response.task.metadata`，不是响应顶层。
只有扩展成功激活时，才按本草案返回 `streamId`、`startAfterSeq` 和 `eventsUrl`。
需要完整流的客户端采用一次 A2A 提交加一条共享 SSE，SDK 可以包装成一个异步迭代器。
无需再同时打开标准 A2A Task SSE 来驱动同一个显示状态。`POST /message:stream`
则在一次请求中返回标准 A2A SSE；它与完整原始事件扩展是两种不同的读取契约。

## 地址与请求头

示例 Agent 接口根地址为 `https://agent.example.com/a2a`。
标准方法路径相对于 AgentCard 的 `supportedInterfaces[].url`；发现路径位于 origin 根目录。
扩展流使用返回的完整 `eventsUrl`，不要用 A2A 根地址自行拼接。

文档使用的扩展 URI `https://agent.example.com/extensions/harness-stream/v1` 是占位符，
实施时须换成项目控制的稳定地址。扩展版本、共享帧版本 `3`、A2A 版本 `1.0` 分别管理。

| 请求头 | 适用范围 | 值与说明 |
| --- | --- | --- |
| `A2A-Version` | A2A 标准操作 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md#1421-a2a-version-header)）。 必填，`1.0`。 |
| `Content-Type` | 带 JSON 请求体的 A2A 操作 | **HTTP / SSE 标准**（[依据](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3)）。 **平台映射/约定**：本调用契约要求 `application/a2a+json`；A2A HTTP binding 对该媒体类型使用 SHOULD，字段名本身来自 HTTP。 `application/a2a+json`。 |
| `Accept` | 普通 A2A 返回 | **HTTP / SSE 标准**（[依据](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.1)）。 **平台映射/约定**：普通 A2A 返回协商 `application/a2a+json`，流式返回协商 `text/event-stream`；本页要求显式发送该请求头。 `application/a2a+json`。 |
| `Accept` | 标准流或共享流 | **HTTP / SSE 标准**（[依据](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.1)）。 **平台映射/约定**：普通 A2A 返回协商 `application/a2a+json`，流式返回协商 `text/event-stream`；本页要求显式发送该请求头。 `text/event-stream`。 |
| `A2A-Extensions` | 请求完整输出扩展时 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/topics/extensions.md#extension-activation)）。 **平台映射/约定**：共享流扩展 URI 由我们定义，目前为占位地址；本扩展要求响应确认激活。A2A 的回传要求是 SHOULD，本方案以确认作为完整输出成功条件。 包含扩展 URI；本扩展要求响应确认激活，未确认时不能当作完整输出成功。 |
| `Last-Event-ID` | 共享 SSE 续传 | **HTTP / SSE 标准**（[依据](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header)）。 **平台映射/约定**：将标准 SSE 游标编码为 `streamId:seq`，与 `afterSeq` 同时提供时必须一致；此格式和重放规则由本扩展定义。 `<streamId>:<seq>`，如 `stream-1:8`。 |
| 认证请求头 | 按 AgentCard 与部署要求 | 不预设 Bearer、API key 或匿名为唯一方式；扩展激活不授予会话权限。 |

路径和字段表中的 `request`、`response`、`frame`、`state` 是文档中的根变量，不是额外 JSON 包装。
数组以 `[i]` 表示某个元素，示例使用确定下标。URI 作为对象键时采用方括号，避免误解为可拆分的 Dot Notation。

## 方法一 发送消息并创建或继续任务

`POST /message:send`

发送用户消息，创建新的逻辑 run，或继续指定的未终态任务。本产品执行请求返回 Task。
新 Task 的日志起点必须在 prompt 注入前持久保存；随后连接共享流可以重放这段期间的事件。

### 请求体参数

| 完整字段路径 | 类型 | 必填与默认值 | 说明 |
| --- | --- | --- | --- |
| `request.message` | object | 必填 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L648-L658)）。 要提交的消息。 |
| `request.message.messageId` | string | 必填 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 **平台映射/约定**：A2A 规定由消息创建者生成身份；本产品另外使用消息 ID 做提交去重，去重范围和请求等价判断属于平台规则。 客户端生成的消息 ID；用于消息身份和产品提交去重。 |
| `request.message.role` | string | 必填 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 A2A 1.0 标准必填字段。此调用使用 `ROLE_USER`，表示客户端向服务端发送；客户端可以是应用或另一个 Agent，不限于人类用户。服务端消息使用 `ROLE_AGENT`。参见 [A2A Role / Message 定义](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L245-L277)。 |
| `request.message.parts` | Part[] | 必填 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 有序的输入内容，至少一个 Part。 |
| `request.message.contextId` | string | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 **平台映射/约定**：本产品将 A2A 上下文映射为平台 sessionId，取相同值；这是平台映射，不是 A2A 对内部会话模型的要求。 A2A 1.0 标准字段，指定已有上下文。本产品将其值映射为平台的 `sessionId`；标准请求中的字段名仍为 `contextId`。省略且没有 taskId 时，由服务器创建上下文。参见 [A2A Message 定义](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L254-L266)。 |
| `request.message.taskId` | string | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 **平台映射/约定**：本产品以平台逻辑 runId 作为 A2A Task ID，关联同一次运行；这不是子组件或 harness 原生 ID。 继续指定未终态任务；只给 taskId 时从任务推导 contextId。两个字段同时提供时必须匹配。 |
| `request.message.referenceTaskIds` | string[] | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 **平台映射/约定**：引用的 A2A Task ID 在本产品对应逻辑 runId；引用只提供上下文，不会继续或恢复这些运行。 引用其它任务作为上下文；不表示继续或复活那些任务。 |
| `request.message.metadata` | object | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 metadata 容器由 A2A 定义；内部自定义键及命名空间不自动属于 A2A 标准。 消息元数据；结构化交互关联放在这里的扩展命名空间。 |
| `request.message.metadata["https://agent.example.com/extensions/harness-stream/v1"]` | object | 可选 | **自定义扩展**（[依据](#继续会话与回答交互)）。 URI 命名空间由本方案定义，metadata 容器仍属于 A2A；该 URI 不是 A2A 官方扩展。 已协商的交互关联命名空间，普通消息不必提供。 |
| `request.message.metadata["https://agent.example.com/extensions/harness-stream/v1"].interactionId` | string | 回答结构化交互时提供 | **自定义扩展**（[依据](#继续会话与回答交互)）。 **平台映射/约定**：与共享 InteractionItem.requestId 使用同一身份；不是组件 id，也不是 A2A 原生字段。 对应共享 InteractionItem.requestId；普通消息省略。 |
| `request.message.extensions` | string[] | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 此 Message 携带或贡献数据的扩展 URI；不能代替请求头中的扩展协商。 |
| `request.configuration` | object | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L648-L658)）。 本次发送的返回方式与输出偏好。 |
| `request.configuration.returnImmediately` | boolean | 可选，默认 `false` | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L143-L161)）。 **平台映射/约定**：完整共享流示例推荐 true，以便先拿 Task 再按需订阅；false 默认值及等待语义来自 A2A。 `true` 尽快返回当前 Task；`false` 等待终态或需要输入/认证的中断态。完整共享流调用应设为 `true`。 |
| `request.configuration.acceptedOutputModes` | string[] | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L143-L161)）。 客户端可接受的结果媒体类型，例如 `text/plain`、`application/json`。不用于筛掉 native 字段。 |
| `request.configuration.historyLength` | integer | 可选，0～2147483647 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L143-L161)）。 非负 int32；返回的最近历史消息数量上限。0 表示不返回历史，省略表示客户端不施加此限制，服务器仍可返回更少。 |
| `request.configuration.taskPushNotificationConfig` | object | 标准字段，当前产品草案不支持 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L143-L161)）。 **平台映射/约定**：该字段来自 A2A，但当前产品声明不支持推送通知；不能据此认为 A2A 本身不支持。 AgentCard 声明 `pushNotifications=false`；传入推送配置应返回标准不支持错误。 |
| `request.metadata` | object | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L648-L658)）。 metadata 容器由 A2A 定义；内部自定义键及命名空间不自动属于 A2A 标准。 请求级元数据，与消息元数据不同；任意键不会自动成为模型或运行参数。 |
| `request.tenant` | string | 按所选接口声明 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L648-L658)）。 不透明路由标识；AgentInterface 声明 tenant 时必须匹配，未声明时省略。 |

`contextId` 表示一组相关任务和消息的上下文；本产品将它映射为一个会话。
平台内部和共享事件流继续使用 `sessionId`，A2A 边界保留 `contextId`。例如：

```text
A2A request.message.contextId = "session-1"
                  |
                  v
Platform sessionId = "session-1"
                  |
                  +--> A2A response.task.contextId = "session-1"
                  +--> Shared event.context.sessionId = "session-1"
```

直接把标准请求字段改为 `sessionId` 会偏离 A2A 契约。SDK 可以将参数命名为
`sessionId`，再序列化为 `message.contextId`；这不需要新增第二个 HTTP 字段。

本文不新增 `model`、`harness`、`profileId`、`workspace`、`tools` 或 `stream` 请求字段。
当前设计通过选择 Agent 接口及其运行配置确定执行环境；逐请求覆盖这些配置的契约尚未定义。
标准流式操作由 `/message:stream` 选择，完整共享流通过返回的 `eventsUrl` 读取。

### Part 输入字段

每个 Part 必须选择 `text`、`data`、`raw`、`url` 中的一个内容字段，不能同时提供多个。
顺序就是输入内容顺序。输入文件或图片与共享返回中的 Content 是两套各有职责的类型。

| 完整字段路径 | 类型 | 必填与条件 | 说明 |
| --- | --- | --- | --- |
| `request.message.parts[i].text` | string | 四选一 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L224-L242)）。 文本内容。 |
| `request.message.parts[i].data` | JSON value | 四选一 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L224-L242)）。 A2A 定义任意 JSON 内容容器；内部业务字段由当前 inputSchema 决定，例如 approved 只是交互示例，不是固定协议字段。 对象、数组、字符串、数值、布尔或 null；用于结构化输入及交互回答。 |
| `request.message.parts[i].raw` | string | 四选一 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L224-L242)）。 base64 编码的二进制内容。 |
| `request.message.parts[i].url` | string | 四选一 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L224-L242)）。 内容地址；是否接受该媒体类型与地址由 Agent 的能力和输入规则决定。 |
| `request.message.parts[i].mediaType` | string | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L224-L242)）。 MIME，例如 `image/png` 或 `application/pdf`。 |
| `request.message.parts[i].filename` | string | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L224-L242)）。 文件名。 |
| `request.message.parts[i].metadata` | object | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L224-L242)）。 metadata 容器由 A2A 定义；内部自定义键及命名空间不自动属于 A2A 标准。 该内容块的元数据。 |

### 返回

成功返回 `200`、`application/a2a+json` 与 `{ "task": Task }`。
A2A 标准允许返回独立 Message，但本产品的执行操作使用 Task 分支。

| 完整字段路径 | 类型 | 出现条件 | 说明 |
| --- | --- | --- | --- |
| `response.task` | object | 本产品成功执行请求必有 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L779-L787)）。 **平台映射/约定**：A2A 标准允许 Task 或独立 Message；本产品的执行操作固定采用 Task 分支。 新建或继续的任务。 |
| `response.task.id` | string | 必有 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L167-L184)）。 **平台映射/约定**：本产品以平台逻辑 runId 作为 A2A Task ID，关联同一次运行；这不是子组件或 harness 原生 ID。 逻辑 run ID；共享组件中的 runId 使用同一身份。 |
| `response.task.contextId` | string | 本产品必有 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L167-L184)）。 **平台映射/约定**：本产品将 A2A 上下文映射为平台 sessionId，取相同值；这是平台映射，不是 A2A 对内部会话模型的要求。 本产品每个 Task 均返回 contextId；A2A Task 类型本身未将它标为 REQUIRED。 A2A 标准上下文 ID；本产品约定与平台会话 ID、共享帧的 sessionId 取相同值，这是产品映射而非 A2A 对内部模型的要求。 |
| `response.task.status.state` | TaskState | 必有 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L211-L219)）。 当前任务状态，见下表。 |
| `response.task.status.message` | Message | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L211-L219)）。 与当前状态相关的消息，例如需要补充的输入。 |
| `response.task.status.timestamp` | string | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L211-L219)）。 状态时间，RFC 3339 格式；不同于共享帧中的 epoch 毫秒。 |
| `response.task.artifacts` | Artifact[] | 有可用结果时 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L167-L184)）。 标准产物；可包含文本、文件或结构化数据。 |
| `response.task.history` | Message[] | 按 historyLength 与服务端限制 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L167-L184)）。 任务交互历史，不是完整原始事件日志。 |
| `response.task.metadata` | object | 可选；完整扩展激活时含流指针 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L167-L184)）。 **平台映射/约定**：仅在完整共享流扩展激活后，平台在自定义 URI 命名空间返回 streamId、startAfterSeq、eventsUrl。 metadata 容器由 A2A 定义；内部自定义键及命名空间不自动属于 A2A 标准。 Task 级元数据。 |
| `response.task.metadata["https://agent.example.com/extensions/harness-stream/v1"].streamId` | string | 完整扩展激活时必有 | **自定义扩展**（[依据](#返回)）。 **平台映射/约定**：指向平台保存的共享事件日志，与共享帧 streamId 使用同一身份。 共享日志身份。 |
| `response.task.metadata["https://agent.example.com/extensions/harness-stream/v1"].startAfterSeq` | integer | 完整扩展激活时必有 | **自定义扩展**（[依据](#返回)）。 **平台映射/约定**：由平台在任务提交时固定日志起点；重试、查询和回答交互不会重置它。 此任务固定的排他起点；新任务可能从已有会话的非零序号开始。 |
| `response.task.metadata["https://agent.example.com/extensions/harness-stream/v1"].eventsUrl` | string | 完整扩展激活时必有 | **自定义扩展**（[依据](#返回)）。 **平台映射/约定**：由平台返回已授权共享日志的完整读取地址，不含凭证；客户端无需从 A2A 地址拼接。 完整共享 SSE 地址，不包含凭证。 |

`startAfterSeq` 不因 GetTask、幂等重试或同任务的审批续答而重置。

| TaskState | 含义 | 是否终态 |
| --- | --- | --- |
| `TASK_STATE_SUBMITTED` | 已接受。 | 否 |
| `TASK_STATE_WORKING` | 正在执行。 | 否 |
| `TASK_STATE_INPUT_REQUIRED` | 等待用户输入或确认。 | 否，中断态 |
| `TASK_STATE_AUTH_REQUIRED` | 执行过程中需要凭据或授权。 | 否，中断态 |
| `TASK_STATE_COMPLETED` | 成功完成。 | 是 |
| `TASK_STATE_FAILED` | 执行失败，可能仍有部分结果。 | 是 |
| `TASK_STATE_CANCELED` | 已取消。 | 是 |
| `TASK_STATE_REJECTED` | Agent 拒绝执行。 | 是 |
| `TASK_STATE_UNSPECIFIED` | 标准保留的未知状态。 | 不作为完成信号 |

### 请求示例

以下使用文档示例域名；实际认证请求头按 AgentCard 补充。

```bash
curl 'https://agent.example.com/a2a/message:send' \
  -H 'A2A-Version: 1.0' \
  -H 'A2A-Extensions: https://agent.example.com/extensions/harness-stream/v1' \
  -H 'Content-Type: application/a2a+json' \
  -H 'Accept: application/a2a+json' \
  --data '{
    "message": {
      "messageId": "input-1",
      "role": "ROLE_USER",
      "parts": [{"text": "读取 README，检查项目目录，并在后台运行测试。"}]
    },
    "configuration": {
      "returnImmediately": true,
      "historyLength": 0,
      "acceptedOutputModes": ["text/plain", "application/json"]
    }
  }'
```

### 响应示例

响应头确认相同的 `A2A-Extensions`。

```json
{
  "task": {
    "id": "run-1",
    "contextId": "session-1",
    "status": {
      "state": "TASK_STATE_SUBMITTED"
    },
    "metadata": {
      "https://agent.example.com/extensions/harness-stream/v1": {
        "streamId": "stream-1",
        "startAfterSeq": 0,
        "eventsUrl": "https://agent.example.com/harness/streams/stream-1/events"
      }
    }
  }
}
```

### 继续会话与回答交互

主任务已终结后，在同一会话开始下一项工作：传 `message.contextId`，使用新的
`message.messageId`，省略旧的 `message.taskId`。服务器创建新 Task。

```json
{
  "message": {
    "messageId": "input-2",
    "contextId": "session-1",
    "role": "ROLE_USER",
    "parts": [{"text": "继续解释测试覆盖的内容。"}]
  },
  "configuration": {"returnImmediately": true}
}
```

回答未终态任务中的结构化交互：传原 `taskId`、匹配的 `contextId` 和新的 messageId。
`interactionId` 对应共享 InteractionItem 的 `requestId`，不是它的组件 `id`。
`parts[0].data` 必须满足该交互给出的 inputSchema；下例假设 schema 接受 `{approved:boolean}`。

```json
{
  "message": {
    "messageId": "approval-reply-1",
    "taskId": "run-1",
    "contextId": "session-1",
    "role": "ROLE_USER",
    "parts": [{"data": {"approved": true}}],
    "extensions": ["https://agent.example.com/extensions/harness-stream/v1"],
    "metadata": {
      "https://agent.example.com/extensions/harness-stream/v1": {
        "interactionId": "approval-request-1"
      }
    }
  },
  "configuration": {"returnImmediately": true}
}
```

**示例字段边界**：`message.metadata[扩展 URI].interactionId` 是自定义扩展，并映射到 InteractionItem.requestId。`parts[0].data.approved` 则由此交互的 inputSchema 定义，仅为业务示例；不是 A2A 或共享协议固定字段。

产品提交去重约定为“授权主体 + messageId”：同 ID、同内容复用提交结果，同 ID、
不同内容明确冲突。这不是 A2A 自动提供的幂等保证；幂等记录保存期限和请求等价判定
仍须在实施契约中固定。请求超时不能直接推断任务未执行。

## 方法二 读取完整共享事件流

`GET {eventsUrl}?afterSeq=N`

读取对外适配层持久记录的会话日志。其事件来源可与现有 Chat 共用，但该返回协议仅供
外部客户端消费。返回 N 处的精确显示快照，再依次返回 N+1 起的所有
已提交事件，并持续等待新事件。关闭连接只取消订阅，不取消运行。

### 请求参数

| 位置与名称 | 类型 | 必填与默认值 | 说明 |
| --- | --- | --- | --- |
| 路径中的 streamId | string | 由 eventsUrl 提供 | 必须与要读取的日志一致。 |
| query `afterSeq` | integer | 与 Last-Event-ID 至少提供一项 | **自定义扩展**（[依据](#方法二-读取完整共享事件流)）。 非负安全整数；排他起点。0 从会话日志起点读取，startAfterSeq 从当前任务起点读取。 |
| header `Last-Event-ID` | string | 可代替 afterSeq | **HTTP / SSE 标准**（[依据](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-last-event-id-header)）。 **平台映射/约定**：将标准 SSE 游标编码为 `streamId:seq`，与 `afterSeq` 同时提供时必须一致；此格式和重放规则由本扩展定义。 格式 `streamId:seq`；若两者同时提供，streamId 与 seq 必须一致。 |
| query `throughSeq` | integer | 可选，默认不设上界 | **自定义扩展**（[依据](#方法二-读取完整共享事件流)）。 有界历史导出的包含上界，到达后发 `stream.closed` 并关闭。不传则持续订阅。 |
| header `Accept` | string | 必填 | **HTTP / SSE 标准**（[依据](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.1)）。 **平台映射/约定**：普通 A2A 返回协商 `application/a2a+json`，流式返回协商 `text/event-stream`；本页要求显式发送该请求头。 `text/event-stream`。 |
| header `A2A-Extensions` | string | 本扩展要求 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/topics/extensions.md#extension-activation)）。 **平台映射/约定**：共享流扩展 URI 由我们定义，目前为占位地址；本扩展要求响应确认激活。A2A 的回传要求是 SHOULD，本方案以确认作为完整输出成功条件。 使用已协商的扩展 URI，并要求响应确认。 |

本文示例中的 throughSeq 使用已提交的历史序号，且不小于 afterSeq。
两种游标均未提供、游标格式错误、throughSeq 小于起点或大于最新提交点的精确 HTTP
错误映射尚未固定；不能由实现静默换成“从最新开始”。

### 返回

成功建立 `200`、`text/event-stream`，每个 SSE `data` 是一个 JSON 对象。

| SSE event | JSON kind | 返回说明 |
| --- | --- | --- |
| `snapshot` | `snapshot` | 第一帧，完整显示基线；atSeq 等于请求的 N。 |
| `event` | `event` | 原始来源记录及有序显示增量；seq 从 N+1 连续递增。 |
| `control` | `control` | 日志缺口、采集不完整、流关闭或替换提示。 |

只有 `event` 带 SSE `id: <streamId>:<seq>`。快照和控制帧不推进日志游标。
HTTP 共享流不发送 WS 的 `reply`，也不发送 OpenAI 风格的 `[DONE]` 字符串。

`afterSeq` 指向的快照必须可精确还原；服务器不能拿最新快照替代，跳过期间的 native。
快照只恢复显示状态，不提供 N 之前的原始事件。完整历史导出需从仍可用的日志起点读取。

### 请求示例

```bash
curl -N 'https://agent.example.com/harness/streams/stream-1/events?afterSeq=0' \
  -H 'Accept: text/event-stream' \
  -H 'A2A-Extensions: https://agent.example.com/extensions/harness-stream/v1'
```

断线后用最后成功处理的 seq 续传，不用仅仅收到但未处理成功的序号：

```bash
curl -N 'https://agent.example.com/harness/streams/stream-1/events' \
  -H 'Accept: text/event-stream' \
  -H 'A2A-Extensions: https://agent.example.com/extensions/harness-stream/v1' \
  -H 'Last-Event-ID: stream-1:8'
```

有界导出示例：`GET {eventsUrl}?afterSeq=0&throughSeq=16`。
它在第 16 条事件后发送 code 为 `stream.closed`、reason 为 `export_complete` 的控制帧。

**SSE 包装来源**：`event`、`data`、`id` 来自 [WHATWG SSE 标准](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)。本扩展定义 `event` 的 snapshot / event / control 名称、`id=streamId:seq` 取值及 `data` 中的共享帧；这些不是 A2A StreamResponse 字段。

### 生命周期与恢复

```text
snapshot(0) -> event 1 -> ... -> event 8 -> disconnect
                                   |
                       persist native + state + seq=8
                                   |
snapshot(8) -> event 9 -> ... -> event 16 -> live tail
```

- 同一 streamId 下重复 seq 不再应用；收到不连续的新 seq 时暂停应用并补齐。
- 每帧 edits 在暂存状态中按序执行并校验，整帧成功后才提交状态与游标。
- 位置路径基于执行该操作前的树；同帧后一条操作基于前一条操作的结果。
- streamId 变化须建立新基线，不能把新日志的 seq=1 拼到旧状态。
- 对 native 的可靠保存与显示应用使用不同事务时，分别保存各自的成功游标，不能相互冒充。
- run 结束、单个 Artifact 结束、A2A Task SSE 结束与共享会话流结束是不同边界。
- detached 后台任务和晚到事件可以在主 run 结束后继续产生共享事件。
- joined 子工作尚未完成时，父任务不能先成功结束。

## 共享返回对象

### 阅读约定

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

### 返回帧类型

HTTP SSE 的 `data` 返回以下三种帧。SSE 的 `event` 字段等于 `frame.kind`；只有 `event` 帧使用 `id: <streamId>:<seq>` 表示可重放游标。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.v` | integer，固定 `3` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 共享帧契约版本。 |
| `frame.kind` | enum | 是 | **自定义扩展**（[依据](#共享返回对象)）。 `event`、`snapshot` 或 `control`。 |
| `frame.streamId` | string | 是 | **自定义扩展**（[依据](#共享返回对象)）。 非空日志身份；不同日志不能共用同一套序号。 |

内部 WS 命令的 `reply` 回执不属于这里的 HTTP 返回契约。本文不定义新的 WS 请求。

### EventFrame

一条已持久化的事件，包含来源内容、完整性状态，以及零个或多个显示操作。

#### 事件外壳

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.v` | integer，固定 `3` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 契约版本。 |
| `frame.kind` | string，固定 `event` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 可重放事件。 |
| `frame.streamId` | string | 是 | **自定义扩展**（[依据](#共享返回对象)）。 事件所属日志。 |
| `frame.seq` | integer | 是 | **自定义扩展**（[依据](#共享返回对象)）。 该日志内严格递增的序号。 |
| `frame.ts` | integer | 是 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：平台记录此帧的时间，使用 epoch 毫秒；来源自带时间保留在 native，A2A TaskStatus.timestamp 使用 RFC 3339。 服务端记录事件的时间；来源自己的时间保留在 `native`。 |
| `frame.context` | object | 是 | **自定义扩展**（[依据](#共享返回对象)）。 事件的会话与逻辑运行上下文。 |
| `frame.context.sessionId` | string | 是 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：与平台会话 ID、A2A contextId 使用同一个值；字段名 sessionId 来自本共享协议。 会话身份。 |
| `frame.context.runId` | string 或 null | 是 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：关联平台逻辑 run，对应 A2A Task.id。脱离主运行时允许 null；不表示 A2A Task.id 可以为空。 当前逻辑运行；脱离主运行的后台事件可以为 `null`。 |
| `frame.native` | NativeRecord 或 null | 是 | **自定义扩展**（[依据](#共享返回对象)）。 NativeRecord 外壳由我们定义，实际原始 payload 由 harness 决定。 映射前保留的原始记录；宿主自行产生且没有来源记录的事件可以为 `null`。 |
| `frame.integrity` | Integrity | 是 | **自定义扩展**（[依据](#共享返回对象)）。 采集边界内持续保存的完整性状态。 |
| `frame.output` | Projection | 是 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：平台把 native 事件投影为按序应用的组件修改；投影失败或未知事件仍保留原始记录。 原始事件到显示操作的映射结果。 |

事件顺序是服务端提交顺序；并发来源之间不宣称存在额外的全局因果顺序。

#### 原始记录：NativeRecord

`format=json` 保留完整 JSON 内容；`format=bytes` 用于需要保留字节的来源。JSON 对象的空白和键顺序不作为内容保证。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.native.source` | NativeSource | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 `frame.native` 非空时的来源标识。 |
| `frame.native.source.harness` | enum | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 `codex`、`claude`、`pi`。 |
| `frame.native.source.interface` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 具体来源接口，例如宿主事件、转录或 hooks；用于区分采集边界。 |
| `frame.native.source.version` | string 或 null | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源版本；未知为 `null`。 |
| `frame.native.source.instanceId` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源实例身份。 |
| `frame.native.source.channel` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 实例内的来源通道。 |
| `frame.native.format` | enum | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 `json` 或 `bytes`。 |
| `frame.native.value` | JSON 或 string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 此字段是我们定义的容器；容器内部的属性名、枚举和内容属于原始 harness 输出，完整保留，不能统称为 A2A 或平台自定义字段。 `json` 时为任意 JSON；`bytes` 时为 Base64 字符串。 |
| `frame.native.encoding` | string，固定 `base64` | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 仅 `format=bytes` 时存在。 |

未知事件也必须保留。来源事件携带可变对象时，采集层应立即复制或序列化冻结，防止后续修改污染已记录事件。

完整性保证始于声明的来源接口：接口本身没有输出的内容不能凭空恢复；来源读取或保存发生缺失时必须明确报告。

#### 完整性：Integrity

`complete` 表示采集边界内没有已知缺失，不表示投影器认识全部原始事件。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.integrity.status` | enum | 是 | **自定义扩展**（[依据](#共享返回对象)）。 `complete` 或 `incomplete`。 |
| `frame.integrity.issues` | IntegrityIssue[] | 是 | **自定义扩展**（[依据](#共享返回对象)）。 `complete` 时必须为空；`incomplete` 时至少一项。 |
| `frame.integrity.issues[i].code` | enum | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 `capture_lost`、`encoding_failed`、`storage_failed`、`source_unavailable`。 |
| `frame.integrity.issues[i].message` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 缺失或故障说明。 |
| `frame.integrity.issues[i].atSeq` | integer 或 null | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 已知时记录关联日志序号，否则为 `null`。 |
| `frame.integrity.issues[i].source` | NativeSource 或 null | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 能定位时记录来源，否则为 `null`。 |
| `frame.integrity.issues[i].source.harness` | enum | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 `codex`、`claude`、`pi`。 |
| `frame.integrity.issues[i].source.interface` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 发生问题的来源接口。 |
| `frame.integrity.issues[i].source.version` | string 或 null | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源版本。 |
| `frame.integrity.issues[i].source.instanceId` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源实例。 |
| `frame.integrity.issues[i].source.channel` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源通道。 |

完整性问题持续出现在后续事件和快照中，不能只依靠临时连接提示。投影失败与原始数据缺失分别报告。

#### 显示投影：Projection

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.output.status` | enum | 是 | **自定义扩展**（[依据](#共享返回对象)）。 `applied`、`unmapped`、`failed`。 |
| `frame.output.edits` | OutputEdit[] | 是 | **自定义扩展**（[依据](#共享返回对象)）。 按数组顺序执行的显示操作；`unmapped` 和 `failed` 时必须为空。 |
| `frame.output.error` | StreamError | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 仅 `status=failed` 时存在。 |
| `frame.output.error.code` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 可编程识别的错误代码。 |
| `frame.output.error.message` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 错误描述。 |
| `frame.output.error.details` | JSON | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 这里只规定承载 JSON 的容器；内部业务字段由工具、harness 或当前交互 schema 决定，不自动成为共享协议固定字段。 错误上下文；无额外信息可为 `null`。 |

- `applied`：映射成功，操作可以为空，例如来源事件不改变显示。
- `unmapped`：尚无显示映射，原始事件仍保留在 `frame.native`。
- `failed`：映射器出错，本帧不提交显示变更，原始事件仍保留。

### 增量操作：OutputEdit

以下操作替代旧方案“根数组 splice + 完整父组件替换”。`path` 定位当前显示树；后一个操作使用前一个操作执行后的状态。

`path` 是字符串和非负整数组成的数组，例如 `["items",3,"children",0,"output",0,"text"]` 对应 `state.items[3].children[0].output[0].text`。后端负责将 provider ID 关联为位置，前端无需维护 provider 专用索引。

#### 插入、删除或替换数组元素：splice

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.output.edits[i].op` | string，固定 `splice` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 数组修改操作。 |
| `frame.output.edits[i].path` | `Array<string 或 integer>` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 指向允许修改的数组；例如 `["items"]` 或 `["items",3,"children"]`。 |
| `frame.output.edits[i].index` | integer | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 从当前数组的哪个位置开始操作；插入到末尾时等于数组长度。 |
| `frame.output.edits[i].deleteCount` | integer | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 删除多少个已有元素；`0` 表示只插入。 |
| `frame.output.edits[i].items` | array | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 插入的完整新元素；类型须符合目标数组；空数组表示只删除。 |

组件首次创建时发送完整组件。向 `children` 插入子组件不需要重发父组件或既有兄弟组件。内容块数组可以单独插入新结果块。

#### 更新字段：set

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.output.edits[i].op` | string，固定 `set` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 替换指定字段值。 |
| `frame.output.edits[i].path` | `Array<string 或 integer>` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 指向允许更新的字段；例如 `["items",2,"status"]`。 |
| `frame.output.edits[i].value` | JSON | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 替换后的完整字段值；其类型由目标字段决定。 |

`set` 不做隐式深合并，不负责自动创建缺失的祖先。状态、计时、结构化值以及权威终稿校正均可使用字段替换；不能通过它修改组件身份、原始记录或日志序号。

#### 追加文本：text.append

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.output.edits[i].op` | string，固定 `text.append` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 向允许追加的字符串字段追加文本。 |
| `frame.output.edits[i].path` | `Array<string 或 integer>` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 目标字符串字段；例如 `["items",5,"content",0,"text"]`。 |
| `frame.output.edits[i].text` | string | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本方案的增量操作，不是 A2A StreamResponse，也不是 RFC 6902 JSON Patch。 本次新增文本，不包含此前已经发送的前缀。 |

适用于消息正文、文本工具输出以及尚未完成的工具参数文本等已声明位置。`null` 不是空字符串；例如思考摘要当前为 `null` 时，须先设置为字符串，才能追加。

完成事件只更新完成状态和必要字段。若来源给出完整终稿，服务端核对后仅追加缺少的后缀；终稿修改了既有内容时，使用 `set` 校正正文。

#### 路径与执行限制

这三种操作是产品专用协议，不是 RFC 6902 JSON Patch；其中 `text.append` 是自定义操作。

以下是修订方案的语义要求，尚未全部编码进机器 schema：

1. 路径只能进入显示树的已声明位置；不能执行任意对象属性写入，也不能写入 `__proto__`、`constructor` 等不在字段白名单中的属性。
2. `splice` 插入元素和 `set` 替换值必须符合目标位置的类型；宽泛的 `JSON` 表格类型不等于任意位置都允许任意值。
3. 数组位置必须在当前边界内。客户端不能重排或删除同步状态中的数组；过滤、排序后的展示应使用派生视图。
4. 整帧先验证并应用到暂存状态，全部成功后原子提交；失败时不推进已提交游标。
5. 后端发生迟到插入后，后续帧使用更新后的位置；客户端按序执行，不自行维护位置迁移表。

### SnapshotFrame

指定游标处的完整显示状态。初次连接、显式请求显示恢复或读取快照时使用。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.v` | integer，固定 `3` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 契约版本。 |
| `frame.kind` | string，固定 `snapshot` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 显示快照。 |
| `frame.streamId` | string | 是 | **自定义扩展**（[依据](#共享返回对象)）。 快照所属日志。 |
| `frame.atSeq` | integer | 是 | **自定义扩展**（[依据](#共享返回对象)）。 快照准确包含到哪个事件序号；空初始状态为 `0`。 |
| `frame.ts` | integer | 是 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：平台记录此帧的时间，使用 epoch 毫秒；来源自带时间保留在 native，A2A TaskStatus.timestamp 使用 RFC 3339。 快照生成时间。 |
| `frame.sessionId` | string | 是 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：与平台会话 ID、A2A contextId 使用同一个值；字段名 sessionId 来自本共享协议。 所属会话。 |
| `frame.sources` | NativeSource[] | 是 | **自定义扩展**（[依据](#共享返回对象)）。 快照记录的来源集合。 |
| `frame.sources[i].harness` | enum | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 `codex`、`claude`、`pi`。 |
| `frame.sources[i].interface` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源接口。 |
| `frame.sources[i].version` | string 或 null | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源版本。 |
| `frame.sources[i].instanceId` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源实例。 |
| `frame.sources[i].channel` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源通道。 |
| `frame.integrity` | Integrity | 是 | **自定义扩展**（[依据](#共享返回对象)）。 字段展开与上文 `frame.integrity` 一致。 |
| `frame.items` | OutputItem[] | 是 | **自定义扩展**（[依据](#共享返回对象)）。 完整有序组件树；替换本地显示基线。 |

快照不包含之前各条 `native`。用快照恢复显示，不等于原始事件历史已经完整交付。

### 输出组件：OutputItem

完整组件存在于快照 `frame.items[i]`、插入操作 `frame.output.edits[i].items[j]` 及嵌套 `children`。为避免联合路径混淆，以下统一展开客户端应用后的完整路径 `state.items[i]`。

嵌套组件使用相同字段结构，例如 `state.items[i].children[j].content[k].text`。每个组件只出现一次，所有组件的 `id` 在整棵显示树中唯一。

#### 公共字段

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items` | OutputItem[] | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 按显示顺序排列的根组件数组。 |
| `state.items[i].id` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：平台分配稳定组件 ID，用作渲染身份；不要求等于 harness 原生 ID。RunItem.id 约定等于 runId。 稳定组件身份，供 UI key 使用；不是 provider 原生 ID。 |
| `state.items[i].kind` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 `message`、`thinking`、`tool`、`agent`、`task`、`plan`、`interaction`、`notice`、`usage`、`run`。 |
| `state.items[i].runId` | string 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：关联平台逻辑 run，对应 A2A Task.id。脱离主运行时允许 null；不表示 A2A Task.id 可以为空。 当前逻辑运行归属；`kind=run` 时必须为字符串并等于 `id`。 |

`detached` 后台工作的 `runId` 从创建起为 `null`；`originRunId` 记录发起它的运行，不会因为父运行完成而丢失。

#### MessageItem：消息

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `message` | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 消息组件。 |
| `state.items[i].role` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：输入 ROLE_USER 可投影为 user，服务端 ROLE_AGENT 可投影为 assistant；system 没有 A2A 同名角色，不能机械一一转换。 `user`、`assistant`、`system`。 |
| `state.items[i].phase` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 `input`、`commentary`、`final`、`notification`。 |
| `state.items[i].status` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：平台适配器按实际运行事件维护本组件状态；这些状态不是 A2A TaskState，不应直接用于标准 Task.status.state。 `streaming`、`complete`、`failed`、`cancelled`。 |
| `state.items[i].content` | Content[] | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 按顺序展示的内容块。 |

`phase=final` 可以与 `status=streaming` 同时出现，表示正在流式生成最终回答。消息完成不等于父运行或整个会话结束。

#### ThinkingItem：公开思考摘要与计时

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `thinking` | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 思考阶段组件。 |
| `state.items[i].status` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：平台适配器按实际运行事件维护本组件状态；这些状态不是 A2A TaskState，不应直接用于标准 Task.status.state。 `running`、`complete`、`failed`、`cancelled`。 |
| `state.items[i].summary` | string 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 来源实际公开的摘要；没有公开文本时为 `null`。 |
| `state.items[i].timing` | Timing | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 该阶段计时，见下文。 |

不根据首字延迟或“总耗时减工具耗时”推导内部思考时间，不补造来源未公开的推理文本。

#### ToolItem：工具执行

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `tool` | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 工具组件。 |
| `state.items[i].name` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 工具名称。 |
| `state.items[i].status` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：平台适配器按实际运行事件维护本组件状态；这些状态不是 A2A TaskState，不应直接用于标准 Task.status.state。 `pending`、`running`、`complete`、`failed`、`cancelled`。 |
| `state.items[i].input` | ToolInput | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 工具输入及解析状态。 |
| `state.items[i].input.status` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 `streaming`、`invalid`、`complete`。 |
| `state.items[i].input.text` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 完整累计输入文本；流式阶段通过文本追加更新。 |
| `state.items[i].input.value` | JSON | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 这里只规定承载 JSON 的容器；内部业务字段由工具、harness 或当前交互 schema 决定，不自动成为共享协议固定字段。 `streaming` 或 `invalid` 时为 `null`；`complete` 时为解析值，解析结果也可合法为 `null`。 |
| `state.items[i].output` | Content[] | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 工具输出内容块。 |
| `state.items[i].children` | OutputItem[] | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 工具执行内需要呈现的子组件。 |
| `state.items[i].timing` | Timing | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 工具阶段计时。 |
| `state.items[i].error` | StreamError 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 错误；失败工具可以同时保留部分输出。 |

#### AgentItem：子 agent

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `agent` | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 子 agent 容器。 |
| `state.items[i].name` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 显示名称。 |
| `state.items[i].originRunId` | string 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：记录发起子工作的逻辑 run，可关联发起方 A2A Task.id；自主后台工作可没有发起 run。 发起运行；后台自主启动且无发起运行时为 `null`。 |
| `state.items[i].completionPolicy` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：平台按 joined/detached 决定子工作是否阻塞主运行结束；A2A 没有直接定义这套子任务生命周期。 `joined` 或 `detached`。 |
| `state.items[i].status` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：平台适配器按实际运行事件维护本组件状态；这些状态不是 A2A TaskState，不应直接用于标准 Task.status.state。 `pending`、`running`、`waiting`、`complete`、`failed`、`cancelled`、`unknown`。 |
| `state.items[i].children` | OutputItem[] | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 子 agent 的消息、工具及其它子组件，按显示顺序排列。 |
| `state.items[i].timing` | Timing | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 子 agent 计时。 |
| `state.items[i].error` | StreamError 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 子 agent 错误。 |

`joined` 的未完成工作阻止父运行成功结束；`detached` 继续通过会话流报告，不重新打开已结束的父运行。子 agent 自己的最终消息只完成它自己的答复。

#### TaskItem：后台任务

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `task` | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 后台或嵌套任务容器。 |
| `state.items[i].title` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 任务标题。 |
| `state.items[i].taskKind` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 `command`、`agent`、`workflow`、`monitor`、`other`。 |
| `state.items[i].originRunId` | string 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：记录发起子工作的逻辑 run，可关联发起方 A2A Task.id；自主后台工作可没有发起 run。 发起运行。 |
| `state.items[i].completionPolicy` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：平台按 joined/detached 决定子工作是否阻塞主运行结束；A2A 没有直接定义这套子任务生命周期。 `joined` 或 `detached`。 |
| `state.items[i].status` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：平台适配器按实际运行事件维护本组件状态；这些状态不是 A2A TaskState，不应直接用于标准 Task.status.state。 `pending`、`running`、`paused`、`complete`、`failed`、`cancelled`、`unknown`。 |
| `state.items[i].control` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 `api`、`terminal`、`none`；描述控制入口，不等同于具体取消请求已经成功。 |
| `state.items[i].children` | OutputItem[] | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 任务产生的有序子组件。 |
| `state.items[i].timing` | Timing | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 任务计时。 |
| `state.items[i].error` | StreamError 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 任务错误。 |

暂停或状态未知不等于完成。同一执行实体不能同时重复显示为 agent 和 task 两个容器。

#### PlanItem：计划

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `plan` | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 计划组件。 |
| `state.items[i].steps` | PlanStep[] | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 按执行展示顺序排列的步骤。 |
| `state.items[i].steps[j].id` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 步骤身份。 |
| `state.items[i].steps[j].text` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 步骤内容。 |
| `state.items[i].steps[j].status` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 `pending`、`running`、`complete`、`skipped`、`failed`。 |

#### InteractionItem：等待输入或授权

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `interaction` | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 交互请求组件。 |
| `state.items[i].requestId` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 请求身份。 |
| `state.items[i].requestKind` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 `approval`、`question`、`form`、`authentication`。 |
| `state.items[i].status` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：平台适配器按实际运行事件维护本组件状态；这些状态不是 A2A TaskState，不应直接用于标准 Task.status.state。 `pending`、`resolved`、`cancelled`。 |
| `state.items[i].prompt` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 用户需要回应的说明。 |
| `state.items[i].inputSchema` | object | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 承载当前交互要求的输入结构；例如示例中的 approved 由该业务 schema 定义，并非 A2A 或共享协议的固定字段。 输入结构描述。 |
| `state.items[i].choices` | InteractionChoice[] | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 预设选择；没有选择时为空数组。 |
| `state.items[i].choices[j].id` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 选项身份。 |
| `state.items[i].choices[j].label` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 选项显示文本。 |
| `state.items[i].choices[j].value` | JSON | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 这里只规定承载 JSON 的容器；内部业务字段由工具、harness 或当前交互 schema 决定，不自动成为共享协议固定字段。 选项提交值。 |
| `state.items[i].response` | JSON | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 这里只规定承载 JSON 的容器；内部业务字段由工具、harness 或当前交互 schema 决定，不自动成为共享协议固定字段。 已记录的响应；尚无响应时可以为 `null`。 |

#### NoticeItem：提示

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `notice` | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 提示组件。 |
| `state.items[i].severity` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 `info`、`warning`、`error`。 |
| `state.items[i].code` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 可编程识别的提示代码。 |
| `state.items[i].text` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 提示正文。 |
| `state.items[i].details` | JSON | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 这里只规定承载 JSON 的容器；内部业务字段由工具、harness 或当前交互 schema 决定，不自动成为共享协议固定字段。 补充内容。 |

#### UsageItem：用量

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `usage` | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 用量组件。 |
| `state.items[i].scope` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 `call`、`run`、`session`。 |
| `state.items[i].mode` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 `delta` 或 `cumulative`。 |
| `state.items[i].model` | string 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 模型；未知为 `null`。 |
| `state.items[i].values` | UsageValues | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 用量值；未知值不冒充 `0`。 |
| `state.items[i].values.inputTokens` | integer 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 输入 token 数。 |
| `state.items[i].values.outputTokens` | integer 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 输出 token 数。 |
| `state.items[i].values.thinkingTokens` | integer 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 来源报告的思考 token 数。 |
| `state.items[i].values.cacheReadTokens` | integer 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 缓存读取 token 数。 |
| `state.items[i].values.cacheWriteTokens` | integer 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 缓存写入 token 数。 |
| `state.items[i].values.totalTokens` | integer 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 来源报告的总 token 数。 |
| `state.items[i].values.cost` | object 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 费用；未知为 `null`。 |
| `state.items[i].values.cost.amount` | string | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 十进制字符串，避免二进制浮点误差。 |
| `state.items[i].values.cost.currency` | string | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：由平台适配器归一化 harness 实际报告的用量与计费值；未知值保留 null，不把不同来源的未公开值补成 0。 来源报告的币种标识。 |

`cumulative` 表示累计值，更新时替换对应累计值，不能再次相加。不同来源对 token 分类的定义可能不同，原始统计仍保留在 `native`。

#### RunItem：逻辑运行

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].kind` | string，固定 `run` | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 逻辑运行组件。 |
| `state.items[i].id` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：平台分配稳定组件 ID，用作渲染身份；不要求等于 harness 原生 ID。RunItem.id 约定等于 runId。 等于该组件的 `runId`。 |
| `state.items[i].runId` | string | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：RunItem 的 runId 必须为非空逻辑运行 ID，并等于该组件 id 和对应 A2A Task.id；脱离运行的其它组件可用 null 的规则不适用于 RunItem。 非空逻辑运行身份。 |
| `state.items[i].status` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：将逻辑运行状态映射到 A2A TASK_STATE_*；例如 complete 对应 TASK_STATE_COMPLETED。这里的小写枚举由共享协议定义。 `queued`、`running`、`input_required`、`auth_required`、`complete`、`failed`、`cancelled`、`rejected`。 |
| `state.items[i].model` | string 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 模型信息；未知为 `null`。 |
| `state.items[i].timing` | Timing | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 运行计时。 |
| `state.items[i].error` | StreamError 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 运行错误。 |

`input_required` 和 `auth_required` 允许后续继续同一运行。运行结束不自动结束会话事件流，后台任务可以继续产生事件。

### 内容块：Content

以下使用消息内容路径。工具内容的对应完整路径为 `state.items[i].output[j]`，内容类型相同。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].content[j].kind` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 `text`、`json`、`image`、`file`、`audio`、`video`。 |
| `state.items[i].content[j].text` | string | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 仅 `kind=text`；正文累计值。 |
| `state.items[i].content[j].value` | JSON | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 这里只规定承载 JSON 的容器；内部业务字段由工具、harness 或当前交互 schema 决定，不自动成为共享协议固定字段。 仅 `kind=json`；完整结构化内容。 |
| `state.items[i].content[j].mediaType` | string | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 图片、文件、音频、视频的媒体类型。 |
| `state.items[i].content[j].name` | string 或 null | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 媒体名称；未知为 `null`。 |
| `state.items[i].content[j].blob` | BinaryData | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 媒体内容或可验证引用。 |
| `state.items[i].content[j].blob.kind` | enum | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 `inline` 或 `reference`。 |
| `state.items[i].content[j].blob.encoding` | string，固定 `base64` | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 仅 `blob.kind=inline`。 |
| `state.items[i].content[j].blob.data` | string | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 仅内联分支；Base64 数据。 |
| `state.items[i].content[j].blob.uri` | string | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 仅引用分支；内容地址。 |
| `state.items[i].content[j].blob.sha256` | string | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 仅引用分支；内容 SHA-256 校验值。 |
| `state.items[i].content[j].blob.sizeBytes` | integer | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 仅引用分支；内容字节数。 |

多模态块保持来源顺序。将二进制内容改为引用时，需要独立保证内容可取回；仅保留失效 URL 不构成完整内容交付。

### 计时：Timing

适用于 thinking、tool、agent、task 和 run。嵌套组件使用同样字段，例如 `state.items[i].children[j].timing.durationMs`。

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].timing.startedAt` | integer 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：来源上报可用时保留来源时间；宿主观察值标为 host_observed，无法确定则为 null / unknown，不臆造原生耗时。 开始时间；没有可靠信息时允许 `null`。 |
| `state.items[i].timing.endedAt` | integer 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：来源上报可用时保留来源时间；宿主观察值标为 host_observed，无法确定则为 null / unknown，不臆造原生耗时。 结束时间；执行中或未知时为 `null`。 |
| `state.items[i].timing.durationMs` | integer 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：来源上报可用时保留来源时间；宿主观察值标为 host_observed，无法确定则为 null / unknown，不臆造原生耗时。 阶段耗时；执行中或无法确定时为 `null`。 |
| `state.items[i].timing.basis` | enum | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 **平台映射/约定**：来源上报可用时保留来源时间；宿主观察值标为 host_observed，无法确定则为 null / unknown，不臆造原生耗时。 `native_reported`、`host_observed`、`unknown`。 |

| 计时分支 | 字段约束 |
| --- | --- |
| `native_reported` | 使用来源提供的计时；三个数值字段均允许未知。 |
| `host_observed`，执行中 | `startedAt` 为数值，`endedAt` 和 `durationMs` 为 `null`。 |
| `host_observed`，已结束 | 三个数值字段均存在；`durationMs` 用单调钟计算。 |
| `unknown` | `durationMs` 必须为 `null`；开始和结束时间允许未知。 |

客户端可以临时显示进行中的计时，完成后以服务端值为准。并发子任务耗时不能直接相加当作父运行耗时。

### 组件错误：StreamError

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `state.items[i].error` | StreamError 或 null | 是 | **自定义扩展**（[依据](#输出组件outputitem)）。 适用于带错误字段的 tool、agent、task、run；无错误为 `null`。 |
| `state.items[i].error.code` | string | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 错误代码。 |
| `state.items[i].error.message` | string | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 错误描述。 |
| `state.items[i].error.details` | JSON | 条件必填 | **自定义扩展**（[依据](#输出组件outputitem)）。 这里只规定承载 JSON 的容器；内部业务字段由工具、harness 或当前交互 schema 决定，不自动成为共享协议固定字段。 结构化上下文。 |

错误不会自动删除已输出的文本、工具部分结果或子组件。

### ControlFrame

连接提示不占用新的事件序号，不参与显示树 reducer。来源采集缺失还必须写入持久完整性状态；保留期造成的历史读取缺口不篡改旧帧的 integrity。

#### 公共字段

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.v` | integer，固定 `3` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 契约版本。 |
| `frame.kind` | string，固定 `control` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 连接控制提示。 |
| `frame.streamId` | string | 是 | **自定义扩展**（[依据](#共享返回对象)）。 对应日志身份。 |
| `frame.code` | enum | 是 | **自定义扩展**（[依据](#共享返回对象)）。 `replay.unavailable`、`stream.incomplete`、`stream.closed`、`stream.replaced`。 |
| `frame.details` | object | 是 | **自定义扩展**（[依据](#共享返回对象)）。 由 `code` 决定的严格分支。 |

#### replay.unavailable：无法完整续传

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.details.requestedAfterSeq` | integer | 是 | **自定义扩展**（[依据](#共享返回对象)）。 请求从哪个已提交游标之后恢复。 |
| `frame.details.availableFromSeq` | integer 或 null | 是 | **自定义扩展**（[依据](#共享返回对象)）。 可用历史起点；未知为 `null`。 |
| `frame.details.latestSeq` | integer 或 null | 是 | **自定义扩展**（[依据](#共享返回对象)）。 已知最新序号。 |
| `frame.details.reason` | enum | 是 | **自定义扩展**（[依据](#共享返回对象)）。 `expired`、`unknown_stream`、`invalid_cursor`。 |

不能静默用最新快照冒充丢失历史的补齐。只恢复显示需要调用方明确接受原始历史不完整。

#### stream.incomplete：采集不完整

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.details.integrity` | IncompleteIntegrity | 是 | **自定义扩展**（[依据](#共享返回对象)）。 本提示只能报告不完整状态。 |
| `frame.details.integrity.status` | string，固定 `incomplete` | 是 | **自定义扩展**（[依据](#共享返回对象)）。 完整性已受损。 |
| `frame.details.integrity.issues` | IntegrityIssue[] | 是 | **自定义扩展**（[依据](#共享返回对象)）。 至少一项，字段与上文完整性问题一致。 |
| `frame.details.integrity.issues[i].code` | enum | 是 | **自定义扩展**（[依据](#共享返回对象)）。 `capture_lost`、`encoding_failed`、`storage_failed`、`source_unavailable`。 |
| `frame.details.integrity.issues[i].message` | string | 是 | **自定义扩展**（[依据](#共享返回对象)）。 问题说明。 |
| `frame.details.integrity.issues[i].atSeq` | integer 或 null | 是 | **自定义扩展**（[依据](#共享返回对象)）。 关联日志位置。 |
| `frame.details.integrity.issues[i].source` | NativeSource 或 null | 是 | **自定义扩展**（[依据](#共享返回对象)）。 关联来源。 |
| `frame.details.integrity.issues[i].source.harness` | enum | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源非空时为 `codex`、`claude`、`pi`。 |
| `frame.details.integrity.issues[i].source.interface` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 发生问题的来源接口。 |
| `frame.details.integrity.issues[i].source.version` | string 或 null | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源版本。 |
| `frame.details.integrity.issues[i].source.instanceId` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源实例。 |
| `frame.details.integrity.issues[i].source.channel` | string | 条件必填 | **自定义扩展**（[依据](#共享返回对象)）。 **平台映射/约定**：采集器将真实来源标识填写到统一描述结构；这组属性名由本协议定义，不代表 harness 原始对象结构。 来源通道。 |

#### stream.closed：连接流结束

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.details.atSeq` | integer | 是 | **自定义扩展**（[依据](#共享返回对象)）。 结束时的日志位置。 |
| `frame.details.reason` | enum | 是 | **自定义扩展**（[依据](#共享返回对象)）。 `export_complete`、`session_closed`、`server_shutdown`。 |

`server_shutdown` 不等于所有运行成功结束；它表示本次连接流关闭。

#### stream.replaced：日志身份改变

| 完整字段路径 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `frame.details.nextStreamId` | string | 是 | **自定义扩展**（[依据](#共享返回对象)）。 后续日志身份。 |
| `frame.details.reason` | string | 是 | **自定义扩展**（[依据](#共享返回对象)）。 变更原因。 |

新日志必须建立新基线，不能将其序号直接拼入旧日志。

## 流式返回示例

以下文件包含全部字段，来源为 `example.synthetic`，没有发起真实模型或工具执行：

- [session.jsonl](examples/harness-stream-v3-delta-proposal/session.jsonl)：初始快照和 16 条事件。
- [session.sse](examples/harness-stream-v3-delta-proposal/session.sse)：相同 JSON 对象的 SSE 编码。
- [reconnect.sse](examples/harness-stream-v3-delta-proposal/reconnect.sse)：snapshot(8) 和事件 9～16。

| seq | 业务事件 | 显示操作 |
| --- | --- | --- |
| 1 | 主运行开始 | splice 插入 run。 |
| 2 | 思考阶段开始 | splice 插入 thinking。 |
| 3 | 思考阶段结束 | set 状态、公开摘要及 1200 ms 耗时。 |
| 4 | read_file 开始 | splice 插入工具及其输入。 |
| 5 | read_file 完成 | 向工具 output 插入两个内容块；set 状态及 300 ms 耗时。 |
| 6 | 子 agent 开始 | splice 插入 agent 容器。 |
| 7 | 子 agent 开始列目录 | 直接向该 agent 的 children 插入工具。 |
| 8 | detached 后台测试开始 | splice 插入 task 容器。 |
| 9 | 子 agent 完成 | 更新子工具，插入子回复，更新 agent 状态；不重发父树。 |
| 10 | 主回复第一段 | splice 插入流式消息。 |
| 11 | 主回复结束 | text.append 追加后缀；set 消息完成。 |
| 12 | 主运行结束 | set run 完成；后台任务继续。 |
| 13 | 后台测试进度 | 直接向 task.children 插入工具及当前进度。 |
| 14 | 后台测试完成 | set 进度文本及状态，插入退出码；不重发父树。 |
| 15 | 后台完成通知 | splice 插入通知消息。 |
| 16 | 暂无映射的新事件 | native 完整保留；output.status=unmapped，edits 为空。 |

第 11 条事件的完整 data 对象如下。它要求此前已应用 snapshot(0) 与事件 1～10，
不能独立应用到空状态。

```json
{
  "v": 3,
  "kind": "event",
  "streamId": "stream-1",
  "seq": 11,
  "ts": 1792202403200,
  "context": {
    "sessionId": "session-1",
    "runId": "run-1"
  },
  "native": {
    "source": {
      "harness": "pi",
      "interface": "example.synthetic",
      "version": "fixture-1",
      "instanceId": "example-process",
      "channel": "fixture"
    },
    "format": "json",
    "value": {
      "type": "answer_end",
      "text": "项目包含 src/ 和 docs/。已读取 README，后台测试仍在运行。"
    }
  },
  "integrity": {
    "status": "complete",
    "issues": []
  },
  "output": {
    "status": "applied",
    "edits": [
      {
        "op": "text.append",
        "path": [
          "items",
          5,
          "content",
          0,
          "text"
        ],
        "text": "已读取 README，后台测试仍在运行。"
      },
      {
        "op": "set",
        "path": [
          "items",
          5,
          "status"
        ],
        "value": "complete"
      }
    ]
  }
}
```

对应 SSE 包装为 `id: stream-1:11`、`event: event`，以及一行 JSON `data`。
执行 edits[0] 后，正文从“项目包含 src/ 和 docs/。”变为
“项目包含 src/ 和 docs/。已读取 README，后台测试仍在运行。”；执行 edits[1] 后，
`state.items[5].status` 变为 `complete`。

这条合成来源给的是完整终稿。后端确认它以已有正文为前缀，才提取后缀作为显示增量；
原始完整终稿仍在 native.value。若终稿改写了前文，应 set 正文而非强行追加。

这里优化的是显示投影。来源本身若携带累计 message/partial，完整保留 native 仍会
保留这部分重复内容，不能把投影增量宣传为整条链路完全没有重复。

## 标准 A2A 查询与流式方法

以下返回标准 A2A 对象，不返回自定义共享帧。标准 Task/history 不能替代 native 日志。

### 查询任务

`GET /tasks/{id}`

| 参数 | 类型 | 条件 | 说明 |
| --- | --- | --- | --- |
| path `id` | string | 必填 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L661-L672)）。 **平台映射/约定**：本产品以平台逻辑 runId 作为 A2A Task ID，关联同一次运行；这不是子组件或 harness 原生 ID。 Task ID。 |
| query `historyLength` | integer | 可选，0～2147483647 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L661-L672)）。 非负 int32；0 不返回历史，省略不施加客户端数量限制，服务端可返回更少。 |
| `tenant` | string | 按接口声明 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L661-L672)）。 必须匹配所选 AgentInterface 的路由标识。 |

返回 Task 本体，字段从 `response.id`、`response.contextId`、`response.status` 开始，
不像 SendMessage 再包装一层 task。完整扩展已激活时，本产品在 Task.metadata 返回同一流指针。

### 列出任务

`GET /tasks`

| Query 参数 | 类型 | 默认或条件 | 说明 |
| --- | --- | --- | --- |
| `contextId` | string | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L675-L700)）。 **平台映射/约定**：本产品将 A2A 上下文映射为平台 sessionId，取相同值；这是平台映射，不是 A2A 对内部会话模型的要求。 按会话过滤。 |
| `status` | TaskState | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L675-L700)）。 按当前状态过滤。 |
| `pageSize` | integer | 默认最多 50；1～100 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L675-L700)）。 单页最大条数，服务端可返回更少。 |
| `pageToken` | string | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L675-L700)）。 上次响应中的 nextPageToken。 |
| `historyLength` | integer | 可选，0～2147483647 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L675-L700)）。 非负 int32；每个任务附带的历史消息数量上限。 |
| `statusTimestampAfter` | string | 可选 | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L675-L700)）。 RFC 3339 时间；包括状态时间大于等于此值的任务。 |
| `includeArtifacts` | boolean | 默认 false | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L675-L700)）。 是否返回产物。 |
| `tenant` | string | 按接口声明 | 所选接口的路由标识。 |

| 返回路径 | 类型 | 说明 |
| --- | --- | --- |
| `response.tasks` | Task[] | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L703-L712)）。 包含此对象时，该字段为 A2A 标准必填；不要求可选的父对象或数组元素一定出现。 当前调用者可访问的匹配任务。 |
| `response.nextPageToken` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L703-L712)）。 包含此对象时，该字段为 A2A 标准必填；不要求可选的父对象或数组元素一定出现。 下一页令牌；没有下一页时为空。 |
| `response.pageSize` | integer | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L703-L712)）。 包含此对象时，该字段为 A2A 标准必填；不要求可选的父对象或数组元素一定出现。 本响应采用的分页大小。 |
| `response.totalSize` | integer | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L703-L712)）。 包含此对象时，该字段为 A2A 标准必填；不要求可选的父对象或数组元素一定出现。 授权范围与筛选条件内、分页前的任务总数。 |

### 取消任务

`POST /tasks/{id}:cancel`

路径 id 为必填 Task ID。请求体可包含 `metadata`；tenant 按所选接口路由要求提供。
返回 Task 本体。任务不可取消时返回 A2A `TASK_NOT_CANCELABLE` 错误。
这不是关闭订阅，也不自动表达“取消整个会话内所有 detached 后台任务”。

### 标准流式发送与订阅

`POST /message:stream` 使用 SendMessage 的请求体，但返回标准 A2A SSE。
configuration.returnImmediately 对此流式方法不生效。

`GET /tasks/{id}:subscribe` 或 `POST /tasks/{id}:subscribe` 订阅指定未终态 Task；
路径 id 必填，tenant 按接口声明提供。终态 Task 使用 GetTask，不能复活旧任务。
双动词来自固定版规范与官方 JS SDK 的同版本差异；实现时两个入口共用同一处理器。

每个 SSE data 只出现下列四个顶层字段之一：

| 返回路径 | 类型 | 说明 |
| --- | --- | --- |
| `response.task` | Task | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L790-L802)）。 **平台映射/约定**：A2A 标准允许 Task 或独立 Message；本产品的执行操作固定采用 Task 分支。 本产品执行流首帧发送当前 Task。 |
| `response.message` | Message | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L790-L802)）。 标准消息。 |
| `response.statusUpdate` | TaskStatusUpdateEvent | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L790-L802)）。 taskId、contextId、status，以及可选 metadata。 |
| `response.artifactUpdate` | TaskArtifactUpdateEvent | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L790-L802)）。 taskId、contextId、artifact、append、lastChunk，以及可选 metadata。 |

`statusUpdate` 没有旧版 final 字段。`artifactUpdate.lastChunk` 只表示该产物最后一块。
`append=true` 的标准产物拼接不能当作共享树的 text.append 或 JSON 字段合并。
现有标准 A2A 示例采用 append=false 的产物替换；本文只更新共享流增量提案。

标准流在终态结束。中断态可能结束当前连接，调用方仍应允许新 Message 继续原 Task。
标准订阅不保证重放每个瞬时更新，完整续传依赖共享流。

### 标准 Message 与 Artifact 返回字段

| 返回路径 | 类型 | 说明 |
| --- | --- | --- |
| `response.task.history[i].messageId` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 包含此对象时，该字段为 A2A 标准必填；不要求可选的父对象或数组元素一定出现。 消息创建者分配的身份。 |
| `response.task.history[i].role` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 包含此对象时，该字段为 A2A 标准必填；不要求可选的父对象或数组元素一定出现。 ROLE_USER 或 ROLE_AGENT。 |
| `response.task.history[i].contextId` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 **平台映射/约定**：本产品将 A2A 上下文映射为平台 sessionId，取相同值；这是平台映射，不是 A2A 对内部会话模型的要求。 服务端消息须携带所属上下文。 |
| `response.task.history[i].taskId` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 **平台映射/约定**：本产品以平台逻辑 runId 作为 A2A Task ID，关联同一次运行；这不是子组件或 harness 原生 ID。 关联任务存在时携带。 |
| `response.task.history[i].parts` | Part[] | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 包含此对象时，该字段为 A2A 标准必填；不要求可选的父对象或数组元素一定出现。 有序内容；Part 的字段与输入 Part 相同。 |
| `response.task.history[i].metadata` | object | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 metadata 容器由 A2A 定义；内部自定义键及命名空间不自动属于 A2A 标准。 可选元数据。 |
| `response.task.history[i].extensions` | string[] | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 可选，消息贡献的扩展 URI。 |
| `response.task.history[i].referenceTaskIds` | string[] | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L260-L277)）。 **平台映射/约定**：引用的 A2A Task ID 在本产品对应逻辑 runId；引用只提供上下文，不会继续或恢复这些运行。 可选，相关任务。 |
| `response.task.artifacts[i].artifactId` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L280-L293)）。 包含此对象时，该字段为 A2A 标准必填；不要求可选的父对象或数组元素一定出现。 任务内唯一的产物身份。 |
| `response.task.artifacts[i].name` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L280-L293)）。 可选名称。 |
| `response.task.artifacts[i].description` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L280-L293)）。 可选说明。 |
| `response.task.artifacts[i].parts` | Part[] | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L280-L293)）。 包含此对象时，该字段为 A2A 标准必填；不要求可选的父对象或数组元素一定出现。 至少一个内容块；可供普通 A2A 客户端直接使用。 |
| `response.task.artifacts[i].metadata` | object | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L280-L293)）。 metadata 容器由 A2A 定义；内部自定义键及命名空间不自动属于 A2A 标准。 可选元数据。 |
| `response.task.artifacts[i].extensions` | string[] | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto#L280-L293)）。 可选，产物贡献的扩展 URI。 |

以上路径以 SendMessage 返回为例；GetTask 返回时去掉 task 包装。

## 错误返回

标准 A2A HTTP 错误使用该 binding 的 error 对象；执行失败则进入 Task 的 FAILED 状态，
保留已产生的产物。两者不能混为一个“请求失败”。

| 返回路径 | 类型 | 说明 |
| --- | --- | --- |
| `response.error.code` | integer | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md#116-error-handling)）。 A2A HTTP binding 采用的标准错误结构；本扩展的游标、日志、幂等错误不能据此自动当作 A2A 标准错误。 HTTP 状态码。 |
| `response.error.status` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md#116-error-handling)）。 A2A HTTP binding 采用的标准错误结构；本扩展的游标、日志、幂等错误不能据此自动当作 A2A 标准错误。 标准状态名称，例如 NOT_FOUND。 |
| `response.error.message` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md#116-error-handling)）。 A2A HTTP binding 采用的标准错误结构；本扩展的游标、日志、幂等错误不能据此自动当作 A2A 标准错误。 可读错误说明。 |
| `response.error.details` | object[] | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md#116-error-handling)）。 A2A HTTP binding 采用的标准错误结构；本扩展的游标、日志、幂等错误不能据此自动当作 A2A 标准错误。 结构化错误详情，每项有 @type。 |
| `response.error.details[i]["@type"]` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md#116-error-handling)）。 A2A HTTP binding 采用的标准错误结构；本扩展的游标、日志、幂等错误不能据此自动当作 A2A 标准错误。 详情类型标识。 |
| `response.error.details[i].reason` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md#116-error-handling)）。 A2A HTTP binding 采用的标准错误结构；本扩展的游标、日志、幂等错误不能据此自动当作 A2A 标准错误。 ErrorInfo 的错误原因。 |
| `response.error.details[i].domain` | string | **A2A 标准**（[依据](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md#116-error-handling)）。 A2A HTTP binding 采用的标准错误结构；本扩展的游标、日志、幂等错误不能据此自动当作 A2A 标准错误。 A2A 标准错误为 a2a-protocol.org。 |

```json
{
  "error": {
    "code": 404,
    "status": "NOT_FOUND",
    "message": "任务不存在或当前调用方无权访问。",
    "details": [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      "reason": "TASK_NOT_FOUND",
      "domain": "a2a-protocol.org"
    }]
  }
}
```

| HTTP 状态 | 标准 reason | 条件 |
| --- | --- | --- |
| 404 | TASK_NOT_FOUND | 任务不存在或不可访问。 |
| 400 | TASK_NOT_CANCELABLE | 无法取消指定任务。 |
| 400 | PUSH_NOTIFICATION_NOT_SUPPORTED | 请求了未启用的推送。 |
| 400 | UNSUPPORTED_OPERATION | 不支持的操作，例如订阅已终态任务。 |
| 400 | CONTENT_TYPE_NOT_SUPPORTED | 不支持的内容类型。 |
| 400 | VERSION_NOT_SUPPORTED | A2A 版本不受支持。 |
| 500 | INVALID_AGENT_RESPONSE | Agent 返回不符合契约。 |

共享扩展 SSE 建立之后的控制对象见上文 ControlFrame。扩展握手前的游标错误、日志不可用、
幂等冲突等产品错误的精确 HTTP 状态与 reason 尚未固定；不能将这些条件误标为
A2A 原生错误，也不能悄悄退化为只返回最新显示状态。

## 实施前仍需固定的请求边界

- 扩展 URI 的正式地址及 AgentCard 中的认证声明。
- 共享流握手前的产品错误映射、非法区间和未来 throughSeq 的处理。
- 消息提交幂等记录的保存期限与请求等价判定。
- 请求/帧大小、日志保留期、慢消费者、心跳与压缩策略的实际限制。
- WS 的完整请求 schema；目前只确定共用返回事件，不能从 reply 类型反推所有请求字段。
- 增量操作的机器 JSON Schema、受控路径校验及共享 reducer 的正式实现。

这些是尚未承诺的接口边界，不是可省略校验的默认行为。

## 文档与示例验证

2026-10-17 已检查 5 个 JSON 示例块可解析、7 处本地文件链接有效，并核对 SSE 的
event/id/data 编码。初始快照及 16 条增量事件逐帧重放后，与上一版示例的每一步
组件树一致，16 条 native 逐条不变；从 snapshot(8) 恢复得到相同最终状态。
重复帧去重、缺号拒绝、无效操作不提交半帧、错误 streamId 拒绝、终稿覆盖校正与
主运行结束后后台继续的示例检查通过。

已使用既有 schema 校验未变化的帧外壳与重放得到的组件类型；这不等于新操作的
机器 schema 已完成。没有调用实际 HTTP 服务，也没有运行 A2A SDK 互操作测试。

## 资料来源

- [参考文档组织方式](https://developers.openai.com/api/reference/resources/responses/methods/create?site_locale=en)。
- [A2A v1.0.1 proto](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto)：请求、响应与字段定义。
- [A2A v1.0.1 规范](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/specification.md)：HTTP binding、错误与流式语义。
- [A2A 扩展规则](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/topics/extensions.md)。
- [官方 JS SDK 标准产物归并](https://github.com/a2aproject/a2a-js/blob/f91670ea8d6110009b90a1d4379b6304f2d605b8/src/server/result_manager.ts#L300-L326)。

