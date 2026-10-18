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

const exampleFrames: SharedFrame[] = [{"v":3,"kind":"snapshot","streamId":"stream-1","atSeq":0,"ts":1792202400000,"sessionId":"session-1","sources":[{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"}],"integrity":{"status":"complete","issues":[]},"items":[]},{"v":3,"kind":"event","streamId":"stream-1","seq":1,"ts":1792202400000,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"run_start","model":"example-model"}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":0,"deleteCount":0,"items":[{"id":"run-1","kind":"run","runId":"run-1","status":"running","model":"example-model","timing":{"startedAt":1792202400000,"endedAt":null,"durationMs":null,"basis":"host_observed"},"error":null}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":2,"ts":1792202400000,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"thinking_start"}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":1,"deleteCount":0,"items":[{"id":"thinking-1","kind":"thinking","runId":"run-1","status":"running","summary":null,"timing":{"startedAt":1792202400000,"endedAt":null,"durationMs":null,"basis":"host_observed"}}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":3,"ts":1792202401200,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"thinking_end","publicSummary":"先读取项目说明，再核对目录。"}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":1,"deleteCount":1,"items":[{"id":"thinking-1","kind":"thinking","runId":"run-1","status":"complete","summary":"先读取项目说明，再核对目录。","timing":{"startedAt":1792202400000,"endedAt":1792202401200,"durationMs":1200,"basis":"host_observed"}}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":4,"ts":1792202401200,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"tool_start","toolCallId":"native-tool-1","name":"read_file","args":{"path":"README.md"}}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":2,"deleteCount":0,"items":[{"id":"tool-1","kind":"tool","runId":"run-1","name":"read_file","status":"running","input":{"status":"complete","text":"{\"path\":\"README.md\"}","value":{"path":"README.md"}},"output":[],"children":[],"timing":{"startedAt":1792202401200,"endedAt":null,"durationMs":null,"basis":"host_observed"},"error":null}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":5,"ts":1792202401500,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"tool_end","toolCallId":"native-tool-1","result":[{"kind":"text","text":"# Example project\nSource: src/\nDocs: docs/"},{"kind":"json","value":{"path":"README.md","encoding":"utf-8"}}],"extra":{"preserved":true}}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":2,"deleteCount":1,"items":[{"id":"tool-1","kind":"tool","runId":"run-1","name":"read_file","status":"complete","input":{"status":"complete","text":"{\"path\":\"README.md\"}","value":{"path":"README.md"}},"output":[{"kind":"text","text":"# Example project\nSource: src/\nDocs: docs/"},{"kind":"json","value":{"path":"README.md","encoding":"utf-8"}}],"children":[],"timing":{"startedAt":1792202401200,"endedAt":1792202401500,"durationMs":300,"basis":"host_observed"},"error":null}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":6,"ts":1792202401500,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"agent_start","agentId":"native-agent-7","name":"检查目录"}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":3,"deleteCount":0,"items":[{"id":"agent-1","kind":"agent","runId":"run-1","name":"检查目录","originRunId":"run-1","completionPolicy":"joined","status":"running","children":[],"timing":{"startedAt":1792202401500,"endedAt":null,"durationMs":null,"basis":"host_observed"},"error":null}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":7,"ts":1792202401600,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"tool_start","agentId":"native-agent-7","toolCallId":"native-child-tool-1","name":"list_directory","args":{"path":"."}}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":3,"deleteCount":1,"items":[{"id":"agent-1","kind":"agent","runId":"run-1","name":"检查目录","originRunId":"run-1","completionPolicy":"joined","status":"running","children":[{"id":"tool-child-1","kind":"tool","runId":"run-1","name":"list_directory","status":"running","input":{"status":"complete","text":"{\"path\":\".\"}","value":{"path":"."}},"output":[],"children":[],"timing":{"startedAt":1792202401600,"endedAt":null,"durationMs":null,"basis":"host_observed"},"error":null}],"timing":{"startedAt":1792202401500,"endedAt":null,"durationMs":null,"basis":"host_observed"},"error":null}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":8,"ts":1792202401600,"context":{"sessionId":"session-1","runId":null},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"background_start","taskId":"native-background-8","command":"npm test"}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":4,"deleteCount":0,"items":[{"id":"background-1","kind":"task","runId":null,"title":"运行后台测试","taskKind":"command","originRunId":"run-1","completionPolicy":"detached","status":"running","control":"api","children":[],"timing":{"startedAt":1792202401600,"endedAt":null,"durationMs":null,"basis":"host_observed"},"error":null}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":9,"ts":1792202402700,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"agent_end","agentId":"native-agent-7","result":"已确认源码和文档目录。","childToolResult":{"toolCallId":"native-child-tool-1","output":[{"kind":"json","value":["src/","docs/","README.md"]}],"timing":{"startedAt":1792202401600,"endedAt":1792202402600,"durationMs":1000,"basis":"host_observed"}}}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":3,"deleteCount":1,"items":[{"id":"agent-1","kind":"agent","runId":"run-1","name":"检查目录","originRunId":"run-1","completionPolicy":"joined","status":"complete","children":[{"id":"tool-child-1","kind":"tool","runId":"run-1","name":"list_directory","status":"complete","input":{"status":"complete","text":"{\"path\":\".\"}","value":{"path":"."}},"output":[{"kind":"json","value":["src/","docs/","README.md"]}],"children":[],"timing":{"startedAt":1792202401600,"endedAt":1792202402600,"durationMs":1000,"basis":"host_observed"},"error":null},{"id":"child-answer-1","kind":"message","runId":"run-1","role":"assistant","phase":"final","status":"complete","content":[{"kind":"text","text":"已确认源码和文档目录。"}]}],"timing":{"startedAt":1792202401500,"endedAt":1792202402700,"durationMs":1200,"basis":"host_observed"},"error":null}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":10,"ts":1792202402900,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"answer_delta","delta":"项目包含 src/ 和 docs/。"}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":5,"deleteCount":0,"items":[{"id":"answer-1","kind":"message","runId":"run-1","role":"assistant","phase":"final","status":"streaming","content":[{"kind":"text","text":"项目包含 src/ 和 docs/。"}]}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":11,"ts":1792202403200,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"answer_end","text":"项目包含 src/ 和 docs/。已读取 README，后台测试仍在运行。"}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":5,"deleteCount":1,"items":[{"id":"answer-1","kind":"message","runId":"run-1","role":"assistant","phase":"final","status":"complete","content":[{"kind":"text","text":"项目包含 src/ 和 docs/。已读取 README，后台测试仍在运行。"}]}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":12,"ts":1792202403300,"context":{"sessionId":"session-1","runId":"run-1"},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"run_end"}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":0,"deleteCount":1,"items":[{"id":"run-1","kind":"run","runId":"run-1","status":"complete","model":"example-model","timing":{"startedAt":1792202400000,"endedAt":1792202403300,"durationMs":3300,"basis":"host_observed"},"error":null}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":13,"ts":1792202404000,"context":{"sessionId":"session-1","runId":null},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"background_progress","taskId":"native-background-8","stdout":"8/12 tests passed"}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":4,"deleteCount":1,"items":[{"id":"background-1","kind":"task","runId":null,"title":"运行后台测试","taskKind":"command","originRunId":"run-1","completionPolicy":"detached","status":"running","control":"api","children":[{"id":"background-tool-1","kind":"tool","runId":null,"name":"bash","status":"running","input":{"status":"complete","text":"{\"command\":\"npm test\"}","value":{"command":"npm test"}},"output":[{"kind":"text","text":"8/12 tests passed"}],"children":[],"timing":{"startedAt":1792202401600,"endedAt":null,"durationMs":null,"basis":"host_observed"},"error":null}],"timing":{"startedAt":1792202401600,"endedAt":null,"durationMs":null,"basis":"host_observed"},"error":null}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":14,"ts":1792202405600,"context":{"sessionId":"session-1","runId":null},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"background_end","taskId":"native-background-8","exitCode":0,"passed":12}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":4,"deleteCount":1,"items":[{"id":"background-1","kind":"task","runId":null,"title":"运行后台测试","taskKind":"command","originRunId":"run-1","completionPolicy":"detached","status":"complete","control":"api","children":[{"id":"background-tool-1","kind":"tool","runId":null,"name":"bash","status":"complete","input":{"status":"complete","text":"{\"command\":\"npm test\"}","value":{"command":"npm test"}},"output":[{"kind":"text","text":"12 tests passed"},{"kind":"json","value":{"exitCode":0}}],"children":[],"timing":{"startedAt":1792202401600,"endedAt":1792202405600,"durationMs":4000,"basis":"host_observed"},"error":null}],"timing":{"startedAt":1792202401600,"endedAt":1792202405600,"durationMs":4000,"basis":"host_observed"},"error":null}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":15,"ts":1792202405700,"context":{"sessionId":"session-1","runId":null},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"background_notification","taskId":"native-background-8","text":"12 tests passed"}},"integrity":{"status":"complete","issues":[]},"output":{"status":"applied","edits":[{"index":6,"deleteCount":0,"items":[{"id":"background-notice-1","kind":"message","runId":null,"role":"assistant","phase":"notification","status":"complete","content":[{"kind":"text","text":"后台测试完成：12 项通过。"}]}]}]}},{"v":3,"kind":"event","streamId":"stream-1","seq":16,"ts":1792202405800,"context":{"sessionId":"session-1","runId":null},"native":{"source":{"harness":"pi","interface":"example.synthetic","version":"fixture-1","instanceId":"example-process","channel":"fixture"},"format":"json","value":{"type":"future_event","unknownFields":{"nested":[1,{"keep":true}]}}},"integrity":{"status":"complete","issues":[]},"output":{"status":"unmapped","edits":[]}}];
