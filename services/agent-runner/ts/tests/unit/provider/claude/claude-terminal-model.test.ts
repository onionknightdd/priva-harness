import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureClaudeTerminal, saveClaudeTerminalSelection } from '../../../../src/provider/claude/claude-terminal-model.js'
import { testRunSpec } from '../../../support/run-spec.js'

describe('configureClaudeTerminal model mappings', () => {
  let scratchDir: string
  const spec = testRunSpec({ model: 'custom-first' })
  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), 'claude-model-selection-'))
    await saveClaudeTerminalSelection(scratchDir, spec)
    await writeFile(join(scratchDir, 'claude-terminal-instance'), 'instance')
  })
  afterEach(async () => { await rm(scratchDir, { recursive: true, force: true }) })

  function input() {
    return { isAlive: vi.fn(() => Promise.resolve(true)), capture: vi.fn(() => Promise.resolve('')),
      paste: vi.fn(() => Promise.resolve()), sendKeys: vi.fn(() => Promise.resolve()) }
  }

  it('requires a restart for a different model even when the native status already reports it', async () => {
    await writeFile(join(scratchDir, 'claude-terminal-status.json'), JSON.stringify({
      instanceId: 'instance', model: { id: 'custom-second' },
    }))
    const terminal = input()
    expect(await configureClaudeTerminal(terminal, scratchDir, { ...spec, model: 'custom-second' }, new AbortController().signal)).toBe('restart')
    expect(terminal.paste).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(scratchDir, 'claude-terminal-run-spec.json'), 'utf8'))).toEqual(spec)
  })

  it('keeps the current process when the selection and mappings are unchanged', async () => {
    const terminal = input()
    expect(await configureClaudeTerminal(terminal, scratchDir, spec, new AbortController().signal)).toBe('applied')
    expect(terminal.paste).not.toHaveBeenCalled()
  })
})
