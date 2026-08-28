import type { SlashCommand, SlashKind } from "@/lib/api/slash-commands"

export type SlashTrigger = {
  query: string
}

export function parseSlashTrigger(draft: string): SlashTrigger | null {
  if (!draft.startsWith("/")) {
    return null
  }

  const firstLine = draft.split("\n", 1)[0] ?? draft
  if (/\s/.test(firstLine)) {
    return null
  }

  return { query: firstLine.slice(1) }
}

export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string
): SlashCommand[] {
  const needle = query.trim().replace(/^\//, "").toLocaleLowerCase()
  if (needle === "") {
    return [...commands]
  }

  return commands.filter((command) => {
    if (command.name.toLocaleLowerCase().includes(needle)) {
      return true
    }
    if (command.description.toLocaleLowerCase().includes(needle)) {
      return true
    }
    return command.aliases?.some((alias) =>
      alias.toLocaleLowerCase().includes(needle)
    )
  })
}

export function groupSlashCommands(commands: readonly SlashCommand[]): {
  kind: SlashKind
  commands: SlashCommand[]
}[] {
  const grouped: { kind: SlashKind; commands: SlashCommand[] }[] = [
    { kind: "command", commands: [] },
    { kind: "skill", commands: [] },
  ]

  for (const command of commands) {
    const group = grouped.find((item) => item.kind === command.kind)
    group?.commands.push(command)
  }

  return grouped.filter((group) => group.commands.length > 0)
}

export function composeSlashMessage(name: string, draft: string): string {
  return `/${name} ${draft}`.trim()
}

export function applySlashSelection(draft: string): string {
  return draft.replace(/^\/[^\s]*[ \t]*/u, "")
}

export function shouldDeleteSlashChip(
  selectionStart: number,
  selectionEnd: number
): boolean {
  return selectionStart === 0 && selectionEnd === 0
}

const SLASH_MENU_VIEWPORT_INSET_PX = 8

export function slashOptionId(menuId: string, index: number) {
  return `${menuId}-option-${index}`
}

export function positionSlashMenuPanel(
  anchorTop: number,
  anchorLeft: number,
  viewportWidth: number,
  viewportHeight: number,
  panelWidth: number,
  gap = SLASH_MENU_VIEWPORT_INSET_PX
): { left: number; bottom: number; width: number } {
  const width = Math.min(
    panelWidth,
    Math.max(0, viewportWidth - SLASH_MENU_VIEWPORT_INSET_PX * 2)
  )
  const maxLeft = viewportWidth - width - SLASH_MENU_VIEWPORT_INSET_PX
  return {
    left: Math.min(
      Math.max(SLASH_MENU_VIEWPORT_INSET_PX, anchorLeft),
      Math.max(SLASH_MENU_VIEWPORT_INSET_PX, maxLeft)
    ),
    bottom: Math.max(gap, viewportHeight - anchorTop + gap),
    width,
  }
}
