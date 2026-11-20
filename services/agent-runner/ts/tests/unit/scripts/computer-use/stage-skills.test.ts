import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { checkOriginalMount, stageOriginalComputerSkills, verifyOriginalComputerSkills } from '../../../../scripts/computer-use/stage-skills.js'
import { resolveSessionPluginResources } from '../../../../src/core/plugin/session-plugin-resources.js'
import { originalComputerSkills, originalPluginIds, resolveOriginalComputerSkills } from '../../../../src/core/plugin/original-computer-skills.js'

let scratch: string
let source: string
let staged: string
function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'skills-'))
  source = join(scratch, 'plugins')
  staged = join(scratch, 'staged')
  for (const id of originalPluginIds) {
    const root = join(source, id)
    const hasMcp = ['computer-history', 'record-and-replay'].includes(id)
    const descriptor = { name: id, version: '1.0', license: 'Fixture', skills: './skills/', ...(hasMcp ? { mcpServers: './.mcp.json' } : {}) }
    write(join(root, '.codex-plugin/plugin.json'), JSON.stringify(descriptor))
    mkdirSync(join(root, 'assets'))
    write(join(root, `skills/${originalComputerSkills[id]}/SKILL.md`), `---\nname: ${originalComputerSkills[id]}\n---\nFixture\n`)
    if (hasMcp) {
      write(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { example: { command: './bin/computer-use-client-launcher' } } }))
      write(join(root, 'bin/computer-use-client-launcher'), 'fixture')
    }
    if (id === 'browser' || id === 'chrome') {
      write(join(root, 'docs/documents.json'), '[]')
      write(join(root, 'docs/api.json'), '{}')
      write(join(root, 'scripts/browser-client.mjs'), 'export const bootstrap = 1\n')
    }
  }
})
afterEach(() => rmSync(scratch, { recursive: true, force: true }))

