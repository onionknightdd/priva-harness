import { readFile, mkdir, rename, writeFile, realpath } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, sep } from 'node:path'
import { asRecord, stringField } from '../../core/event/json-record.js'
import type { WorkflowAgentDetail, WorkflowExecutionEntry, WorkflowState } from '../../core/resource/workflow.js'
import { SessionError } from '../../core/resource/session.js'
import { internalTool, renderWorkflowValue } from './pi-workflow-data.js'

export interface PiWorkflowTranscript {
  readonly id: string
  readonly file: string
  readonly entryIds: readonly string[]
  readonly toolCalls?: number
}

export interface PiWorkflowRecord {
  readonly sessionId: string
  readonly state: WorkflowState
  readonly transcripts: Readonly<Record<string, readonly PiWorkflowTranscript[]>>
}

export function piWorkflowRoot(agentDir: string, sessionId: string): string {
  return join(agentDir, 'workflow-data', digest(sessionId))
}

function recordPath(root: string, runId: string): string { return join(root, `${digest(runId)}.json`) }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }

export async function savePiWorkflow(agentDir: string, record: PiWorkflowRecord): Promise<void> {
  const runId = record.state.workflowRunId
  if (!runId) throw new Error('Cannot persist a workflow without a run id')
  const root = piWorkflowRoot(agentDir, record.sessionId)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const target = recordPath(root, runId)
  const temp = `${target}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(record), { mode: 0o600 })
  await rename(temp, target)
}

export async function loadPiWorkflow(agentDir: string, sessionId: string, runId: string): Promise<PiWorkflowRecord | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(recordPath(piWorkflowRoot(agentDir, sessionId), runId), 'utf8'))
    const record = asRecord(raw)
    const state = asRecord(record?.['state'])
    if (record?.['sessionId'] !== sessionId || state?.['workflowRunId'] !== runId || !Array.isArray(state['agents']) || !Array.isArray(state['phases'])) {
      throw new SessionError('io-failure', 'Invalid Pi workflow record')
    }
    return raw as PiWorkflowRecord
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function readPiWorkflowAgent(agentDir: string, sessionId: string, runId: string, agentId: string): Promise<WorkflowAgentDetail> {
  const record = await loadPiWorkflow(agentDir, sessionId, runId)
  const agent = record?.state.agents.find((item) => item.agentId === agentId)
  if (!record || !agent) throw new SessionError('session-not-found', 'Workflow agent not found in this session')
  const files = record.transcripts[agentId] ?? []
  const process: WorkflowExecutionEntry[] = []
  const root = await realpath(piWorkflowRoot(agentDir, sessionId))
  for (const [attempt, transcript] of files.entries()) {
    const resolved = await realpath(transcript.file)
    if (!resolved.startsWith(root + sep)) throw new SessionError('invalid-request', 'Agent transcript is outside this session')
    const detail = extractPiWorkflowDetail(await readFile(resolved, 'utf8'), new Set(transcript.entryIds))
    process.push(...detail.process.map((entry) => ({ ...entry, id: `${attempt}:${entry.id}` })))
  }
  return { prompt: agent.promptPreview ?? null, result: agent.resultPreview ?? null, process }
}

export function extractPiWorkflowDetail(content: string, entryIds?: ReadonlySet<string>): WorkflowAgentDetail {
  const process: WorkflowExecutionEntry[] = []
  const tools = new Map<string, number>()
  let prompt: string | null = null
  let result: string | null = null
  const lines = content.trimEnd().split('\n')
  for (const [lineIndex, line] of lines.entries()) {
    if (!line.trim()) continue
    let row: Record<string, unknown> | undefined
    try { row = asRecord(JSON.parse(line) as unknown) } catch (error) {
      if (error instanceof SyntaxError && lineIndex === lines.length - 1) break
      throw error
    }
    if (entryIds && !entryIds.has(stringField(row ?? {}, 'id') ?? '')) continue
    const message = asRecord(row?.['message'])
    if (!message) continue
    const blocks = Array.isArray(message['content']) ? message['content'].map(asRecord).filter((b) => b !== undefined) : []
    const text = typeof message['content'] === 'string' ? message['content'] : blocks.map((b) => stringField(b, 'text')).filter((text) => text !== undefined).join('\n')
    if (message['role'] === 'user' && prompt === null) prompt = text
    if (message['role'] === 'toolResult') {
      const index = tools.get(String(message['toolCallId']))
      const entry = index === undefined ? undefined : process[index]
      if (index !== undefined && entry) process[index] = { ...entry, output: text, isError: message['isError'] === true }
    }
    if (message['role'] !== 'assistant') continue
    if (text) result = text
    for (const [index, b] of blocks.entries()) {
      const id = `${stringField(row ?? {}, 'id') ?? String(lineIndex)}:${index}`
      if (b['type'] === 'thinking' && typeof b['thinking'] === 'string' && b['thinking'].trim()) process.push({ id, kind: 'thinking', text: b['thinking'] })
      if (b['type'] === 'text' && typeof b['text'] === 'string' && b['text']) process.push({ id, kind: 'message', text: b['text'] })
      if (b['type'] === 'toolCall' && !internalTool(String(b['name']))) {
        const callId = stringField(b, 'id') ?? id
        tools.set(callId, process.length)
        process.push({ id: callId, kind: 'tool', name: String(b['name']), text: renderWorkflowValue(b['arguments']) })
      }
    }
    if (typeof message['errorMessage'] === 'string') process.push({ id: `error:${lineIndex}`, kind: 'message', text: message['errorMessage'], isError: true })
  }
  return { prompt, result, process }
}
