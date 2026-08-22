import type { SessionInfo, SessionProjectGroup } from "@/lib/api/sandbox-sessions"

export function projectDisplayName(cwd: string, fallback: string) {
  const trimmed = cwd.replace(/[\\/]+$/u, "")
  if (!trimmed) {
    return fallback
  }

  const segments = trimmed.split(/[\\/]/u).filter(Boolean)
  return segments.at(-1) ?? fallback
}

export function sessionDisplayTitle(session: SessionInfo, fallback: string) {
  const title =
    session.customTitle?.trim() ||
    session.summary.trim() ||
    session.firstPrompt?.trim()

  return title || fallback
}

export function sessionMatchesQuery(session: SessionInfo, query: string, fallback: string) {
  const haystack = [
    sessionDisplayTitle(session, fallback),
    session.sessionId,
    ...session.tags,
  ]
    .join(" ")
    .toLocaleLowerCase()

  return haystack.includes(query)
}

export function sessionMatchesTags(session: SessionInfo, tags: readonly string[]) {
  if (tags.length === 0) {
    return true
  }

  const selected = new Set(tags.map((tag) => tag.toLocaleLowerCase()))
  return session.tags.some((tag) => selected.has(tag.toLocaleLowerCase()))
}

export function groupMatchesQuery(
  group: SessionProjectGroup,
  query: string,
  untitled: string,
  unknownProject: string,
  tags: readonly string[] = []
) {
  const sessions = filterGroupSessions(
    group,
    query,
    untitled,
    unknownProject,
    tags
  )
  if (sessions.length > 0) {
    return true
  }

  if (tags.length > 0) {
    return false
  }

  if (!query) {
    return true
  }

  const projectName = projectDisplayName(group.cwd, unknownProject).toLocaleLowerCase()
  return (
    group.cwd.toLocaleLowerCase().includes(query) || projectName.includes(query)
  )
}

export function filterGroupSessions(
  group: SessionProjectGroup,
  query: string,
  untitled: string,
  unknownProject: string,
  tags: readonly string[] = []
) {
  let sessions = group.sessions

  if (query) {
    const projectMatched =
      group.cwd.toLocaleLowerCase().includes(query) ||
      projectDisplayName(group.cwd, unknownProject)
        .toLocaleLowerCase()
        .includes(query)

    if (!projectMatched) {
      sessions = sessions.filter((session) =>
        sessionMatchesQuery(session, query, untitled)
      )
    }
  }

  if (tags.length > 0) {
    sessions = sessions.filter((session) => sessionMatchesTags(session, tags))
  }

  return sessions
}

export const MAX_SESSION_TAGS = 3
export const TAG_COLOR_COUNT = 300

type TagBadgeColors = {
  backgroundColor: string
  color: string
}

function tagBadgeColors(index: number): TagBadgeColors {
  const slot =
    ((Math.trunc(index) % TAG_COLOR_COUNT) + TAG_COLOR_COUNT) % TAG_COLOR_COUNT
  const hue = (slot * 137.507764) % 360
  const chroma = [0.19, 0.12, 0.04][slot % 3] ?? 0.12
  const highSaturation = chroma >= 0.1
  let lightness = highSaturation ? 0.52 : 0.82

  if (highSaturation && hue >= 40 && hue <= 120) {
    lightness = 0.42
  }

  return {
    backgroundColor: `oklch(${lightness} ${chroma} ${hue})`,
    color: highSaturation ? "oklch(0.99 0 0)" : "oklch(0.2 0 0)",
  }
}

export const TAG_BADGE_PALETTE: readonly TagBadgeColors[] = Array.from(
  { length: TAG_COLOR_COUNT },
  (_, index) => tagBadgeColors(index)
)

export function tagBadgeStyle(index: number): TagBadgeColors {
  const slot =
    ((Math.trunc(index) % TAG_COLOR_COUNT) + TAG_COLOR_COUNT) % TAG_COLOR_COUNT
  return TAG_BADGE_PALETTE[slot] ?? TAG_BADGE_PALETTE[0]!
}

export function tagSwatch(index: number) {
  return tagBadgeStyle(index).backgroundColor
}

export function fallbackTagColorIndex(tag: string) {
  let value = 2_166_136_261
  for (const byte of new TextEncoder().encode(tag.toLowerCase())) {
    value ^= byte
    value = Math.imul(value, 16_777_619) >>> 0
  }
  return value % TAG_COLOR_COUNT
}

export type KnownSessionTag = {
  name: string
  color: number
}

export function collectKnownTags(groups: SessionProjectGroup[]): KnownSessionTag[] {
  const colors: Record<string, number> = {}
  const names: string[] = []
  const seen = new Set<string>()

  for (const group of groups) {
    for (const session of group.sessions) {
      Object.assign(colors, session.tagColors)
      for (const tag of session.tags) {
        const key = tag.toLocaleLowerCase()
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        names.push(tag)
      }
    }
  }

  return names.map((name) => ({
    name,
    color: colors[name] ?? fallbackTagColorIndex(name),
  }))
}
