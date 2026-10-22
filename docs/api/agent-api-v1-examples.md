# Agent API v1 示例

状态：与 [Agent API v1 设计](../architecture/agent-api-v1.md) 同步的示例，尚未实现。日期：2026-10-22。
同一组示例的可筛选画布：[agent-runner-api-io-examples.canvas.tsx](agent-runner-api-io-examples.canvas.tsx)（Cursor Canvas）。

本文沿一个完整会话推进：创建会话，带截图和日志发消息，Agent 查问题、提问、改文件、启动后台测试、
用子 Agent 搜索代码、生成示意图、后台结果回送，最后是设置变化、上下文压缩、错误、打断和重连。
每个案例给出线上实际传输的字段，以及第三方客户端通常渲染出的界面（ASCII 示意）。

约定：

- `…` 表示与前文相同、为简洁省略的字段；真实响应中这些字段完整出现。
- 事件外壳：`seq`、`type`、`created_at`，按需带 `run_id`、`thread_id`；`thread_id` 省略表示主线程。
- 持久事件带 `seq` 并携带一个完整对象；`item.delta` 与 `native` 是临时事件，不带 `seq`。
- 主线示例会话是由 API 以 SDK 驱动运行的 Claude 会话。只在特定 harness 出现的增量会单独注明，
  见设计文档 §8.3。
- API 会话写入原生转录，结束后可以在 WebUI 与原生 TUI 中回放并继续（设计文档 §10）。
- ID 前缀：`ses_` `run_` `msg_` `itm_` `thr_` `task_` `int_` `file_` `chg_` `req_`。

```text
一、输入：请求与命令（1–10）      二、一次 run：主线程（11–22）    三、子 Agent：内联线程（23–26）
四、后台任务（27–31）             五、会话级变化与异常（32–37）    六、重连与读取（38–40）
```

覆盖情况：

| 类别 | 项目（括号内为案例编号） |
| --- | --- |
| 请求 | `POST /sessions`（1, 2）、`POST /files`（3）、`POST /messages`（4, 5, 6）、`stream: true`（6）、WebSocket（7）、`POST /interactions/{id}`（8）、`POST /runs/{id}/cancel`（9）、`POST /tasks/{id}/stop`（9）、`GET /sessions/{id}`（40）、`GET /runs`（40）、`GET /events`（37, 38, 39）、错误响应（10, 39） |
| 持久事件 | `session.status_changed`（11, 15, 16, 22, 31）、`session.settings_changed`（32）、`session.error`（34）、`run.queued`（7, 17）、`run.started`（6, 12, 20, 23, 26, 31, 36）、`run.updated`（18）、`run.completed`（6, 20, 22, 25, 35, 36）、`item.started`（13, 14, 15, 16, 19, 21, 23, 24, 33）、`item.updated`（14）、`item.completed`（13, 14, 16, 19, 21, 24, 25, 27, 31, 33）、`interaction.requested`（15, 16）、`interaction.resolved`（15, 16）、`task.started`（27）、`task.updated`（28, 29）、`task.completed`（30） |
| 临时事件 | `item.delta`（6, 13, 14, 19, 24, 38）、resync 的 `item.updated`（38）、`native`（37） |

---

## 一、输入：请求与命令

### 1. 创建会话：自己的 Agent

覆盖：`POST /sessions`

所有字段都可省略，默认取用户 Runner 的设置。`workdir` 相对 Sandbox 工作区。
创建只做登记并预分配原生会话 UUID，首条消息才打开 SDK 运行时。`driver` 为当前写入驱动。

```http
POST /api/agent/v1/sandbox/sessions
Authorization: Bearer <由 agent-workshop 校验>
Content-Type: application/json

{
  "harness": "claude",
  "workdir": "projects/shop-web",
  "settings": { "model": "default:claude-sonnet-4-5", "effort": "high" }
}
```

```http
201 Created
Request-Id: req_01Ka

{
  "id": "ses_01JDX4",
  "harness": "claude",
  "workdir": "projects/shop-web",
  "title": null,
  "settings": { "model": "default:claude-sonnet-4-5", "effort": "high", "context_window": 200000 },
  "status": { "state": "idle", "active_tasks": 0 },
  "driver": "none",
  "last_event_seq": 0,
  "created_at": "2026-10-22T00:20:00.000Z",
  "updated_at": "2026-10-22T00:20:00.000Z"
}
```

用户看到：

```text
+------------------------------------------------------------+
| shop-web   Claude · claude-sonnet-4-5 · high               |
|------------------------------------------------------------|
| 给 Agent 发消息…                                    [发送] |
+------------------------------------------------------------+
```

### 2. 创建会话：已发布 Agent

覆盖：`POST /sessions`

harness、模型、目录都由 Release 固定，请求体为空。后续请求使用返回的会话令牌。

```http
POST /api/agent/v1/published/agt_9Pq2/sessions
Authorization: Bearer <发布者签发的 API key>
Content-Type: application/json

{}
```

```http
201 Created

{
  "session": {
    "id": "ses_01JF8M",
    "agent": { "id": "agt_9Pq2", "name": "文档助手", "release": 3 },
    "status": { "state": "idle", "active_tasks": 0 },
    "last_event_seq": 0,
    "created_at": "2026-10-22T00:21:00.000Z",
    "updated_at": "2026-10-22T00:21:00.000Z"
  },
  "token": "st_••••",
  "token_expires_at": "2026-10-23T00:21:00.000Z"
}
```

用户看到：

```text
+------------------------------------------------------------+
| 文档助手   已发布 Agent · v3                                |
|------------------------------------------------------------|
| 问问文档助手…                                       [发送] |
+------------------------------------------------------------+
```

### 3. 上传文件

覆盖：`POST /files`

上传后得到会话工作目录内的路径，在消息中用 `file_path` / `image_path` 引用。
文件写入 `.priva-attachments/file-<unique>/`，与 WebUI 上传附件的约定相同。

```http
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/files
Content-Type: multipart/form-data; boundary=----x

(file = checkout-error.log)
```

```http
201 Created

{
  "id": "file_2Hc",
  "path": ".priva-attachments/file-8f2c/checkout-error.log",
  "name": "checkout-error.log",
  "media_type": "text/plain",
  "size": 18342
}
```

用户看到：

```text
+------------------------------------------------------------+
| [checkout-error.log 17.9 KB]                               |
| 结账页报错了，帮我查一下并修复                      [发送] |
+------------------------------------------------------------+
```

### 4. 发送消息：stream = false

覆盖：`POST /messages`

立即返回 202。客户端随后用 `last_event_seq` 订阅事件流，不会漏事件。

```http
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/messages
Idempotency-Key: 9b2e7c1a-5d1f-4c1e-9e0a-2f7b3c6d8e41
Content-Type: application/json

{
  "message": {
    "parts": [
      { "type": "text", "text": "结账页报错了，帮我查一下并修复" },
      { "type": "image", "image_url": "data:image/png;base64,iVBORw0KGgoAAA…" },
      { "type": "file", "file_path": ".priva-attachments/file-8f2c/checkout-error.log" }
    ]
  },
  "delivery": "follow-up",
  "stream": false
}
```

```http
202 Accepted

{
  "message": { "id": "msg_3fA" },
  "run": { "id": "run_7Ka2", "status": "in_progress" },
  "last_event_seq": 0
}
```

用户看到：

