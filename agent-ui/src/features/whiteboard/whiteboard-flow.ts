import { MarkerType, Position, type NodeChange } from "@xyflow/react"
import { parentFirstIds, type Board, type AnimationCue, type BoardSide, type BoardOperation } from "./whiteboard-model"
import type { WhiteboardEdge, WhiteboardNode } from "./whiteboard-elements"

export const SIDE_POSITIONS: Record<BoardSide, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

export function boardFlowElements(board: Board, cues: Record<string, AnimationCue> = {}) {
  const nodes: WhiteboardNode[] = []
  const edges: WhiteboardEdge[] = []
  for (const id of parentFirstIds(board)) {
    const element = board.elements[id]
    if (element.type === "arrow") {
      const arrow = element
      function endpoint(side: "from" | "to") {
        const point = arrow[side]
        if (typeof point === "string") return point
        let anchorId = `__whiteboard_anchor__${id}__${side}`
        while (Object.hasOwn(board.elements, anchorId)) anchorId += "_"
        nodes.push({ id: anchorId, type: "anchor", position: point, data: {}, width: 1, height: 1, style: { width: 1, height: 1 }, draggable: false, selectable: false, deletable: false, focusable: false, ariaLabel: "Arrow endpoint" })
        return anchorId
      }
      edges.push({ id, type: "arrow", source: endpoint("from"), target: endpoint("to"), sourceHandle: `source-${arrow.fromSide ?? "right"}`, targetHandle: `target-${arrow.toSide ?? "left"}`, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: arrow.color && arrow.color !== "plain" && arrow.color !== "gray" ? `oklch(var(--wb-ll) var(--wb-lc) ${{ blue: 250, green: 158, amber: 78, rose: 12, violet: 300 }[arrow.color]})` : "var(--wb-wire)" }, data: { element, cue: cues[id] }, zIndex: 2, ariaLabel: arrow.label || "Arrow" })
    } else nodes.push({ id, type: "element", position: { x: element.x, y: element.y }, width: element.w, height: element.h, style: { width: element.w, height: element.h }, parentId: element.parentId, data: { element, cue: cues[id] }, zIndex: element.type === "container" ? 0 : 1, ariaLabel: element.text || element.type })
  }
  return { nodes, edges }
}


/** React Flow marks both keyboard moves and pointer drag completion with dragging:false. */
export function committedPositionOperations(changes: NodeChange<WhiteboardNode>[], board: Board): BoardOperation[] {
  return changes.flatMap(change => {
    if (!("id" in change)) return []
    const element = board.elements[change.id]
    if (change.type !== "position" || change.dragging !== false || !change.position || !element || element.type === "arrow") return []
    if (element.x === change.position.x && element.y === change.position.y) return []
    return [{ op: "update", id: change.id, patch: { x: change.position.x, y: change.position.y } }]
  })
}
