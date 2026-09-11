import { describe, expect, it } from 'vitest'
import { ClaudeEventMapper } from '../../../../src/provider/claude/claude-event-mapper.js'
import { ClaudeBackgroundTasks } from '../../../../src/provider/claude/claude-background-tasks.js'
import { BackgroundTasks, taskNotification } from '../../../../src/core/resource/background-task.js'
import { mergeSdkAndTranscriptMessages } from '../../../../src/provider/claude/session/claude-transcript.js'
import { mapClaudeMessage } from '../../../../src/provider/claude/session/claude-session-store.js'
import { replayClaudeSessionMessages } from '../../../../src/provider/claude/session/claude-thread-replay.js'
import { foldThread } from '../../../../src/core/resource/fold-thread.js'

const xml = '<task-notification>\n<task-id>job</task-id>\n<tool-use-id>tool</tool-use-id>\n<status>completed</status>\n<summary>done</summary>\n<output-file>/tmp/job.output</output-file>\n</task-notification>'
const origin = { kind: 'task-notification' }

describe('background task notifications', () => {
  it('preserves terminal evidence when membership snapshots arrive out of order', () => {
    const tasks = new BackgroundTasks()
    tasks.update({ taskId: 'job', kind: 'bash', status: 'running', toolUseId: 'tool' })
    expect(tasks.snapshot([])[0]?.status).toBe('unknown')
    tasks.update({ taskId: 'job', kind: 'other', status: 'completed' })
    tasks.snapshot([{ taskId: 'job', kind: 'bash', status: 'running' }])
    expect(tasks.list()).toEqual([{ taskId: 'job', kind: 'bash', status: 'completed', toolUseId: 'tool' }])
    expect(tasks.hasActive).toBe(false)
  })

  it('maps Bash launch IDs and output paths, and excludes ambient tasks', () => {
    const mapper = new ClaudeBackgroundTasks()
    expect(mapper.launch('tool', 'Bash', { backgroundTaskId: 'job' }, 'Command running in background with ID: job. Output is being written to: /tmp/a b/job.output. You will be notified when it completes.')).toMatchObject([
      { type: 'task.updated', task: { taskId: 'job', kind: 'bash', status: 'running', outputFile: '/tmp/a b/job.output' } },
    ])
    mapper.push({ subtype: 'background_tasks_changed', tasks: [{ task_id: 'ambient', ambient: true }] }, new Map())
    expect(mapper.state.list().some((task) => task.taskId === 'ambient')).toBe(false)
    const stopped = mapper.push({ subtype: 'task_notification', task_id: 'job', status: 'stopped', output_file: '/tmp/job.output' }, new Map())
    expect(stopped).toMatchObject([{ type: 'task.notification', task: { toolUseId: 'tool', status: 'cancelled' } }])
  })

  it('keeps a long-running Monitor independent of response completion', () => {
    const mapper = new ClaudeEventMapper()
    mapper.push({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 'monitor', task_type: 'monitor', description: 'Watch' }] } as Parameters<ClaudeEventMapper['push']>[0])
    mapper.push({ type: 'result', subtype: 'success', duration_ms: 1 })
    expect(mapper.backgroundTasks.state.hasActive).toBe(true)
  })

  it('retains origin from raw transcript and hides only native notices, associating native replies with their task', () => {
    const records = [
      { type: 'user', uuid: 'u', message: { role: 'user', content: 'start' } },
      { type: 'assistant', uuid: 'a', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool', name: 'Bash', input: { run_in_background: true } }, { type: 'text', text: 'launched' }] } },
      { type: 'user', uuid: 'n', origin, message: { role: 'user', content: xml } },
      { type: 'assistant', uuid: 'b', message: { role: 'assistant', content: [{ type: 'text', text: 'finished' }] } },
      { type: 'user', uuid: 'human', message: { role: 'user', content: xml } },
    ]
    const sdk = records.map(({ origin: _origin, ...rest }) => { void _origin; return rest })
    const merged = mergeSdkAndTranscriptMessages(sdk, records)
    const messages = merged.map((record) => mapClaudeMessage(record, 's'))
    expect(messages.find((message) => message.uuid === 'n')?.origin).toEqual(origin)
    const folded = foldThread(replayClaudeSessionMessages(messages))
    expect(folded.filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['start', xml])
    expect(folded.filter((message) => message.role === 'assistant')).toHaveLength(1)
    expect(folded[1]?.blocks?.map((block) => block.type)).toEqual(['tool_use', 'text', 'task_notification', 'text'])
    expect(folded.flatMap((message) => message.blocks ?? []).find((block) => block.type === 'tool_use')).toMatchObject({ tool: { backgroundTask: { status: 'completed' } } })
    expect(taskNotification(undefined, xml)).toBeUndefined()
    expect(taskNotification(origin, '<task-notification>malformed</task-notification>')).toBeUndefined()
  })
})