```text
                                  +--------------------------+
                                  | [截图 checkout.png]       |
                                  | [checkout-error.log]      |
                                  | 结账页报错了，帮我查一下并修复 |
                                  +--------------------------+
                                                       已发送
```

### 5. part 的另外两种写法

覆盖：`POST /messages`

`image` 的 `image_url`（data URL）与 `image_path` 二选一；`file` 的 `file_path` 与 `file_data` + `filename`
二选一。路径相对会话工作目录。base64 内容由服务端写入 `.priva-attachments/` 后，在 `run.started` 中以路径回显。

```json
{
  "message": {
    "parts": [
      { "type": "text", "text": "按这张图和流程文档检查一遍" },
      { "type": "image", "image_path": "screenshots/checkout.png" },
      {
        "type": "file",
        "file_data": "data:application/pdf;base64,JVBERi0xLjcK…",
        "filename": "支付流程.pdf"
      }
    ]
  }
}
```

用户看到：

```text
                                  +--------------------------+
                                  | [截图 screenshots/checkout.png] |
                                  | [支付流程.pdf PDF]         |
                                  | 按这张图和流程文档检查一遍   |
                                  +--------------------------+
```

### 6. 发送消息：stream = true

覆盖：`POST /messages`、`stream: true`、`run.started`、`item.delta`、`run.completed`

同一个请求直接返回本次 run 的 SSE，在 `run.completed` 之后关闭。客户端断开不会取消运行。

```http
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/messages
Idempotency-Key: 0c4d2f6e-…

{
  "message": { "parts": [{ "type": "text", "text": "结账页报错了，帮我查一下并修复" }] },
  "stream": true,
  "stream_options": { "deltas": true, "threads": "all", "native": false }
}
```

```text
200 OK
Content-Type: text/event-stream

id: 2
event: run.started
data: {"seq":2,"type":"run.started","created_at":"…","run":{"id":"run_7Ka2",…}}

event: item.delta
data: {"type":"item.delta","run_id":"run_7Ka2","item_id":"itm_08","delta":{"type":"text","index":0,"text":"问题出在"}}

…

id: 32
event: run.completed
data: {"seq":32,"type":"run.completed","created_at":"…","run":{"id":"run_7Ka2","status":"completed",…}}

（连接在 run.completed 之后关闭）
```

用户看到：

```text
                                  +--------------------------+
                                  | 结账页报错了，帮我查一下并修复 |
                                  +--------------------------+
问题出在▌
```

### 7. WebSocket：命令、回执与事件

覆盖：WebSocket、`run.queued`

每个会话一条连接。命令帧等于对应的 HTTP 请求体加 `type` 和 `request_id`；`reply.result` 等于 HTTP 响应体；
事件与 SSE 的 `data` 同构。

```text
GET wss://app.example.com/api/agent/v1/sandbox/sessions/ses_01JDX4/ws?after=25
Sec-WebSocket-Protocol: agent-workshop.v1
```

```text
// 客户端 → 服务端
{"type":"message.send","request_id":"r1","idempotency_key":"5e1f…",
 "message":{"parts":[{"type":"text","text":"再生成一张修复后结账页的示意图"}]},
 "delivery":"follow-up"}

// 服务端 → 客户端
{"type":"reply","request_id":"r1","ok":true,
 "result":{"message":{"id":"msg_5Qe"},"run":{"id":"run_8Lm","status":"queued"},"last_event_seq":25}}
{"seq":26,"type":"run.queued","created_at":"…","run":{"id":"run_8Lm",…}}

// 这条审批已经在另一个客户端处理过
{"type":"interaction.respond","request_id":"r2","interaction_id":"int_7","decision":"allow"}
{"type":"reply","request_id":"r2","ok":false,
 "error":{"type":"conflict","code":"interaction_resolved","message":"该请求已在其他客户端处理","request_id":"req_3Tq"}}

// 其余命令
{"type":"run.cancel","request_id":"r3","run_id":"run_8Lm"}
{"type":"task.stop","request_id":"r4","task_id":"task_9"}
{"type":"settings.update","request_id":"r5","settings":{"effort":"medium"}}
```

用户看到：

```text
                                  +--------------------------+
                                  | 再生成一张修复后结账页的示意图 |
                                  +--------------------------+
                                     排队中 · 当前回复结束后处理
该请求已在其他客户端处理
```

### 8. 回答提问 / 审批

覆盖：`POST /interactions/{id}`

请求体与 WebUI 的 `permission.respond` 相同（不含 requestId）。202 只表示已接收；
卡片以 `interaction.resolved` 事件为准再移除，多个客户端同步。

```http
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/interactions/int_6

{
  "decision": "allow",
  "answers": {
    "q0": { "selected": ["只修复问题"], "text": "" }
  }
}
```

```http
202 Accepted

{ "interaction": { "id": "int_6", "status": "submitted" } }
```

拒绝一条审批：

```http
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/interactions/int_7

{ "decision": "deny" }
```

用户看到：

```text
+-- Agent 提问 ------------------------------ 提交中… --+
| 这次修复的范围？                                        |
| (●) 只修复问题                                          |
| ( ) 顺便重构 CartTotal   改动更大，需要补测试           |
+--------------------------------------------------------+
```

### 9. 取消运行、停止后台任务

覆盖：`POST /runs/{id}/cancel`、`POST /tasks/{id}/stop`

取消是异步的：状态先变为 `cancelling` / `stop_requested`，最终结果以 `run.completed`、`task.completed` 为准。

```http
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/runs/run_8Lm/cancel

202 Accepted
{ "run": { "id": "run_8Lm", "status": "cancelling" } }
```

停止后台任务（Claude 与 Pi 都通过 SDK 的 `stopTask` 按 ID 停止）：

```http
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/tasks/task_9/stop

202 Accepted
{ "task": { "id": "task_9", "status": "running", "stop_requested": true } }
```

任务所属的运行时已经释放时：

```http
409 Conflict
{
  "error": {
    "type": "conflict",
    "code": "task_runtime_unavailable",
    "message": "该任务所属的运行时已释放，无法停止",
    "request_id": "req_6Lm"
  }
}
```

用户看到：

```text
正在停止…
+-- 运行 e2e 测试 ----------------------------- 停止中 --+
```

### 10. 请求错误

覆盖：错误响应

HTTP 与 WS `reply` 使用同一个 `error` 结构：`type` 是类别，`code` 是具体原因，`param` 指向出错的字段。

```http
422 Unprocessable Entity

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

```http
429 Too Many Requests
Retry-After: 30

{
  "error": {
    "type": "rate_limit",
    "code": "queue_full",
    "message": "该会话排队中的消息已达上限（3 条）",
    "request_id": "req_4Hm9"
  }
}
```

会话的原生终端仍存活（用户正在 WebUI 中使用该会话）时，API 不能写入：

```http
409 Conflict

