import type { SlashCommand, SlashKind, SlashOrigin } from "@/lib/api/slash-commands"

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

const DESCRIPTION_NEEDLE_MIN = 3

export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string
): SlashCommand[] {
  const needle = query.trim().replace(/^\//, "").toLocaleLowerCase()
  if (needle === "") {
    return [...commands]
  }

  return commands
    .flatMap((command) => {
      const rank = slashMatchRank(command, needle)
      return rank === null ? [] : [{ command, rank }]
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        slashKindRank(left.command.kind) - slashKindRank(right.command.kind) ||
        left.command.name.localeCompare(right.command.name)
    )
    .map((item) => item.command)
}

function slashKindRank(kind: SlashKind): number {
  return kind === "command" ? 0 : 1
}

function slashMatchRank(command: SlashCommand, needle: string): number | null {
  const name = command.name.toLocaleLowerCase()
  const aliases = (command.aliases ?? []).map((alias) =>
    alias.toLocaleLowerCase()
  )
  if (name.startsWith(needle)) {
    return 0
  }
  if (aliases.some((alias) => alias.startsWith(needle))) {
    return 1
  }
  if (name.includes(needle)) {
    return 2
  }
  if (aliases.some((alias) => alias.includes(needle))) {
    return 3
  }
  if (descriptionMatches(command.description, needle)) {
    return 4
  }
  return null
}

function descriptionMatches(description: string, needle: string): boolean {
  if (needle.length < DESCRIPTION_NEEDLE_MIN) {
    return false
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}`, "iu").test(description)
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

export function visibleSlashCommands(
  commands: readonly SlashCommand[]
): SlashCommand[] {
  return groupSlashCommands(commands).flatMap((group) => group.commands)
}

export function slashMenuHoverMoved(
  origin: { x: number; y: number } | null,
  point: { x: number; y: number }
): boolean {
  if (origin === null) {
    return false
  }
  return origin.x !== point.x || origin.y !== point.y
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

export function slashGroupId(menuId: string, kind: SlashKind) {
  return `${menuId}-group-${kind}`
}

export function slashRevealTargetId(
  menuId: string,
  highlightedIndex: number,
  groups: readonly { kind: SlashKind; commands: readonly unknown[] }[]
): string {
  let index = 0
  for (const group of groups) {
    if (highlightedIndex === index) {
      return slashGroupId(menuId, group.kind)
    }
    index += group.commands.length
  }
  return slashOptionId(menuId, highlightedIndex)
}

export function slashKindLabelKey(kind: SlashKind) {
  return kind === "skill"
    ? "agentMessage.slashSkillGroup"
    : "agentMessage.slashCommandGroup"
}

export function slashOriginLabelKey(origin: SlashOrigin) {
  switch (origin) {
    case "user":
      return "agentMessage.slashOriginUser"
    case "project":
      return "agentMessage.slashOriginProject"
    default:
      return "agentMessage.slashOriginBuiltin"
  }
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
