import type { TFunction } from "i18next"

/** A stable slice of a sentence. `count` is the only part that should roll when its digits change. */
export type StatusPiece = {
  id: string
  text: string
  count?: boolean
  /** Changing text stays put. Used for the running clock. */
  steady?: boolean
}

const COUNT_MARK = "%%COUNT%%"

export function joinStatusText(pieces: readonly StatusPiece[]): string {
  return pieces.map((piece) => piece.text).join("")
}

/** Split one translated "{{count}}" phrase into the words around the number. */
export function countPhrasePieces(
  t: TFunction,
  key: string,
  count: number,
  id: string
): StatusPiece[] {
  const marked = t(key, { count: COUNT_MARK })
  const countText = String(count)
  const index = marked.indexOf(COUNT_MARK)
  if (index < 0) return [{ id: `${id}:label`, text: t(key, { count }) }]
  const before = marked.slice(0, index)
  const after = marked.slice(index + COUNT_MARK.length)
  const pieces: StatusPiece[] = []
  if (before) pieces.push({ id: `${id}:before`, text: before })
  pieces.push({ id: `${id}:count`, text: countText, count: true })
  if (after) pieces.push({ id: `${id}:after`, text: after })
  return pieces
}

/** Split a translation that contains several "{{name}}" numbers, in source order. */
export function slottedPieces(
  t: TFunction,
  key: string,
  values: Record<string, number>
): StatusPiece[] {
  const marks = Object.fromEntries(
    Object.keys(values).map((name) => [name, `%%${name}%%`])
  )
  const marked = t(key, marks)
  if (Object.values(marks).some((mark) => !marked.includes(mark))) {
    return [{ id: `${key}:label`, text: t(key, values) }]
  }

  const slots = Object.entries(values).map(([name, value]) => ({
    name,
    value: String(value),
    mark: marks[name],
  }))
  const pieces: StatusPiece[] = []
  let rest = marked
  let literal = 0
  while (rest.length > 0) {
    let nextAt = -1
    let next: (typeof slots)[number] | undefined
    for (const slot of slots) {
      const at = rest.indexOf(slot.mark)
      if (at >= 0 && (nextAt < 0 || at < nextAt)) {
        nextAt = at
        next = slot
      }
    }
    if (next === undefined || nextAt < 0) {
      pieces.push({ id: `${key}:text:${String(literal)}`, text: rest })
      break
    }
    if (nextAt > 0) {
      pieces.push({
        id: `${key}:text:${String(literal)}`,
        text: rest.slice(0, nextAt),
      })
      literal += 1
    }
    pieces.push({ id: `${key}:${next.name}`, text: next.value, count: true })
    rest = rest.slice(nextAt + next.mark.length)
  }
  return pieces
}

export function tokenPieces(tokens: number): StatusPiece[] {
  return [
    { id: "tokens", text: tokens.toLocaleString(), count: true },
    { id: "unit", text: " tokens" },
  ]
}

export function ratioPieces(completed: number, total: number): StatusPiece[] {
  return [
    { id: "completed", text: String(completed), count: true },
    { id: "slash", text: "/" },
    { id: "total", text: String(total), count: true },
  ]
}
