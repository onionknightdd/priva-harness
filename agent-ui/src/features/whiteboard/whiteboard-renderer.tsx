import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Background, MiniMap, Panel, ReactFlow, ReactFlowProvider, ViewportPortal, applyEdgeChanges, applyNodeChanges, useNodesInitialized, useReactFlow, type EdgeChange, type NodeChange, type Viewport } from "@xyflow/react"
import { MaximizeIcon, MinusIcon, PlusIcon, RotateCwIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { TooltipHint } from "@/components/ui/tooltip"
import { connectWhiteboard, type WhiteboardConnectionState } from "./whiteboard-connection"
import { WhiteboardAnchor, WhiteboardArrow, WhiteboardElement, type WhiteboardEdge, type WhiteboardNode } from "./whiteboard-elements"
import { boardLayoutIssues, type AnimationCue, type Board, type BoardClaim, type BoardContext, type BoardOperation } from "./whiteboard-model"
import "@xyflow/react/dist/style.css"
import "./whiteboard.css"
import { WhiteboardEditContext } from "./whiteboard-edit-context"
import { WhiteboardDrawingContext } from "./whiteboard-drawing-context"
import { boardFlowElements, committedPositionOperations } from "./whiteboard-flow"
import { WhiteboardDownloadMenu, WhiteboardFileMenu, type WhiteboardFilePickerOptions } from "./whiteboard-menus"

const NODE_TYPES = { element: WhiteboardElement, anchor: WhiteboardAnchor }
const EDGE_TYPES = { arrow: WhiteboardArrow }
const EMPTY_CUES: Record<string, AnimationCue> = {}


export type WhiteboardCanvasProps = {
  board: Board; cues?: Record<string, AnimationCue>; claims?: BoardClaim[]; disabled?: boolean
  path?: string; filePicker?: WhiteboardFilePickerOptions
  status?: WhiteboardConnectionState; pending?: number
  onWrite(ops: BoardOperation[]): void
  onContext?(context: BoardContext): void
  onRetry?(): void
  onDrawingComplete?(id: string, revision: number): void
}
export function WhiteboardCanvas(props: WhiteboardCanvasProps) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider> }

