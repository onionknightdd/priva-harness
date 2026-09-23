import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ProviderRunSpec, SessionTarget } from '../../core/contract/agent-provider.js'
import {
  TerminalError,
  type TerminalLaunchContext,
  type TerminalLaunchSpec,
} from '../../core/contract/terminal-service.js'
import {
  resolveClaudeQueryEnv,
  resolveClaudeQuerySettings,
} from './claude-runtime.js'
import { writeClaudeTerminalHooks } from './claude-terminal-hooks.js'
import { saveClaudeTerminalSelection } from './claude-terminal-model.js'
import type { ToolDefinition } from '../../core/tool/define-tool.js'
import { writeNativeProductConfig } from './tools/native-product-launch.js'

import { claudeDisallowedTools } from './claude-tool-policy.js'
import { claudeSystemPromptArgs } from './claude-system-prompt.js'

const SETTINGS_FILE = 'claude-settings.json'

export interface ClaudeTerminalLaunchInput {
  readonly target: SessionTarget
  readonly spec: ProviderRunSpec
  readonly executable: string
  readonly context: TerminalLaunchContext
  readonly tools?: readonly ToolDefinition[]
}

/**
 * Describe the interactive `claude` process for a session terminal.
 *
 * The command line mirrors what `resolveClaudeQueryOptions` compiles for the
 * SDK driver (model, effort, bypass permissions, disallowed tools, settings
 * overrides) so a session behaves the same whichever driver opened it.
 * Settings are written to a file because they carry the model profile's
 * credentials, which must not appear in the process argument list.
 */
export async function claudeTerminalLaunch(input: ClaudeTerminalLaunchInput): Promise<TerminalLaunchSpec> {
  const { target, spec, context } = input
  const settingsPath = join(context.scratchDir, SETTINGS_FILE)
  const bridge = context.eventsUrl === undefined ? undefined : await writeClaudeTerminalHooks(context.scratchDir, context.eventsUrl)
  await saveClaudeTerminalSelection(context.scratchDir, spec)
  await writeFile(settingsPath, JSON.stringify({
    ...resolveClaudeQuerySettings(spec),
    skipDangerousModePermissionPrompt: true,
    ...(spec.promptSuggestions === undefined ? {} : { promptSuggestionEnabled: spec.promptSuggestions }),
    ...bridge,
  }, null, 2), { mode: 0o600 })
  const args = [
    ...sessionArgs(target),
    '--model', spec.model,
    '--permission-mode', 'bypassPermissions',
    '--settings', settingsPath,
    ...await writeNativeProductConfig(context.scratchDir, target, spec, input.tools ?? []),
    '--disallowedTools', claudeDisallowedTools(spec.runMode).join(','),
    ...claudeSystemPromptArgs(spec),
    ...(spec.effort === undefined ? [] : ['--effort', spec.effort]),
  ]
  return {
    command: input.executable,
    args,
    cwd: spec.cwd,
    env: {
      ...resolveClaudeQueryEnv(spec),
      // The binary is pinned by the SDK dependency; the TUI must not try to
      // replace itself (it cannot, and reports the failure on every start).
      DISABLE_AUTOUPDATER: '1',
    },
    cols: context.cols,
    rows: context.rows,
  }
}

function sessionArgs(target: SessionTarget): string[] {
  switch (target.kind) {
    case 'new':
      if (target.sessionId === undefined) {
        throw new TerminalError('unsupported', 'A terminal session needs its id chosen before launch')
      }
      return ['--session-id', target.sessionId]
    case 'resume':
      return ['--resume', target.session.id]
    case 'fork':
      if (!target.sessionId) throw new TerminalError('unsupported', 'A forked terminal needs its id chosen before launch')
      return ['--resume', target.source.id, '--fork-session', '--session-id', target.sessionId]
  }
}
