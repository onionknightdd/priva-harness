import { randomUUID } from 'node:crypto'
import {
  createCodemodeExtension,
  type ExtensionFactory,
  type ModelRegistry,
} from '@earendil-works/pi-coding-agent'

import type { ModelInvocation, ToolArtifact } from '../../core/event/agent-event.js'
import { asRecord, numberField } from '../../core/event/json-record.js'
import { writeGeneratedImage } from '../../core/tool/image-tool-shared.js'

interface ModelResult {
  readonly stopReason: string
  readonly errorMessage?: string
  readonly usage?: unknown
}

/** Keep Pi's executor and renderers; add product accounting at its public registry boundary. */
export function createProductCodemodeExtension(): ExtensionFactory {
  const native = createCodemodeExtension({ mode: 'on', models: true })
  return (pi) => native(new Proxy(pi, {
    get(target, key, receiver) {
      if (key !== 'registerTool') {
        const value: unknown = Reflect.get(target, key, receiver)
        return value
      }
      return (definition: Parameters<typeof pi.registerTool>[0]) => target.registerTool({
        ...definition,
        defaultActive: true,
        async execute(toolCallId, params, signal, onUpdate, ctx) {
          const calls: ModelInvocation[] = []
          const artifacts: ToolArtifact[] = []
          let nativeDetails: Record<string, unknown> = {}
          let resultContent: readonly unknown[] | undefined
          const details = () => ({ ...nativeDetails, harnessModelCalls: [...calls], harnessArtifacts: [...artifacts],
            ...(resultContent === undefined ? {} : { harnessResultContent: resultContent }) })
          const publish = () => onUpdate?.({ content: [], details: details() })
          async function saveImage(block: { mimeType: string; data: string }): Promise<ToolArtifact> {
            const path = await writeGeneratedImage({ cwd: ctx.cwd, mimeType: block.mimeType, bytes: Buffer.from(block.data, 'base64') })
            const artifact = { path, mimeType: block.mimeType }
            if (!artifacts.some((item) => item.path === path)) artifacts.push(artifact)
            return artifact
          }

          async function invoke<T extends ModelResult>(
            operation: ModelInvocation['operation'],
            model: { provider: string; id: string },
            run: () => Promise<T>,
            generatedArtifacts?: () => readonly ToolArtifact[],
          ): Promise<T> {
            const index = calls.length
            const startedAt = performance.now()
            const invocation: ModelInvocation = {
              id: randomUUID(), parentToolCallId: toolCallId, operation,
              provider: model.provider, model: model.id, status: 'running',
            }
            calls.push(invocation)
            publish()
            try {
              const result = await run()
              calls[index] = {
                ...invocation,
                status: result.stopReason === 'stop' ? 'completed' : result.stopReason === 'aborted' ? 'aborted' : 'failed',
                durationMs: Math.max(0, performance.now() - startedAt),
                ...invocationUsage(result),
                ...(result.errorMessage ? { error: result.errorMessage } : {}),
                ...(operation === 'classify' ? { result: asRecord(result)?.['answers'] } : {}),
                ...(generatedArtifacts ? { artifacts: generatedArtifacts() } : {}),
              }
              return result
            } catch (error) {
              calls[index] = {
                ...invocation, status: signal?.aborted ? 'aborted' : 'failed',
                durationMs: Math.max(0, performance.now() - startedAt),
                error: error instanceof Error ? error.message : String(error),
              }
              throw error
            } finally {
              publish()
            }
          }

          const registry = new Proxy(ctx.modelRegistry, {
            get(target, key) {
              if (key === 'classify') return (...args: Parameters<ModelRegistry['classify']>) =>
                invoke('classify', args[0], () => target.classify(...args))
              if (key === 'generateImages') return (...args: Parameters<ModelRegistry['generateImages']>) => {
                const invocationArtifacts: ToolArtifact[] = []
                return invoke('generateImages', args[0], async () => {
                  const result = await target.generateImages(...args)
                  try {
                    for (const block of result.output) if (block.type === 'image') {
                      invocationArtifacts.push(await saveImage(block))
                    }
                  } catch (error) {
                    return { ...result, stopReason: 'error' as const, errorMessage: `Could not save generated image: ${error instanceof Error ? error.message : String(error)}` }
                  }
                  return result
                }, () => invocationArtifacts)
              }
              const value: unknown = Reflect.get(target, key, target)
              const bound: unknown = typeof value === 'function' ? value.bind(target) : value
              return bound
            },
          })

          try {
            const result = await definition.execute(toolCallId, params, signal, (update) => {
              nativeDetails = asRecord(update.details) ?? {}
              onUpdate?.({ ...update, details: details() })
            }, new Proxy(ctx, {
              get(target, key, receiver) {
                const value: unknown = key === 'modelRegistry' ? registry : Reflect.get(target, key, receiver)
                return value
              },
            }))
            nativeDetails = asRecord(result.details) ?? {}
            try {
              resultContent = await Promise.all(result.content.map(async (block) =>
                block.type === 'image' ? { type: 'image', ...await saveImage(block) } : block))
            } catch (error) {
              return { ...result, isError: true, content: [...result.content, {
                type: 'text' as const, text: `Could not save Codemode image output: ${error instanceof Error ? error.message : String(error)}`,
              }], details: details() }
            }
            const saved = artifacts.length ? [{ type: 'text' as const, text: `Workspace images:\n${artifacts.map((artifact) => artifact.path).join('\n')}` }] : []
            return { ...result, content: [...result.content, ...saved], details: details() }
          } finally {
            // A custom entry survives even if the parent tool is cancelled before its result is saved.
            if (calls.length || artifacts.length) pi.appendEntry('harness-model-invocations', {
              parentToolCallId: toolCallId, modelCalls: calls, artifacts,
            })
          }
        },
      })
    },
  }))
}

function invocationUsage(result: ModelResult): Pick<ModelInvocation, 'usage' | 'costUsd' | 'pricingKnown'> {
  const usage = asRecord(result.usage)
  const raw = asRecord(result)
  const input = usage && numberField(usage, 'input')
  const output = usage && numberField(usage, 'output')
  const pricingKnown = raw?.['pricingKnown'] !== false
  const cost = usage && asRecord(usage['cost'])
  const costUsd = cost && numberField(cost, 'total')
  return {
    ...(input === undefined || output === undefined ? {} : {
      usage: { input, output, cacheRead: numberField(usage ?? {}, 'cacheRead') ?? 0, cacheWrite: numberField(usage ?? {}, 'cacheWrite') ?? 0 },
    }),
    ...(raw?.['pricingKnown'] === undefined ? {} : { pricingKnown }),
    ...(pricingKnown && costUsd !== undefined ? { costUsd } : {}),
  }
}