describe('original Computer Use skill provisioning', () => {
  it('preserves documented relative paths and generates only a skill adapter for Claude', () => {
    const inventory = stageOriginalComputerSkills(source, staged)
    const selected = resolveOriginalComputerSkills(staged, ['chrome', 'computer-history'])
    expect(selected[0]?.skillDir).toBe(join(staged, 'chrome/skills/control-chrome'))
    expect(readFileSync(join(staged, 'chrome/scripts/browser-client.mjs'))).toEqual(readFileSync(join(source, 'chrome/scripts/browser-client.mjs')))
    expect(statSync(staged).mode & 0o777).toBe(0o700)
    expect(statSync(join(staged, 'chrome/scripts/browser-client.mjs')).mode & 0o777).toBe(0o600)
    expect(inventory.find((entry) => entry.id === 'computer-history')?.outsideStage).toContain('bin')
    expect(inventory.find((entry) => entry.id === 'computer-use')?.skillPlatform).toBe('darwin')
    expect(verifyOriginalComputerSkills(staged).map((entry) => entry.id)).toEqual(originalPluginIds)
    expect(existsSync(join(staged, 'computer-history/.mcp.json'))).toBe(false)
    expect(existsSync(join(staged, 'computer-history/bin'))).toBe(false)
    expect(JSON.parse(readFileSync(join(staged, 'computer-history/.claude-plugin/plugin.json'), 'utf8'))).toEqual({
      name: 'priva-original-computer-history', skills: './skills/computer-history',
    })
    expect(() => checkOriginalMount(staged, 'chrome', join(source, 'chrome'))).toThrow('browser-service.mjs')
    expect(() => stageOriginalComputerSkills(source, staged)).toThrow()
  })

  it('stages an explicit subset when other source plugins are absent and verifies the expected IDs', () => {
    for (const id of ['computer-use', 'computer-history', 'record-and-replay']) rmSync(join(source, id), { recursive: true })
    stageOriginalComputerSkills(source, staged, ['browser', 'chrome'])
    expect(verifyOriginalComputerSkills(staged, ['chrome', 'browser']).map((entry) => entry.id)).toEqual(['browser', 'chrome'])
    expect(verifyOriginalComputerSkills(staged)).toHaveLength(2)
    expect(() => verifyOriginalComputerSkills(staged, ['browser'])).toThrow('requested original skills')
    expect(() => stageOriginalComputerSkills(source, join(scratch, 'empty'), [])).toThrow('At least one')
    expect(() => stageOriginalComputerSkills(source, join(scratch, 'duplicate'), ['browser', 'browser'])).toThrow('Duplicate')
    expect(() => stageOriginalComputerSkills(source, join(scratch, 'unknown'), ['other'])).toThrow()
    // A default full snapshot must fail when one of its sources is missing.
    expect(() => stageOriginalComputerSkills(source, join(scratch, 'full'))).toThrow()
    expect(existsSync(join(scratch, 'full'))).toBe(false)
  })

  it('rejects an empty or partial inventory, unlisted resources, missing files, and incorrect bytes', () => {
    const plugins = stageOriginalComputerSkills(source, staged, ['browser', 'chrome'])
    const inventoryPath = join(staged, 'inventory.json')
    const chrome = plugins.find((plugin) => plugin.id === 'chrome')
    if (!chrome) throw new Error('Missing chrome fixture')
    const inventory = (entries: typeof plugins) => write(inventoryPath, JSON.stringify({ version: 1, plugins: entries }))
    inventory([])
    expect(() => verifyOriginalComputerSkills(staged)).toThrow('At least one')
    inventory([chrome, chrome])
    expect(() => verifyOriginalComputerSkills(staged)).toThrow('Duplicate')
    inventory([chrome])
    expect(() => verifyOriginalComputerSkills(staged)).toThrow('Unexpected staged resource: browser')
    inventory(plugins)
    const unlisted = join(staged, 'chrome/scripts/unlisted.mjs')
    write(unlisted, 'extra')
    expect(() => verifyOriginalComputerSkills(staged)).toThrow('Unlisted staged resource')
    rmSync(unlisted)
    const client = join(staged, 'chrome/scripts/browser-client.mjs')
    write(client, 'changed')
    expect(() => verifyOriginalComputerSkills(staged)).toThrow('SHA-256 mismatch')
    rmSync(client)
    expect(() => verifyOriginalComputerSkills(staged)).toThrow()
    delete chrome.files['scripts/browser-client.mjs']
    inventory(plugins)
    expect(() => verifyOriginalComputerSkills(staged)).toThrow('Missing staged inventory entry')
  })

  it('publishes only selected original skills and chooses the unified desktop instructions when configured', () => {
    stageOriginalComputerSkills(source, staged)
    const env = { PRIVA_CUA_SKILLS: staged, PRIVA_CUA_ENABLED_SKILLS: 'chrome,computer-use,browser,computer-history,record-and-replay,chrome' }
    expect(resolveSessionPluginResources([], { PRIVA_CUA_SKILLS: staged })).toEqual([])
    expect(() => resolveSessionPluginResources([], { PRIVA_CUA_ENABLED_SKILLS: 'chrome' })).toThrow('requires PRIVA_CUA_SKILLS')
    expect(() => resolveSessionPluginResources([], { ...env, PRIVA_CUA_ENABLED_SKILLS: 'bogus' })).toThrow('not present')
    const names = (runtime?: string, surfaces?: string) => resolveSessionPluginResources(['computer-use'], {
      ...env, ...(runtime ? { PRIVA_CUA_RUNTIME: runtime } : {}), ...(surfaces ? { CUA_REPL_ENABLED_SURFACES: surfaces } : {}),
    }).map(({ skillDir }) => /^name: (.+)$/mu.exec(readFileSync(join(skillDir, 'SKILL.md'), 'utf8'))?.[1])
    expect(names()).toEqual(['registered-computers', 'control-chrome', 'computer-use', 'control-in-app-browser', 'computer-history', 'record-and-replay'])
    expect(names('/vendor/unified')).toEqual(['registered-computers', 'control-chrome', 'control-in-app-browser', 'computer-history', 'record-and-replay'])
    if (process.platform === 'darwin') {
      expect(names('/vendor/unified', 'browser')).toEqual(['registered-computers', 'computer-use', 'computer-history', 'record-and-replay'])
    } else {
      expect(() => names('/vendor/unified', 'browser')).toThrow('matching computer-use SKILL.md')
    }
    expect(names('/vendor/unified', 'browser,computer')).toEqual(['registered-computers', 'computer-history', 'record-and-replay'])
  })

  it('detects changed staged resources and refuses symlinks in the installed resource tree', () => {
    stageOriginalComputerSkills(source, staged)
    write(join(staged, 'browser/skills/control-in-app-browser/SKILL.md'), 'unexpected change')
    expect(() => resolveOriginalComputerSkills(staged, ['browser'])).toThrow('SHA-256 mismatch')
    const another = join(scratch, 'another')
    symlinkSync(join(scratch, 'private-data'), join(source, 'browser/docs/foreign.md'))
    expect(() => stageOriginalComputerSkills(source, another)).toThrow('Unrecognized or linked')
    expect(existsSync(another)).toBe(false)
  })
})
