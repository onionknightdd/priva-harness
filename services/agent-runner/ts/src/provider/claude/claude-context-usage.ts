import type { McpServerStatus, Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'

import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import { emptyContextUsage, mapClaudeContextUsage } from '../../core/resource/context-usage.js'
import type { ContextUsage } from '../../core/resource/context-usage.js'
import { PushableStream } from '../../core/stream/pushable-stream.js'
import type { ToolDefinition } from '../../core/tool/define-tool.js'
import { resolveClaudeQueryOptions } from './claude-runtime.js'

const MCP_CONTEXT_READY_TIMEOUT_MS = 2_000
const MCP_CONTEXT_READY_POLL_MS = 100
const MCP_STATUS_CALL_TIMEOUT_MS = 400

export type ClaudeContextQuery = Pick<Query, 'initializationResult' | 'getContextUsage' | 'close'>
  & Partial<Pick<Query, 'mcpServerStatus'>>
  & AsyncIterable<unknown>

export type ClaudeContextQueryStart = (args: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => ClaudeContextQuery

export function resolveClaudeContextQueryOptions(
  spec: ProviderRunSpec,
  sessionId: string,
  globalConfigDir: string,
  abortController?: AbortController,
  tools: readonly ToolDefinition[] = [],
): Options {
  return {
    ...resolveClaudeQueryOptions(
      spec,
      globalConfigDir,
      { kind: 'resume', session: { provider: 'claude', id: sessionId } },
      abortController,
      tools,
    ),
    persistSession: false,
  }
}

export async function measureClaudeContextUsage(options: {
  readonly spec: ProviderRunSpec
  readonly sessionId: string
  readonly globalConfigDir: string
  readonly tools?: readonly ToolDefinition[]
  readonly startQuery?: ClaudeContextQueryStart
}): Promise<ContextUsage> {
  const input = new PushableStream<SDKUserMessage>()
  const abortController = new AbortController()
  const startQuery = options.startQuery ?? ((args) => query(args))
  const tools = options.tools ?? []
  const active = startQuery({
    prompt: input,
    options: resolveClaudeContextQueryOptions(
      options.spec,
      options.sessionId,
      options.globalConfigDir,
      abortController,
      tools,
    ),
  })
  const drained = drainQuery(active)
  try {
    await active.initializationResult()
    const initial = mapClaudeContextUsage(await active.getContextUsage())
    if (tools.length === 0) return initial
    const mcpReady = await waitForConfiguredMcp(active, true)
    if (!mcpReady) return initial
    try {
      return mapClaudeContextUsage(await active.getContextUsage())
    } catch {
      return initial
    }
  } catch {
    return emptyContextUsage()
  } finally {
    input.close()
    active.close()
    abortController.abort()
    await drained
  }
}

async function waitForConfiguredMcp(
  active: Pick<ClaudeContextQuery, 'mcpServerStatus'>,
  configured: boolean,
): Promise<boolean> {
  if (!configured || active.mcpServerStatus === undefined) return false
  const deadline = Date.now() + MCP_CONTEXT_READY_TIMEOUT_MS
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) return false
      const status = await raceTimeout(
        active.mcpServerStatus(),
        Math.min(remaining, MCP_STATUS_CALL_TIMEOUT_MS),
      )
      if (status === undefined) return false
      if (mcpServersSettled(status)) return true
      await delay(MCP_CONTEXT_READY_POLL_MS)
    }
  } catch {
    return false
  }
  return false
}

function mcpServersSettled(status: readonly McpServerStatus[]): boolean {
  if (status.length === 0) return false
  return status.every((server) => server.status !== 'pending')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

async function drainQuery(active: AsyncIterable<unknown>): Promise<void> {
  try {
    for await (const _message of active) {
      void _message
    }
  } catch {
    return
  }
}