{
  "error": {
    "type": "conflict",
    "code": "session_driven_by_terminal",
    "message": "该会话正在由终端驱动，请在终端退出或空闲回收后再发送",
    "request_id": "req_4Hq5"
  }
}
```

用户看到：

```text
+------------------------------------------------------------+
| [截图 checkout.png（灰）]                                  |
| 结账页报错了，帮我查一下并修复                      [发送] |
+------------------------------------------------------------+
当前模型 glm-4.6 不支持图片输入
```

---

## 二、一次 run：主线程

### 11. 会话开始运行

覆盖：`session.status_changed`

```json
{
  "seq": 1,
  "type": "session.status_changed",
  "created_at": "2026-10-22T00:20:03.102Z",
  "status": { "state": "running", "active_tasks": 0 }
}
```

用户看到：

```text
+------------------------------------------------------------+
| shop-web   Claude · claude-sonnet-4-5               运行中 |
|------------------------------------------------------------|
| 给 Agent 发消息…                                    [停止] |
+------------------------------------------------------------+
```

### 12. run 开始，回显输入

覆盖：`run.started`

`input` 是服务端确认后的用户消息。内联的 base64 图片已落盘，这里以 `image_path` 回显。
`source` 指出消息来源：`api`、`web`（WebUI）或 `terminal`（直接在终端输入）。

```json
{
  "seq": 2,
  "type": "run.started",
  "created_at": "2026-10-22T00:20:03.110Z",
  "run": {
    "id": "run_7Ka2",
    "status": "in_progress",
    "model": "claude-sonnet-4-5",
    "input": {
      "type": "user_message",
      "message_id": "msg_3fA",
      "source": "api",
      "content": [
        { "type": "image", "image_path": ".priva-attachments/file-3a91/image-1.png", "media_type": "image/png" },
        { "type": "text", "text": "结账页报错了，帮我查一下并修复" },
        {
          "type": "file",
          "file_path": ".priva-attachments/file-8f2c/checkout-error.log",
          "name": "checkout-error.log",
          "media_type": "text/plain",
          "size": 18342
        }
      ]
    },
    "created_at": "2026-10-22T00:20:03.050Z",
    "started_at": "2026-10-22T00:20:03.110Z"
  }
}
```

用户看到：

```text
                                  +--------------------------+
                                  | [截图]                    |
                                  | 结账页报错了，帮我查一下并修复 |
                                  | [checkout-error.log]      |
                                  +--------------------------+
claude-sonnet-4-5 · 正在处理…
```

### 13. 思考

覆盖：`item.started`、`item.delta`、`item.completed`

`item.completed` 携带完整的 reasoning 对象。SDK 驱动下 Claude（`thinking_delta`）与 Pi 都有思考增量。
发布场景可以只保留 `duration_ms`。

```json
{
  "seq": 3,
  "type": "item.started",
  "created_at": "2026-10-22T00:20:03.420Z",
  "run_id": "run_7Ka2",
  "item": { "id": "itm_01", "type": "reasoning", "status": "in_progress" }
}
```

```json
{
  "type": "item.delta",
  "run_id": "run_7Ka2",
  "item_id": "itm_01",
  "delta": { "type": "text", "text": "先看日志里的堆栈，" }
}
```

```json
{
  "seq": 4,
  "type": "item.completed",
  "created_at": "2026-10-22T00:20:05.560Z",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_01",
    "type": "reasoning",
    "status": "completed",
    "text": "先看日志里的堆栈，错误来自 CartTotal 计算优惠券……",
    "duration_ms": 2140
  }
}
```

用户看到：

```text
思考中… → 已思考 2.1s ›
  | 先看日志里的堆栈，错误来自 CartTotal 计算优惠券……
```

### 14. 执行命令：参数 → 执行 → 输出 → 失败

覆盖：`item.started`、`item.delta`、`item.updated`、`item.completed`

`tool_call` 的状态：`pending`（参数生成中或等待审批）→ `running` → `completed` / `failed` / `declined` / `cancelled`。

开始，参数还在生成：

```json
{
  "seq": 5,
  "type": "item.started",
  "created_at": "2026-10-22T00:20:05.600Z",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_02",
    "type": "tool_call",
    "status": "pending",
    "tool": { "name": "Bash", "kind": "command" }
  }
}
```

工具参数流（Claude 的 `input_json_delta`，Pi 的 toolcall 增量）：

```json
{
  "type": "item.delta",
  "run_id": "run_7Ka2",
  "item_id": "itm_02",
  "delta": { "type": "input_json", "text": "{\"command\":\"npm test -- cart" }
}
```

参数完整，开始执行：

```json
{
  "seq": 6,
  "type": "item.updated",
  "created_at": "2026-10-22T00:20:05.900Z",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_02",
    "type": "tool_call",
    "status": "running",
    "tool": { "name": "Bash", "kind": "command" },
    "input": { "command": "npm test -- cart", "description": "运行购物车相关测试" }
  }
}
```

命令输出流只在 Pi 或上报进度的产品工具上出现；Claude 的内置 Bash 在完成时一次给出输出：

```json
{
  "type": "item.delta",
  "run_id": "run_P1",
  "item_id": "itm_P2",
  "delta": { "type": "output", "stream": "stdout", "text": "FAIL src/cart/total.test.ts\n  ✕ applies empty coupon (12 ms)\n" }
}
```

结束：

```json
{
  "seq": 7,
  "type": "item.completed",
  "created_at": "2026-10-22T00:20:13.912Z",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_02",
    "type": "tool_call",
    "status": "failed",
    "tool": { "name": "Bash", "kind": "command" },
    "input": { "command": "npm test -- cart", "description": "运行购物车相关测试" },
    "output": {
      "content": [{ "type": "text", "text": "FAIL src/cart/total.test.ts\n  ✕ applies empty coupon (12 ms)\nTests: 1 failed, 23 passed, 24 total" }],
      "is_error": true
    },
    "duration_ms": 8312
  }
}
```

用户看到：

```text
+-- 运行购物车相关测试  npm test -- cart ------ 失败 · 8.3s --+
| FAIL src/cart/total.test.ts                                |
|   ✕ applies empty coupon (12 ms)                           |
| Tests: 1 failed, 23 passed, 24 total                       |
+------------------------------------------------------------+
```

### 15. Agent 提问

覆盖：`item.started`、`interaction.requested`、`session.status_changed`、`interaction.resolved`

提问也是一个 `tool_call`；interaction 引用它的 `item_id`。挂起期间会话进入 `requires_action`，并列出待处理的 interaction。

```json
{
  "seq": 14,
  "type": "item.started",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_05",
    "type": "tool_call",
    "status": "pending",
    "tool": { "name": "AskUserQuestion", "kind": "question" }
  }
}
```

```json
{
  "seq": 15,
  "type": "interaction.requested",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "interaction": {
    "id": "int_6",
    "type": "question",
    "run_id": "run_7Ka2",
    "item_id": "itm_05",
    "questions": [
      {
        "id": "q0",
        "question": "这次修复的范围？",
        "header": null,
        "options": [
          { "label": "只修复问题", "description": null },
          { "label": "顺便重构 CartTotal", "description": "改动更大，需要补测试" }
        ],
        "multi_select": false,
        "allow_custom": true,
        "multiline": false,
        "initial_text": null
      }
    ],
    "expires_at": "2026-10-22T00:30:41.000Z",
    "status": "pending"
  }
}
```

```json
{
  "seq": 16,
  "type": "session.status_changed",
  "created_at": "…",
  "status": { "state": "requires_action", "interaction_ids": ["int_6"], "active_tasks": 0 }
}
```

用户提交之后：

```json
{
  "seq": 17,
  "type": "interaction.resolved",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "interaction": {
    "id": "int_6",
    "type": "question",
    "run_id": "run_7Ka2",
    "item_id": "itm_05",
    "questions": [ … ],
    "expires_at": "2026-10-22T00:30:41.000Z",
    "status": "resolved",
    "resolution": {
      "decision": "allow",
      "reason": "answered",
      "answers": { "q0": { "selected": ["只修复问题"], "text": "" } }
    }
  }
}
```

```json
{
  "seq": 18,
  "type": "session.status_changed",
  "created_at": "…",
  "status": { "state": "running", "active_tasks": 0 }
}
```

用户看到：

```text
+-- Agent 提问 ------------------------------ 等待回答 --+
| 这次修复的范围？                                        |
| ( ) 只修复问题                                          |
| ( ) 顺便重构 CartTotal   改动更大，需要补测试           |
|                                      [跳过]  [提交]     |
+--------------------------------------------------------+
提交后 → 这次修复的范围？只修复问题
```

### 16. 修改文件需要审批

覆盖：`item.started`、`interaction.requested`、`session.status_changed`、`interaction.resolved`、`item.completed`

Claude 默认 `bypassPermissions`，只有 SDK 的 `canUseTool` 明确要求确认时（例如项目的 ask 规则）才出现审批。

```json
{
  "seq": 20,
  "type": "item.started",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_06",
    "type": "tool_call",
    "status": "pending",
    "tool": { "name": "Edit", "kind": "file_edit" },
    "input": {
      "file_path": "src/cart/CartTotal.tsx",
      "old_string": "const discount = coupon.amount",
      "new_string": "const discount = coupon?.amount ?? 0"
    }
  }
}
```

```json
{
  "seq": 21,
  "type": "interaction.requested",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "interaction": {
    "id": "int_7",
    "type": "approval",
    "run_id": "run_7Ka2",
    "item_id": "itm_06",
    "tool": { "name": "Edit", "kind": "file_edit" },
    "input": { "file_path": "src/cart/CartTotal.tsx", … },
    "title": "修改 src/cart/CartTotal.tsx",
    "reason": "项目规则要求编辑文件前确认",
    "expires_at": "2026-10-22T00:31:10.000Z",
    "status": "pending"
  }
}
```

```json
{
  "seq": 22,
  "type": "session.status_changed",
  "created_at": "…",
  "status": { "state": "requires_action", "interaction_ids": ["int_7"], "active_tasks": 0 }
}
```

```json
{
  "seq": 23,
  "type": "interaction.resolved",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "interaction": {
    "id": "int_7",
    "type": "approval",
    …,
    "status": "resolved",
    "resolution": { "decision": "allow", "reason": "answered" }
  }
}
```

```json
{
  "seq": 25,
  "type": "item.completed",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_06",
    "type": "tool_call",
    "status": "completed",
    "tool": { "name": "Edit", "kind": "file_edit" },
    "input": { … },
    "output": { "content": [{ "type": "text", "text": "已修改 1 处" }], "is_error": false },
    "duration_ms": 40
  }
}
```

用户看到：

```text
+-- 修改文件  src/cart/CartTotal.tsx ---------- 等待确认 --+
| - const discount = coupon.amount                         |
| + const discount = coupon?.amount ?? 0                   |
| 项目规则要求编辑文件前确认                               |
|                                      [跳过]  [允许]      |
+----------------------------------------------------------+
+-- 修改文件  src/cart/CartTotal.tsx -- 已允许 · 已修改 1 处 --+
```

#### MCP 授权链接（open_url）

MCP 服务通过 SDK 的 `onElicitation`（url 模式）要求用户在浏览器中完成授权。用户完成后回答 `allow`，
放弃则回答 `deny`。form 模式的 MCP 表单则表现为 `type = question` 的交互。

```json
{
  "seq": 52,
  "type": "interaction.requested",
  "created_at": "…",
  "run_id": "run_B2c",
  "interaction": {
    "id": "int_9",
    "type": "open_url",
    "run_id": "run_B2c",
    "server": "linear",
    "title": "连接 Linear",
    "reason": "Linear MCP 需要授权后才能读取工单",
    "url": "https://linear.app/oauth/authorize?client_id=…&state=…",
    "expires_at": "2026-10-22T00:35:00.000Z",
    "status": "pending"
  }
}
```

```http
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/interactions/int_9

