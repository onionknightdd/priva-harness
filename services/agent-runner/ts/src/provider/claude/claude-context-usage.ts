import type { Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'

import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import { emptyContextUsage, mapClaudeContextUsage } from '../../core/resource/context-usage.js'
import type { ContextUsage } from '../../core/resource/context-usage.js'
import { PushableStream } from '../../core/stream/pushable-stream.js'
import type { ToolDefinition } from '../../core/tool/define-tool.js'
import { resolveClaudeQueryOptions } from './claude-runtime.js'
import { PRODUCT_MCP_SERVER_NAME } from './tools/compile-custom-tools.js'

const CONTEXT_USAGE_INIT_TIMEOUT_MS = 15_000
const CONTEXT_USAGE_READ_TIMEOUT_MS = 8_000
const MCP_CONNECT_WAIT_TIMEOUT_MS = 5_000
const MCP_CONNECT_POLL_INTERVAL_MS = 200

export type ClaudeContextQuery = Pick<
  Query,
  'initializationResult' | 'getContextUsage' | 'mcpServerStatus' | 'close'
> & AsyncIterable<unknown>

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
    await withTimeout(active.initializationResult(), CONTEXT_USAGE_INIT_TIMEOUT_MS)
    const initial = mapClaudeContextUsage(
      await withTimeout(active.getContextUsage(), CONTEXT_USAGE_READ_TIMEOUT_MS),
    )
    if (tools.length === 0) return initial
    // Until the product MCP connects, Claude folds its tool schemas into
    // Messages. Re-read once it connects so MCP tools land in their own row.
    if (!(await waitForProductMcp(active))) return initial
    try {
      return mapClaudeContextUsage(
        await withTimeout(active.getContextUsage(), CONTEXT_USAGE_READ_TIMEOUT_MS),
      )
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

async function waitForProductMcp(active: ClaudeContextQuery): Promise<boolean> {
  const deadline = Date.now() + MCP_CONNECT_WAIT_TIMEOUT_MS
  for (;;) {
    let statuses
    try {
      statuses = await withTimeout(active.mcpServerStatus(), MCP_CONNECT_WAIT_TIMEOUT_MS)
    } catch {
      return false
    }
    const product = statuses.find((server) => server.name === PRODUCT_MCP_SERVER_NAME)
    if (product?.status === 'connected') return true
    if (product !== undefined && product.status !== 'pending') return false
    if (Date.now() >= deadline) return false
    await sleep(MCP_CONNECT_POLL_INTERVAL_MS)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('context usage timed out')), ms)
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