function Canvas({ board, path, filePicker, cues = EMPTY_CUES, claims = [], disabled = false, status = "connected", pending = 0, onWrite, onContext, onRetry, onDrawingComplete }: WhiteboardCanvasProps) {
  const { t } = useTranslation()
  const initial = useMemo(() => boardFlowElements(board, cues), [board, cues])
  const [nodes, setNodes] = useState(initial.nodes)
  const [edges, setEdges] = useState(initial.edges)
  const [selection, setSelection] = useState<string[]>([])
  const [zoom, setZoom] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const exportInFlight = useRef(false)
  const filename = path?.split("/").at(-1) || board.title
  const fileLabel = path ? filename.replace(/\.json$/i, "") : filename
  const [activeDrawings, setActiveDrawings] = useState<Record<string, number>>({})
  const drawing = Object.entries(activeDrawings).some(([id, revision]) => cues[id]?.revision === revision && Object.hasOwn(board.elements, id))
  const initialized = useNodesInitialized()
  const hasFit = useRef(false)
  const api = useReactFlow<WhiteboardNode, WhiteboardEdge>()
  const latest = useRef({ board, cues, onWrite, onContext, onDrawingComplete, disabled })
  latest.current = { board, cues, onWrite, onContext, onDrawingComplete, disabled }
  const surface = useRef<HTMLDivElement>(null)
  const context = useRef<BoardContext>({ selection: [] })
  const contextTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    setNodes(previous => initial.nodes.map(node => {
      const old = previous.find(item => item.id === node.id)
      return old ? { ...node, selected: old.selected, ...(old.dragging || old.resizing ? { position: old.position, width: old.width, height: old.height, style: old.style, dragging: old.dragging, resizing: old.resizing } : {}) } : node
    }))
    setEdges(previous => initial.edges.map(edge => ({ ...edge, selected: previous.find(item => item.id === edge.id)?.selected })))
  }, [initial])
  useEffect(() => {
    if (!initialized || hasFit.current || !board.order.length) return
    hasFit.current = true
    void api.fitView({ padding: .2, minZoom: .15, maxZoom: 1 })
  }, [initialized, board.order.length, api])
  useEffect(() => {
    setActiveDrawings(previous => {
      const remaining = Object.fromEntries(Object.entries(previous).filter(([id, revision]) => cues[id]?.revision === revision && Object.hasOwn(board.elements, id)))
      return Object.keys(remaining).length === Object.keys(previous).length ? previous : remaining
    })
  }, [board.elements, cues])
  const drawingContext = useMemo(() => ({
    drawingStarted(id: string, revision: number) {
      if (latest.current.cues[id]?.revision !== revision || !Object.hasOwn(latest.current.board.elements, id)) return
      setActiveDrawings(previous => previous[id] === revision ? previous : { ...previous, [id]: revision })
    },
    drawingFinished(id: string, revision: number) {
      setActiveDrawings(previous => {
        if (previous[id] !== revision) return previous
        const next = { ...previous }; delete next[id]; return next
      })
      if (latest.current.cues[id]?.revision === revision) latest.current.onDrawingComplete?.(id, revision)
    },
  }), [])
  useEffect(() => () => clearTimeout(contextTimer.current), [])
  const reportContext = useCallback((patch: Partial<BoardContext>) => {
    context.current = { ...context.current, ...patch }
    clearTimeout(contextTimer.current)
    contextTimer.current = setTimeout(() => {
      const issues = boardLayoutIssues(latest.current.board)
      surface.current?.querySelectorAll<HTMLElement>(".react-flow__node-element .wb-label").forEach(label => {
        if (label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1) issues.push(`${label.closest("[data-id]")?.getAttribute("data-id")} text overflows its box`)
      })
      latest.current.onContext?.({ ...context.current, issues: issues.slice(0, 30) })
    }, 100)
  }, [])
  useEffect(() => { reportContext({}) }, [board, reportContext])
  const write = useCallback((ops: BoardOperation[]) => { if (!latest.current.disabled && ops.length) latest.current.onWrite(ops) }, [])
  const editContext = useMemo(() => ({ disabled, write, tableCell(id: string, row: number, column: number, text: string) {
    const element = latest.current.board.elements[id]
    if (element?.type !== "table") return
    if (row < 0) {
      const columns = [...element.columns]; columns[column] = text
      write([{ op: "update", id, patch: { columns } }])
    } else {
      const rows = element.rows.map(cells => [...cells]); rows[row][column] = text
      write([{ op: "update", id, patch: { rows } }])
    }
  } }), [disabled, write])
  const nodeChanges = useCallback((changes: NodeChange<WhiteboardNode>[]) => {
    setNodes(previous => applyNodeChanges(changes.filter(change => change.type !== "remove"), previous))
    write(committedPositionOperations(changes, latest.current.board))
  }, [write])
  const edgeChanges = useCallback((changes: EdgeChange<WhiteboardEdge>[]) => {
    setEdges(previous => applyEdgeChanges(changes.filter(change => change.type !== "remove"), previous))
  }, [])
  const selectionChanged = useCallback(({ nodes: selectedNodes, edges: selectedEdges }: { nodes: WhiteboardNode[]; edges: WhiteboardEdge[] }) => {
    const ids = [...selectedNodes, ...selectedEdges].map(item => item.id)
    setSelection(ids); reportContext({ selection: ids })
  }, [reportContext])
  const deleteSelection = () => write(selection.filter(id => Object.hasOwn(board.elements, id)).map(id => ({ op: "delete", id })))
  const download = async (format: "png" | "pdf") => {
    if (!surface.current || exportInFlight.current) return
    exportInFlight.current = true
    setExporting(true); setExportError(null)
    try {
      const { exportWhiteboard } = await import("./whiteboard-export")
      if (surface.current) await exportWhiteboard(surface.current, format, filename)
    } catch (error) {
      setExportError(t("whiteboard.exportFailed", { message: error instanceof Error ? error.message : String(error) }))
    } finally { exportInFlight.current = false; setExporting(false) }
  }
  const toolbarButton = (label: string, icon: ReactNode, action: () => void, isDisabled = false) => <TooltipHint content={label}><Button variant="ghost" size="icon-xs" aria-label={label} onClick={action} disabled={isDisabled}>{icon}</Button></TooltipHint>
  return <WhiteboardDrawingContext.Provider value={drawingContext}><WhiteboardEditContext.Provider value={editContext}><div ref={surface} className="whiteboard" aria-label={t("whiteboard.title")}>
    <ReactFlow<WhiteboardNode, WhiteboardEdge>
      nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES}
      onNodesChange={nodeChanges} onEdgesChange={edgeChanges}
      onBeforeDelete={async ({ nodes: removedNodes, edges: removedEdges }) => { write([...removedNodes, ...removedEdges].filter(item => Object.hasOwn(board.elements, item.id)).map(item => ({ op: "delete", id: item.id }))); return false }}
      onSelectionChange={selectionChanged}
      onMoveEnd={(_, viewport: Viewport) => { setZoom(viewport.zoom); reportContext({ viewport }) }}
      nodesDraggable={!disabled} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={disabled ? null : ["Backspace", "Delete"]}
      minZoom={.1} maxZoom={3} fitView fitViewOptions={{ padding: .2, maxZoom: 1 }} selectionOnDrag panOnDrag={[1, 2]} panOnScroll
    >
      <Background gap={20} size={1} />
      <Panel position="top-left" className="wb-topbar"><div className="wb-toolbar">
        {filePicker && path ? <WhiteboardFileMenu path={path} filename={filename} picker={filePicker} /> : <span className="wb-toolbar-title" title={fileLabel}>{fileLabel}</span>}
        <span className="wb-status" aria-live="polite" data-drawing={drawing}><i />{status !== "connected" ? t(`whiteboard.${status}`) : pending ? t("whiteboard.saving") : drawing ? t("whiteboard.drawing") : `${board.order.length}`}</span>
        {status !== "connected" && onRetry && toolbarButton(t("whiteboard.retry"), <RotateCwIcon />, onRetry)}
      </div>
      <div className="wb-toolbar">
        {toolbarButton(t("whiteboard.fit"), <MaximizeIcon />, () => { void api.fitView({ padding: .2, maxZoom: 1 }) })}
        {toolbarButton(t("whiteboard.zoomOut"), <MinusIcon />, () => { void api.zoomOut() })}
        <span className="text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        {toolbarButton(t("whiteboard.zoomIn"), <PlusIcon />, () => { void api.zoomIn() })}
        {toolbarButton(t("whiteboard.delete"), <Trash2Icon />, deleteSelection, disabled || !selection.length)}
        <WhiteboardDownloadMenu busy={exporting} disabled={!initialized || !board.order.length} onDownload={format => { void download(format) }} />
      </div></Panel>
      <MiniMap ariaLabel={t("whiteboard.minimap")} pannable zoomable nodeColor="var(--muted-foreground)" nodeStrokeWidth={0} />
      <ViewportPortal>{claims.map(claim => <div key={claim.id} className="wb-claim" style={{ position: "absolute", transform: `translate(${claim.x}px,${claim.y}px)`, width: claim.w, height: claim.h } as CSSProperties}><span>{claim.label}</span></div>)}</ViewportPortal>
      {!board.order.length && <Panel position="bottom-center"><p className="text-sm text-muted-foreground">{t("whiteboard.empty")}</p></Panel>}
    </ReactFlow>
    {exportError && <div role="alert" className="absolute inset-x-3 bottom-3 z-20 rounded-md border border-destructive/30 bg-background p-3 text-xs text-destructive shadow-sm">{exportError}</div>}
  </div></WhiteboardEditContext.Provider></WhiteboardDrawingContext.Provider>
}

