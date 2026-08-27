import {
  STREAM_PROTOCOL_VERSION,
  sessionIdOf,
  type AgentEvent,
  type StreamFrame,
} from '../../core/event/agent-event.js'

export class EnvelopeStamper {
  private seq = 0
  private sessionId: string | undefined

  constructor(
    private readonly runId: string,
    private readonly harness: string,
    private readonly now: () => number = Date.now,
    initialSessionId?: string,
  ) {
    if (initialSessionId !== undefined && initialSessionId !== '') {
      this.sessionId = initialSessionId
    }
  }

  stamp(event: AgentEvent): StreamFrame {
    this.seq += 1
    const sessionId = sessionIdOf(event) ?? this.sessionId
    if (sessionId !== undefined) this.sessionId = sessionId
    return {
      ...withoutSessionId(event),
      v: STREAM_PROTOCOL_VERSION,
      runId: this.runId,
      seq: this.seq,
      ts: this.now(),
      harness: this.harness,
      ...(this.sessionId === undefined ? {} : { sessionId: this.sessionId }),
    }
  }
}

function withoutSessionId(event: AgentEvent): AgentEvent {
  if (!('sessionId' in event)) return event
  const { sessionId, ...rest } = event
  void sessionId
  return rest
}
