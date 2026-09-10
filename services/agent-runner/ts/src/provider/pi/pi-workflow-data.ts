import { asRecord, numberField, stringField } from '../../core/event/json-record.js'
import { workflowStatus } from '../../core/resource/workflow-status.js'
import type { WorkflowAgent, WorkflowState } from '../../core/resource/workflow.js'

/** Pi snapshots use named phases and call identities; the UI uses numbered phases. */
export function piWorkflowState(toolId: string, raw: unknown, previous?: WorkflowState): WorkflowState {
  const data = asRecord(raw) ?? {}
  const phaseNames = Array.isArray(data['phases'])
    ? data['phases'].map((p) => typeof p === 'string' ? p : stringField(asRecord(p) ?? {}, 'title') ?? '').filter(Boolean)
    : previous?.phases.map((p) => p.title) ?? []
  const entries = Array.isArray(data['agents']) ? data['agents'] : []
  for (const entry of entries) {
    const phase = stringField(asRecord(entry) ?? {}, 'phase')
    if (phase && !phaseNames.includes(phase)) phaseNames.push(phase)
  }
  const agents: WorkflowAgent[] = entries.map((entry, offset) => {
    const a = asRecord(entry) ?? {}
    const id = stringField(a, 'callId') ?? String(numberField(a, 'id') ?? offset + 1)
    const prior = previous?.agents.find((item) => item.agentId === id)
    const phase = stringField(a, 'phase')
    const startedAt = timestamp(a['startedAt']) ?? prior?.startedAt
    const endedAt = timestamp(a['endedAt'])
    const usage = asRecord(a['tokenUsage'])
    // The scalar `tokens` can be an estimate, including on failed requests.
    const tokens = usage === undefined ? undefined : providerTokens(usage)
    const history = Array.isArray(a['history']) ? a['history'].map(asRecord) : []
    const calls = history.filter((h) => h?.['kind'] === 'toolCall' && !internalTool(String(h['toolName'])))
    const last = calls.at(-1)
    return {
      ...prior,
      index: numberField(a, 'id') ?? offset + 1,
      agentId: id,
      label: stringField(a, 'label') ?? `Agent ${offset + 1}`,
      state: workflowStatus(stringField(a, 'status')),
      ...(phase === undefined ? {} : { phaseIndex: phaseNames.indexOf(phase) + 1 }),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(startedAt === undefined || endedAt === undefined ? {} : { durationMs: Math.max(0, endedAt - startedAt) }),
      ...(tokens === undefined ? {} : { tokens }),
      ...(typeof a['model'] !== 'string' ? {} : { model: a['model'] }),
      ...(typeof a['prompt'] !== 'string' ? {} : { promptPreview: a['prompt'] }),
      ...(a['result'] === undefined ? {} : { resultPreview: renderWorkflowValue(a['result']) }),
      ...(typeof a['error'] !== 'string' ? {} : { error: a['error'] }),
      ...(last === undefined ? {} : { lastToolName: String(last['toolName']), lastToolSummary: stringField(last, 'text') ?? '' }),
    }
  })
  const status = stringField(data, 'status')
  const state = status === undefined ? previous?.status ?? 'running' : workflowStatus(status)
  const runId = stringField(data, 'runId') ?? previous?.workflowRunId
  const duration = numberField(data, 'durationMs')
  const usage = asRecord(data['tokenUsage'])
  const total = usage === undefined ? undefined : providerTokens(usage)
  const name = stringField(data, 'workflowName') ?? stringField(data, 'name') ?? previous?.name
  const summary = stringField(data, 'description') ?? previous?.summary
  return {
    ...previous,
    workflowToolUseId: toolId,
    ...(runId === undefined ? {} : { workflowRunId: runId }),
    ...(name === undefined ? {} : { name }),
    ...(summary === undefined ? {} : { summary }),
    // A resolved script may contain failed agents when it accepts null results.
    status: state === 'completed' && agents.some((a) => a.state === 'failed') ? 'failed' : state,
    phases: phaseNames.map((title, index) => ({ index: index + 1, title })),
    agents: entries.length ? agents : previous?.agents ?? [],
    ...(duration === undefined ? {} : { durationMs: duration }),
    ...(total === undefined ? {} : { totalTokens: total }),
  }
}

export function internalTool(name: string): boolean {
  return name.replaceAll('_', '').toLowerCase() === 'structuredoutput'
}

export function renderWorkflowValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
}

function timestamp(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

export function piWorkflowToolResult(toolId: string, name: string, result: unknown, previous?: WorkflowState, terminal = false): WorkflowState | undefined {
  if (name.toLowerCase() !== 'workflow') return undefined
  const details = asRecord(asRecord(result)?.['details'])
  if (!details) return undefined
  const hydrated = asRecord(details['workflowState'])
  if (hydrated) return { ...hydrated as unknown as WorkflowState, workflowToolUseId: toolId }
  return piWorkflowState(toolId, { ...details,
    status: details['background'] === true ? 'running' : terminal ? 'completed' : 'running',
  }, previous)
}

function providerTokens(usage: Record<string, unknown>): number | undefined {
  const total = ['input', 'output', 'cacheRead', 'cacheWrite'].reduce((sum, key) => sum + (numberField(usage, key) ?? 0), 0)
  return total > 0 ? total : undefined
}
