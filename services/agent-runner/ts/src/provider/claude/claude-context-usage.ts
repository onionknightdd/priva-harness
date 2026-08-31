import type { McpServerStatus, Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'

import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import { emptyContextUsage, mapClaudeContextUsage } from '../../core/resource/context-usage.js'
import type { ContextUsage } from '../../core/resource/context-usage.js'
import { PushableStream } from '../../core/stream/pushable-stream.js'
import type { ToolDefinition } from '../../core/tool/define-tool.js'
import { resolveClaudeQueryOptions } from './claude-runtime.js'

const MCP_CONTEXT_READY_TIMEOUT_MS = 8_000
const MCP_CONTEXT_READY_POLL_MS = 100

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
    // SDK MCP servers connect after initialize. getContextUsage() before that
    // omits the "MCP tools" category; Claude then folds those tokens into Messages.
    await waitForConfiguredMcp(active, tools.length > 0)
    return mapClaudeContextUsage(await active.getContextUsage())
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
): Promise<void> {
  if (!configured || active.mcpServerStatus === undefined) return
  const deadline = Date.now() + MCP_CONTEXT_READY_TIMEOUT_MS
  try {
    while (Date.now() < deadline) {
      const status = await active.mcpServerStatus()
      if (mcpServersSettled(status)) return
      await delay(MCP_CONTEXT_READY_POLL_MS)
    }
  } catch {
    return
  }
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

async function drainQuery(active: AsyncIterable<unknown>): Promise<void> {
  try {
    for await (const _message of active) {
      void _message
    }
  } catch {
    return
  }
}
