export type ComposerPrimaryAction = "send" | "stop"

export function composerPrimaryAction(
  draft: string,
  isStreaming: boolean,
  hasSlashCommand = false,
  hasAttachments = false
): ComposerPrimaryAction {
  if (isStreaming && draft.trim() === "" && !hasSlashCommand && !hasAttachments) {
    return "stop"
  }
  return "send"
}
