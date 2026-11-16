export type ShapeKind = "rect" | "rounded" | "pill" | "ellipse" | "diamond" | "hexagon" | "parallelogram" | "database" | "queue" | "document" | "cloud" | "person"
export type BoardColor = "plain" | "gray" | "blue" | "green" | "amber" | "rose" | "violet"
export type BoardPoint = { x: number; y: number }
export type BoardSide = "top" | "right" | "bottom" | "left"
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type PositionedElement = BoardPoint & { w: number; h: number; text?: string; color?: BoardColor; parentId?: string }
export type BoardElement =
  | (PositionedElement & { type: "shape"; kind: ShapeKind })
  | (PositionedElement & { type: "text" | "container" })
  | (PositionedElement & { type: "table"; columns: string[]; rows: string[][] })
  | (PositionedElement & { type: "html"; html: string; state?: JsonValue })
  | (PositionedElement & { type: "image"; src: string; alt?: string })
  | (PositionedElement & { type: "stroke"; points: [number, number][]; width?: number })
  | { type: "arrow"; from: string | BoardPoint; to: string | BoardPoint; fromSide?: BoardSide; toSide?: BoardSide; label?: string; color?: BoardColor }
export type Board = { v: 1; title: string; revision: number; order: string[]; elements: Record<string, BoardElement> }
export type BoardOperation = { op: "set"; id: string; element: BoardElement } | { op: "update"; id: string; patch: Record<string, unknown> } | { op: "delete"; id: string }
export type BoardClaim = { id: string; label: string; x: number; y: number; w: number; h: number }
export type BoardContext = { selection: string[]; viewport?: { x: number; y: number; zoom: number }; issues?: string[] }
export type AnimationCue = { revision: number; delay: number }

/** A missed delta must be recovered with a fresh snapshot, never applied to stale state. */
export function applyBoardChange(board: Board, revision: number, ops: BoardOperation[], title: string, finalOrder?: string[]): Board {
  if (revision !== board.revision + 1) throw new Error("Whiteboard revision gap; reconnecting to reload")
  const elements = { ...board.elements }
  let order = [...board.order]
  for (const op of ops) {
    if (op.op === "set") {
      if (!Object.hasOwn(elements, op.id)) order.push(op.id)
      Object.defineProperty(elements, op.id, { value: op.element, enumerable: true, configurable: true, writable: true })
    } else if (op.op === "update") {
      if (!Object.hasOwn(elements, op.id)) throw new Error("Whiteboard update references a missing element")
      elements[op.id] = { ...elements[op.id], ...op.patch } as BoardElement
    } else {
      delete elements[op.id]
      order = order.filter(id => id !== op.id)
    }
  }
  return { ...board, title, revision, order: finalOrder ?? order, elements }
}

export function createdElementCues(board: Board, ops: BoardOperation[], revision: number, source: string): Record<string, AnimationCue> {
  if (source !== "agent") return {}
  const result: Record<string, AnimationCue> = {}
  let index = 0
  for (const op of ops) {
    if (op.op === "set" && !Object.hasOwn(board.elements, op.id)) {
      result[op.id] = { revision, delay: Math.min(index++ * 70, 700) }
    }
  }
  return result
}

export function parentFirstIds(board: Board): string[] {
  const seen = new Set<string>(), ordered: string[] = []
  const visit = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    const element = board.elements[id]
    if (!element) return
    if ("parentId" in element && element.parentId) visit(element.parentId)
    ordered.push(id)
  }
  board.order.forEach(visit)
  return ordered
}

export function absolutePosition(id: string, board: Board): BoardPoint {
  let current = board.elements[id]
  const seen = new Set<string>([id])
  let x = 0, y = 0
  while (current && current.type !== "arrow") {
    x += current.x; y += current.y
    if (!current.parentId || seen.has(current.parentId)) break
    seen.add(current.parentId)
    current = board.elements[current.parentId]
  }
  return { x, y }
}

/** Layout feedback ignores intentional containment and compares peers only. */
export function boardLayoutIssues(board: Board): string[] {
  const issues: string[] = []
  const entries = board.order.flatMap(id => {
    const element = board.elements[id]
    return element && element.type !== "arrow" ? [{ id, element }] : []
  })
  for (let i = 0; i < entries.length && issues.length < 30; i++) {
    const { id, element } = entries[i]
    if (element.parentId) {
      const parent = board.elements[element.parentId]
      if (parent && parent.type !== "arrow" && (element.x < 0 || element.y < 0 || element.x + element.w > parent.w || element.y + element.h > parent.h)) issues.push(`${id} extends outside ${element.parentId}`)
    }
    if (element.type === "container") continue
    for (const other of entries.slice(i + 1)) {
      if (other.element.type === "container" || element.parentId !== other.element.parentId) continue
      if (element.x < other.element.x + other.element.w && element.x + element.w > other.element.x && element.y < other.element.y + other.element.h && element.y + element.h > other.element.y) issues.push(`${id} overlaps ${other.id}`)
      if (issues.length >= 30) break
    }
  }
  return issues
}
