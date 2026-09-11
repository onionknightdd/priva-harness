import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeTaskDeliveryReader } from '../../../../src/provider/claude/session/claude-task-delivery-reader.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
const notice = (id: string) => ({ type: 'user', uuid: id, origin: { kind: 'task-notification' }, message: { content:
  `<task-notification><task-id>worker</task-id><status>completed</status><result>实际输出 ${id}</result></task-notification>` } })
const answer = (id: string) => ({ type: 'assistant', message: { id, content: [{ type: 'text', text: 'Response' }] } })
const lines = (...records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\n') + '\n'

describe('native task delivery reader', () => {
  it('binds consumed attachments to the following assistant and ignores enqueue/removal bookkeeping', async () => {
    const root = await mkdtemp(join(tmpdir(), 'task-delivery-')); roots.push(root)
    await mkdir(join(root, 'projects', '-work'), { recursive: true })
    const path = join(root, 'projects', '-work', 'session.jsonl')
    const reader = new ClaudeTaskDeliveryReader(root, '/work')
    await reader.start('session')
    const attachment = (id: string) => ({ type: 'attachment', uuid: id, attachment: {
      type: 'queued_command', commandMode: 'task-notification', prompt: notice(id).message.content,
    } })
    await writeFile(path, lines(notice('standalone'), answer('checking'),
      { type: 'queue-operation', operation: 'enqueue', content: notice('one').message.content }))
    expect((await reader.forAssistant('checking')).map((item) => item.uuid)).toEqual(['standalone'])
    await appendFile(path, lines(attachment('one'),
      { type: 'queue-operation', operation: 'remove', reason: 'absorbed_mid_turn', content: notice('one').message.content },
      attachment('two')))
    expect((await reader.forAssistant('checking')).map((item) => item.uuid)).toEqual(['standalone'])
    const delivered = await reader.forAssistant('summary-streaming')
    expect(delivered.map((item) => item.uuid)).toEqual(['one', 'two'])
    expect(delivered.every((item) => (item.origin as { delivery: string }).delivery === 'absorbed_mid_turn')).toBe(true)
    await appendFile(path, lines(answer('summary-streaming'), { type: 'user', message: { content: 'Next question' } }, answer('human')))
    expect((await reader.forAssistant('summary-streaming')).map((item) => item.uuid)).toEqual(['one', 'two'])
    expect(await reader.forAssistant('human')).toEqual([])
  })

  it('starts after existing history and associates buffered assistant IDs with their own delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'task-delivery-')); roots.push(root)
    await mkdir(join(root, 'projects', '-work'), { recursive: true })
    const path = join(root, 'projects', '-work', 'session.jsonl')
    await writeFile(path, lines(notice('old'), answer('old-answer')))
    const reader = new ClaudeTaskDeliveryReader(root, '/work')
    await reader.start('session')
    await appendFile(path, lines(notice('first'), answer('first-answer'), notice('second'), answer('second-answer')))
    expect((await reader.forAssistant('first-answer')).map((item) => item.uuid)).toEqual(['first'])
    expect((await reader.forAssistant('second-answer')).map((item) => item.uuid)).toEqual(['second'])
    await appendFile(path, lines({ type: 'user', message: { content: 'Human question' } }, answer('human-answer')))
    expect(await reader.forAssistant('human-answer')).toEqual([])
  })

  it('reads a delivery before the streaming assistant is saved and tolerates partial UTF-8 lines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'task-delivery-')); roots.push(root)
    const reader = new ClaudeTaskDeliveryReader(root, '/work')
    await reader.start('new')
    expect(await reader.forAssistant('streaming')).toEqual([])
    await mkdir(join(root, 'projects', '-work'), { recursive: true })
    const path = join(root, 'projects', '-work', 'new.jsonl')
    const bytes = Buffer.from(lines(notice('live')))
    const boundary = bytes.indexOf(Buffer.from('实际')) + 1
    await writeFile(path, bytes.subarray(0, boundary))
    expect(await reader.forAssistant('streaming')).toEqual([])
    await appendFile(path, bytes.subarray(boundary))
    const context = await reader.forAssistant('streaming')
    expect(context).toHaveLength(1)
    expect(context[0]?.message).toMatchObject({ content: expect.stringContaining('实际输出 live') as unknown })
  })
})
