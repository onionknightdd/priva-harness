import {
  Button,
  Callout,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Spacer,
  Stack,
  Table,
  Text,
  useHostTheme,
  useState,
} from "cursor/canvas";

type Node = Parameters<typeof Stack>[0]["children"];
type Tone = "run" | "ok" | "bad" | "muted";

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ───────────────────────── coverage keys ─────────────────────────

const REQUEST_KEYS = [
  "POST /sessions",
  "POST /files",
  "POST /messages",
  "stream: true",
  "WebSocket",
  "POST /interactions/{id}",
  "POST /runs/{id}/cancel",
  "POST /tasks/{id}/stop",
  "GET /sessions/{id}",
  "GET /runs",
  "GET /events",
  "错误响应",
];

const DURABLE_KEYS = [
  "session.status_changed",
  "session.settings_changed",
  "session.error",
  "run.queued",
  "run.started",
  "run.updated",
  "run.completed",
  "item.started",
  "item.updated",
  "item.completed",
  "interaction.requested",
  "interaction.resolved",
  "task.started",
  "task.updated",
  "task.completed",
];

const EPHEMERAL_KEYS = ["item.delta", "native"];

// ───────────────────────── mock UI building blocks ─────────────────────────

function toneColor(t: ReturnType<typeof useHostTheme>, tone: Tone): string {
  if (tone === "run") return t.accent.primary;
  if (tone === "ok") return t.diff.stripAdded;
  if (tone === "bad") return t.diff.stripRemoved;
  return t.text.tertiary;
}

function Frame({ children }: { children?: Node }) {
  const t = useHostTheme();
  return (
    <div
      style={{
        border: `1px solid ${t.stroke.tertiary}`,
        borderRadius: 8,
        background: t.bg.chrome,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const t = useHostTheme();
  const lines = code.replace(/^\n/, "").replace(/\n\s*$/, "").split("\n");
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        fontFamily: MONO,
        fontSize: 11.5,
        lineHeight: 1.55,
        background: t.fill.quaternary,
        border: `1px solid ${t.stroke.tertiary}`,
        borderRadius: 6,
        whiteSpace: "pre",
        overflowX: "auto",
        color: t.text.primary,
        minWidth: 0,
      }}
    >
      {lines.map((line, index) => {
        const trimmed = line.trim();
        const comment = trimmed.startsWith("//");
        const http = /^(POST|GET|DELETE|PATCH|wss?:|\d{3} )/.test(trimmed);
        const sse = /^(id|event):/.test(trimmed);
        return (
          <div
            key={index}
            style={{
              color: comment ? t.text.tertiary : sse ? t.text.secondary : t.text.primary,
              fontWeight: http ? 600 : 400,
              minHeight: "1.55em",
            }}
          >
            {line}
          </div>
        );
      })}
    </pre>
  );
}

function Status({ tone, children }: { tone: Tone; children?: Node }) {
  const t = useHostTheme();
  return (
    <span style={{ color: toneColor(t, tone), fontSize: 12, whiteSpace: "nowrap" }}>{children}</span>
  );
}

function Mono({ children }: { children?: Node }) {
  const t = useHostTheme();
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: 11.5,
        color: t.text.secondary,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        minWidth: 0,
      }}
    >
      {children}
    </span>
  );
}

function Header({ title, meta, status }: { title: string; meta: string; status?: Node }) {
  const t = useHostTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingBottom: 8,
        borderBottom: `1px solid ${t.stroke.tertiary}`,
      }}
    >
      <Text weight="semibold">{title}</Text>
      <Text size="small" tone="tertiary">
        {meta}
      </Text>
      <Spacer />
      {status}
    </div>
  );
}

function UserMsg({ children, meta }: { children?: Node; meta?: Node }) {
  const t = useHostTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <div
        style={{
          maxWidth: "88%",
          background: t.fill.secondary,
          borderRadius: 10,
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {children}
      </div>
      {meta ? (
        <Text size="small" tone="tertiary">
          {meta}
        </Text>
      ) : null}
    </div>
  );
}

function Chip({ label, meta }: { label: string; meta?: string }) {
  const t = useHostTheme();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: `1px solid ${t.stroke.tertiary}`,
        borderRadius: 6,
        padding: "2px 8px",
        fontSize: 12,
        color: t.text.primary,
        background: t.bg.editor,
        alignSelf: "flex-start",
      }}
    >
      {label}
      {meta ? <span style={{ color: t.text.tertiary }}>{meta}</span> : null}
    </span>
  );
}

