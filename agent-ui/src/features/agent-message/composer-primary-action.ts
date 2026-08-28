export type ComposerPrimaryAction = "send" | "stop"

export function composerPrimaryAction(
  draft: string,
  isStreaming: boolean,
  hasSlashCommand = false
): ComposerPrimaryAction {
  if (isStreaming && draft.trim() === "" && !hasSlashCommand) {
    return "stop"
  }
  return "send"
}
