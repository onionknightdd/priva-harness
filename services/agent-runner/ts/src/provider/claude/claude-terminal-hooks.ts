import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'

import type { TerminalSessionState } from '../../core/contract/terminal-service.js'

const STATE_FILE = 'claude-terminal-state.json'
const INSTANCE_FILE = 'claude-terminal-instance'

const stateSchema = z.object({
  sessionId: z.string(), instanceId: z.string(), cwd: z.string(), updatedAt: z.number(),
  phase: z.enum(['idle', 'running', 'exited']),
  event: z.enum(['ready', 'prompt', 'stop', 'failure', 'exit']),
  prompt: z.string().optional(), message: z.string().optional(),
  source: z.string().optional(), reason: z.string().optional(),
})

export async function readClaudeTerminalState(scratchDir: string): Promise<TerminalSessionState | undefined> {
  try {
    const { prompt, message, source, reason, ...value } = stateSchema.parse(JSON.parse(await readFile(join(scratchDir, STATE_FILE), 'utf8')) as unknown)
    if (value.instanceId !== await readFile(join(scratchDir, INSTANCE_FILE), 'utf8')) return undefined
    return { ...value, ...(prompt === undefined ? {} : { prompt }), ...(message === undefined ? {} : { message }),
      ...(source === undefined ? {} : { source }), ...(reason === undefined ? {} : { reason }) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export async function recordClaudeTerminalState(scratchDir: string, state: TerminalSessionState): Promise<void> {
  const path = join(scratchDir, STATE_FILE)
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temp, JSON.stringify(state), { mode: 0o600 })
    await rename(temp, path)
  } finally { await rm(temp, { force: true }) }
}

/** Command hooks also work for SessionStart, which does not support HTTP hooks. */
export async function writeClaudeTerminalHooks(scratchDir: string, eventsUrl: string) {
  const instanceId = randomUUID()
  await writeFile(join(scratchDir, INSTANCE_FILE), instanceId, { mode: 0o600 })
  // A new process must not inherit an exited/running state from its predecessor.
  await rm(join(scratchDir, STATE_FILE), { force: true })
  const script = join(scratchDir, 'claude-terminal-hook.cjs')
  await writeFile(script, HOOK_RELAY, { mode: 0o600 })
  await writeFile(join(scratchDir, 'claude-terminal-text.jsonl'), '', { mode: 0o600 })
  await writeFile(join(scratchDir, 'claude-terminal-events.jsonl'), '', { mode: 0o600 })
  const displayCommand = `[ "$(cat ${quote(join(scratchDir, INSTANCE_FILE))})" = ${quote(instanceId)} ] || exit 0; payload=$(tr -d '\\r\\n'); printf '%s\\n' "$payload" >> ${quote(join(scratchDir, 'claude-terminal-text.jsonl'))}`
  const command = [process.execPath, script, eventsUrl, join(scratchDir, STATE_FILE), join(scratchDir, INSTANCE_FILE), instanceId, basename(scratchDir)].map(quote).join(' ')
  return { statusLine: { type: 'command', command }, hooks: { ...Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd',
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'CwdChanged'].map((event) =>
    [event, [{ hooks: [{ type: 'command', command, timeout: 10 }] }]])),
    MessageDisplay: [{ hooks: [{ type: 'command', command: displayCommand, timeout: 2 }] }],
    PermissionRequest: [{ hooks: [{ type: 'command', command, timeout: 620 }] }],
    Elicitation: [{ hooks: [{ type: 'command', command, timeout: 620 }] }] } }
}

function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'` }