{ "decision": "allow" }
```

用户看到：

```text
+-- 连接 Linear --------------------------------- 等待授权 --+
| Linear MCP 需要授权后才能读取工单                           |
|                         [取消]  [在浏览器中打开]  [我已完成] |
+-----------------------------------------------------------+
```

### 17. 运行中又发了一条消息

覆盖：`run.queued`

`delivery = follow-up` 时新消息进入队列。`position` 是在队列中的位置；当前 run 结束后自动开始。

```json
{
  "seq": 26,
  "type": "run.queued",
  "created_at": "2026-10-22T00:20:41.300Z",
  "run": {
    "id": "run_8Lm",
    "status": "queued",
    "position": 1,
    "input": {
      "type": "user_message",
      "message_id": "msg_5Qe",
      "source": "api",
      "content": [{ "type": "text", "text": "再生成一张修复后结账页的示意图" }]
    },
    "created_at": "2026-10-22T00:20:41.300Z"
  }
}
```

用户看到：

```text
+------------------------------------------------------------+
| [再生成一张修复后结账页的示意图   排队中 · 第 1 位  取消]   |
| 给 Agent 发消息…                                    [停止] |
+------------------------------------------------------------+
```

### 18. 用量与上下文更新

覆盖：`run.updated`

```json
{
  "seq": 29,
  "type": "run.updated",
  "created_at": "2026-10-22T00:20:46.000Z",
  "run": {
    "id": "run_7Ka2",
    "status": "in_progress",
    "model": "claude-sonnet-4-5",
    "input": { … },
    "usage": { "input_tokens": 18240, "output_tokens": 1630, "cache_read_tokens": 12000, "cache_write_tokens": 0 },
    "context": { "used_tokens": 41200, "limit_tokens": 200000 },
    "created_at": "…",
    "started_at": "…"
  }
}
```

用户看到：

```text
[====                ] 上下文 41.2k / 200k
```

### 19. 回复正文流式输出

覆盖：`item.started`、`item.delta`、`item.completed`

SDK 驱动下 Claude 与 Pi 的正文增量都是逐 token 到达；完成事件携带全文。

```json
{
  "seq": 30,
  "type": "item.started",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "item": { "id": "itm_08", "type": "message", "status": "in_progress", "content": [] }
}
```

```json
{
  "type": "item.delta",
  "run_id": "run_7Ka2",
  "item_id": "itm_08",
  "delta": { "type": "text", "index": 0, "text": "问题出在 CartTotal：" }
}
```

```json
{
  "seq": 31,
  "type": "item.completed",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_08",
    "type": "message",
    "status": "completed",
    "content": [
      {
        "type": "text",
        "text": "问题出在 CartTotal：未使用优惠券时 coupon 为 null，读取 amount 抛错。\n已改为空值默认 0，购物车测试 24/24 通过；e2e 已在后台运行。"
      }
    ]
  }
}
```

用户看到：

```text
问题出在 CartTotal：未使用优惠券时 coupon 为 null，读取 amount 抛错。
已改为空值默认 0，购物车测试 24/24 通过；e2e 已在后台运行。
```

### 20. run 结束，排队的消息接着运行

覆盖：`run.completed`、`run.started`

队列里还有消息时，会话保持 `running`，不会先变成 `idle`。

```json
{
  "seq": 32,
  "type": "run.completed",
  "created_at": "2026-10-22T00:20:51.320Z",
  "run": {
    "id": "run_7Ka2",
    "status": "completed",
    "stop_reason": "end_turn",
    "model": "claude-sonnet-4-5",
    "input": { … },
    "usage": {
      "input_tokens": 52310,
      "output_tokens": 4120,
      "cache_read_tokens": 38000,
      "cache_write_tokens": 0,
      "cost_usd": 0.21
    },
    "context": { "used_tokens": 47900, "limit_tokens": 200000 },
    "duration_ms": 48210,
    "created_at": "…",
    "started_at": "…",
    "completed_at": "2026-10-22T00:20:51.320Z"
  }
}
```

```json
{
  "seq": 33,
  "type": "run.started",
  "created_at": "2026-10-22T00:20:51.330Z",
  "run": {
    "id": "run_8Lm",
    "status": "in_progress",
    "model": "claude-sonnet-4-5",
    "input": { "type": "user_message", "message_id": "msg_5Qe", "source": "api", "content": [ … ] },
    "created_at": "…",
    "started_at": "2026-10-22T00:20:51.330Z"
  }
}
```

用户看到：

```text
已完成 · 48.2s · 56.4k tokens · $0.21
                                  +--------------------------+
                                  | 再生成一张修复后结账页的示意图 |
                                  +--------------------------+
