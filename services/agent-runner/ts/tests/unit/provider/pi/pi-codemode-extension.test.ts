import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExtensionAPI, ExtensionToolContext, ModelRegistry, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { createProductCodemodeExtension } from '../../../../src/provider/pi/pi-codemode-extension.js'
import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import { replayPiSessionMessages } from '../../../../src/provider/pi/pi-thread-replay.js'
import type { SessionMessage } from '../../../../src/core/resource/session.js'
import { piToolResultMetadata } from '../../../../src/provider/pi/pi-tool-result.js'

const folders: string[] = []
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))) })

async function fixture(classify?: ModelRegistry['classify']) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'pi-codemode-'))
  folders.push(cwd)
  let tool: ToolDefinition | undefined
  const entries: { type: string; data: unknown }[] = []
  const api = {
    registerTool(definition: ToolDefinition) { tool = definition },
    getAllTools: () => [], getSettings: () => ({}),
    appendEntry(type: string, data: unknown) { entries.push({ type, data }) },
  } as unknown as ExtensionAPI
  await createProductCodemodeExtension()(api)
  if (!tool) throw new Error('Codemode was not registered')
  const registry = {
    getModelOfType: (type: string, provider: string, id: string) => ({ type, provider, id, api: 'probe', input: ['text'], name: id }),
    classify: classify ?? ((model: { provider: string; id: string }) => Promise.resolve({
      provider: model.provider, model: model.id, answers: { accepted: { type: 'bool', probability: 1 } }, stopReason: 'stop',
      usage: { input: 4, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0.01, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.02 } },
    })),
    generateImages: (model: { provider: string; id: string }) => Promise.resolve({
      provider: model.provider, model: model.id, stopReason: 'stop', pricingKnown: false,
      output: [{ type: 'image', mimeType: 'image/png', data: PNG }],
      usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }),
  }
  // Real Pi contexts also expose inherited getters; spreading them loses tools.
  const ctx = Object.create({ tools: [], modelRegistry: registry, sessionManager: { getBranch: () => [] } }) as ExtensionToolContext
  Object.assign(ctx, { cwd })
  return { tool, ctx, cwd, entries }
}

const classifySource = 'models.classify({provider:"probe",id:"judge"}, {state:{},questions:{accepted:{type:"bool",instructions:"Accept it",criteria:{true:"yes",false:"no"}}}})'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrNsAAAAASUVORK5CYII='

