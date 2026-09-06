import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractWorkflowAgentDetail, hydrateWorkflowResult, readWorkflowAgentDetail } from '../../../../src/provider/claude/session/claude-workflow-files.js'
import { mapClaudeMessage } from '../../../../src/provider/claude/session/claude-session-store.js'
import { replayClaudeSessionMessages } from '../../../../src/provider/claude/session/claude-thread-replay.js'
import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import { workflowLaunch, workflowSnapshot, workflowTranscript } from '../../../fixtures/claude-workflow.js'

describe('workflow history and detail files', () => {
  let root: string
  let transcript: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'workflow-history-'))
    transcript = join(root, 'session.jsonl')
    await mkdir(join(root, 'session', 'workflows'), { recursive: true })
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  it('restores the launch card and routes a later notification back to its original message', async () => {
    await writeFile(join(root, 'session', 'workflows', 'wf_test.json'), JSON.stringify(workflowSnapshot))
    const messages = await Promise.all(workflowTranscript.map(async (raw) => {
      const mapped = mapClaudeMessage(raw, 'session')
      return { ...mapped, message: await hydrateWorkflowResult(mapped.message, transcript) }
    }))
    const folded = foldThread(replayClaudeSessionMessages(messages))
    expect(folded.filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['Test a workflow', 'Another turn'])
    const workflows = folded.flatMap((message) => message.workflows ?? [])
    expect(workflows).toHaveLength(1)
    expect(workflows[0]).toMatchObject({ status: 'completed', workflowRunId: 'wf_test', agents: expect.any(Array) as unknown })
    expect(workflows[0]?.agents).toHaveLength(4)
    expect(folded.find((message) => message.content === 'Another answer.')?.workflows).toBeUndefined()
  })

  it('marks missing or malformed snapshots unavailable without inventing completion', async () => {
    const raw = { tool_use_result: workflowLaunch }
    const expected = { tool_use_result: { ...workflowLaunch, workflowSnapshot: { detailsUnavailable: true, status: 'unknown' } } }
    expect(await hydrateWorkflowResult(raw, transcript)).toEqual(expected)
    await writeFile(join(root, 'session', 'workflows', 'wf_test.json'), '{partial')
    expect(await hydrateWorkflowResult(raw, transcript)).toEqual(expected)
  })

  it('returns the full structured result in preference to assistant prose', async () => {
    const content = [
      { type: 'user', message: { content: 'Full prompt' } },
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'Preparing result' },
        { type: 'tool_use', name: 'StructuredOutput', input: { accepted: false, reason: 'Business rejection' } },
      ] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Finished' }] } },
    ].map((value) => JSON.stringify(value)).join('\n') + '\n{"partial'
    expect(extractWorkflowAgentDetail(content)).toMatchObject({ prompt: 'Full prompt', result: JSON.stringify({ accepted: false, reason: 'Business rejection' }, null, 2) })
    const folder = join(root, 'session', 'subagents', 'workflows', 'wf_test')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'agent-agent1.jsonl'), content)
    expect(await readWorkflowAgentDetail(transcript, 'wf_test', 'agent1')).toEqual(extractWorkflowAgentDetail(content))
    await expect(readWorkflowAgentDetail(transcript, 'wf_test', 'missing')).rejects.toMatchObject({ kind: 'session-not-found' })
  })

  it('joins tool results by ID and retains execution order while ignoring partial records', () => {
    const content = [
      { type: 'user', message: { content: 'Task' } },
      { type: 'assistant', message: { content: [
        { type: 'text', text: 'Reading files' },
        { type: 'tool_use', id: 'a', name: 'Read', input: { path: 'a.ts' } },
        { type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'test' } },
      ] } },
      { type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'b', content: 'failed', is_error: true },
        { type: 'tool_result', tool_use_id: 'a', content: 'file content' },
      ] } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n{"partial'
    expect(extractWorkflowAgentDetail(content)).toMatchObject({ prompt: 'Task', process: [
      { kind: 'message', text: 'Reading files' },
      { id: 'a', name: 'Read', text: JSON.stringify({ path: 'a.ts' }, null, 2), output: 'file content', isError: false },
      { id: 'b', name: 'Bash', output: 'failed', isError: true },
    ] })
    expect(extractWorkflowAgentDetail('')).toEqual({ prompt: null, result: null, process: [] })
  })

  it('includes recorded reasoning in order without treating it as final output or exposing opaque blocks', () => {
    const content = JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'thinking', thinking: 'Check the input before calling the tool.', signature: 'opaque-signature' },
      { type: 'redacted_thinking', data: 'opaque-data' },
      { type: 'thinking', thinking: '  ' },
      { type: 'tool_use', id: 'read', name: 'Read', input: { path: 'input.txt' } },
      { type: 'text', text: 'Finished.' },
    ] } })
    expect(extractWorkflowAgentDetail(content)).toEqual({ prompt: null, result: 'Finished.', process: [
      { id: 'thinking-0', kind: 'thinking', text: 'Check the input before calling the tool.' },
      { id: 'read', kind: 'tool', name: 'Read', text: JSON.stringify({ path: 'input.txt' }, null, 2) },
      { id: 'message-2', kind: 'message', text: 'Finished.' },
    ] })
  })

  it('rejects traversal and symlinks outside the selected session', async () => {
    await expect(readWorkflowAgentDetail(transcript, '../wf_other', 'agent1')).rejects.toMatchObject({ kind: 'invalid-request' })
    const outside = join(root, 'outside.json')
    await writeFile(outside, JSON.stringify(workflowSnapshot))
    await symlink(outside, join(root, 'session', 'workflows', 'wf_test.json'))
    await expect(hydrateWorkflowResult({ tool_use_result: workflowLaunch }, transcript)).rejects.toMatchObject({ kind: 'invalid-request' })
  })
})
