import type { Options, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'

import type { ProviderRunSpec } from '../../core/contract/agent-provider.js'
import { emptyContextUsage, mapClaudeContextUsage } from '../../core/resource/context-usage.js'
import type { ContextUsage } from '../../core/resource/context-usage.js'
import { PushableStream } from '../../core/stream/pushable-stream.js'
import type { ToolDefinition } from '../../core/tool/define-tool.js'
import { resolveClaudeQueryOptions } from './claude-runtime.js'

export type ClaudeContextQuery = Pick<Query, 'initializationResult' | 'getContextUsage' | 'close'>
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
  const active = startQuery({
    prompt: input,
    options: resolveClaudeContextQueryOptions(
      options.spec,
      options.sessionId,
      options.globalConfigDir,
      abortController,
      options.tools ?? [],
    ),
  })
  const drained = drainQuery(active)
  try {
    await active.initializationResult()
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

async function drainQuery(active: AsyncIterable<unknown>): Promise<void> {
  try {
    for await (const _message of active) {
      void _message
    }
  } catch {
    return
  }
}