正在处理…
```

### 21. 生成图片

覆盖：`item.started`、`item.completed`

图片由产品工具生成：Claude 中为原生 MCP 工具 `mcp__agentWorkshop__image_gen`，Pi 中为 codemode 的图片调用。
结果是 `tool_call` 的输出内容，文件保存在工作区 `.images/`。V1 没有图片增量。

```json
{
  "seq": 34,
  "type": "item.started",
  "created_at": "…",
  "run_id": "run_8Lm",
  "item": {
    "id": "itm_09",
    "type": "tool_call",
    "status": "running",
    "tool": { "name": "mcp__agentWorkshop__image_gen", "kind": "image", "server": "agentWorkshop" },
    "input": { "prompt": "修复后的结账页示意图，展示优惠券为空时的总价", "size": "1536x1024" }
  }
}
```

```json
{
  "seq": 35,
  "type": "item.completed",
  "created_at": "…",
  "run_id": "run_8Lm",
  "item": {
    "id": "itm_09",
    "type": "tool_call",
    "status": "completed",
    "tool": { "name": "mcp__agentWorkshop__image_gen", "kind": "image", "server": "agentWorkshop" },
    "input": { … },
    "output": {
      "content": [
        { "type": "image", "image_path": ".images/checkout-fixed.png", "media_type": "image/png" },
        { "type": "text", "text": "已保存 1 张图片" }
      ],
      "is_error": false
    },
    "model_calls": [
      { "operation": "generate_images", "model": "gpt-image-1", "status": "completed", "duration_ms": 14200 }
    ],
    "duration_ms": 14800
  }
}
```

随后 Agent 的回复（`message` item，结构同案例 19）：

```json
{
  "seq": 36,
  "type": "item.completed",
  "created_at": "…",
  "run_id": "run_8Lm",
  "item": {
    "id": "itm_0A",
    "type": "message",
    "status": "completed",
    "content": [{ "type": "text", "text": "示意图已保存到 .images/checkout-fixed.png。" }]
  }
}
```

用户看到：

```text
+-- 生成图片  修复后的结账页示意图… ------------ 运行中 --+
+-- 生成图片 ------------------------------------ 14.8s --+
| +----------------------+                               |
| | 修复后的结账页示意图 |                               |
| +----------------------+                               |
+--------------------------------------------------------+
示意图已保存到 .images/checkout-fixed.png。
```

### 22. 会话空闲，后台仍有任务

覆盖：`run.completed`、`session.status_changed`

run 结束、会话空闲、后台任务结束是三件独立的事。`active_tasks` 告诉客户端还有后台工作。

```json
{
  "seq": 37,
  "type": "run.completed",
  "created_at": "…",
  "run": { "id": "run_8Lm", "status": "completed", "stop_reason": "end_turn", … }
}
```

```json
{
  "seq": 38,
  "type": "session.status_changed",
  "created_at": "2026-10-22T00:21:20.010Z",
  "status": { "state": "idle", "stop_reason": "end_turn", "active_tasks": 1 }
}
```

用户看到：

```text
+-- 运行 e2e 测试 ---------------------- 后台运行中 [停止] --+
+------------------------------------------------------------+
| 给 Agent 发消息…                                    [发送] |
+------------------------------------------------------------+
```

---

## 三、子 Agent：内联线程

### 23. 启动子 Agent

覆盖：`item.started`、`run.started`

发生在主线程 seq 8–13 之间。subagent 是主线程中的一个 item；子 Agent 自己的 run 带 `thread_id`。
Claude 的数据来自 SDK 中带 `parent_tool_use_id` 的消息与 `task_*` 系统消息。

```json
{
  "seq": 8,
  "type": "item.started",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_03",
    "type": "subagent",
    "status": "running",
    "agent": { "name": "Explore", "description": "查找结账金额计算代码" },
    "thread_id": "thr_2",
    "mode": "foreground",
    "input": { "prompt": "找出所有计算订单总价的位置，列出文件和行号" }
  }
}
```

```json
{
  "seq": 9,
  "type": "run.started",
  "created_at": "…",
  "thread_id": "thr_2",
  "run": {
    "id": "run_9Xb",
    "thread_id": "thr_2",
    "status": "in_progress",
    "model": "claude-haiku-4-5",
    "input": {
      "type": "agent_task",
      "item_id": "itm_03",
      "prompt": "找出所有计算订单总价的位置，列出文件和行号"
    },
    "created_at": "…",
    "started_at": "…"
  }
}
```

用户看到：

```text
| Explore  查找结账金额计算代码 · claude-haiku-4-5        运行中
|   | 找出所有计算订单总价的位置，列出文件和行号
```

### 24. 子 Agent 内部的工具调用

覆盖：`item.started`、`item.delta`、`item.completed`

所有线程默认都在主流里，用 `thread_id` 区分；订阅时传 `threads=main` 可以只收主线程。
（下面的输出流 `item.delta` 只在 Pi 或上报进度的工具上出现；Claude 的 Grep 在完成时一次给出结果。）

```json
{
  "seq": 10,
  "type": "item.started",
  "created_at": "…",
  "thread_id": "thr_2",
  "run_id": "run_9Xb",
  "item": {
    "id": "itm_04",
    "type": "tool_call",
    "status": "running",
    "tool": { "name": "Grep", "kind": "search" },
    "input": { "pattern": "orderTotal|calcTotal", "path": "src" }
  }
}
```

```json
{
  "type": "item.delta",
  "thread_id": "thr_2",
  "run_id": "run_9Xb",
  "item_id": "itm_04",
  "delta": { "type": "output", "stream": "stdout", "text": "src/cart/CartTotal.tsx:42\n" }
}
```

```json
{
  "seq": 11,
  "type": "item.completed",
  "created_at": "…",
  "thread_id": "thr_2",
  "run_id": "run_9Xb",
  "item": {
    "id": "itm_04",
    "type": "tool_call",
    "status": "completed",
    "tool": { "name": "Grep", "kind": "search" },
    "input": { … },
    "output": {
      "content": [{ "type": "text", "text": "src/cart/CartTotal.tsx:42\nsrc/api/order.ts:88" }],
      "is_error": false
    },
    "duration_ms": 310
  }
}
```

用户看到：

```text
| Explore  查找结账金额计算代码                            运行中
|   +-- 搜索  orderTotal|calcTotal · src ---------- 2 个结果 --+
|   | src/cart/CartTotal.tsx:42                               |
|   | src/api/order.ts:88                                     |
|   +---------------------------------------------------------+
```

### 25. 子 Agent 完成

覆盖：`run.completed`、`item.completed`

```json
{
  "seq": 12,
  "type": "run.completed",
  "created_at": "…",
  "thread_id": "thr_2",
  "run": {
    "id": "run_9Xb",
    "thread_id": "thr_2",
    "status": "completed",
    "stop_reason": "end_turn",
    "input": { … },
    "usage": { "input_tokens": 8200, "output_tokens": 920, "cache_read_tokens": 0, "cache_write_tokens": 0 },
    "duration_ms": 6400,
    "created_at": "…",
    "started_at": "…",
    "completed_at": "…"
  }
}
```

```json
{
  "seq": 13,
  "type": "item.completed",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_03",
    "type": "subagent",
    "status": "completed",
    "agent": { "name": "Explore", "description": "查找结账金额计算代码" },
    "thread_id": "thr_2",
    "mode": "foreground",
    "input": { … },
    "output": { "content": [{ "type": "text", "text": "共 2 处：CartTotal.tsx:42、order.ts:88" }], "is_error": false },
    "usage": { "input_tokens": 8200, "output_tokens": 920 },
    "duration_ms": 6400
  }
}
```

用户看到：

```text
| Explore  6.4s · 9.1k tokens                             已完成
|   共 2 处：CartTotal.tsx:42、order.ts:88
```

### 26. 给后台 Agent 发消息

覆盖：`run.started`

正在后台运行的 Agent 收到主 Agent 或其他 Agent 的消息时，在它自己的线程中开始一个新 run。

```json
{
  "seq": 60,
  "type": "run.started",
  "created_at": "2026-10-22T00:24:10.000Z",
  "thread_id": "thr_4",
  "run": {
    "id": "run_Q2c",
    "thread_id": "thr_4",
    "status": "in_progress",
    "model": "claude-haiku-4-5",
    "input": {
      "type": "inbox_message",
      "from": { "kind": "coordinator", "name": "主 Agent" },
      "content": [{ "type": "text", "text": "也检查一下移动端的结账页" }]
    },
    "created_at": "…",
    "started_at": "…"
  }
}
```

用户看到：

```text
| mobile-check  后台 Agent                              继续运行
|   主 Agent → 也检查一下移动端的结账页
```

---

## 四、后台任务

### 27. 后台命令启动

覆盖：`item.completed`、`task.started`

工具调用本身很快完成，item 带 `task_id`；后台执行的生命周期由 task 对象单独描述。

```json
{
  "seq": 27,
  "type": "item.completed",
  "created_at": "…",
  "run_id": "run_7Ka2",
  "item": {
    "id": "itm_07",
    "type": "tool_call",
    "status": "completed",
    "tool": { "name": "Bash", "kind": "command" },
    "input": { "command": "npm run e2e", "description": "运行 e2e 测试", "run_in_background": true },
    "output": { "content": [{ "type": "text", "text": "已在后台启动" }], "is_error": false },
    "task_id": "task_9",
    "duration_ms": 120
  }
}
```

```json
{
  "seq": 28,
  "type": "task.started",
  "created_at": "…",
  "task": {
    "id": "task_9",
    "kind": "shell",
    "status": "running",
    "description": "运行 e2e 测试",
    "origin": { "run_id": "run_7Ka2", "item_id": "itm_07" },
    "stop_requested": false,
    "started_at": "2026-10-22T00:20:44.900Z"
  }
}
```

用户看到：

```text
+-- 运行 e2e 测试  npm run e2e ----------------- 后台运行 --+
+-- 运行 e2e 测试 ------------------------- 运行中 [停止] --+
```

### 28. Workflow 进度

覆盖：`task.updated`

每个 Workflow Agent 有自己的 `thread_id`。Claude 与 Pi 目前都只在请求时从转录读取 Workflow Agent
的内部过程；在设计文档 §11.6 的"Workflow Agent 实时内联"完成之前，它们的内部 item 不会实时出现，
只能通过本事件看到进度。

```json
{
  "seq": 39,
  "type": "task.updated",
  "created_at": "…",
  "task": {
    "id": "task_11",
    "kind": "workflow",
    "status": "running",
    "description": "全站结账回归检查",
    "origin": { "run_id": "run_8Lm", "item_id": "itm_0B" },
    "workflow": {
      "name": "checkout-regression",
      "phases": [
        { "index": 0, "title": "收集入口页面" },
        { "index": 1, "title": "并行检查" }
      ],
      "agents": [
        { "label": "desktop", "phase_index": 1, "thread_id": "thr_6", "status": "running", "last_tool": "Bash", "tokens": 4200 },
        { "label": "mobile", "phase_index": 1, "thread_id": "thr_7", "status": "completed", "tokens": 3100, "duration_ms": 52000 }
      ]
    },
    "usage": { "total_tokens": 7300 },
    "stop_requested": false,
    "started_at": "…"
  }
}
```

用户看到：

```text
+-- 全站结账回归检查  checkout-regression ------ 运行中 --+
| 1 收集入口页面 · 2 并行检查                              |
| desktop   Bash · 4.2k tokens                     运行中  |
| mobile    52s · 3.1k tokens                      已完成  |
+---------------------------------------------------------+
```

### 29. Monitor 事件

覆盖：`task.updated`

Monitor 每产生一次事件就更新 `last_event`。事件也可能作为 `task_result` 回送给模型，触发新 run（结构同案例 31，
`input.event` 为事件文本）。

```json
{
  "seq": 41,
  "type": "task.updated",
  "created_at": "…",
  "task": {
    "id": "task_12",
    "kind": "monitor",
    "status": "running",
    "description": "监听 dev server 日志",
    "origin": { "run_id": "run_8Lm", "item_id": "itm_0C" },
    "last_event": {
      "text": "ERROR POST /api/checkout 500 (coupon=null)",
      "created_at": "2026-10-22T00:22:03.000Z"
    },
    "stop_requested": false,
    "started_at": "…"
  }
}
```

用户看到：

```text
+-- 监听 dev server 日志  ERROR POST /api/checkout 500 -- 运行中 [停止] --+
```

### 30. 后台任务完成

覆盖：`task.completed`

`result.output_path` 只在输出文件位于会话工作目录内时出现。

```json
{
  "seq": 44,
  "type": "task.completed",
  "created_at": "…",
  "task": {
    "id": "task_9",
    "kind": "shell",
    "status": "completed",
    "description": "运行 e2e 测试",
    "origin": { "run_id": "run_7Ka2", "item_id": "itm_07" },
    "result": { "summary": "e2e 全部通过（42/42）" },
    "stop_requested": false,
    "started_at": "2026-10-22T00:20:44.900Z",
    "completed_at": "2026-10-22T00:23:46.900Z",
    "duration_ms": 182000
  }
}
```

用户看到：

```text
+-- 运行 e2e 测试  e2e 全部通过（42/42）· 3m02s ---- 已完成 --+
```

### 31. 结果回送给模型，开启新 run

覆盖：`session.status_changed`、`run.started`、`item.completed`

对应 WebUI 现有的 `task.delivered` + `replyTo`；对外只是一个 `input.type = task_result` 的普通 run。

```json
{
  "seq": 45,
  "type": "session.status_changed",
  "created_at": "…",
  "status": { "state": "running", "active_tasks": 0 }
}
```

```json
{
  "seq": 46,
  "type": "run.started",
  "created_at": "…",
  "run": {
    "id": "run_A1d",
    "status": "in_progress",
    "model": "claude-sonnet-4-5",
    "input": {
      "type": "task_result",
      "task_id": "task_9",
      "status": "completed",
      "summary": "e2e 全部通过（42/42）"
    },
    "created_at": "…",
    "started_at": "…"
  }
}
```

```json
{
  "seq": 48,
  "type": "item.completed",
  "created_at": "…",
  "run_id": "run_A1d",
  "item": {
    "id": "itm_0D",
    "type": "message",
    "status": "completed",
    "content": [{ "type": "text", "text": "后台 e2e 已全部通过，这次修复没有引入回归。" }]
  }
}
```

用户看到：

```text
+-- 后台任务完成  运行 e2e 测试 ---- e2e 全部通过（42/42）--+
后台 e2e 已全部通过，这次修复没有引入回归。
```

---

## 五、会话级变化与异常

### 32. 模型被切换

覆盖：`session.settings_changed`

`source` 说明变化来源：`api`（PATCH 会话，带 `change_id`）、`web`（WebUI）、`native_command`（例如 Claude 原生 `/model`）。

```json
{
  "seq": 70,
  "type": "session.settings_changed",
  "created_at": "2026-10-22T00:26:00.000Z",
  "settings": { "model": "default:claude-opus-4-1", "effort": "high", "context_window": 200000 },
  "source": "native_command"
}
```

通过 API 修改时：

```http
PATCH /api/agent/v1/sandbox/sessions/ses_01JDX4

