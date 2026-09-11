import { describe, expect, it } from 'vitest'
import { foldThread } from '../../../../src/core/resource/fold-thread.js'
import { ClaudeEventMapper } from '../../../../src/provider/claude/claude-event-mapper.js'
import { mapClaudeMessage } from '../../../../src/provider/claude/session/claude-session-store.js'
import { replayClaudeSessionMessages } from '../../../../src/provider/claude/session/claude-thread-replay.js'
import { transcriptThreadRecords } from '../../../../src/provider/claude/session/claude-transcript.js'

const user = (uuid: string, content: string, native = false) => ({ type: 'user', uuid,
  ...(native ? { origin: { kind: 'task-notification' } } : {}), message: { role: 'user', content } })
const assistant = (id: string, content: unknown[]) => ({ type: 'assistant', uuid: id, message: { id, role: 'assistant', content } })
const text = (value: string) => ({ type: 'text', text: value })
const call = (id: number) => ({ type: 'tool_use', id: `tool-${id}`, name: 'Agent', input: { description: `Worker ${id}`, run_in_background: true } })
const notice = (id: number, uuid = `notice-${id}`, output = `worker ${id} done`) => user(uuid,
  `<task-notification><task-id>task-${id}</task-id><tool-use-id>tool-${id}</tool-use-id><status>completed</status><summary>Worker ${id} finished</summary><result>${output}</result><usage><subagent_tokens>23</subagent_tokens><duration_ms>10</duration_ms></usage></task-notification>`, true)
const absorbed = (id: number, uuid = `absorbed-${id}`) => ({ type: 'attachment', uuid, attachment: {
  type: 'queued_command', commandMode: 'task-notification', prompt: notice(id).message.content,
} })
const replay = (records: unknown[]) => foldThread(replayClaudeSessionMessages(transcriptThreadRecords(records.map((record) => JSON.stringify(record)))
  .map((record) => mapClaudeMessage(record, 'session'))))

