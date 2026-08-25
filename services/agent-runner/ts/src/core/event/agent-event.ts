export const STREAM_PROTOCOL_VERSION = 1 as const

// Mapping table (product type ← SDK). Mappers emit AgentEvent; EnvelopeStamper adds the envelope.
// Claude stream_event.content_block_start          → assistant.block_start
// Claude stream_event.delta.text_delta             → assistant.delta
// Claude stream_event.delta.thinking_delta         → assistant.thinking_delta
// Claude stream_event.delta.input_json_delta       → tool.input_delta
// Claude stream_event / assistant tool_use         → tool.started (once per id)
// Claude /v1/responses partial_image               → assistant.image_delta (never assistant.delta)
// Claude complete assistant                        → assistant.message (replace blocks; merge split assistants by messageId)
// Claude user.tool_result                          → tool.completed (output always string; Agent/Task may be async_launched)
// Claude parent_tool_use_id assistant/user         → same types + parentToolUseId (do not drop)
// Claude system task_* + workflow_name/progress    → workflow.*
// Claude system task_* + subagent_type / Agent     → agent.started / agent.completed
// Pi message_update text_delta / thinking_delta    → assistant.delta / assistant.thinking_delta
// Pi toolcall_start before id is known             → assistant.block_start only (no tool.started)
// Pi toolcall_delta/end once id exists             → tool.started (once) / tool.input_delta / tool.updated
// Pi tool_execution_start/update/end               → tool.running / tool.progress / tool.completed
// Pi message_end assistant                         → assistant.message
// Pi agent_end                                     → run.completed | run.failed | run.aborted


export interface TokenUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

export type BlockKind = 'text' | 'thinking' | 'tool_use' | 'image' | 'unknown'

export type ContentBlock =
  | {
      readonly type: 'text'
      readonly blockId: string
      readonly index: number
      readonly text: string
    }
  | {
      readonly type: 'thinking'
      readonly blockId: string
      readonly index: number
      readonly text: string
    }
  | {
      readonly type: 'tool_use'
      readonly blockId: string
      readonly index: number
      readonly id: string
      readonly name: string
      readonly input?: unknown
    }
  | {
      readonly type: 'image'
      readonly blockId: string
      readonly index: number
      readonly mime?: string
      readonly url?: string
      readonly b64?: string
      readonly alt?: string
    }
  | {
      readonly type: 'unknown'
      readonly blockId: string
      readonly index: number
      readonly kind: string
      readonly data?: unknown
    }

export interface EventChannel {
  readonly parentToolUseId?: string
  readonly agentId?: string
}

export interface BlockAddress {
  readonly messageId: string
  readonly blockId: string
  readonly index?: number
}

