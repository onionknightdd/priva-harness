import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { TerminalBindings } from '../../../../src/infrastructure/terminal/terminal-bindings.js'

it('persists /clear bindings across restart and gives the old transcript its own terminal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'priva-bindings-'))
  try {
    const bindings = new TerminalBindings(root)
    const original = await bindings.directory('claude:old', true)
    await bindings.rebind('claude:old', 'claude:new')
    const reopened = new TerminalBindings(root)
    expect(await reopened.directory('claude:new')).toBe(original)
    expect(await reopened.keyFor(original ?? '')).toBe('claude:new')
    expect(await reopened.directory('claude:old')).toBeUndefined()
    const old = await reopened.directory('claude:old', true)
    expect(old).not.toBe(original)
    await expect(reopened.rebind('claude:new', 'claude:old')).rejects.toThrow('already has a terminal')
    expect(await reopened.directory('claude:new')).toBe(original)
  } finally { await rm(root, { recursive: true, force: true }) }
})