describe('task reply ownership', () => {
  it('groups an absorbed batch and its reply into an independent turn after a human question', () => {
    const messages = replay([user('u1', 'Start'), assistant('launch', [call(1), call(2), call(3), text('Started')]),
      user('u2', 'Done yet?'), assistant('human-reply', [text('Still running')]), notice(2),
      assistant('checking', [{ type: 'tool_use', id: 'list', name: 'ListAgents', input: {} }]),
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'list', content: 'All completed' }] } },
      absorbed(1), { type: 'queue-operation', operation: 'remove', reason: 'absorbed_mid_turn', content: notice(1).message.content },
      { type: 'queue-operation', operation: 'remove', reason: 'absorbed_mid_turn', content: notice(3).message.content }, absorbed(3),
      assistant('summary', [text('All three finished')]), user('u3', 'Next question'), assistant('next', [text('Next answer')])])
    expect(messages.map((message) => message.id)).toEqual(['u1', 'launch', 'u2', 'human-reply', 'task-turn:absorbed-1', 'u3', 'next'])
    expect(messages[3]?.content).toBe('Still running')
    expect(messages[4]?.blocks?.map((block) => block.type === 'task_notification' ? block.notification.id : block.type)).toEqual(['absorbed-1', 'absorbed-3', 'text'])
    expect(messages[4]?.content).toBe('All three finished')
    expect(messages[4]?.transcriptUuid).toBe('summary')
    expect(messages[4]?.blocks?.filter((block) => block.type === 'task_notification').map((block) => block.notification.turnId))
      .toEqual(['task-turn:absorbed-1', 'task-turn:absorbed-1'])
    const launch = messages[1]
    expect(launch?.blocks?.filter((block) => block.type === 'task_notification').map((block) => block.notification.id)).toEqual(['notice-2'])
    expect(launch?.blocks?.flatMap((block) => block.type === 'tool_use' && block.id !== 'list' ? [block.tool?.backgroundTask?.result] : []))
      .toEqual(['worker 1 done', 'worker 2 done', 'worker 3 done'])
  })

  it('starts another independent turn for a later absorbed batch and clears the target on real user input', () => {
    const messages = replay([user('u1', 'Start'), assistant('launch', [call(1), call(2)]),
      user('u2', 'Check'), assistant('checking', [text('Checking now')]), absorbed(1), absorbed(1),
      assistant('first-reply', [text('First finished')]), absorbed(2), assistant('second-reply', [text('Second finished')]),
      user('u3', 'Continue'), assistant('human-reply', [text('Human answer')])])
    expect(messages.map((message) => message.id)).toEqual(['u1', 'launch', 'u2', 'checking', 'task-turn:absorbed-1', 'task-turn:absorbed-2', 'u3', 'human-reply'])
    expect(messages[3]?.content).toBe('Checking now')
    expect(messages[4]?.blocks?.filter((block) => block.type === 'task_notification')).toHaveLength(1)
    expect(messages[5]?.content).toBe('Second finished')
  })

  it('keeps ten deliveries and their split assistant replies in their original bubble and native order', () => {
    const order = [5, 2, 1, 4, 3, 7, 6, 8, 10, 9]
    const records = [user('human', 'Start workers'), assistant('launch', [...order.map(call), text('Started')]),
      ...order.flatMap((id) => [notice(id), assistant(`reply-${id}`, [{ type: 'thinking', thinking: `Think ${id}` }]), assistant(`reply-${id}`, [text(`Acknowledged ${id}`)])]),
      user('next-human', 'Foreground work'), assistant('foreground', [call(11), text('Foreground answer')])]
    const messages = replay(records)
    expect(messages.map((message) => message.id)).toEqual(['human', 'launch', 'next-human', 'foreground'])
    const timeline = messages[1]?.blocks?.flatMap((block) => block.type === 'task_notification' ? [block.notification.task.result]
      : block.type === 'text' ? [block.text] : [])
    expect(timeline).toEqual(['Started', ...order.flatMap((id) => [`worker ${id} done`, `Acknowledged ${id}`])])
    const notifications = messages[1]?.blocks?.filter((block) => block.type === 'task_notification')
    expect(notifications).toHaveLength(10)
    expect(notifications?.[0]).toMatchObject({ notification: { id: 'notice-5', task: { tokens: 23, durationMs: 10 } } })
    expect(messages[1]?.blocks?.filter((block) => block.type === 'thinking')).toHaveLength(10)
  })

  it('keeps a real human reply independent even when an older task finishes later', () => {
    const messages = replay([user('u1', 'Start'), assistant('launch', [call(1), text('Started')]),
      user('u2', 'Hello'), assistant('human-reply', [text('Hello back')]), notice(1), assistant('followup', [text('Worker finished')])])
    expect(messages.map((message) => message.id)).toEqual(['u1', 'launch', 'u2', 'human-reply'])
    expect(messages[1]?.content).toBe('Worker finished')
    expect(messages[3]?.content).toBe('Hello back')
  })

  it('deduplicates a delivery UUID while retaining separate deliveries for a resumed task', () => {
    const messages = replay([assistant('launch', [call(1)]), notice(1), notice(1), assistant('first', [text('First reply')]),
      notice(1, 'second-delivery', 'Second\nresult'), assistant('second', [text('Second reply')])])
    const notifications = messages[0]?.blocks?.filter((block) => block.type === 'task_notification')
    expect(notifications?.map((block) => block.notification.task.result)).toEqual(['worker 1 done', 'Second\nresult'])
    expect(messages).toHaveLength(1)
  })

  it('does not infer reply ownership from lifecycle events or human-authored XML', () => {
    const mapper = new ClaudeEventMapper()
    mapper.push(assistant('launch', [call(1)]))
    mapper.push({ type: 'system', subtype: 'task_notification', task_id: 'task-1', tool_use_id: 'tool-1', status: 'completed' } as Parameters<typeof mapper.push>[0])
    expect(mapper.push(assistant('human-reply', [text('Normal reply')])).every((event) => event.replyTo === undefined)).toBe(true)
    const xml = notice(1).message.content
    const messages = replay([assistant('launch', [call(1)]), user('human', xml), assistant('answer', [text('About your XML')])])
    expect(messages.map((message) => message.role)).toEqual(['assistant', 'user', 'assistant'])
  })

  it('associates a batched response with all consumed notification IDs', () => {
    const mapper = new ClaudeEventMapper()
    mapper.push(assistant('launch', [call(1), call(2)]))
    mapper.push(notice(1)); mapper.push(notice(2))
    expect(mapper.push(assistant('reply', [text('Both done')]))[0]?.replyTo).toEqual({ taskId: 'task-2', toolUseId: 'tool-2', notificationIds: ['notice-1', 'notice-2'] })
  })

  it('retains literal result markup and clears old output when a later native delivery has no result', () => {
    const output = 'Example: <result>inner</result>\nActual end'
    const later = notice(1, 'failed')
    later.message.content = later.message.content.replace('<result>worker 1 done</result>', '').replace('<status>completed</status>', '<status>failed</status>')
    const messages = replay([assistant('launch', [call(1)]), notice(1, 'first', output), assistant('a1', [text('Done')]), later, assistant('a2', [text('Failed')])])
    const notifications = messages[0]?.blocks?.filter((block) => block.type === 'task_notification')
    expect(notifications?.map((block) => block.notification.task.result)).toEqual([output, null])
    expect(messages[0]?.blocks?.find((block) => block.type === 'tool_use')).toMatchObject({ tool: { backgroundTask: { status: 'failed', result: null } } })
  })
})