function ImageBox({ label, width = 136, height = 80, faded }: { label: string; width?: number; height?: number; faded?: boolean }) {
  const t = useHostTheme();
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 6,
        background: t.fill.tertiary,
        border: `1px solid ${t.stroke.tertiary}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: faded ? 0.55 : 1,
        fontSize: 11,
        color: t.text.tertiary,
        textAlign: "center",
        padding: 6,
      }}
    >
      {label}
    </div>
  );
}

function Tool({
  title,
  detail,
  status,
  tone,
  children,
}: {
  title: string;
  detail?: string;
  status: string;
  tone: Tone;
  children?: Node;
}) {
  const t = useHostTheme();
  return (
    <div style={{ border: `1px solid ${t.stroke.tertiary}`, borderRadius: 6, background: t.bg.editor, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: t.text.primary, whiteSpace: "nowrap" }}>{title}</span>
        {detail ? <Mono>{detail}</Mono> : null}
        <Spacer />
        <Status tone={tone}>{status}</Status>
      </div>
      {children ? (
        <div
          style={{
            borderTop: `1px solid ${t.stroke.tertiary}`,
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function Term({ text }: { text: string }) {
  const t = useHostTheme();
  return (
    <pre
      style={{
        margin: 0,
        fontFamily: MONO,
        fontSize: 11,
        lineHeight: 1.5,
        background: t.fill.quaternary,
        borderRadius: 4,
        padding: "6px 8px",
        whiteSpace: "pre-wrap",
        color: t.text.secondary,
      }}
    >
      {text}
    </pre>
  );
}

function Nested({ title, meta, status, tone, children }: { title: string; meta?: string; status: string; tone: Tone; children?: Node }) {
  const t = useHostTheme();
  return (
    <div
      style={{
        borderLeft: `2px solid ${t.stroke.secondary}`,
        paddingLeft: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: t.text.primary }}>{title}</span>
        {meta ? <span style={{ fontSize: 12, color: t.text.tertiary }}>{meta}</span> : null}
        <Spacer />
        <Status tone={tone}>{status}</Status>
      </div>
      {children}
    </div>
  );
}

function Composer({ action, children, hint }: { action: string; children?: Node; hint?: string }) {
  const t = useHostTheme();
  return (
    <div
      style={{
        border: `1px solid ${t.stroke.secondary}`,
        borderRadius: 8,
        padding: "8px 10px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: t.bg.editor,
      }}
    >
      {children}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: t.text.quaternary }}>{hint ?? "给 Agent 发消息…"}</span>
        <Spacer />
        <Button variant={action === "停止" ? "secondary" : "primary"}>{action}</Button>
      </div>
    </div>
  );
}

function TaskRow({ title, status, tone, meta, action }: { title: string; status: string; tone: Tone; meta?: string; action?: string }) {
  const t = useHostTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        border: `1px solid ${t.stroke.tertiary}`,
        borderRadius: 6,
        background: t.bg.editor,
      }}
    >
      <span style={{ fontSize: 12, color: t.text.primary }}>{title}</span>
      {meta ? <span style={{ fontSize: 12, color: t.text.tertiary }}>{meta}</span> : null}
      <Spacer />
      <Status tone={tone}>{status}</Status>
      {action ? <Button variant="ghost">{action}</Button> : null}
    </div>
  );
}

function Rule({ label }: { label: string }) {
  const t = useHostTheme();
  const line = { flex: 1, borderTop: `1px solid ${t.stroke.tertiary}` };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={line} />
      <span style={{ fontSize: 11, color: t.text.tertiary, whiteSpace: "nowrap" }}>{label}</span>
      <div style={line} />
    </div>
  );
}

function Quote({ children }: { children?: Node }) {
  const t = useHostTheme();
  return (
    <div
      style={{
        borderLeft: `2px solid ${t.stroke.tertiary}`,
        paddingLeft: 8,
        fontSize: 12,
        color: t.text.tertiary,
        lineHeight: 1.5,
      }}
    >
      {children}
    </div>
  );
}

function DiffLine({ kind, text }: { kind: "add" | "del"; text: string }) {
  const t = useHostTheme();
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 11,
        padding: "2px 8px",
        background: kind === "add" ? t.diff.insertedLine : t.diff.removedLine,
        color: t.text.primary,
        borderRadius: 3,
      }}
    >
      {kind === "add" ? "+ " : "- "}
      {text}
    </div>
  );
}

function Meter({ percent, label }: { percent: number; label: string }) {
  const t = useHostTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: t.fill.tertiary, overflow: "hidden" }}>
        <div style={{ width: `${percent}%`, height: "100%", background: t.accent.primary }} />
      </div>
      <span style={{ fontSize: 11, color: t.text.tertiary, whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

function Option({ label, detail, selected }: { label: string; detail?: string; selected?: boolean }) {
  const t = useHostTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 6,
        border: `1px solid ${selected ? t.accent.primary : t.stroke.tertiary}`,
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          marginTop: 3,
          borderRadius: 6,
          border: `1px solid ${selected ? t.accent.primary : t.stroke.primary}`,
          background: selected ? t.accent.primary : "transparent",
          flexShrink: 0,
        }}
      />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 12, color: t.text.primary }}>{label}</span>
        {detail ? <span style={{ fontSize: 11, color: t.text.tertiary }}>{detail}</span> : null}
      </div>
    </div>
  );
}

function Caret() {
  const t = useHostTheme();
  return <span style={{ display: "inline-block", width: 6, height: 13, marginLeft: 2, background: t.accent.primary, verticalAlign: "text-bottom" }} />;
}

function DevRow({ cells }: { cells: string[] }) {
  const t = useHostTheme();
  return (
    <div style={{ display: "flex", gap: 10, fontFamily: MONO, fontSize: 11, color: t.text.secondary, padding: "3px 0", borderBottom: `1px solid ${t.stroke.tertiary}` }}>
      {cells.map((cell, index) => (
        <span key={index} style={{ color: index === 0 ? t.text.tertiary : t.text.secondary, whiteSpace: "nowrap" }}>
          {cell}
        </span>
      ))}
    </div>
  );
}

function Small({ children, tone = "tertiary" }: { children?: Node; tone?: "primary" | "secondary" | "tertiary" }) {
  return (
    <Text size="small" tone={tone}>
      {children}
    </Text>
  );
}

// ───────────────────────── steps ─────────────────────────

type Step = {
  id: string;
  chapter: string;
  title: string;
  note?: string;
  covers: string[];
  code: string;
  ui: () => Node;
};

const SESSION_HEADER = () => <Header title="shop-web" meta="Claude · claude-sonnet-4-5 · high" />;

const STEPS: Step[] = [
  // ── 输入 ──
  {
    id: "create-sandbox",
    chapter: "input",
    title: "创建会话：自己的 Agent",
    note: "所有字段都可省略，默认取用户 Runner 的设置。workdir 相对 Sandbox 工作区。",
    covers: ["POST /sessions"],
    code: `
POST /api/agent/v1/sandbox/sessions
Authorization: Bearer pat_••••
Content-Type: application/json

{
  "harness": "claude",
  "workdir": "projects/shop-web",
  "model": "default:claude-sonnet-4-5",
  "effort": "high"
}

201 Created
{
  "id": "ses_01JDX4",
  "harness": "claude",
  "workdir": "projects/shop-web",
  "settings": { "model": "default:claude-sonnet-4-5", "effort": "high" },
  "status": { "state": "idle", "active_tasks": 0 },
  "last_event_seq": 0,
  "created_at": "2026-10-22T00:20:00.000Z"
}`,
    ui: () => (
      <>
        {SESSION_HEADER()}
        <Composer action="发送" />
      </>
    ),
  },
  {
    id: "create-published",
    chapter: "input",
    title: "创建会话：已发布 Agent",
    note: "harness、模型、目录都由 Release 固定，请求体为空。后续请求用返回的会话令牌。",
    covers: ["POST /sessions"],
    code: `
POST /api/agent/v1/published/agt_9Pq2/sessions
Authorization: Bearer ak_live_••••
Content-Type: application/json

{}

201 Created
{
  "session": {
    "id": "ses_01JF8M",
    "agent": { "id": "agt_9Pq2", "name": "文档助手", "release": 3 },
    "status": { "state": "idle", "active_tasks": 0 },
    "last_event_seq": 0,
    "created_at": "2026-10-22T00:21:00.000Z"
  },
  "token": "st_••••",
  "token_expires_at": "2026-10-23T00:21:00.000Z"
}`,
    ui: () => (
      <>
        <Header title="文档助手" meta="已发布 Agent · v3" />
        <Composer action="发送" hint="问问文档助手…" />
      </>
    ),
  },
  {
    id: "upload",
    chapter: "input",
    title: "上传文件",
    note: "上传后得到会话工作区内的路径，消息里用 file_path / image_path 引用。",
    covers: ["POST /files"],
    code: `
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/files
Content-Type: multipart/form-data; boundary=----x
(file = checkout-error.log)

201 Created
{
  "path": "inputs/checkout-error.log",
  "name": "checkout-error.log",
  "media_type": "text/plain",
  "size": 18342
}`,
    ui: () => (
      <Composer action="发送" hint="结账页报错了，帮我查一下并修复">
        <Chip label="checkout-error.log" meta="17.9 KB" />
      </Composer>
    ),
  },
  {
    id: "send-202",
    chapter: "input",
    title: "发送消息：stream = false",
    note: "立即返回 202。客户端随后用 last_event_seq 订阅事件流，不会漏事件。",
    covers: ["POST /messages"],
    code: `
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/messages
Idempotency-Key: 9b2e7c1a-5d1f-4c1e-9e0a-2f7b3c6d8e41
Content-Type: application/json

{
  "message": {
    "parts": [
      { "type": "text", "text": "结账页报错了，帮我查一下并修复" },
      { "type": "image", "image_url": "data:image/png;base64,iVBORw0KGgoAAA…" },
      { "type": "file", "file_path": "inputs/checkout-error.log" }
    ]
  },
  "delivery": "follow-up",
  "stream": false
}

202 Accepted
{
  "message": { "id": "msg_3fA" },
  "run": { "id": "run_7Ka2", "status": "in_progress" },
  "last_event_seq": 0
}`,
    ui: () => (
      <UserMsg meta="已发送">
        <ImageBox label="checkout.png" />
        <Chip label="checkout-error.log" meta="17.9 KB" />
        <Text>结账页报错了，帮我查一下并修复</Text>
      </UserMsg>
    ),
  },
  {
    id: "parts",
    chapter: "input",
    title: "part 的另外两种写法",
    note: "image：image_url（data URL）与 image_path 二选一；file：file_path 与 file_data + filename 二选一。base64 内容由服务端落盘，在 run.started 里以路径回显。",
    covers: ["POST /messages"],
    code: `
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
}`,
    ui: () => (
      <UserMsg>
        <ImageBox label="screenshots/checkout.png" />
        <Chip label="支付流程.pdf" meta="PDF" />
        <Text>按这张图和流程文档检查一遍</Text>
      </UserMsg>
    ),
  },
  {
    id: "send-stream",
    chapter: "input",
    title: "发送消息：stream = true",
    note: "同一个请求直接返回本次 run 的 SSE，在 run.completed 后关闭。客户端断开不会取消运行。",
    covers: ["POST /messages", "stream: true", "run.started", "item.delta", "run.completed"],
    code: `
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/messages
Idempotency-Key: 0c4d2f6e-…