{ "settings": { "effort": "medium" } }
```

```http
202 Accepted

{ "session": { "id": "ses_01JDX4", … }, "settings_change": { "id": "chg_01", "status": "pending" } }
```

随后发出 `session.settings_changed`（`"source": "api"`，`"change_id": "chg_01"`）；失败则发出 `session.error`
（`"code": "settings_change_failed"`，`"change_id": "chg_01"`）。

用户看到：

```text
| shop-web   Claude · claude-opus-4-1 · high                  |
---------------- 模型已切换为 claude-opus-4-1 ----------------
```

### 33. 上下文压缩

覆盖：`item.started`、`item.completed`

```json
{
  "seq": 80,
  "type": "item.started",
  "created_at": "…",
  "run_id": "run_C3f",
  "item": { "id": "itm_20", "type": "compaction", "status": "in_progress", "trigger": "auto" }
}
```

```json
{
  "seq": 81,
  "type": "item.completed",
  "created_at": "…",
  "run_id": "run_C3f",
  "item": {
    "id": "itm_20",
    "type": "compaction",
    "status": "completed",
    "trigger": "auto",
    "summary": "此前：定位并修复 CartTotal 空优惠券问题，补充回归测试，e2e 通过。",
    "context": { "tokens_before": 182000, "tokens_after": 24000 }
  }
}
```

`/clear` 产生的边界是 `context_reset` item（新原生会话的第一个 run 中），平台会话 ID 不变：

```json
{
  "seq": 85,
  "type": "item.completed",
  "created_at": "…",
  "run_id": "run_C9a",
  "item": { "id": "itm_24", "type": "context_reset", "status": "completed", "reason": "clear" }
}
```

用户看到：

```text
------------- 上下文已自动压缩 · 182k → 24k -------------
  | 此前：定位并修复 CartTotal 空优惠券问题，补充回归测试，e2e 通过。