type RendererProps = { path: string; active?: boolean; animateInitial?: boolean; filePicker?: WhiteboardFilePickerOptions; onContentChange?(content: string, revision: number): void }
export function WhiteboardRenderer(props: RendererProps) { return <WhiteboardSession key={props.path} {...props} /> }
function WhiteboardSession({ path, active = true, animateInitial = false, filePicker, onContentChange }: RendererProps) {
  const { t } = useTranslation()
  const [board, setBoard] = useState<Board | null>(null)
  const [cues, setCues] = useState<Record<string, AnimationCue>>({})
  const [claims, setClaims] = useState<BoardClaim[]>([])
  const [status, setStatus] = useState<WhiteboardConnectionState>("connecting")
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const connection = useRef<ReturnType<typeof connectWhiteboard> | null>(null)
  const firstSnapshot = useRef(true)
  const initialAnimation = useRef(animateInitial)
  const onContent = useRef(onContentChange)
  onContent.current = onContentChange
  const drawingComplete = useCallback((id: string, revision: number) => {
    setCues(previous => {
      if (previous[id]?.revision !== revision) return previous
      const next = { ...previous }; delete next[id]; return next
    })
  }, [])
  useEffect(() => {
    if (!active) { setStatus("disconnected"); setCues({}); return }
    const client = connectWhiteboard(path, {
      board(value, animations, resetAnimations) {
        if (resetAnimations && firstSnapshot.current) {
          firstSnapshot.current = false
          if (initialAnimation.current) animations = Object.fromEntries(value.order.map((id, index) => [id, { revision: value.revision, delay: Math.min(index * 70, 700) }]))
        }
        setBoard(value); setCues(previous => resetAnimations ? animations : Object.fromEntries(Object.entries({ ...previous, ...animations }).filter(([id]) => Object.hasOwn(value.elements, id)))); onContent.current?.(JSON.stringify(value, null, 2) + "\n", value.revision) },
      status: setStatus, claims: setClaims, pending: setPending, error: setError,
    })
    connection.current = client
    return () => { client.dispose(); connection.current = null }
  }, [path, active])
  return <div className="relative h-full min-h-0 w-full">
    {board ? <WhiteboardCanvas board={board} path={path} filePicker={filePicker} cues={cues} claims={claims} disabled={status !== "connected"} status={status} pending={pending} onDrawingComplete={drawingComplete} onWrite={ops => { connection.current?.write(ops) }} onContext={context => connection.current?.context(context)} onRetry={() => connection.current?.retry()} /> : <div className="whiteboard flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
      {filePicker && <div className="wb-topbar absolute left-3 top-3"><div className="wb-toolbar"><WhiteboardFileMenu path={path} filename={path.split("/").at(-1) || path} picker={filePicker} /></div></div>}
      {t(status === "connecting" ? "whiteboard.loading" : "whiteboard.disconnected")}{status !== "connecting" && <Button size="sm" variant="outline" onClick={() => connection.current?.retry()}>{t("whiteboard.retry")}</Button>}
    </div>}
    {error && <div role="alert" className="absolute inset-x-3 bottom-3 z-20 rounded-md border border-destructive/30 bg-background p-3 text-xs text-destructive shadow-sm">{error}</div>}
  </div>
}