{
  "message": { "parts": [{ "type": "text", "text": "结账页报错了，帮我查一下并修复" }] },
  "stream": true,
  "stream_options": { "deltas": true, "threads": "all", "native": false }
}

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

// 连接在 run.completed 之后关闭`,
    ui: () => (
      <>
        <UserMsg>
          <Text>结账页报错了，帮我查一下并修复</Text>
        </UserMsg>
        <Text>
          问题出在<Caret />
        </Text>
      </>
    ),
  },
  {
    id: "ws",
    chapter: "input",
    title: "WebSocket：命令、回执与事件",
    note: "每个会话一条连接。命令帧等于对应的 HTTP 请求体加 type 和 request_id；reply.result 等于 HTTP 响应体；事件与 SSE 的 data 同构。",
    covers: ["WebSocket", "run.queued"],
    code: `
GET wss://app.example.com/api/agent/v1/sandbox/sessions/ses_01JDX4/ws?after=25
Sec-WebSocket-Protocol: agent-workshop.v1

// 客户端 → 服务端
{"type":"message.send","request_id":"r1","idempotency_key":"5e1f…",
 "message":{"parts":[{"type":"text","text":"再生成一张修复后结账页的示意图"}]},
 "delivery":"follow-up"}

// 服务端 → 客户端
{"type":"reply","request_id":"r1","ok":true,
 "result":{"message":{"id":"msg_5Qe"},"run":{"id":"run_8Lm","status":"queued"}}}
{"seq":26,"type":"run.queued","created_at":"…","run":{"id":"run_8Lm",…}}

// 另一个客户端已经处理过这条审批
{"type":"interaction.respond","request_id":"r2","interaction_id":"int_7","decision":"allow"}
{"type":"reply","request_id":"r2","ok":false,
 "error":{"type":"conflict","code":"interaction_resolved","message":"该请求已在其他客户端处理"}}

// 其余命令
{"type":"run.cancel","request_id":"r3","run_id":"run_8Lm"}
{"type":"task.stop","request_id":"r4","task_id":"task_9"}`,
    ui: () => (
      <>
        <UserMsg meta="排队中 · 当前回复结束后处理">
          <Text>再生成一张修复后结账页的示意图</Text>
        </UserMsg>
        <Small>该请求已在其他客户端处理</Small>
      </>
    ),
  },
  {
    id: "respond",
    chapter: "input",
    title: "回答提问 / 审批",
    note: "202 只表示已接收。卡片以 interaction.resolved 事件为准再移除，多个客户端同步。",
    covers: ["POST /interactions/{id}"],
    code: `
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/interactions/int_6
{
  "decision": "allow",
  "answers": {
    "q0": { "selected": ["只修复问题"], "text": "" }
  }
}

202 Accepted
{ "interaction": { "id": "int_6", "status": "submitted" } }

// 拒绝一条审批
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/interactions/int_7
{ "decision": "deny" }`,
    ui: () => (
      <Tool title="Agent 提问" status="提交中…" tone="run">
        <Text size="small" weight="medium">
          这次修复的范围？
        </Text>
        <Option label="只修复问题" selected />
        <Option label="顺便重构 CartTotal" detail="改动更大，需要补测试" />
      </Tool>
    ),
  },
  {
    id: "cancel",
    chapter: "input",
    title: "取消运行、停止后台任务",
    note: "取消是异步的：状态先变为 cancelling / stop_requested，最终结果以 run.completed、task.completed 为准。",
    covers: ["POST /runs/{id}/cancel", "POST /tasks/{id}/stop"],
    code: `
POST /api/agent/v1/sandbox/sessions/ses_01JDX4/runs/run_8Lm/cancel
202 Accepted
{ "run": { "id": "run_8Lm", "status": "cancelling" } }

POST /api/agent/v1/sandbox/sessions/ses_01JDX4/tasks/task_9/stop
202 Accepted
{ "task": { "id": "task_9", "status": "running", "stop_requested": true } }`,
    ui: () => (
      <>
        <Small>正在停止…</Small>
        <TaskRow title="运行 e2e 测试" status="停止中" tone="muted" />
      </>
    ),
  },
  {
    id: "errors",
    chapter: "input",
    title: "请求错误",
    note: "HTTP 与 WS reply 使用同一个 error 结构：type 是类别，code 是具体原因，param 指向出错的字段。",
    covers: ["错误响应"],
    code: `
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

429 Too Many Requests
Retry-After: 30
{
  "error": {
    "type": "rate_limit",
    "code": "queue_full",
    "message": "该会话排队中的消息已达上限（3 条）",
    "request_id": "req_4Hm9"
  }
}`,
    ui: () => (
      <>
        <Composer action="发送" hint="结账页报错了，帮我查一下并修复">
          <ImageBox label="checkout.png" width={96} height={56} faded />
        </Composer>
        <Status tone="bad">当前模型 glm-4.6 不支持图片输入</Status>
      </>
    ),
  },

  // ── 主线程 ──
  {
    id: "status-running",
    chapter: "run",
    title: "会话开始运行",
    covers: ["session.status_changed"],
    code: `
{
  "seq": 1,
  "type": "session.status_changed",
  "created_at": "2026-10-22T00:20:03.102Z",
  "status": { "state": "running", "active_tasks": 0 }
}`,
    ui: () => (
      <>
        <Header title="shop-web" meta="Claude · claude-sonnet-4-5" status={<Status tone="run">运行中</Status>} />
        <Composer action="停止" />
      </>
    ),
  },
  {
    id: "run-started",
    chapter: "run",
    title: "run 开始，回显输入",
    note: "input 是服务端确认后的用户消息。内联的 base64 图片已落盘，这里以 image_path 回显。",
    covers: ["run.started"],
    code: `
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
      "content": [
        { "type": "text", "text": "结账页报错了，帮我查一下并修复" },
        { "type": "image", "image_path": "inputs/.uploads/msg_3fA-1.png", "media_type": "image/png" },
        {
          "type": "file",
          "file_path": "inputs/checkout-error.log",
          "name": "checkout-error.log",
          "media_type": "text/plain",
          "size": 18342
        }
      ]
    }
  }
}`,
    ui: () => (
      <>
        <UserMsg>
          <ImageBox label="checkout.png" />
          <Chip label="checkout-error.log" meta="17.9 KB" />
          <Text>结账页报错了，帮我查一下并修复</Text>
        </UserMsg>
        <Small>claude-sonnet-4-5 · 正在处理…</Small>
      </>
    ),
  },
  {
    id: "reasoning",
    chapter: "run",
    title: "思考",
    note: "delta 只带 item_id 和文本片段；item.completed 携带完整的 reasoning 对象。发布场景可以只保留 duration_ms。",
    covers: ["item.started", "item.delta", "item.completed"],
    code: `
// 持久
{
  "seq": 3,
  "type": "item.started",
  "created_at": "2026-10-22T00:20:03.420Z",
  "run_id": "run_7Ka2",
  "item": { "id": "itm_01", "type": "reasoning", "status": "in_progress" }
}

// 临时
{
  "type": "item.delta",
  "run_id": "run_7Ka2",
  "item_id": "itm_01",
  "delta": { "type": "text", "text": "先看日志里的堆栈，" }
}

// 持久
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
}`,
    ui: () => (
      <>
        <Small>思考中… → 已思考 2.1s</Small>
        <Quote>先看日志里的堆栈，错误来自 CartTotal 计算优惠券……</Quote>
      </>
    ),
  },
  {
    id: "command",
    chapter: "run",
    title: "执行命令：参数流 → 执行 → 输出流 → 失败",
    note: "tool_call 的状态：pending（参数生成中或等待审批）→ running → completed | failed | declined | cancelled。",
    covers: ["item.started", "item.delta", "item.updated", "item.completed"],
    code: `
// 持久：开始，参数还在生成
{
  "seq": 5, "type": "item.started", "created_at": "…", "run_id": "run_7Ka2",
  "item": {
    "id": "itm_02", "type": "tool_call", "status": "pending",
    "tool": { "name": "Bash", "kind": "command" }
  }
}

// 临时：工具参数流
{ "type": "item.delta", "run_id": "run_7Ka2", "item_id": "itm_02",
  "delta": { "type": "input_json", "text": "{\\"command\\":\\"npm test -- cart" } }

// 持久：参数完整，开始执行
{
  "seq": 6, "type": "item.updated", "created_at": "…", "run_id": "run_7Ka2",
  "item": {
    "id": "itm_02", "type": "tool_call", "status": "running",
    "tool": { "name": "Bash", "kind": "command" },
    "input": { "command": "npm test -- cart", "description": "运行购物车相关测试" }
  }
}

// 临时：命令输出流
{ "type": "item.delta", "run_id": "run_7Ka2", "item_id": "itm_02",
  "delta": { "type": "output", "stream": "stdout",
             "text": "FAIL src/cart/total.test.ts\\n  ✕ applies empty coupon (12 ms)\\n" } }

// 持久：结束
{
  "seq": 7, "type": "item.completed", "created_at": "…", "run_id": "run_7Ka2",
  "item": {
    "id": "itm_02", "type": "tool_call", "status": "failed",
    "tool": { "name": "Bash", "kind": "command" },
    "input": { "command": "npm test -- cart", "description": "运行购物车相关测试" },
    "output": {
      "content": [{ "type": "text", "text": "Tests: 1 failed, 23 passed, 24 total" }],
      "is_error": true
    },
    "duration_ms": 8312
  }
}`,
    ui: () => (
      <Tool title="运行购物车相关测试" detail="npm test -- cart" status="失败 · 8.3s" tone="bad">
        <Term text={"FAIL src/cart/total.test.ts\n  ✕ applies empty coupon (12 ms)\nTests: 1 failed, 23 passed, 24 total"} />
      </Tool>
    ),
  },
  {
    id: "question",
    chapter: "run",
    title: "Agent 提问",
    note: "提问也是一个 tool_call；interaction 引用它的 item_id。挂起期间会话进入 requires_action，并列出待处理的 interaction。",
    covers: ["item.started", "interaction.requested", "session.status_changed", "interaction.resolved"],
    code: `
{
  "seq": 14, "type": "item.started", "created_at": "…", "run_id": "run_7Ka2",
  "item": {
    "id": "itm_05", "type": "tool_call", "status": "pending",
    "tool": { "name": "AskUserQuestion", "kind": "question" }
  }
}

{
  "seq": 15, "type": "interaction.requested", "created_at": "…", "run_id": "run_7Ka2",
  "interaction": {
    "id": "int_6", "type": "question", "item_id": "itm_05",
    "questions": [{
      "id": "q0",
      "question": "这次修复的范围？",
      "options": [
        { "label": "只修复问题" },
        { "label": "顺便重构 CartTotal", "description": "改动更大，需要补测试" }
      ],
      "multi_select": false,
      "allow_custom": true
    }],
    "expires_at": "2026-10-22T00:30:41.000Z"
  }
}

{
  "seq": 16, "type": "session.status_changed", "created_at": "…",
  "status": { "state": "requires_action", "interaction_ids": ["int_6"], "active_tasks": 0 }
}

// 用户提交之后
{
  "seq": 17, "type": "interaction.resolved", "created_at": "…", "run_id": "run_7Ka2",
  "interaction": {
    "id": "int_6", "type": "question", "item_id": "itm_05", "questions": [ … ],
    "status": "resolved", "decision": "allow", "reason": "answered",
    "answers": { "q0": { "selected": ["只修复问题"], "text": "" } }
  }
}

{
  "seq": 18, "type": "session.status_changed", "created_at": "…",
  "status": { "state": "running", "active_tasks": 0 }
}`,
    ui: () => (
      <>
        <Tool title="Agent 提问" status="等待回答" tone="run">
          <Text size="small" weight="medium">
            这次修复的范围？
          </Text>
          <Option label="只修复问题" />
          <Option label="顺便重构 CartTotal" detail="改动更大，需要补测试" />
          <Row gap={8}>
            <Spacer />
            <Button variant="ghost">跳过</Button>
            <Button variant="primary">提交</Button>
          </Row>
        </Tool>
        <Small>提交后 → 这次修复的范围？只修复问题</Small>
      </>
    ),
  },
  {
    id: "approval",
    chapter: "run",
    title: "修改文件需要审批",
    covers: ["item.started", "interaction.requested", "session.status_changed", "interaction.resolved", "item.completed"],
    code: `
{
  "seq": 20, "type": "item.started", "created_at": "…", "run_id": "run_7Ka2",
  "item": {
    "id": "itm_06", "type": "tool_call", "status": "pending",
    "tool": { "name": "Edit", "kind": "file_edit" },
    "input": {
      "file_path": "src/cart/CartTotal.tsx",
      "old_string": "const discount = coupon.amount",
      "new_string": "const discount = coupon?.amount ?? 0"
    }
  }
}

{
  "seq": 21, "type": "interaction.requested", "created_at": "…", "run_id": "run_7Ka2",
  "interaction": {
    "id": "int_7", "type": "approval", "item_id": "itm_06",
    "title": "修改 src/cart/CartTotal.tsx",
    "reason": "项目规则要求编辑文件前确认",
    "expires_at": "2026-10-22T00:31:10.000Z"
  }
}

{ "seq": 22, "type": "session.status_changed", "created_at": "…",
  "status": { "state": "requires_action", "interaction_ids": ["int_7"], "active_tasks": 0 } }

{ "seq": 23, "type": "interaction.resolved", "created_at": "…", "run_id": "run_7Ka2",
  "interaction": { "id": "int_7", "type": "approval", "item_id": "itm_06", …,
                   "status": "resolved", "decision": "allow", "reason": "answered" } }

{
  "seq": 25, "type": "item.completed", "created_at": "…", "run_id": "run_7Ka2",
  "item": {
    "id": "itm_06", "type": "tool_call", "status": "completed",
    "tool": { "name": "Edit", "kind": "file_edit" }, "input": { … },
    "output": { "content": [{ "type": "text", "text": "已修改 1 处" }] },
    "duration_ms": 40
  }
}`,
    ui: () => (
      <>
        <Tool title="修改文件" detail="src/cart/CartTotal.tsx" status="等待确认" tone="run">
          <DiffLine kind="del" text="const discount = coupon.amount" />
          <DiffLine kind="add" text="const discount = coupon?.amount ?? 0" />
          <Small>项目规则要求编辑文件前确认</Small>
          <Row gap={8}>
            <Spacer />
            <Button variant="ghost">跳过</Button>
            <Button variant="primary">允许</Button>
          </Row>
        </Tool>
        <Tool title="修改文件" detail="src/cart/CartTotal.tsx" status="已允许 · 已修改 1 处" tone="ok" />
      </>
    ),
  },
  {
    id: "queued",
    chapter: "run",
    title: "运行中又发了一条消息",
    note: "delivery = follow-up 时，新消息进入队列。position 是队列中的位置；当前 run 结束后自动开始。",
    covers: ["run.queued"],
    code: `
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
      "content": [{ "type": "text", "text": "再生成一张修复后结账页的示意图" }]
    }
  }
}`,
    ui: () => (
      <Composer action="停止">
        <TaskRow title="再生成一张修复后结账页的示意图" status="排队中 · 第 1 位" tone="muted" action="取消" />
      </Composer>
    ),
  },
  {
    id: "run-updated",
    chapter: "run",
    title: "用量与上下文更新",
    covers: ["run.updated"],
    code: `
{
  "seq": 29,
  "type": "run.updated",
  "created_at": "2026-10-22T00:20:46.000Z",
  "run": {
    "id": "run_7Ka2",
    "status": "in_progress",
    "model": "claude-sonnet-4-5",
    "input": { … },
    "usage": { "input_tokens": 18240, "output_tokens": 1630, "cache_read_tokens": 12000 },
    "context": { "used_tokens": 41200, "limit_tokens": 200000 }
  }
}`,
    ui: () => <Meter percent={21} label="上下文 41.2k / 200k" />,
  },
  {
    id: "message",
    chapter: "run",
    title: "回复正文流式输出",
    covers: ["item.started", "item.delta", "item.completed"],
    code: `
{
  "seq": 30, "type": "item.started", "created_at": "…", "run_id": "run_7Ka2",
  "item": { "id": "itm_08", "type": "message", "status": "in_progress", "content": [] }
}

{ "type": "item.delta", "run_id": "run_7Ka2", "item_id": "itm_08",
  "delta": { "type": "text", "index": 0, "text": "问题出在 CartTotal：" } }

{
  "seq": 31, "type": "item.completed", "created_at": "…", "run_id": "run_7Ka2",
  "item": {
    "id": "itm_08", "type": "message", "status": "completed",
    "content": [{
      "type": "text",
      "text": "问题出在 CartTotal：未使用优惠券时 coupon 为 null，读取 amount 抛错。已改为空值默认 0，购物车测试 24/24 通过；e2e 已在后台运行。"
    }]
  }
}`,
    ui: () => (
      <Text>
        问题出在 CartTotal：未使用优惠券时 coupon 为 null，读取 amount 抛错。已改为空值默认 0，购物车测试 24/24 通过；e2e 已在后台运行。
      </Text>
    ),
  },
  {
    id: "run-completed",
    chapter: "run",
    title: "run 结束，排队的消息接着运行",
    note: "队列里还有消息时，会话保持 running，不会先变成 idle。",
    covers: ["run.completed", "run.started"],
    code: `
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
    "duration_ms": 48210,
    "usage": {
      "input_tokens": 52310, "output_tokens": 4120,
      "cache_read_tokens": 38000, "cost_usd": 0.21
    }
  }
}

{
  "seq": 33,
  "type": "run.started",
  "created_at": "2026-10-22T00:20:51.330Z",
  "run": {
    "id": "run_8Lm", "status": "in_progress", "model": "claude-sonnet-4-5",
    "input": { "type": "user_message", "message_id": "msg_5Qe", "content": [ … ] }
  }
}`,
    ui: () => (
      <>
        <Small>已完成 · 48.2s · 56.4k tokens · $0.21</Small>
        <UserMsg>
          <Text>再生成一张修复后结账页的示意图</Text>
        </UserMsg>
        <Small>正在处理…</Small>
      </>
    ),
  },
  {
    id: "image",
    chapter: "run",
    title: "生成图片",
    covers: ["item.started", "item.delta", "item.completed"],
    code: `
{
  "seq": 34, "type": "item.started", "created_at": "…", "run_id": "run_8Lm",
  "item": { "id": "itm_09", "type": "message", "status": "in_progress", "content": [] }
}

// 临时：渐进图片
{ "type": "item.delta", "run_id": "run_8Lm", "item_id": "itm_09",
  "delta": { "type": "image", "index": 0, "media_type": "image/png",
             "partial": true, "data": "iVBORw0KGgo…" } }

{
  "seq": 35, "type": "item.completed", "created_at": "…", "run_id": "run_8Lm",
  "item": {
    "id": "itm_09", "type": "message", "status": "completed",
    "content": [
      { "type": "image", "image_path": "outputs/checkout-fixed.png",
        "media_type": "image/png", "alt": "修复后的结账页示意图" },
      { "type": "text", "text": "示意图已保存到 outputs/checkout-fixed.png。" }
    ]
  }
}`,
    ui: () => (
      <>
        <Row gap={10} align="end">
          <ImageBox label="生成中…" width={120} height={72} faded />
          <ImageBox label="修复后的结账页示意图" width={180} height={108} />
        </Row>
        <Text>示意图已保存到 outputs/checkout-fixed.png。</Text>
      </>
    ),
  },
  {
    id: "idle",
    chapter: "run",
    title: "会话空闲，后台仍有任务",
    note: "run 结束、会话空闲、后台任务结束是三件独立的事。active_tasks 告诉客户端还有后台工作。",
    covers: ["run.completed", "session.status_changed"],
    code: `
{
  "seq": 36, "type": "run.completed", "created_at": "…",
  "run": { "id": "run_8Lm", "status": "completed", "stop_reason": "end_turn", … }
}

{
  "seq": 37,
  "type": "session.status_changed",
  "created_at": "2026-10-22T00:21:20.010Z",
  "status": { "state": "idle", "stop_reason": "end_turn", "active_tasks": 1 }
}`,
    ui: () => (
      <>
        <TaskRow title="运行 e2e 测试" status="后台运行中" tone="run" action="停止" />
        <Composer action="发送" />
      </>
    ),
  },

  // ── 子 Agent ──
  {
    id: "subagent-start",
    chapter: "thread",
    title: "启动子 Agent",
    note: "发生在主线程 seq 8–13 之间。subagent 是主线程里的一个 item；子 Agent 自己的 run 带 thread_id。",
    covers: ["item.started", "run.started"],
    code: `
{
  "seq": 8, "type": "item.started", "created_at": "…", "run_id": "run_7Ka2",
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

{
  "seq": 9, "type": "run.started", "created_at": "…", "thread_id": "thr_2",
  "run": {
    "id": "run_9Xb", "status": "in_progress", "model": "claude-haiku-4-5",
    "input": {
      "type": "agent_task",
      "item_id": "itm_03",
      "prompt": "找出所有计算订单总价的位置，列出文件和行号"
    }
  }
}`,
    ui: () => (
      <Nested title="Explore" meta="查找结账金额计算代码 · claude-haiku-4-5" status="运行中" tone="run">
        <Quote>找出所有计算订单总价的位置，列出文件和行号</Quote>
      </Nested>
    ),
  },
  {
    id: "subagent-tool",
    chapter: "thread",
    title: "子 Agent 内部的工具调用",
    note: "所有线程默认都在主流里，靠 thread_id 区分；用 threads=main 可以只收主线程。",
    covers: ["item.started", "item.delta", "item.completed"],
    code: `
{
  "seq": 10, "type": "item.started", "created_at": "…",
  "thread_id": "thr_2", "run_id": "run_9Xb",
  "item": {
    "id": "itm_04", "type": "tool_call", "status": "running",
    "tool": { "name": "Grep", "kind": "search" },
    "input": { "pattern": "orderTotal|calcTotal", "path": "src" }
  }
}

{ "type": "item.delta", "thread_id": "thr_2", "run_id": "run_9Xb", "item_id": "itm_04",
  "delta": { "type": "output", "stream": "stdout", "text": "src/cart/CartTotal.tsx:42\\n" } }

{
  "seq": 11, "type": "item.completed", "created_at": "…",
  "thread_id": "thr_2", "run_id": "run_9Xb",
  "item": {
    "id": "itm_04", "type": "tool_call", "status": "completed",
    "tool": { "name": "Grep", "kind": "search" }, "input": { … },
    "output": { "content": [{ "type": "text", "text": "src/cart/CartTotal.tsx:42\\nsrc/api/order.ts:88" }] },
    "duration_ms": 310
  }
}`,
    ui: () => (
      <Nested title="Explore" meta="查找结账金额计算代码" status="运行中" tone="run">
        <Tool title="搜索" detail="orderTotal|calcTotal · src" status="2 个结果" tone="ok">
          <Term text={"src/cart/CartTotal.tsx:42\nsrc/api/order.ts:88"} />
        </Tool>
      </Nested>
    ),
  },
  {
    id: "subagent-done",
    chapter: "thread",
    title: "子 Agent 完成",
    covers: ["run.completed", "item.completed"],
    code: `
{
  "seq": 12, "type": "run.completed", "created_at": "…", "thread_id": "thr_2",
  "run": {
    "id": "run_9Xb", "status": "completed", "stop_reason": "end_turn",
    "duration_ms": 6400, "usage": { "input_tokens": 8200, "output_tokens": 920 }
  }
}

{
  "seq": 13, "type": "item.completed", "created_at": "…", "run_id": "run_7Ka2",
  "item": {
    "id": "itm_03", "type": "subagent", "status": "completed",
    "agent": { "name": "Explore", "description": "查找结账金额计算代码" },
    "thread_id": "thr_2", "mode": "foreground", "input": { … },
    "output": { "content": [{ "type": "text", "text": "共 2 处：CartTotal.tsx:42、order.ts:88" }] },
    "duration_ms": 6400,
    "usage": { "input_tokens": 8200, "output_tokens": 920 }
  }
}`,
    ui: () => (
      <Nested title="Explore" meta="6.4s · 9.1k tokens" status="已完成" tone="ok">
        <Text size="small">共 2 处：CartTotal.tsx:42、order.ts:88</Text>
      </Nested>
    ),
  },
  {
    id: "inbox",
    chapter: "thread",
    title: "给后台 Agent 发消息",
    note: "后台 Agent 收到主 Agent 或其他 Agent 的消息时，在它自己的线程里开始一个新 run。",
    covers: ["run.started"],
    code: `
{
  "seq": 60,
  "type": "run.started",
  "created_at": "2026-10-22T00:24:10.000Z",
  "thread_id": "thr_4",
  "run": {
    "id": "run_Q2c",
    "status": "in_progress",
    "model": "claude-haiku-4-5",
    "input": {
      "type": "inbox_message",
      "from": { "kind": "coordinator", "name": "主 Agent" },
      "content": [{ "type": "text", "text": "也检查一下移动端的结账页" }]
    }
  }
}`,
    ui: () => (
      <Nested title="mobile-check" meta="后台 Agent" status="继续运行" tone="run">
        <Small>主 Agent → 也检查一下移动端的结账页</Small>
      </Nested>
    ),
  },

  // ── 后台任务 ──
  {
    id: "task-start",
    chapter: "task",
    title: "后台命令启动",
    note: "工具调用本身很快完成，item 带 task_id；后台执行的生命周期由 task 对象单独描述。",
    covers: ["item.completed", "task.started"],
    code: `
{
  "seq": 27, "type": "item.completed", "created_at": "…", "run_id": "run_7Ka2",
  "item": {
    "id": "itm_07", "type": "tool_call", "status": "completed",
    "tool": { "name": "Bash", "kind": "command" },
    "input": { "command": "npm run e2e", "description": "运行 e2e 测试", "run_in_background": true },
    "output": { "content": [{ "type": "text", "text": "已在后台启动" }] },
    "task_id": "task_9",
    "duration_ms": 120
  }
}

{
  "seq": 28, "type": "task.started", "created_at": "…",
  "task": {
    "id": "task_9",
    "kind": "shell",
    "status": "running",
    "description": "运行 e2e 测试",
    "origin": { "run_id": "run_7Ka2", "item_id": "itm_07" },
    "started_at": "2026-10-22T00:20:44.900Z"
  }
}`,
    ui: () => (
      <>
        <Tool title="运行 e2e 测试" detail="npm run e2e" status="后台运行" tone="run" />
        <TaskRow title="运行 e2e 测试" status="运行中" tone="run" action="停止" />
      </>
    ),
  },
  {
    id: "workflow",
    chapter: "task",
    title: "Workflow 进度",
    note: "每个 Workflow Agent 有自己的 thread_id，它内部的 item 同样内联在主流里。",
    covers: ["task.updated"],
    code: `
{
  "seq": 39, "type": "task.updated", "created_at": "…",
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
        { "label": "desktop", "phase_index": 1, "thread_id": "thr_6",
          "status": "running", "last_tool": "Bash", "tokens": 4200 },
        { "label": "mobile", "phase_index": 1, "thread_id": "thr_7",
          "status": "completed", "tokens": 3100, "duration_ms": 52000 }
      ]
    },
    "usage": { "total_tokens": 7300 }
  }
}`,
    ui: () => (
      <Tool title="全站结账回归检查" detail="checkout-regression" status="运行中" tone="run">
        <Small>1 收集入口页面 · 2 并行检查</Small>
        <TaskRow title="desktop" meta="Bash · 4.2k tokens" status="运行中" tone="run" />
        <TaskRow title="mobile" meta="52s · 3.1k tokens" status="已完成" tone="ok" />
      </Tool>
    ),
  },
  {
    id: "monitor",
    chapter: "task",
    title: "Monitor 事件",
    note: "Monitor 的每次事件都会更新 last_event；它也可能作为 task_result 回送给模型，触发新 run。",
    covers: ["task.updated"],
    code: `
{
  "seq": 41, "type": "task.updated", "created_at": "…",
  "task": {
    "id": "task_12",
    "kind": "monitor",
    "status": "running",
    "description": "监听 dev server 日志",
    "origin": { "run_id": "run_8Lm", "item_id": "itm_0C" },
    "last_event": {
      "text": "ERROR POST /api/checkout 500 (coupon=null)",
      "created_at": "2026-10-22T00:22:03.000Z"
    }
  }
}`,
    ui: () => <TaskRow title="监听 dev server 日志" meta="ERROR POST /api/checkout 500" status="运行中" tone="run" action="停止" />,
  },
  {
    id: "task-done",
    chapter: "task",
    title: "后台任务完成",
    covers: ["task.completed"],
    code: `
{
  "seq": 44, "type": "task.completed", "created_at": "…",
  "task": {
    "id": "task_9",
    "kind": "shell",
    "status": "completed",
    "description": "运行 e2e 测试",
    "origin": { "run_id": "run_7Ka2", "item_id": "itm_07" },
    "result": {
      "summary": "e2e 全部通过（42/42）",
      "output_path": ".agent/tasks/task_9.log"
    },
    "started_at": "2026-10-22T00:20:44.900Z",
    "completed_at": "2026-10-22T00:23:46.900Z",
    "duration_ms": 182000
  }
}`,
    ui: () => <TaskRow title="运行 e2e 测试" meta="e2e 全部通过（42/42）· 3m02s" status="已完成" tone="ok" action="查看输出" />,
  },
  {
    id: "task-delivered",
    chapter: "task",
    title: "结果回送给模型，开启新 run",
    note: "对应现有的 task.delivered + replyTo：现在只是一个 input.type = task_result 的普通 run。",
    covers: ["session.status_changed", "run.started", "item.completed"],
    code: `
{ "seq": 45, "type": "session.status_changed", "created_at": "…",
  "status": { "state": "running", "active_tasks": 0 } }

{
  "seq": 46, "type": "run.started", "created_at": "…",
  "run": {
    "id": "run_A1d",
    "status": "in_progress",
    "model": "claude-sonnet-4-5",
    "input": {
      "type": "task_result",
      "task_id": "task_9",
      "status": "completed",
      "summary": "e2e 全部通过（42/42）"
    }
  }
}

{
  "seq": 48, "type": "item.completed", "created_at": "…", "run_id": "run_A1d",
  "item": {
    "id": "itm_0D", "type": "message", "status": "completed",
    "content": [{ "type": "text", "text": "后台 e2e 已全部通过，这次修复没有引入回归。" }]
  }
}`,
    ui: () => (
      <>
        <Tool title="后台任务完成" detail="运行 e2e 测试" status="e2e 全部通过（42/42）" tone="ok" />
        <Text>后台 e2e 已全部通过，这次修复没有引入回归。</Text>
      </>
    ),
  },

  // ── 会话级 ──
  {
    id: "settings",
    chapter: "session",
    title: "模型被切换",
    note: "source 说明变化来源：api（PATCH 会话）或 native_command（例如 Claude 原生 /model）。",
    covers: ["session.settings_changed"],
    code: `
{
  "seq": 70,
  "type": "session.settings_changed",
  "created_at": "2026-10-22T00:26:00.000Z",
  "settings": { "model": "default:claude-opus-4-1", "effort": "high" },
  "source": "native_command"
}`,
    ui: () => (
      <>
        <Header title="shop-web" meta="Claude · claude-opus-4-1 · high" />
        <Rule label="模型已切换为 claude-opus-4-1" />
      </>
    ),
  },
  {
    id: "compaction",
    chapter: "session",
    title: "上下文压缩",
    covers: ["item.started", "item.completed"],
    code: `
{
  "seq": 80, "type": "item.started", "created_at": "…", "run_id": "run_C3f",
  "item": { "id": "itm_20", "type": "compaction", "status": "in_progress", "trigger": "auto" }
}

{
  "seq": 81, "type": "item.completed", "created_at": "…", "run_id": "run_C3f",
  "item": {
    "id": "itm_20",
    "type": "compaction",
    "status": "completed",
    "trigger": "auto",
    "summary": "此前：定位并修复 CartTotal 空优惠券问题，补充回归测试，e2e 通过。",
    "context": { "tokens_before": 182000, "tokens_after": 24000 }
  }
}`,
    ui: () => (
      <>
        <Rule label="上下文已自动压缩 · 182k → 24k" />
        <Quote>此前：定位并修复 CartTotal 空优惠券问题，补充回归测试，e2e 通过。</Quote>
      </>
    ),
  },
  {
    id: "session-error",
    chapter: "session",
    title: "上游错误，自动重试中",
    note: "retry.status：retrying（等待即可）、exhausted（本次 run 放弃）、terminal（会话不可继续）。",
    covers: ["session.error"],
    code: `
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
}`,
    ui: () => (
      <Callout tone="warning" title="模型服务繁忙">
        正在自动重试（2/5），无需操作。
      </Callout>
    ),
  },
  {
    id: "run-failed",
    chapter: "session",
    title: "run 失败",
    covers: ["run.completed"],
    code: `
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
    "duration_ms": 61000,
    "usage": { "input_tokens": 3100, "output_tokens": 0 }
  }
}`,
    ui: () => (
      <Row gap={8} align="center">
        <Status tone="bad">回复失败：重试 5 次后仍失败</Status>
        <Spacer />
        <Button variant="secondary">重试</Button>
      </Row>
    ),
  },
  {
    id: "interrupted",
    chapter: "session",
    title: "被新消息打断",
    note: "新消息以 delivery = interrupt 发送。stop_reason 还可能是 cancelled（用户取消）、max_turns、budget_exceeded。",
    covers: ["run.completed", "run.started"],
    code: `
{
  "seq": 101, "type": "run.completed", "created_at": "…",
  "run": {
    "id": "run_D4k",
    "status": "interrupted",
    "stop_reason": "interrupted",
    "interrupted_by": { "message_id": "msg_9Tz" },
    "input": { … },
    "duration_ms": 5200,
    "usage": { "input_tokens": 9100, "output_tokens": 210 }
  }
}

{
  "seq": 102, "type": "run.started", "created_at": "…",
  "run": {
    "id": "run_E5m", "status": "in_progress", "model": "claude-opus-4-1",
    "input": {
      "type": "user_message", "message_id": "msg_9Tz",
      "content": [{ "type": "text", "text": "先别改样式，只修逻辑" }]
    }
  }
}`,
    ui: () => (
      <>
        <Text tone="tertiary">我先把按钮样式统一一下，然后……</Text>
        <Small>已中断</Small>
        <UserMsg>
          <Text>先别改样式，只修逻辑</Text>
        </UserMsg>
      </>
    ),
  },
  {
    id: "native",
    chapter: "session",
    title: "原生事件（按连接开启）",
    note: "native=true 时出现。不带 seq、不持久化、重连不补发。refs 只在能对应到语义对象时给出。",
    covers: ["native", "GET /events"],
    code: `
GET /api/agent/v1/sandbox/sessions/ses_01JDX4/events?after=0&native=true

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
      "content": [{
        "type": "tool_result",
        "tool_use_id": "toolu_01Qz3…",
        "content": "src/cart/CartTotal.tsx:42\\n…"
      }]
    }
  }
}`,
    ui: () => (
      <>
        <Small>对话界面不显示，只出现在客户端的开发者面板：</Small>
        <div>
          <DevRow cells={["00:20:12.4", "claude", "sdk", "user/tool_result", "→ itm_04"]} />
          <DevRow cells={["00:20:12.6", "claude", "sdk", "system/task_progress", "→ task_9"]} />
          <DevRow cells={["00:20:12.9", "claude", "sdk", "stream_event/text_delta", "→ itm_08"]} />
        </div>
      </>
    ),
  },

  // ── 重连与读取 ──
  {
    id: "resume",
    chapter: "resume",
    title: "断线续传",
    note: "先补发游标之后的持久事件；对进行中的 item 补发一条 resync 的 item.updated（带已累积内容，无 seq）；然后接实时 delta。",
    covers: ["GET /events", "item.updated", "item.delta"],
    code: `
GET /api/agent/v1/sandbox/sessions/ses_01JDX4/events
Last-Event-ID: 33

id: 34
event: item.started
data: {"seq":34,"type":"item.started","run_id":"run_8Lm","item":{"id":"itm_09","type":"message",…}}

event: item.updated
data: {"type":"item.updated","resync":true,"run_id":"run_8Lm",
       "item":{"id":"itm_09","type":"message","status":"in_progress",
               "content":[{"type":"text","text":"示意图已生成，正在"}]}}

event: item.delta
data: {"type":"item.delta","run_id":"run_8Lm","item_id":"itm_09",
       "delta":{"type":"text","index":0,"text":"保存到 outputs/"}}

: keep-alive`,
    ui: () => (
      <>
        <Small>已重新连接</Small>
        <Text>
          示意图已生成，正在保存到 outputs/<Caret />
        </Text>
      </>
    ),
  },
  {
    id: "cursor-expired",
    chapter: "resume",
    title: "游标过期",
    covers: ["GET /events", "错误响应"],
    code: `
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

// 客户端随后：
GET /api/agent/v1/sandbox/sessions/ses_01JDX4             // 会话快照
GET /api/agent/v1/sandbox/sessions/ses_01JDX4/runs        // 历史
GET /api/agent/v1/sandbox/sessions/ses_01JDX4/events?after=512`,
    ui: () => (
      <Stack gap={6}>
        <Small>正在同步会话…</Small>
        <Small>1. 读取会话快照（状态、进行中的 run、待处理交互、后台任务）</Small>
        <Small>2. 读取历史 run 与 item</Small>
        <Small>3. 从 seq 512 继续订阅</Small>
      </Stack>
    ),
  },
  {
    id: "snapshot",
    chapter: "resume",
    title: "会话快照与历史",
    note: "快照与历史里的对象，和事件里携带的对象完全同构：只按顺序应用持久事件，结果与这里一致。",
    covers: ["GET /sessions/{id}", "GET /runs"],
    code: `
GET /api/agent/v1/sandbox/sessions/ses_01JDX4
200 OK
{
  "id": "ses_01JDX4",
  "harness": "claude",
  "workdir": "projects/shop-web",
  "settings": { "model": "default:claude-sonnet-4-5", "effort": "high" },
  "status": { "state": "requires_action", "interaction_ids": ["int_7"], "active_tasks": 1 },
  "active_run": { "id": "run_7Ka2", "status": "in_progress", … },
  "queued_runs": [],
  "interactions": [{ "id": "int_7", "type": "approval", "item_id": "itm_06", … }],
  "tasks": [{ "id": "task_9", "kind": "shell", "status": "running", … }],
  "last_event_seq": 22
}

GET /api/agent/v1/sandbox/sessions/ses_01JDX4/runs?limit=20&thread=all
200 OK
{
  "data": [
    {
      "id": "run_7Ka2",
      "status": "in_progress",
      "input": { "type": "user_message", … },
      "items": [
        { "id": "itm_01", "type": "reasoning", … },
        { "id": "itm_02", "type": "tool_call", … },
        { "id": "itm_03", "type": "subagent", "thread_id": "thr_2", … }
      ]
    },
    { "id": "run_9Xb", "thread_id": "thr_2", "status": "completed", "items": [ … ] }
  ],
  "next_cursor": null
}`,
    ui: () => (
      <>
        {SESSION_HEADER()}
        <UserMsg>
          <Text>结账页报错了，帮我查一下并修复</Text>
        </UserMsg>
        <Small>已思考 2.1s</Small>
        <Tool title="运行购物车相关测试" detail="npm test -- cart" status="失败 · 8.3s" tone="bad" />
        <Nested title="Explore" meta="6.4s" status="已完成" tone="ok" />
        <Tool title="修改文件" detail="src/cart/CartTotal.tsx" status="等待确认" tone="run" />
      </>
    ),
  },
];

