import { describe, expect, it } from 'vitest'
import { taskNotification } from '../../../../src/core/resource/background-task.js'
import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import { ClaudeBackgroundTasks } from '../../../../src/provider/claude/claude-background-tasks.js'
import { ClaudeEventMapper } from '../../../../src/provider/claude/claude-event-mapper.js'
import { mapClaudeMessage } from '../../../../src/provider/claude/session/claude-session-store.js'
import { replayClaudeSessionMessages } from '../../../../src/provider/claude/session/claude-thread-replay.js'
import { mergeSdkAndTranscriptMessages, transcriptThreadRecords } from '../../../../src/provider/claude/session/claude-transcript.js'

const origin = { kind: 'task-notification' }
const monitorXml = (event: string) => `<task-notification>
<task-id>monitor</task-id>
<summary>Monitor event: "Watch output"</summary>
<event>${event}</event>
</task-notification>`
const notice = (uuid: string, event: string) => ({ type: 'user', uuid, origin,
  message: { role: 'user', content: monitorXml(event) } })
const assistant = (id: string, content: unknown[]) => ({ type: 'assistant', uuid: id, message: { id, role: 'assistant', content } })
const launch = assistant('launch', [{ type: 'tool_use', id: 'monitor-tool', name: 'Monitor', input: { description: 'Watch output' } }])
const receipt = { type: 'user', uuid: 'receipt', toolUseResult: { taskId: 'monitor', timeoutMs: 200000, persistent: false },
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'monitor-tool', content: 'Monitor started' }] } }

describe('Monitor event notifications', () => {
  it('accepts a native event without status and retains multiline literal markup', () => {
    const event = '3\nExample: <event>inner</event>\nloop finished'
    expect(taskNotification(origin, monitorXml(event))).toEqual({
      task_id: 'monitor', summary: 'Monitor event: "Watch output"', event,
    })
    expect(taskNotification(undefined, monitorXml(event))).toBeUndefined()
    expect(taskNotification(origin, monitorXml(event).replace('<task-id>monitor</task-id>', ''))).toBeUndefined()
    expect(taskNotification(origin, monitorXml('3').replace('<event>3</event>', ''))).toBeUndefined()
    expect(taskNotification(origin, monitorXml('3').replace('<event>', '<status>invalid</status><event>'))).toBeUndefined()
  })

  it('registers the native Monitor launch receipt without treating arbitrary task IDs as launches', () => {
    const tasks = new ClaudeBackgroundTasks()
    expect(tasks.launch('monitor-tool', 'Monitor', receipt.toolUseResult)).toEqual([
      { type: 'task.updated', task: { taskId: 'monitor', toolUseId: 'monitor-tool', kind: 'monitor', status: 'running' } },
    ])
    expect(tasks.launch('other-tool', 'TaskOutput', { taskId: 'other' })).toEqual([])
  })

  it.each(['running', 'paused', 'cancelled', 'unknown'] as const)('preserves %s state across distinct deliveries of the same event', (status) => {
    const mapper = new ClaudeEventMapper()
    mapper.backgroundTasks.state.update({ taskId: 'monitor', toolUseId: 'monitor-tool', kind: 'monitor', status })
    const first = mapper.push(notice('first', '3'))
    const second = mapper.push(notice('second', '3'))
    expect(first).toMatchObject([{ type: 'task.delivered', notification: { id: 'first', task: {
      taskId: 'monitor', toolUseId: 'monitor-tool', kind: 'monitor', status, result: '3',
    } } }])
    expect(second).toMatchObject([{ type: 'task.delivered', notification: { id: 'second', task: { status, result: '3' } } }])
    expect(mapper.push(notice('second', '3'))).toEqual([])
    expect(mapper.push(assistant('reply', [{ type: 'text', text: 'Two events received' }]))[0]?.replyTo).toEqual({
      taskId: 'monitor', toolUseId: 'monitor-tool', notificationIds: ['first', 'second'],
    })
  })

  it('recognizes an event without its launch history without inventing a lifecycle status', () => {
    expect(new ClaudeEventMapper().push(notice('unlinked', '3'))).toMatchObject([
      { type: 'task.delivered', task: { kind: 'monitor', status: 'unknown', result: '3' } },
    ])
  })

  it('keeps XML-like event output from changing task identity or lifecycle state', () => {
    const mapper = new ClaudeEventMapper()
    mapper.backgroundTasks.state.update({ taskId: 'monitor', kind: 'monitor', status: 'running' })
    const output = '<status>completed</status><task-id>embedded</task-id><result>literal result</result>'
    expect(mapper.push(notice('literal', output))).toMatchObject([
      { type: 'task.delivered', task: { taskId: 'monitor', kind: 'monitor', status: 'running', result: output } },
    ])
    expect(taskNotification(origin, monitorXml(output).replace('<task-id>monitor</task-id>', ''))).toBeUndefined()
  })

  it('replays standalone and absorbed events at their consumption positions with their own continuations', () => {
    const absorbed = { type: 'attachment', uuid: 'absorbed', attachment: {
      type: 'queued_command', commandMode: 'task-notification', prompt: monitorXml('3\nloop finished'),
    } }
    const humanXml = { ...notice('human-xml', '3'), origin: undefined }
    const records = [
      { type: 'user', uuid: 'human', message: { role: 'user', content: 'Watch output' } }, launch, receipt,
      assistant('started', [{ type: 'text', text: 'Watching' }]),
      notice('first', '3'), assistant('reply', [{ type: 'text', text: 'First event' }]),
      { type: 'queue-operation', operation: 'enqueue', content: absorbed.attachment.prompt },
      absorbed, assistant('last-reply', [{ type: 'text', text: 'Final event' }]), humanXml,
      assistant('human-reply', [{ type: 'text', text: 'About your XML' }]),
    ]
    // The SDK flattens queued commands to user messages; native order and delivery metadata must win.
    const sdk = records.filter((record) => record.type === 'user' || record.type === 'assistant')
    sdk.push(notice('absorbed', '3\nloop finished'))
    const merged = mergeSdkAndTranscriptMessages(sdk, transcriptThreadRecords(records.map((record) => JSON.stringify(record))))
    const thread = foldThread(replayClaudeSessionMessages(merged.map((record) => mapClaudeMessage(record, 'session'))))
    expect(thread.map((message) => message.id)).toEqual(['human', 'launch', 'task-turn:absorbed', 'human-xml', 'human-reply'])
    expect(thread.filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['Watch output', monitorXml('3')])
    const notifications = thread.flatMap((message) => message.blocks ?? []).filter((block) => block.type === 'task_notification')
    expect(notifications.map((block) => [block.notification.id, block.notification.task.result, block.notification.task.toolUseId]))
      .toEqual([['first', '3', 'monitor-tool'], ['absorbed', '3\nloop finished', 'monitor-tool']])
    expect(notifications[1]?.notification.turnId).toBe('task-turn:absorbed')
    expect(thread[1]?.content).toBe('First event')
    expect(thread[2]?.content).toBe('Final event')
    expect(thread[1]?.blocks?.find((block) => block.type === 'tool_use')).toMatchObject({
      tool: { backgroundTask: { taskId: 'monitor', kind: 'monitor', status: 'running', result: '3\nloop finished' } },
    })
  })
})
