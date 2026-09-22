import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import type { TerminalColorScheme } from '../../core/contract/terminal-service.js'
import { asRecord } from '../../core/event/json-record.js'

export interface ClaudeTerminalPreflight {
  readonly cwd: string
  /** Profile API key handed to the CLI through `ANTHROPIC_API_KEY`, if any. */
  readonly apiKey?: string
  /**
   * Viewer colour scheme. Claude Code keeps its own `theme` in the global
   * config; aligning it with the surface that shows the TUI keeps its
   * secondary text readable on both light and dark backgrounds.
   */
  readonly colorScheme?: TerminalColorScheme
}

// Claude Code remembers an approved custom API key by the last 20 characters
// of the trimmed key (see its `customApiKeyResponses` handling).
const API_KEY_FINGERPRINT_LENGTH = 20
const configWrites = new Map<string, Promise<void>>()

/**
 * Pre-accept the interactive dialogs Claude Code shows on a first launch.
 *
 * The TUI blocks on the folder trust prompt, the onboarding flow, the
 * bypass-permissions warning and the "use this custom API key?" question;
 * any of them would swallow a message the web chat pastes into the terminal.
 * The Agent SDK never shows them, so the terminal driver seeds the same
 * global config the CLI reads. Existing keys are preserved; only the flags
 * below are set.
 */
export async function ensureClaudeProjectTrusted(
  configFilePath: string,
  preflight: ClaudeTerminalPreflight,
): Promise<void> {
  const path = resolve(configFilePath)
  // Different sessions share this file. Serialize the whole read/modify/write
  // transaction so a later preflight preserves the projects and keys just added.
  const previous = configWrites.get(path) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(() => updateClaudeProjectTrust(path, preflight))
  configWrites.set(path, next)
  try {
    await next
  } finally {
    if (configWrites.get(path) === next) configWrites.delete(path)
  }
}

async function updateClaudeProjectTrust(configFilePath: string, preflight: ClaudeTerminalPreflight): Promise<void> {
  let config: Record<string, unknown> = {}
  try {
    config = asRecord(JSON.parse(await readFile(configFilePath, 'utf8')) as unknown) ?? {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const projects = asRecord(config['projects']) ?? {}
  const project = asRecord(projects[preflight.cwd]) ?? {}
  const responses = asRecord(config['customApiKeyResponses']) ?? {}
  const approved = stringList(responses['approved'])
  const fingerprint = apiKeyFingerprint(preflight.apiKey)
  const next = {
    ...config,
    ...(preflight.colorScheme === undefined ? {} : { theme: preflight.colorScheme }),
    hasCompletedOnboarding: true,
    bypassPermissionsModeAccepted: true,
    projects: {
      ...projects,
      [preflight.cwd]: { ...project, hasTrustDialogAccepted: true },
    },
    customApiKeyResponses: {
      ...responses,
      approved: fingerprint === undefined || approved.includes(fingerprint) ? approved : [...approved, fingerprint],
      rejected: stringList(responses['rejected']).filter((entry) => entry !== fingerprint),
    },
  }
  if (JSON.stringify(next) === JSON.stringify(config)) return
  await mkdir(dirname(configFilePath), { recursive: true, mode: 0o700 })
  const temporary = `${configFilePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    await rename(temporary, configFilePath)
  } finally {
    await rm(temporary, { force: true })
  }
}

function apiKeyFingerprint(apiKey: string | undefined): string | undefined {
  const trimmed = apiKey?.trim() ?? ''
  return trimmed === '' ? undefined : trimmed.slice(-API_KEY_FINGERPRINT_LENGTH)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}
