import { stripVTControlCharacters } from 'node:util'
import { asRecord, stringField, type JsonRecord } from '../../../core/event/json-record.js'
import type { ModelChange } from '../../../core/resource/thread.js'

/** A native caveat and parent chain distinguish local commands from pasted XML. */
export class ClaudeModelCommands {
  private readonly prompts = new Map<string, string>()
  private readonly commands = new Map<string, string>()

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
    if (parent === this.prompts.get(promptId) && /^\s*<command-name>\/model<\/command-name>\s*<command-message>model<\/command-message>\s*<command-args>[\s\S]*<\/command-args>\s*$/u.test(content)) {
      this.commands.set(promptId, uuid)
      return { ...record, origin: { type: 'model-command', commandId: uuid } }
    }
    const commandId = this.commands.get(promptId)
    if (commandId && parent === commandId && /^\s*<local-command-stdout>[\s\S]*<\/local-command-stdout>\s*$/u.test(content)) {
      return { ...record, origin: { type: 'model-command-result', commandId } }
    }
    return undefined
  }
}

export function claudeModelChange(content: string): ModelChange {
  const output = stripVTControlCharacters(content.replace(/^\s*<local-command-stdout>|<\/local-command-stdout>\s*$/gu, '')).trim()
  const firstLine = output.split('\n')[0] ?? ''
  const model = firstLine.startsWith('Set model to ')
    ? firstLine.slice('Set model to '.length).replace(/ and saved as your default for new sessions$/u, '').replace(/^`|`$/gu, '').trim()
    : undefined
  return { ...(model ? { model } : {}), output }
}
