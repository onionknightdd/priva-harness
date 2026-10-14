import { stripVTControlCharacters } from 'node:util'
import { asRecord, stringField, type JsonRecord } from '../../../core/event/json-record.js'
import type { EffortChange, ModelChange } from '../../../core/resource/thread.js'

/** A native caveat and parent chain distinguish local commands from pasted XML. */
export class ClaudeSettingCommands {
  private readonly prompts = new Map<string, string>()
  private readonly commands = new Map<string, { id: string; name: string }>()

  record(record: JsonRecord): JsonRecord | undefined {
    if (record['type'] !== 'user' || record['isSidechain'] === true || record['is_sidechain'] === true) return undefined
    const promptId = stringField(record, 'promptId'), uuid = stringField(record, 'uuid')
    const content = asRecord(record['message'])?.['content']
    if (!promptId || !uuid || typeof content !== 'string') return undefined
    if (record['isMeta'] === true && /^\s*<local-command-caveat>[\s\S]*<\/local-command-caveat>\s*$/u.test(content)) {
      this.prompts.set(promptId, uuid)
      return undefined
    }
    const parent = stringField(record, 'parentUuid')
    if (!parent) return undefined
    const name = /^\s*<command-name>\/(model|effort)<\/command-name>\s*<command-message>\1<\/command-message>\s*<command-args>[\s\S]*<\/command-args>\s*$/u.exec(content)?.[1]
    if (parent === this.prompts.get(promptId) && name) {
      this.commands.set(promptId, { id: uuid, name })
      return { ...record, origin: { type: `${name}-command`, commandId: uuid } }
    }
    const command = this.commands.get(promptId)
    if (parent === command?.id && /^\s*<local-command-stdout>[\s\S]*<\/local-command-stdout>\s*$/u.test(content)) {
      return { ...record, origin: { type: `${command.name}-command-result`, commandId: command.id } }
    }
    return undefined
  }
}

export function claudeModelChange(content: string): ModelChange {
  const output = commandOutput(content)
  const firstLine = output.split('\n')[0] ?? ''
  const model = firstLine.startsWith('Set model to ')
    ? firstLine.slice('Set model to '.length).replace(/ and saved as your default for new sessions$/u, '').replace(/^`|`$/gu, '').trim()
    : undefined
  return { ...(model ? { model } : {}), output }
}

export function claudeEffortChange(content: string): EffortChange {
  const output = commandOutput(content)
  // Only native success output confirms a change; arguments may be rejected,
  // capped by policy, or overridden by the environment.
  const effort = /^Set effort level to (low|medium|high|xhigh|max|ultracode)\b/iu.exec(output)?.[1]?.toLowerCase()
    ?? (/^Effort level set to auto\b/u.test(output) ? 'auto' : undefined)
  return { ...(effort ? { effort } : {}), output }
}

function commandOutput(content: string): string {
  return stripVTControlCharacters(content.replace(/^\s*<local-command-stdout>|<\/local-command-stdout>\s*$/gu, '')).trim()
}
