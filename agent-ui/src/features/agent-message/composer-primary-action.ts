export type ComposerPrimaryAction = "send" | "stop"

export function composerPrimaryAction(
  draft: string,
  isStreaming: boolean
): ComposerPrimaryAction {
  if (isStreaming && draft.trim() === "") {
    return "stop"
  }
  return "send"
}