export type AgentEvent =
  | ({ readonly type: 'run.started'; readonly model?: string } & EventChannel)
  | ({
      readonly type: 'assistant.block_start'
      readonly kind: BlockKind
    } & BlockAddress &
      EventChannel)
  | ({
      readonly type: 'assistant.thinking_delta'
      readonly text: string
    } & BlockAddress &
      EventChannel)
  | ({
      readonly type: 'assistant.delta'
      readonly text: string
    } & BlockAddress &
      EventChannel)
  | ({
      readonly type: 'assistant.image_delta'
      readonly mime?: string
      readonly b64?: string
      readonly url?: string
      readonly final?: boolean
    } & BlockAddress &
      EventChannel)
  | ({
      readonly type: 'assistant.message'
      readonly messageId: string
      readonly blocks: readonly ContentBlock[]
    } & EventChannel)
  | ({
      readonly type: 'tool.started'
      readonly id: string
      readonly name: string
      readonly input?: unknown
    } & BlockAddress &
      EventChannel)
  | ({
      readonly type: 'tool.input_delta'
      readonly id: string
      readonly chunk: string
    } & BlockAddress &
      EventChannel)
  | ({
      readonly type: 'tool.updated'
      readonly id: string
      readonly name: string
      readonly input: unknown
    } & BlockAddress &
      EventChannel)
  | ({
      readonly type: 'tool.running'
      readonly id: string
    } & Partial<BlockAddress> &
      EventChannel)
  | ({
      readonly type: 'tool.progress'
      readonly id: string
      readonly channel: 'stdout' | 'stderr' | 'log'
      readonly chunk: string
    } & Partial<BlockAddress> &
      EventChannel)
  | ({
      readonly type: 'tool.completed'
      readonly id: string
      readonly name: string
      readonly ok: boolean
      readonly output: string
      readonly status?: string
    } & Partial<BlockAddress> &
      EventChannel)
  | {
      readonly type: 'run.completed'
      readonly sessionId?: string
      readonly model: string
      readonly durationMs: number
      readonly costUsd?: number
      readonly usage?: TokenUsage
    }
  | {
      readonly type: 'run.failed'
      readonly message: string
      readonly code?: string
      readonly sessionId?: string
      readonly model?: string
      readonly durationMs?: number
      readonly costUsd?: number
      readonly usage?: TokenUsage
    }
  | {
      readonly type: 'run.aborted'
      readonly message?: string
      readonly sessionId?: string
      readonly model?: string
    }
  | { readonly type: 'error'; readonly code?: string; readonly message: string }
  | ({
      readonly type: 'agent.message'
      readonly direction: 'received'
      readonly body: string
      readonly senderAgentId?: string
      readonly senderName?: string
      readonly source: 'peer' | 'coordinator'
    } & EventChannel)
  | {
      readonly type: 'workflow.started'
      readonly workflowToolUseId: string
      readonly name?: string
    }
  | {
      readonly type: 'workflow.progress'
      readonly workflowToolUseId: string
      readonly taskId?: string
      readonly phases?: unknown
      readonly agents?: unknown
      readonly workflowProgress?: unknown
    }
  | {
      readonly type: 'workflow.updated'
      readonly taskId: string
      readonly patch: unknown
    }
  | {
      readonly type: 'workflow.notification'
      readonly taskId: string
      readonly workflowToolUseId?: string
      readonly status: string
      readonly summary?: string
    }
  | {
      readonly type: 'workflow.agent'
      readonly agentId: string
      readonly prompt?: string
      readonly result?: string
    }
  | {
      readonly type: 'workflow.completed'
      readonly workflowToolUseId: string
      readonly status: string
    }
  | { readonly type: 'agent.started'; readonly agentId: string; readonly name?: string }
  | { readonly type: 'agent.completed'; readonly agentId: string; readonly ok?: boolean }
  | {
      readonly type: 'permission.requested'
      readonly requestId: string
      readonly tool: string
      readonly input?: unknown
    }
  | { readonly type: 'permission.resolved'; readonly requestId: string; readonly decision: string }
  | { readonly type: 'session.compacted'; readonly summary?: string }
  | { readonly type: 'suggestion.prompts'; readonly prompts: readonly string[] }
  | { readonly type: 'run.usage'; readonly usage: TokenUsage }
  | {
      readonly type: 'ext'
      readonly vendor: string
      readonly name: string
      readonly data?: unknown
    }

export interface StreamEnvelope {
  readonly v: typeof STREAM_PROTOCOL_VERSION
  readonly runId: string
  readonly seq: number
  readonly ts: number
  readonly sessionId?: string
  readonly harness: string
}

export type StreamFrame = StreamEnvelope & AgentEvent

export function isRunResultEvent(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: 'run.completed' | 'run.failed' | 'run.aborted' }> {
  return event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.aborted'
}

export function isRunTerminalEvent(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: 'run.failed' | 'run.aborted' | 'error' }> {
  return event.type === 'run.failed' || event.type === 'run.aborted' || event.type === 'error'
}

export function sessionIdOf(event: AgentEvent): string | undefined {
  if (!('sessionId' in event)) return undefined
  const sessionId = event.sessionId
  return typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
}