```

### 34. 上游错误，自动重试中

覆盖：`session.error`

`retry.status`：`retrying`（等待即可）、`exhausted`（本次 run 放弃）、`terminal`（会话不可继续）。
重试信息只在原生提供时出现；没有时只会看到最终的 `run.completed`（`failed`）。

```json
{
  "seq": 90,
  "type": "session.error",
  "created_at": "2026-10-22T00:28:12.000Z",
  "run_id": "run_B7e",
  "error": {
    "code": "upstream_overloaded",
    "message": "模型服务繁忙（HTTP 529）",
    "retry": {
      "status": "retrying",
      "attempt": 2,
      "max_attempts": 5,
      "next_retry_at": "2026-10-22T00:28:20.000Z"
    }
  }
}
```

用户看到：

```text
+-- 模型服务繁忙 -----------------------------------------+
| 正在自动重试（2/5），无需操作。                          |
+---------------------------------------------------------+
```

### 35. run 失败

覆盖：`run.completed`

```json
{
  "seq": 95,
  "type": "run.completed",
  "created_at": "2026-10-22T00:29:13.000Z",
  "run": {
    "id": "run_B7e",
    "status": "failed",
    "stop_reason": "error",
    "input": { … },
    "error": { "code": "upstream_overloaded", "message": "重试 5 次后仍失败" },
    "usage": { "input_tokens": 3100, "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0 },
    "duration_ms": 61000,
    "created_at": "…",
    "started_at": "…",
    "completed_at": "…"
  }
}
```

用户看到：

```text
回复失败：重试 5 次后仍失败                              [重试]
```

### 36. 被新消息打断

覆盖：`run.completed`、`run.started`

新消息以 `delivery = interrupt` 发送。用户主动取消时为 `status = cancelled`、`stop_reason = cancelled`。

```json
{
  "seq": 101,
  "type": "run.completed",
  "created_at": "…",
  "run": {
    "id": "run_D4k",
    "status": "interrupted",
    "stop_reason": "interrupted",
    "interrupted_by": { "message_id": "msg_9Tz" },
    "input": { … },
    "usage": { "input_tokens": 9100, "output_tokens": 210, "cache_read_tokens": 0, "cache_write_tokens": 0 },
    "duration_ms": 5200,
    "created_at": "…",
    "started_at": "…",
    "completed_at": "…"
  }
}
```

```json
{
  "seq": 102,
  "type": "run.started",
  "created_at": "…",
  "run": {
    "id": "run_E5m",
    "status": "in_progress",
    "model": "claude-opus-4-1",
    "input": {
      "type": "user_message",
      "message_id": "msg_9Tz",
      "source": "api",
      "content": [{ "type": "text", "text": "先别改样式，只修逻辑" }]
    },
    "created_at": "…",
    "started_at": "…"
  }
}
```

用户看到：

```text
我先把按钮样式统一一下，然后……（灰）
已中断
                                  +--------------------------+
                                  | 先别改样式，只修逻辑        |
                                  +--------------------------+
```

### 37. 原生事件（按连接开启）

覆盖：`native`、`GET /events`

`native=true` 时出现。不带 `seq`、不持久化、重连不补发；`refs` 只在能对应到语义对象时给出。
SDK 驱动下 `source` 为 `sdk`（原样转发 Claude 的 SDKMessage 或 Pi 的 AgentSession 事件）；
从原生转录读取的记录为 `transcript`。只读订阅由 TUI 驱动的会话时，还会出现 `hook`、`display`、
`status_line`（Claude）或 `host`（Pi）。

```http
GET /api/agent/v1/sandbox/sessions/ses_01JDX4/events?after=0&native=true
```

```json
{
  "type": "native",
  "harness": "claude",
  "source": "sdk",
  "refs": { "run_id": "run_7Ka2", "item_id": "itm_02" },
  "event": {
    "type": "stream_event",
    "parent_tool_use_id": null,
    "event": {
      "type": "content_block_delta",
      "index": 1,
      "delta": { "type": "input_json_delta", "partial_json": "{\"command\":\"npm test -- cart" }
    }
  }
}
```

```json
{
  "type": "native",
  "thread_id": "thr_2",
  "harness": "claude",
  "source": "sdk",
  "refs": { "run_id": "run_9Xb", "item_id": "itm_04" },
  "event": {
    "type": "user",
    "parent_tool_use_id": "toolu_01Hc7…",
    "message": {
      "role": "user",
      "content": [{ "type": "tool_result", "tool_use_id": "toolu_01Qz3…", "content": "src/cart/CartTotal.tsx:42\n…" }]
    }
  }
}
```

用户看到（对话界面不显示，只出现在客户端的开发者面板）：

```text
00:20:05.7  claude  sdk  stream_event / input_json_delta   → itm_02
00:20:12.4  claude  sdk  user / tool_result                → itm_04
00:20:12.9  claude  sdk  stream_event / text_delta         → itm_08
```

---

## 六、重连与读取

### 38. 断线续传

覆盖：`GET /events`、resync 的 `item.updated`、`item.delta`

先补发游标之后的持久事件；对进行中的 item 补发一条 `resync` 的 `item.updated`（带已累积内容，不带 `seq`）；
然后接实时增量。

```http
GET /api/agent/v1/sandbox/sessions/ses_01JDX4/events
Last-Event-ID: 33
```

```text
id: 34
event: item.started
data: {"seq":34,"type":"item.started","created_at":"…","run_id":"run_8Lm","item":{"id":"itm_0A","type":"message","status":"in_progress","content":[]}}

event: item.updated
data: {"type":"item.updated","resync":true,"run_id":"run_8Lm","item":{"id":"itm_0A","type":"message","status":"in_progress","content":[{"type":"text","text":"示意图已生成，正在"}]}}

event: item.delta
data: {"type":"item.delta","run_id":"run_8Lm","item_id":"itm_0A","delta":{"type":"text","index":0,"text":"保存到 .images/"}}

: keep-alive
```

用户看到：

```text
已重新连接
示意图已生成，正在保存到 .images/▌
```

### 39. 游标过期

覆盖：`GET /events`、错误响应

```http
GET /api/agent/v1/sandbox/sessions/ses_01JDX4/events?after=12

410 Gone
{
  "error": {
    "type": "invalid_request",
    "code": "cursor_expired",
    "message": "游标 12 已超出保留范围",
    "last_event_seq": 512,
    "request_id": "req_7Pq1"
  }
}
```

客户端随后：

```text
GET /api/agent/v1/sandbox/sessions/ses_01JDX4                       会话快照
GET /api/agent/v1/sandbox/sessions/ses_01JDX4/runs                  历史
GET /api/agent/v1/sandbox/sessions/ses_01JDX4/events?after=512      继续订阅
```

用户看到：

```text
正在同步会话…
1. 读取会话快照（状态、进行中的 run、待处理交互、后台任务）
2. 读取历史 run 与 item
3. 从 seq 512 继续订阅
```

### 40. 会话快照与历史

覆盖：`GET /sessions/{id}`、`GET /runs`

快照与历史中的对象与事件携带的对象完全同构：只按顺序应用持久事件，结果与这里一致。

```http
GET /api/agent/v1/sandbox/sessions/ses_01JDX4

200 OK
{
  "id": "ses_01JDX4",
  "harness": "claude",
  "workdir": "projects/shop-web",
  "title": "结账页报错排查",
  "settings": { "model": "default:claude-sonnet-4-5", "effort": "high", "context_window": 200000 },
  "status": { "state": "requires_action", "interaction_ids": ["int_7"], "active_tasks": 1 },
  "driver": "sdk",
  "active_run": { "id": "run_7Ka2", "status": "in_progress", … },
  "queued_runs": [],
  "interactions": [{ "id": "int_7", "type": "approval", "item_id": "itm_06", "status": "pending", … }],
  "tasks": [{ "id": "task_9", "kind": "shell", "status": "running", … }],
  "last_event_seq": 22,
  "created_at": "…",
  "updated_at": "…"
}
```

```http
GET /api/agent/v1/sandbox/sessions/ses_01JDX4/runs?thread=all&order=desc&limit=20

200 OK
{
  "data": [
    {
      "id": "run_7Ka2",
      "status": "in_progress",
      "model": "claude-sonnet-4-5",
      "input": { "type": "user_message", "message_id": "msg_3fA", "source": "api", "content": [ … ] },
      "items": [
        { "id": "itm_01", "type": "reasoning", "status": "completed", … },
        { "id": "itm_02", "type": "tool_call", "status": "failed", … },
        { "id": "itm_03", "type": "subagent", "status": "completed", "thread_id": "thr_2", … },
        { "id": "itm_06", "type": "tool_call", "status": "pending", … }
      ],
      …
    },
    {
      "id": "run_9Xb",
      "thread_id": "thr_2",
      "status": "completed",
      "input": { "type": "agent_task", "item_id": "itm_03", … },
      "items": [{ "id": "itm_04", "type": "tool_call", … }],
      …
    }
  ],
  "next_cursor": null
}
```

用户看到（重新打开会话后恢复的界面）：

```text
+------------------------------------------------------------+
| shop-web   Claude · claude-sonnet-4-5            等待确认   |
|------------------------------------------------------------|
|                     结账页报错了，帮我查一下并修复          |
| 已思考 2.1s                                                |
| [运行购物车相关测试  npm test -- cart        失败 · 8.3s]   |
| | Explore  6.4s                                  已完成     |
| [修改文件  src/cart/CartTotal.tsx               等待确认]   |
+------------------------------------------------------------+
```

---

## 附：在 WebUI 中回放 API 会话

这不是 API 交互，而是可回放要求（设计文档 §10）的验收场景。API 会话写入的是原生转录和会话元数据，
因此 WebUI 不需要任何新协议就能打开它。

```text
API（SDK 驱动）                                     WebUI（终端驱动）
POST …/messages ×3，run 全部完成、无后台任务
        |
        v
原生转录 + 会话元数据（runMode、模型、任务状态）
        |
        +──> WebUI 会话列表出现 "结账页报错排查"（projects/shop-web 分组）
        +──> 打开：GET /api/sandbox/agent/sessions/{原生 ID}/thread
        |      用户消息（含附件与图片）、思考、工具卡片、子 Agent、后台通知、压缩标记完整显示
        +──> 在 WebUI 中继续发送：释放空闲 SDK 运行时 → TUI --resume 同一会话 → 正常回复
        |
        v
此后该会话由终端驱动；API 再发送会得到 409 session_driven_by_terminal，
直到终端退出或空闲回收（session.driver 从 terminal 回到 none）
```

用户看到（WebUI）：

```text
+-- 会话列表 ---------------+---------------------------------------------------+
| projects/shop-web         | 结账页报错排查                    Chat | Terminal |
|   结账页报错排查    刚刚   |---------------------------------------------------|
|   …                       |                [截图] 结账页报错了，帮我查一下并修复 |
|                           | 已思考 2.1s ›                                     |
|                           | [运行购物车相关测试  npm test -- cart  失败 8.3s] |
|                           | | Explore                              已完成     |
|                           | [修改文件 src/cart/CartTotal.tsx  已允许]         |
|                           | 问题出在 CartTotal：……                            |
|                           | [后台任务完成  运行 e2e 测试]                     |
|                           | 后台 e2e 已全部通过，这次修复没有引入回归。       |
|                           |---------------------------------------------------|
|                           | 给 Agent 发消息…                           [发送] |
+---------------------------+---------------------------------------------------+
```
