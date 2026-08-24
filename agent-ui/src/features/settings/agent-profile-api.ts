import {
  isQueueBehavior,
  type QueueBehavior,
} from "./agent-preferences"

const AGENT_PROFILE_API = "/api/sandbox/agent/profile"

type AgentProfileResponse = {
  queue_behavior: string
}

type ErrorResponse = {
  detail?: string
}

export type AgentProfile = {
  queueBehavior: QueueBehavior
}

export class AgentProfileApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "AgentProfileApiError"
    this.status = status
  }
}

export async function getAgentProfile(signal?: AbortSignal): Promise<AgentProfile> {
  return fromResponse(
    await requestJson<AgentProfileResponse>(
      AGENT_PROFILE_API,
      signal ? { signal } : undefined
    )
  )
}

export async function updateAgentProfileQueueBehavior(
  queueBehavior: QueueBehavior
): Promise<AgentProfile> {
  return fromResponse(
    await requestJson<AgentProfileResponse>(AGENT_PROFILE_API, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queue_behavior: queueBehavior }),
    })
  )
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)

  if (!response.ok) {
    let detail = response.statusText || `HTTP ${response.status}`

    try {
      const error = (await response.json()) as ErrorResponse
      if (error.detail) {
        detail = error.detail
      }
    } catch {
      // Keep the HTTP status text when the response has no JSON body.
    }

    throw new AgentProfileApiError(response.status, detail)
  }

  return (await response.json()) as T
}

function fromResponse(response: AgentProfileResponse): AgentProfile {
  if (!isQueueBehavior(response.queue_behavior)) {
    throw new AgentProfileApiError(
      500,
      "Agent profile queue_behavior is invalid"
    )
  }

  return { queueBehavior: response.queue_behavior }
}
