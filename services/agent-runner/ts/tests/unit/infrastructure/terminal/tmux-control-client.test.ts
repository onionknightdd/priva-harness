import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TmuxControlClient } from '../../../../src/infrastructure/terminal/tmux-control-client.js'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    exitCode: null, signalCode: null, kill: vi.fn(() => true),
  })
}

describe('TmuxControlClient', () => {
  let child: ReturnType<typeof fakeChild>

  beforeEach(() => {
    child = fakeChild()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  })

  afterEach(() => { child.emit('close') })

  async function open() {
    const opened = TmuxControlClient.open({ tmuxBinary: 'tmux', socketPath: '/test.sock', sessionName: 'main' })
    child.stdout.write('%begin 1 1 0\n%end 1 1 0\n%begin 1 2 1\nmain\n%end 1 2 1\n')
    return opened
  }

  it('marks the snapshot boundary before following output in the same stdout chunk', async () => {
    const client = await open()
    let completed = false
    const output: { data: string; afterSnapshot: boolean }[] = []
    client.onOutput((_pane, data) => { output.push({ data: Buffer.from(data).toString('utf8'), afterSnapshot: completed }) })
    const snapshot = client.commandBatch([
      ['display-message', '-p', 'state'], ['capture-pane', '-p'],
    ], () => { completed = true })
    child.stdout.write('%output %0 before\n%begin 1 3 1\nstate\n%end 1 3 1\n'
      + '%begin 1 4 1\n%output %0 literal screen text\n%exit\n%end 1 4 1\n%output %0 after\n')
    expect(output).toEqual([{ data: 'before', afterSnapshot: false }, { data: 'after', afterSnapshot: true }])
    expect(await snapshot).toEqual([['state'], ['%output %0 literal screen text', '%exit']])
  })

  it('keeps raw UTF-8 fragments while decoding complete command replies as text', async () => {
    const client = await open()
    const output: Uint8Array[] = []
    client.onOutput((_pane, data) => { output.push(data) })
    const reply = client.command(['capture-pane', '-p'])
    const character = Buffer.from('中')
    child.stdout.write(Buffer.concat([Buffer.from('%output %0 '), character.subarray(0, 1), Buffer.from('\n')]))
    const replyBytes = Buffer.from('%begin 1 3 1\n中文\n%end 1 3 1\n')
    for (const byte of replyBytes) child.stdout.write(Buffer.of(byte))
    child.stdout.write(Buffer.concat([Buffer.from('%output %0 '), character.subarray(1), Buffer.from('\n')]))
    expect(await reply).toEqual(['中文'])
    expect(Buffer.concat(output)).toEqual(character)
  })

  it('removes skipped batch commands after an error without consuming the next command\'s reply', async () => {
    const client = await open()
    const failed = expect(client.commandBatch([['bad-command'], ['capture-pane', '-p']])).rejects.toThrow('bad command')
    const next = client.command(['display-message', '-p', 'next'])
    child.stdout.write('%begin 1 3 1\nbad command\n%error 1 3 1\n%begin 1 4 1\nnext\n%end 1 4 1\n')
    await failed
    expect(await next).toEqual(['next'])
  })
})
