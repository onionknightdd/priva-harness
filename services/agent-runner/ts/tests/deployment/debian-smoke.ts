import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'

import { createBashTool, createWriteTool, getAgentDir } from '@earendil-works/pi-coding-agent'
import { WebSocket } from 'ws'

import { claudeGlobalDir } from '../../src/provider/claude/claude-paths.js'
import { TmuxTerminalService } from '../../src/infrastructure/terminal/tmux-terminal-service.js'

const exec = promisify(execFile)
assert.equal(process.platform, 'linux', 'Run this probe inside the Debian Pod')
assert.notEqual(process.getuid?.(), 0, 'Claude bypass mode needs a non-root user')
assert.match(await readFile('/etc/os-release', 'utf8'), /^VERSION_ID="13"$/mu)
assert.equal(homedir(), '/data/home')
assert.equal(getAgentDir(), '/data/home/.pi/agent')
assert.equal(claudeGlobalDir(), '/data/home/.claude')
assert.equal(await realpath(process.env['WORKSPACE_DIR'] ?? ''), '/data/workspace')
assert.equal(process.env['RUNTIME_HOME_DIR'], '/data/runtime')
const claude = (await exec('claude', ['--version'])).stdout.trim()
const pi = (await exec('pi', ['--version'])).stdout.trim()
const tmux = (await exec('tmux', ['-V'])).stdout.trim()
assert.equal(tmux, 'tmux 3.7c', 'The terminal snapshot protocol requires the pinned tmux build')

const cwd = await mkdtemp('/data/workspace/.debian-smoke-')
const terminalDir = await mkdtemp('/tmp/debian-tmux-')
const terminals = new TmuxTerminalService({ rootDir: terminalDir, sweepIntervalMs: 0 })
try {
  await createWriteTool(cwd).execute('write-probe', { path: 'proof.txt', content: 'Debian container tool execution\n' })
  const result = await createBashTool(cwd).execute('bash-probe', {
    command: 'test "$(uname -s)" = Linux && cat proof.txt && pwd && . /etc/os-release && echo "$PRETTY_NAME"',
    timeout: 10,
  })
  const output = result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  assert.match(output, /Debian container tool execution/u)
  assert.ok(output.includes(cwd))
  assert.match(output, /Debian GNU\/Linux 13/u)
  assert.equal(await readFile(join(cwd, 'proof.txt'), 'utf8'), 'Debian container tool execution\n')

  await terminals.ensure('debian-probe', { command: 'sleep', args: ['30'], cwd, env: {}, cols: 80, rows: 24 })
  const attachment = await terminals.attach('debian-probe', 80, 24)
  assert.equal(attachment.cols, 80)
  assert.equal(attachment.rows, 24)
  await attachment.detach()
  const socket = await terminals.socketPath('debian-probe')
  const pid = (await exec('tmux', ['-S', socket, 'display-message', '-p', '#{pane_pid}'])).stdout.trim()
  assert.equal(await realpath(`/proc/${pid}/cwd`), cwd)
  assert.match(await readFile(`/proc/${pid}/root/etc/os-release`, 'utf8'), /^VERSION_ID="13"$/mu)

  const origin = 'http://127.0.0.1:8001'
  const response = await fetch(`${origin}/api/sandbox/files/list`)
  assert.equal(response.status, 200)
  const listing = await response.json() as { path: string }
  assert.equal(listing.path, '/data/workspace')
  const preview = await fetch(`${origin}/api/sandbox/files/preview?path=${encodeURIComponent(join(cwd, 'proof.txt'))}`)
  const file = await preview.json() as { content: string }
  assert.equal(file.content, 'Debian container tool execution\n')
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:8001/api/sandbox/agent/ws/session')
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('WebSocket probe timed out')) }, 5_000)
    ws.once('error', (error) => { clearTimeout(timeout); reject(error) })
    ws.once('open', () => { clearTimeout(timeout); ws.close(); resolve() })
  })
  const db = new DatabaseSync('/data/runtime/.data.db', { readOnly: true })
  try {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_event'").get())
  } finally {
    db.close()
  }
  console.log(JSON.stringify({ os: 'Debian 13', arch: process.arch, uid: process.getuid?.(), node: process.version, claude, pi, tmux, checks: ['Pi bash/write tools', 'tmux Linux process and terminal snapshot', 'HTTP file preview', 'WebSocket', 'SQLite', 'Linux config paths'] }, null, 2))
} finally {
  // The private socket ensures this never terminates a user's agent terminal.
  await terminals.close('debian-probe')
  await terminals.dispose()
  await rm(terminalDir, { recursive: true, force: true })
  await rm(cwd, { recursive: true, force: true })
}