const CHAPTERS: { id: string; title: string; description: string }[] = [
  { id: "input", title: "输入：请求与命令", description: "创建会话、上传文件、发送消息（202 / SSE / WS）、回答交互、取消与错误。" },
  { id: "run", title: "一次 run：主线程", description: "从会话开始运行到空闲，覆盖思考、工具、提问、审批、排队、用量、图片和结束。" },
  { id: "thread", title: "子 Agent：内联线程", description: "子 Agent 的 item 和 run 都内联在主流里，用 thread_id 区分。" },
  { id: "task", title: "后台任务", description: "后台命令、Workflow、Monitor 的生命周期，以及结果回送给模型。" },
  { id: "session", title: "会话级变化与异常", description: "设置变化、上下文压缩、上游错误、失败、打断，以及原生事件。" },
  { id: "resume", title: "重连与读取", description: "游标续传、游标过期，以及与事件同构的快照和历史。" },
];

// ───────────────────────── page ─────────────────────────

function ColumnLabels() {
  const t = useHostTheme();
  const style = { fontSize: 11, color: t.text.tertiary, letterSpacing: 0.2 };
  return (
    <Grid columns="minmax(0, 1.15fr) minmax(0, 1fr)" gap={16}>
      <span style={style}>字段（线上传输的内容）</span>
      <span style={style}>用户看到的</span>
    </Grid>
  );
}