// The relay persists the last state before posting it. A runner restart can
// re-adopt a live TUI without guessing whether its model is still responding.
const HOOK_RELAY = String.raw`
const fs = require('node:fs/promises');
async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const hook = JSON.parse(input);
  const instanceId = process.argv[5];
  if (await fs.readFile(process.argv[4], 'utf8') !== instanceId) return;
  if (!hook.hook_event_name && hook.model) {
    const path = require('node:path').join(require('node:path').dirname(process.argv[3]), 'claude-terminal-status.json');
    const temp = path + '.' + process.pid + '.tmp';
    await fs.writeFile(temp, JSON.stringify({ ...hook, instanceId, updatedAt: Date.now() }), { mode: 0o600 });
    await fs.rename(temp, path);
    process.stdout.write(hook.model.display_name + (hook.effort?.level ? ' · ' + hook.effort.level : ''));
    return;
  }
  if (['PreToolUse','PostToolUse','PostToolUseFailure','PreCompact','PostCompact','SubagentStart','SubagentStop','CwdChanged'].includes(hook.hook_event_name)) {
    await fs.appendFile(require('node:path').join(require('node:path').dirname(process.argv[3]), 'claude-terminal-events.jsonl'), JSON.stringify({ ...hook, instanceId }) + '\n', { mode: 0o600 });
    if (hook.hook_event_name === 'CwdChanged') {
      const path = process.argv[3], temp = path + '.' + process.pid + '.tmp';
      const state = JSON.parse(await fs.readFile(path, 'utf8'));
      await fs.writeFile(temp, JSON.stringify({ ...state, cwd: hook.new_cwd }), { mode: 0o600 });
      await fs.rename(temp, path);
    }
    return;
  }
  if (hook.agent_id && !['PermissionRequest', 'Elicitation'].includes(hook.hook_event_name)) return;
  if (hook.hook_event_name === 'Stop' && Array.isArray(hook.background_tasks)) {
    await fs.appendFile(require('node:path').join(require('node:path').dirname(process.argv[3]), 'claude-terminal-events.jsonl'), JSON.stringify({ ...hook, instanceId }) + '\n', { mode: 0o600 });
  }
  if (hook.hook_event_name === 'PermissionRequest' || hook.hook_event_name === 'Elicitation') {
    const elicitation = hook.hook_event_name === 'Elicitation';
    const response = await fetch(process.argv[2].replace(/events$/, elicitation ? 'elicitation' : 'question'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ terminalId: process.argv[6], sessionId: hook.session_id, instanceId, cwd: hook.cwd,
        ...(elicitation ? { serverName: hook.mcp_server_name, message: hook.message, mode: hook.mode || 'form', schema: hook.requested_schema }
          : { tool: hook.tool_name, input: hook.tool_input, ...(hook.tool_use_id ? { toolUseId: hook.tool_use_id } : {}) }) }),
      signal: AbortSignal.timeout(610000)
    });
    if (!response.ok) throw new Error('Terminal question returned HTTP ' + response.status);
    process.stdout.write(JSON.stringify(await response.json()));
    return;
  }
  const events = { SessionStart: 'ready', UserPromptSubmit: 'prompt', Stop: 'stop', StopFailure: 'failure', SessionEnd: 'exit' };
  const event = events[hook.hook_event_name];
  if (!event) return;
  if (event === 'prompt') await fs.writeFile(require('node:path').join(require('node:path').dirname(process.argv[3]), 'claude-terminal-text.jsonl'), '', { mode: 0o600 });
  const state = {
    sessionId: hook.session_id, instanceId, cwd: hook.cwd, event,
    phase: event === 'prompt' ? 'running' : event === 'exit' ? 'exited' : 'idle',
    updatedAt: Date.now(),
    ...(typeof hook.source === 'string' ? { source: hook.source } : {}),
    ...(typeof hook.reason === 'string' ? { reason: hook.reason } : {}),
    ...(typeof hook.prompt === 'string' ? { prompt: hook.prompt } : {}),
    ...(event === 'failure' ? { message: hook.error_details || hook.error || 'Claude stopped with an API error' } : {})
  };
  const path = process.argv[3], temp = path + '.' + process.pid + '.tmp';
  await fs.writeFile(temp, JSON.stringify(state), { mode: 0o600 });
  await fs.rename(temp, path);
  const response = await fetch(process.argv[2], {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...state, terminalId: process.argv[6] }), signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Terminal sync returned HTTP ' + response.status);
}
main().catch(error => { process.stderr.write('Terminal sync: ' + error.message + '\n'); process.exitCode = 1; });
`