describe('product native Codemode extension', () => {
  it('runs the native sandbox and attributes parallel model calls without changing the parent usage', async () => {
    const { tool, ctx, entries } = await fixture()
    const updates: unknown[] = []
    const result = await tool.execute('outer', { code: `const results = await Promise.all(Array.from({length:6}, () => ${classifySource})); return results.length;` },
      new AbortController().signal, (update) => updates.push(update), ctx)
    expect(result.isError).not.toBe(true)
    expect(tool.defaultActive).toBe(true)
    const calls = piToolResultMetadata(result).modelCalls ?? []
    expect(calls).toHaveLength(6)
    expect(new Set(calls.map((call) => call.id)).size).toBe(6)
    expect(calls).toEqual(expect.arrayContaining([expect.objectContaining({ parentToolCallId: 'outer', provider: 'probe', model: 'judge', status: 'completed', costUsd: 0.02, usage: { input: 4, output: 1, cacheRead: 0, cacheWrite: 0 } })]))
    expect(result.usage?.input).toBe(24)
    expect(result.usage?.cost.total).toBeCloseTo(0.12)
    expect(entries).toHaveLength(1)
    expect(updates.some((update) => piToolResultMetadata(update).modelCalls?.some((call) => call.status === 'running'))).toBe(true)
  })

  it('persists native generated image output as a workspace artifact and preserves unknown pricing', async () => {
    const { tool, ctx, cwd, entries } = await fixture()
    const result = await tool.execute('image-call', { code: 'const result = await models.generateImages({provider:"probe",id:"painter"},{input:[{type:"text",text:"a dot"}]}); image(result.output[0]);' },
      new AbortController().signal, undefined, ctx)
    expect(result.isError).not.toBe(true)
    const metadata = piToolResultMetadata(result)
    expect(metadata.modelCalls?.[0]).toMatchObject({ operation: 'generateImages', pricingKnown: false, status: 'completed' })
    expect(metadata.modelCalls?.[0]).not.toHaveProperty('costUsd')
    const artifact = metadata.artifacts?.[0]
    expect(artifact?.path.startsWith(path.join(cwd, '.images'))).toBe(true)
    if (!artifact) throw new Error('Missing image artifact')
    expect(await readFile(artifact.path)).toEqual(Buffer.from(PNG, 'base64'))
    expect(result.content.some((block) => block.type === 'image')).toBe(true)
    expect(metadata.resultContent?.find((block) => typeof block === 'object' && block !== null && 'type' in block && block.type === 'image')).toEqual({ type: 'image', ...artifact })
    expect(JSON.stringify(metadata.resultContent)).not.toContain(PNG)
    const entry = (type: SessionMessage['type'], uuid: string, message: unknown): SessionMessage => ({ type, uuid, message, sessionId: 's', parentToolUseId: null, metadata: null, timestamp: 1 })
    const replay = foldThread(replayPiSessionMessages([
      entry('assistant', 'a', { content: [{ type: 'toolCall', id: 'image-call', name: 'codemode' }] }),
      ...entries.map((saved, index) => entry('custom', `custom-${index}`, { customType: saved.type, data: saved.data })),
      entry('tool_result', 'r', { ...result, role: 'toolResult', toolCallId: 'image-call', toolName: 'codemode' }),
    ]))
    const restored = replay[0]?.blocks?.find((block) => block.type === 'tool_use')?.tool
    expect(restored).toMatchObject({ status: 'completed', ok: true, artifacts: [artifact],
      modelCalls: [{ status: 'completed', pricingKnown: false, artifacts: [artifact] }] })
    expect(JSON.stringify(restored?.resultContent)).not.toContain(PNG)
  })

  it('preserves cancelled model usage and records the cancelled invocation', async () => {
    const { tool, ctx } = await fixture(() => Promise.resolve({ provider: 'probe', model: 'judge', api: 'openai-decisions', timestamp: Date.now(), answers: {}, stopReason: 'aborted',
      errorMessage: 'cancelled', usage: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } } }))
    const result = await tool.execute('cancelled-call', { code: `return (await ${classifySource}).stopReason;` }, new AbortController().signal, undefined, ctx)
    expect(piToolResultMetadata(result).modelCalls?.[0]).toMatchObject({ status: 'aborted', costUsd: 0.01, error: 'cancelled' })
    expect(result.usage?.cost.total).toBe(0.01)
  })

  it('propagates cancellation into an in-flight native model call before persisting its audit', async () => {
    let notifyStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => { notifyStarted = resolve })
    const { tool, ctx, entries } = await fixture((_model, _context, options) => new Promise((resolve) => {
      options?.signal?.addEventListener('abort', () => resolve({ provider: 'probe', model: 'judge', api: 'openai-decisions', timestamp: Date.now(),
        answers: {}, stopReason: 'aborted', errorMessage: 'cancelled while calling',
        usage: { input: 2, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 } },
      }), { once: true })
      notifyStarted()
    }))
    const controller = new AbortController()
    const pending = tool.execute('cancel-inflight', { code: `return await ${classifySource};` }, controller.signal, undefined, ctx)
    await started
    controller.abort()
    const result = await pending
    expect(piToolResultMetadata(result).modelCalls?.[0]).toMatchObject({ status: 'aborted', costUsd: 0.01 })
    expect(entries).toHaveLength(1)
    expect(result.usage?.cost.total).toBe(0.01)
  })
})
