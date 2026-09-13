import { homedir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { claudeGlobalConfigFilePath, claudeGlobalDir, claudeProjectDir } from '../../../../src/provider/claude/claude-paths.js'

describe('claude paths', () => {
  beforeEach(() => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', undefined)
    vi.stubEnv('RUNTIME_HOME_DIR', '/product-runtime')
  })

  afterEach(() => { vi.unstubAllEnvs() })

  it('uses the native global directory independently of the product runtime home', () => {
    expect(claudeGlobalDir()).toBe(join(homedir(), '.claude').normalize('NFC'))
    expect(claudeGlobalConfigFilePath()).toBe(join(homedir(), '.claude.json'))
    expect(process.env['CLAUDE_CONFIG_DIR']).toBeUndefined()
  })

  it('follows the SDK resolution for an inherited directory', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/native/cafe\u0301/.claude')
    expect(claudeGlobalDir()).toBe('/native/café/.claude')
    expect(process.env['CLAUDE_CONFIG_DIR']).toBe('/native/cafe\u0301/.claude')
  })

  it('uses the inherited root for the global MCP configuration file', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/native/claude')
    expect(claudeGlobalConfigFilePath()).toBe('/native/claude/.claude.json')
  })

  it('uses the home directory for global MCP config when the native variable is empty', () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', '')
    expect(claudeGlobalConfigFilePath()).toBe(join(homedir(), '.claude.json'))
  })

  it('keeps project config under cwd/.claude', () => {
    expect(claudeProjectDir('/work/repo')).toBe(join('/work/repo', '.claude'))
  })
})
