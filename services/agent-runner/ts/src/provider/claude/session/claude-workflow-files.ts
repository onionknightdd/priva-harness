import { readFile, realpath } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { asRecord, stringField, type JsonRecord } from '../../../core/event/json-record.js'
import { SessionError } from '../../../core/resource/session.js'
import type { WorkflowAgentDetail, WorkflowExecutionEntry } from '../../../core/resource/workflow.js'

const RUN_ID = /^wf_[A-Za-z0-9_-]{1,64}$/u
const AGENT_ID = /^[A-Za-z0-9_-]{1,80}$/u

export async function hydrateWorkflowResult(raw: unknown, transcriptPath: string): Promise<unknown> {
  const envelope = asRecord(raw)
  if (envelope === undefined) return raw
  const result = asRecord(envelope['tool_use_result'] ?? envelope['toolUseResult'])
  const runId = result === undefined ? undefined : stringField(result, 'runId')
  if (runId === undefined || !RUN_ID.test(runId)) return raw
  const root = transcriptPath.replace(/\.jsonl$/u, '')
  const content = await readWithin(root, join(root, 'workflows', `${runId}.json`))
  let snapshot: JsonRecord | undefined
  if (content !== undefined) {
    try {
      snapshot = asRecord(JSON.parse(content) as unknown)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
  }
  if (snapshot !== undefined && (snapshot['runId'] !== runId || !Array.isArray(snapshot['workflowProgress']) || typeof snapshot['status'] !== 'string')) snapshot = undefined
  const workflowSnapshot = snapshot === undefined
    ? { detailsUnavailable: true, status: 'unknown' }
    : Object.fromEntries(['runId', 'taskId', 'workflowName', 'summary', 'status', 'phases',
      'workflowProgress', 'durationMs', 'totalTokens', 'totalToolCalls']
      .filter((key) => snapshot[key] !== undefined)
      .map((key) => [key, snapshot[key]]))
  return { ...envelope, tool_use_result: { ...result, workflowSnapshot } }
}

export async function readWorkflowAgentDetail(
  transcriptPath: string, runId: string, agentId: string,
): Promise<WorkflowAgentDetail> {
  if (!RUN_ID.test(runId) || !AGENT_ID.test(agentId)) {
    throw new SessionError('invalid-request', 'Invalid workflow or agent identifier')
  }
  const root = transcriptPath.replace(/\.jsonl$/u, '')
  const content = await readWithin(root, join(root, 'subagents', 'workflows', runId, `agent-${agentId}.jsonl`))
  if (content === undefined) throw new SessionError('session-not-found', 'Workflow agent transcript is not available')
  return extractWorkflowAgentDetail(content)
}

export function extractWorkflowAgentDetail(content: string): WorkflowAgentDetail {
  const process: WorkflowExecutionEntry[] = []
  const tools = new Map<string, number>()
  const render = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  let prompt: string | null = null
  let result: string | null = null
  let structured: string | null = null
  for (const line of content.split('\n')) {
    if (line.trim() === '') continue
    let record: JsonRecord | undefined
    try { record = asRecord(JSON.parse(line) as unknown) } catch (error) {
      // A running transcript can end with an incomplete JSON record.
      if (error instanceof SyntaxError) continue
      throw error
    }
    const message = asRecord(record?.['message'])
    if (message === undefined) continue
    const blocks = message['content']
    const text = typeof blocks === 'string' ? blocks : Array.isArray(blocks)
      ? blocks.map((block) => stringField(asRecord(block) ?? {}, 'text') ?? '').filter((value) => value !== '').join('\n') : ''
    if (record?.['type'] === 'user' && prompt === null && text !== '') prompt = text
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        const item = asRecord(block)
        if (item === undefined) continue
        if (record?.['type'] === 'assistant' && item['type'] === 'tool_use') {
          const id = stringField(item, 'id') ?? `tool-${process.length}`
          const entry: WorkflowExecutionEntry = { id, kind: 'tool', name: stringField(item, 'name') ?? 'Tool', text: render(item['input']) }
          const existing = tools.get(id)
          if (existing === undefined) { tools.set(id, process.length); process.push(entry) }
          else process[existing] = { ...process[existing], ...entry }
        } else if (item['type'] === 'tool_result') {
          const index = tools.get(stringField(item, 'tool_use_id') ?? '')
          const entry = index === undefined ? undefined : process[index]
          if (entry !== undefined && index !== undefined) {
            process[index] = { ...entry, output: render(item['content']), isError: item['is_error'] === true }
          }
        } else if (record?.['type'] === 'assistant' && item['type'] === 'thinking' && typeof item['thinking'] === 'string' && item['thinking'].trim() !== '') {
          process.push({ id: `thinking-${process.length}`, kind: 'thinking', text: item['thinking'] })
        } else if (record?.['type'] === 'assistant' && item['type'] === 'text' && typeof item['text'] === 'string') {
          process.push({ id: `message-${process.length}`, kind: 'message', text: item['text'] })
        }
      }
    } else if (record?.['type'] === 'assistant' && text !== '') {
      process.push({ id: `message-${process.length}`, kind: 'message', text })
    }
    if (record?.['type'] !== 'assistant') continue
    if (text !== '') result = text
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      const item = asRecord(block)
      if (item?.['type'] === 'tool_use' && item['name'] === 'StructuredOutput' && item['input'] !== undefined) {
        structured = JSON.stringify(item['input'], null, 2)
      }
    }
  }
  return { prompt, result: structured ?? result, process }
}

async function readWithin(root: string, path: string): Promise<string | undefined> {
  try {
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(root), realpath(path)])
    if (!resolvedFile.startsWith(resolvedRoot + sep) || dirname(resolvedFile) === resolvedRoot) {
      throw new SessionError('invalid-request', 'Workflow path is outside the session')
    }
    return await readFile(resolvedFile, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