function StepView({ step }: { step: Step }) {
  return (
    <Stack gap={8}>
      <Row gap={8} align="center" wrap>
        <H3>{step.title}</H3>
        <Spacer />
        {step.covers.map((key) => (
          <Pill key={key} size="sm">
            {key}
          </Pill>
        ))}
      </Row>
      {step.note ? (
        <Text size="small" tone="secondary">
          {step.note}
        </Text>
      ) : null}
      <Grid columns="minmax(0, 1.15fr) minmax(0, 1fr)" gap={16} align="start">
        <CodeBlock code={step.code} />
        <Frame>{step.ui()}</Frame>
      </Grid>
    </Stack>
  );
}

function CoverageGroup({
  label,
  keys,
  counts,
  selected,
  onSelect,
}: {
  label: string;
  keys: string[];
  counts: Map<string, number>;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    <Stack gap={6}>
      <Text size="small" tone="tertiary">
        {label}
      </Text>
      <Row gap={6} wrap>
        {keys.map((key) => (
          <Pill key={key} active={selected === key} onClick={() => onSelect(selected === key ? null : key)}>
            {`${key}  ${counts.get(key) ?? 0}`}
          </Pill>
        ))}
      </Row>
    </Stack>
  );
}

export default function AgentRunnerApiExamples() {
  const [selected, setSelected] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const step of STEPS) for (const key of step.covers) counts.set(key, (counts.get(key) ?? 0) + 1);
  const visible = selected ? STEPS.filter((step) => step.covers.includes(selected)) : STEPS;

  return (
    <Stack gap={20} style={{ padding: 4 }}>
      <Stack gap={6}>
        <H1>Agent Runner 对外接口 · 输入输出示例</H1>
        <Text tone="secondary">
          一个会话从创建到结束的完整过程。左边是线上实际传输的字段，右边是第三方客户端通常会渲染出来的界面。示例覆盖 12 类请求、15 种持久事件和 2 种临时事件；点击下方标签可以只看包含某个事件的示例。
        </Text>
      </Stack>

      <Grid columns="minmax(0, 1.6fr) minmax(0, 1fr)" gap={24} align="start">
        <Stack gap={12}>
          <CoverageGroup label="请求与命令" keys={REQUEST_KEYS} counts={counts} selected={selected} onSelect={setSelected} />
          <CoverageGroup label="持久事件（带 seq，携带完整对象）" keys={DURABLE_KEYS} counts={counts} selected={selected} onSelect={setSelected} />
          <CoverageGroup label="临时事件（不带 seq，不持久化）" keys={EPHEMERAL_KEYS} counts={counts} selected={selected} onSelect={setSelected} />
          {selected ? (
            <Row gap={8} align="center">
              <Text size="small" tone="secondary">
                {`正在显示包含 ${selected} 的 ${visible.length} 个示例`}
              </Text>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                显示全部
              </Button>
            </Row>
          ) : null}
        </Stack>
        <Stack gap={8}>
          <Text size="small" tone="tertiary">
            约定
          </Text>
          <Table
            headers={["规则", "说明"]}
            rows={[
              ["事件外壳", "seq、type、created_at，按需带 run_id、thread_id"],
              ["thread_id", "省略表示主线程"],
              ["…", "示例中与前文相同的字段省略"],
              ["字段命名", "snake_case；时间为 RFC 3339"],
              ["ID 前缀", "ses_ run_ itm_ thr_ task_ int_ msg_"],
              ["默认订阅", "deltas=true · threads=all · native=false"],
            ]}
          />
        </Stack>
      </Grid>

      {CHAPTERS.map((chapter) => {
        const steps = visible.filter((step) => step.chapter === chapter.id);
        if (steps.length === 0) return null;
        return (
          <Stack key={chapter.id} gap={14}>
            <Divider />
            <Stack gap={4}>
              <H2>{chapter.title}</H2>
              <Text size="small" tone="secondary">
                {chapter.description}
              </Text>
            </Stack>
            <ColumnLabels />
            {steps.map((step, index) => (
              <Stack key={step.id} gap={14}>
                {index > 0 ? <div style={{ height: 4 }} /> : null}
                <StepView step={step} />
              </Stack>
            ))}
          </Stack>
        );
      })}
    </Stack>
  );
}
