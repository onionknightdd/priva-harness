import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractPiWorkflowDetail, loadPiWorkflow, piWorkflowRoot, readPiWorkflowAgent, savePiWorkflow } from '../../../../src/provider/pi/pi-workflow-files.js'
import type { WorkflowState } from '../../../../src/core/resource/workflow.js'

const rows = [
  { type: 'message', id: 'u', message: { role: 'user', content: [{ type: 'text', text: 'Read a file' }] } },
  { type: 'message', id: 'a', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Consider the input' }, { type: 'toolCall', id: 'call', name: 'read', arguments: { path: 'sample.txt' } }] } },
  { type: 'message', id: 'r', message: { role: 'toolResult', toolCallId: 'call', content: [{ type: 'text', text: '7 11' }], isError: false } },
  { type: 'message', id: 'f', message: { role: 'assistant', content: [{ type: 'text', text: '18' }, { type: 'toolCall', id: 'hidden', name: 'structured_output', arguments: { value: 18 } }] } },
]
const transcript = rows.map((r) => JSON.stringify(r)).join('\n')
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe('Pi workflow raw transcripts', () => {
  it('preserves full thinking and pairs tools by call ID, hiding internal schema tools', () => {
    const detail = extractPiWorkflowDetail(transcript)
    expect(detail).toMatchObject({ prompt: 'Read a file', result: '18' })
    expect(detail.process.map((p) => p.kind)).toEqual(['thinking', 'tool', 'message'])
    expect(detail.process[1]).toMatchObject({ id: 'call', name: 'read', output: '7 11', isError: false })
  })

  it('limits a retained thread to the entries belonging to this invocation', () => {
    expect(extractPiWorkflowDetail(transcript, new Set(['f'])).process).toEqual([{ id: 'f:0', kind: 'message', text: '18' }])
  })

  it('tolerates a trailing partial write but rejects corrupt interior rows', () => {
    expect(extractPiWorkflowDetail(transcript + '\n{"type":').result).toBe('18')
    expect(() => extractPiWorkflowDetail('{invalid}\n' + transcript)).toThrow(SyntaxError)
  })

  it('restores detail with scoped IDs and rejects cross-session and symlink access', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pi-workflow-test-')); roots.push(dir)
    const root = piWorkflowRoot(dir, 'session')
    await mkdir(root, { recursive: true })
    const file = join(root, 'agent.jsonl')
    await writeFile(file, transcript)
    const state: WorkflowState = { workflowToolUseId: 'tool', workflowRunId: 'run', status: 'completed', phases: [], agents: [{ index: 1, agentId: 'run:0', label: 'Agent', state: 'completed', promptPreview: 'Read', resultPreview: '18' }] }
    await savePiWorkflow(dir, { sessionId: 'session', state, transcripts: { 'run:0': [{ id: 'attempt', file, entryIds: rows.map((r) => r.id) }] } })
    expect((await readPiWorkflowAgent(dir, 'session', 'run', 'run:0')).process).toHaveLength(3)
    expect(await loadPiWorkflow(dir, 'other', 'run')).toBeUndefined()
    await expect(readPiWorkflowAgent(dir, 'session', 'run', '../other')).rejects.toMatchObject({ kind: 'session-not-found' })
    const outside = join(dir, 'outside.jsonl'); await writeFile(outside, transcript)
    await rm(file); await symlink(outside, file)
    await expect(readPiWorkflowAgent(dir, 'session', 'run', 'run:0')).rejects.toMatchObject({ kind: 'invalid-request' })
  })
})
