import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TerminalError } from '../../../../src/core/contract/terminal-service.js'
import { resolveBundledClaudeExecutable } from '../../../../src/provider/claude/claude-executable.js'
import { ensureClaudeProjectTrusted } from '../../../../src/provider/claude/claude-project-trust.js'
import { claudeTerminalLaunch } from '../../../../src/provider/claude/claude-terminal-launch.js'
import { CLAUDE_DISALLOWED_TOOLS } from '../../../../src/provider/claude/claude-runtime.js'
import { testRunSpec } from '../../../support/run-spec.js'

describe('claudeTerminalLaunch', () => {
  let scratchDir: string
  beforeEach(async () => { scratchDir = await mkdtemp(join(tmpdir(), 'priva-claude-tui-')) })
  afterEach(async () => { await rm(scratchDir, { recursive: true, force: true }) })

  const context = { scratchDir: '', cols: 132, rows: 43 }

  it('launches a new session with a fixed id, the profile env and settings kept out of argv', async () => {
    const spec = testRunSpec({ cwd: '/work/repo', model: 'deepseek-v4-flash', authToken: 'secret', effort: 'high' })
    const launch = await claudeTerminalLaunch({
      target: { kind: 'new', provider: 'claude', sessionId: 'sess-1' },
      spec,
      executable: '/opt/claude',
      context: { ...context, scratchDir },
    })
    expect(launch.command).toBe('/opt/claude')
    expect(launch.cwd).toBe('/work/repo')
    expect(launch.cols).toBe(132)
    expect(launch.rows).toBe(43)
    expect(launch.args.slice(0, 2)).toEqual(['--session-id', 'sess-1'])
    expect(launch.args).toEqual(expect.arrayContaining([
      '--model', 'deepseek-v4-flash',
      '--permission-mode', 'bypassPermissions',
      '--disallowedTools', CLAUDE_DISALLOWED_TOOLS.join(','),
      '--effort', 'high',
    ]))
    expect(launch.args.join(' ')).not.toContain('secret')
    expect(launch.env).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: 'secret',
      ANTHROPIC_MODEL: 'deepseek-v4-flash',
      CLAUDE_CODE_HARBOR_KITE: '1',
      DISABLE_AUTOUPDATER: '1',
    })
    const settingsPath = launch.args[launch.args.indexOf('--settings') + 1]
    expect(settingsPath?.startsWith(scratchDir)).toBe(true)
    const settings = JSON.parse(await readFile(settingsPath ?? '', 'utf8')) as Record<string, unknown>
    expect(settings).toMatchObject({
      skipDangerousModePermissionPrompt: true,
      env: { ANTHROPIC_AUTH_TOKEN: 'secret' },
    })
  })

  it('resumes by session id and omits effort when the spec has none', async () => {
    const launch = await claudeTerminalLaunch({
      target: { kind: 'resume', session: { provider: 'claude', id: 'old' } },
      spec: testRunSpec(),
      executable: '/opt/claude',
      context: { ...context, scratchDir },
    })
    expect(launch.args.slice(0, 2)).toEqual(['--resume', 'old'])
    expect(launch.args).not.toContain('--effort')
  })

  it('refuses a new session without a chosen id and any fork', async () => {
    await expect(claudeTerminalLaunch({
      target: { kind: 'new', provider: 'claude' },
      spec: testRunSpec(),
      executable: '/opt/claude',
      context: { ...context, scratchDir },
    })).rejects.toBeInstanceOf(TerminalError)
    await expect(claudeTerminalLaunch({
      target: { kind: 'fork', source: { provider: 'claude', id: 'old' } },
      spec: testRunSpec(),
      executable: '/opt/claude',
      context: { ...context, scratchDir },
    })).rejects.toMatchObject({ kind: 'unsupported' })
  })
})

describe('ensureClaudeProjectTrusted', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'priva-claude-json-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('creates the global config with the dialogs pre-accepted for the project and key', async () => {
    const file = join(dir, 'nested', '.claude.json')
    await ensureClaudeProjectTrusted(file, { cwd: '/work/repo', apiKey: ' sk-ant-0123456789abcdefghijklmnop ' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      hasCompletedOnboarding: true,
      bypassPermissionsModeAccepted: true,
      projects: { '/work/repo': { hasTrustDialogAccepted: true } },
      customApiKeyResponses: { approved: ['6789abcdefghijklmnop'], rejected: [] },
    })
  })

  it('preserves unrelated keys, other projects and earlier key decisions', async () => {
    const file = join(dir, '.claude.json')
    await writeFile(file, JSON.stringify({
      theme: 'dark',
      projects: { '/other': { allowedTools: ['Bash'] }, '/work/repo': { history: ['x'] } },
      customApiKeyResponses: { approved: ['old-key-fingerprint00'], rejected: ['short-key'] },
    }))
    await ensureClaudeProjectTrusted(file, { cwd: '/work/repo', apiKey: 'short-key' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      theme: 'dark',
      hasCompletedOnboarding: true,
      bypassPermissionsModeAccepted: true,
      projects: {
        '/other': { allowedTools: ['Bash'] },
        '/work/repo': { history: ['x'], hasTrustDialogAccepted: true },
      },
      customApiKeyResponses: { approved: ['old-key-fingerprint00', 'short-key'], rejected: [] },
    })
  })

  it('aligns Claude Code\'s theme with the viewer colour scheme only when one is given', async () => {
    const file = join(dir, '.claude.json')
    await writeFile(file, JSON.stringify({ theme: 'dark-daltonized' }))
    await ensureClaudeProjectTrusted(file, { cwd: '/work/repo' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ theme: 'dark-daltonized' })
    await ensureClaudeProjectTrusted(file, { cwd: '/work/repo', colorScheme: 'light' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ theme: 'light' })
  })

  it('serialises concurrent writers so every project lands and no temp file is lost', async () => {
    const file = join(dir, '.claude.json')
    const cwds = ['/a', '/b', '/c', '/d', '/e', '/f']
    await Promise.all(cwds.map((cwd) => ensureClaudeProjectTrusted(file, { cwd, apiKey: `key-${cwd}` })))
    const written = JSON.parse(await readFile(file, 'utf8')) as { projects: Record<string, unknown>; customApiKeyResponses: { approved: string[] } }
    expect(Object.keys(written.projects).sort()).toEqual(cwds)
    expect(written.customApiKeyResponses.approved.sort()).toEqual(cwds.map((cwd) => `key-${cwd}`).sort())
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('leaves key approvals alone when the profile has no token', async () => {
    const file = join(dir, '.claude.json')
    await ensureClaudeProjectTrusted(file, { cwd: '/work/repo', apiKey: '' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
      customApiKeyResponses: { approved: [], rejected: [] },
    })
  })
})

describe('resolveBundledClaudeExecutable', () => {
  it('returns undefined for a platform the SDK does not ship a binary for', () => {
    expect(resolveBundledClaudeExecutable('freebsd', 'x64')).toBeUndefined()
  })

  it('finds the binary shipped for the current platform when installed', () => {
    const found = resolveBundledClaudeExecutable()
    if (found === undefined) return
    expect(found).toMatch(/claude-agent-sdk-[a-z0-9-]+[\\/]claude(?:\.exe)?$/u)
  })
})
