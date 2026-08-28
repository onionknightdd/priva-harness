import type { AgentRunHarness } from "./sandbox-sessions"

const SLASH_COMMANDS_API = "/api/sandbox/agent/slash-commands"

export type SlashKind = "command" | "skill"

export type SlashOrigin = "builtin" | "user" | "project"

export type SlashCommand = {
  name: string
  description: string
  argumentHint?: string
  aliases?: readonly string[]
  kind: SlashKind
  origin: SlashOrigin
}

export class SlashCommandsApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "SlashCommandsApiError"
    this.status = status
  }
}

type SlashCommandResponse = {
  name: string
  description: string
  argument_hint?: string
  aliases?: string[]
  kind: SlashKind
  origin: SlashOrigin
}

type SlashCommandListResponse = {
  harness: AgentRunHarness
  cwd: string
  commands: SlashCommandResponse[]
}

type ErrorResponse = {
  detail?: string
}

export function listSlashCommands(
  harness: AgentRunHarness,
  cwd: string,
  signal?: AbortSignal
) {
  const query = new URLSearchParams({ harness, cwd })
  return requestJson<SlashCommandListResponse>(
    `${SLASH_COMMANDS_API}?${query}`,
    { signal }
  ).then((payload) => payload.commands.map(mapSlashCommand))
}

function mapSlashCommand(command: SlashCommandResponse): SlashCommand {
  return {
    name: command.name,
    description: command.description,
    kind: command.kind,
    origin: command.origin,
    ...(command.argument_hint === undefined
      ? {}
      : { argumentHint: command.argument_hint }),
    ...(command.aliases === undefined ? {} : { aliases: command.aliases }),
  }
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init })

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

    throw new SlashCommandsApiError(response.status, detail)
  }

  return (await response.json()) as T
}
