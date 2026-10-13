import type { AgentEvent, ModelInvocation, ToolArtifact, ToolResultMetadata } from '../../core/event/agent-event.js'
import { asRecord, numberField, stringField } from '../../core/event/json-record.js'

export function piToolResultMetadata(value: unknown): ToolResultMetadata {
  const result = asRecord(value)
  if (!result) return {}
  const details = asRecord(result['details'])
  const nested = asRecord(result['nestedCalls'])
  const modelCalls = modelInvocations(details?.['harnessModelCalls'])
  const artifacts = toolArtifacts(details?.['harnessArtifacts'])
  const content = details?.['harnessResultContent'] ?? result['content']
  return {
    ...(Array.isArray(content) ? { resultContent: content } : {}),
    ...(result['structuredContent'] === undefined ? {} : { structuredContent: result['structuredContent'] }),
    ...(modelCalls.length ? { modelCalls } : {}),
    ...(artifacts.length ? { artifacts } : {}),
    ...(typeof nested?.['complete'] === 'boolean' ? { nestedCallsComplete: nested['complete'] } : {}),
  }
}

export function modelInvocations(value: unknown): ModelInvocation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ModelInvocation[] => {
    const raw = asRecord(item)
    if (!raw) return []
    const id = stringField(raw, 'id'), parentToolCallId = stringField(raw, 'parentToolCallId')
    const provider = stringField(raw, 'provider'), model = stringField(raw, 'model')
    const operation = raw['operation'], status = raw['status']
    if (!id || !parentToolCallId || !provider || !model || (operation !== 'classify' && operation !== 'generateImages') ||
      (status !== 'running' && status !== 'completed' && status !== 'failed' && status !== 'aborted')) return []
    const usage = asRecord(raw['usage'])
    const input = usage && numberField(usage, 'input'), output = usage && numberField(usage, 'output')
    const durationMs = numberField(raw, 'durationMs'), costUsd = numberField(raw, 'costUsd'), error = stringField(raw, 'error')
    return [{ id, parentToolCallId, provider, model, operation, status,
      ...(input === undefined || output === undefined ? {} : { usage: { input, output,
        cacheRead: numberField(usage ?? {}, 'cacheRead') ?? 0, cacheWrite: numberField(usage ?? {}, 'cacheWrite') ?? 0 } }),
      ...(durationMs === undefined ? {} : { durationMs }), ...(costUsd === undefined ? {} : { costUsd }),
      ...(typeof raw['pricingKnown'] === 'boolean' ? { pricingKnown: raw['pricingKnown'] } : {}),
      ...(error === undefined ? {} : { error }), ...(raw['result'] === undefined ? {} : { result: raw['result'] }),
      ...(Array.isArray(raw['artifacts']) ? { artifacts: toolArtifacts(raw['artifacts']) } : {}),
    }]
  })
}

function toolArtifacts(value: unknown): ToolArtifact[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const raw = asRecord(item)
    const path = raw && stringField(raw, 'path'), mimeType = raw && stringField(raw, 'mimeType')
    return path && mimeType ? [{ path, mimeType }] : []
  })
}

/** Pi persists nested calls as a bounded summary on the outer result, not separate messages. */
export function replayPiNestedTools(value: unknown, rootId: string, messageId: string): AgentEvent[] {
  const nested = asRecord(asRecord(value)?.['nestedCalls'])
  if (!Array.isArray(nested?.['calls'])) return []
  return nested['calls'].flatMap((item): AgentEvent[] => {
    const raw = asRecord(item)
    if (!raw) return []
    const id = stringField(raw, 'id'), name = stringField(raw, 'name')
    if (!id || !name) return []
    const parentToolCallId = id.startsWith(`${rootId}/`) ? id.slice(0, id.lastIndexOf('/')) : rootId
    const durationMs = numberField(raw, 'durationMs')
    const status = stringField(raw, 'status')
    return [
      { type: 'tool.started', id, name, messageId, blockId: id, parentToolCallId,
        ...(raw['arguments'] === undefined ? {} : { input: raw['arguments'] }) },
      { type: 'tool.completed', id, name, messageId, blockId: id, parentToolCallId,
        ok: status === 'ok', output: stringField(raw, 'error') ?? '',
        ...(status === 'unfinished' ? { status: 'interrupted' } : {}),
        ...(durationMs === undefined ? {} : { durationMs }),
      },
    ]
  })
}
