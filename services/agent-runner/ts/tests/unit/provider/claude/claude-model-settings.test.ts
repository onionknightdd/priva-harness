import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { saveClaudeModelSettings } from '../../../../src/provider/claude/claude-model-settings.js'

describe('saveClaudeModelSettings', () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'claude-model-settings-')) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  function expected(model: string) {
    return { model, env: {
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      ANTHROPIC_DEFAULT_FABLE_MODEL: model,
    } }
  }

  it('creates user settings under the configured directory and skips unchanged writes', async () => {
    const configDir = join(root, 'user-claude')
    const path = join(configDir, 'settings.json')
    await saveClaudeModelSettings(configDir, 'custom-model')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(expected('custom-model'))
    const before = await stat(path)
    expect(before.mode & 0o777).toBe(0o600)
    await saveClaudeModelSettings(configDir, 'custom-model')
    expect((await stat(path)).ino).toBe(before.ino)
    expect(await readdir(configDir)).toEqual(['settings.json'])
  })

  it('updates all aliases together while preserving unrelated JSONC settings and environment', async () => {
    const path = join(root, 'settings.json')
    await writeFile(path, '{ // existing settings\n"model":"old", "permissions":{"allow":["Read"]}, "env":{"KEEP":"value", "ANTHROPIC_DEFAULT_HAIKU_MODEL":"old-haiku"}, }')
    await saveClaudeModelSettings(root, 'next-model[1m]')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      ...expected('next-model[1m]'), permissions: { allow: ['Read'] },
      env: { ...expected('next-model[1m]').env, KEEP: 'value' },
    })
  })

  it('serializes concurrent selections and persists the last model consistently', async () => {
    await Promise.all(['first', 'second', 'third'].map((model) => saveClaudeModelSettings(root, model)))
    expect(JSON.parse(await readFile(join(root, 'settings.json'), 'utf8'))).toEqual(expected('third'))
  })

  it.each(['{ broken', '[]', '{"env":null}', '{"env":[]}'])('preserves invalid settings and allows a retry after repair: %s', async (invalid) => {
    const path = join(root, 'settings.json')
    await writeFile(path, invalid)
    await expect(saveClaudeModelSettings(root, 'new')).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(invalid)
    await writeFile(path, '{}')
    await saveClaudeModelSettings(root, 'new')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(expected('new'))
  })

  it('does not replace linked user settings', async () => {
    const configDir = join(root, 'user-claude')
    await mkdir(configDir)
    const target = join(root, 'linked.json')
    await writeFile(target, '{}')
    await symlink(target, join(configDir, 'settings.json'))
    await expect(saveClaudeModelSettings(configDir, 'new')).rejects.toThrow('Linked Claude settings')
    expect(await readFile(target, 'utf8')).toBe('{}')
  })
})
