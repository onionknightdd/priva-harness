import { memo, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { BaseEdge, EdgeLabelRenderer, Handle, NodeResizer, type Edge, type EdgeProps, type Node, type NodeProps, type Position, type Rect } from "@xyflow/react"
import { useTranslation } from "react-i18next"
import { shapePaths, strokePath } from "./whiteboard-shapes"
import { handdrawnConnectorPath } from "./whiteboard-connector-path"
import { SIDE_POSITIONS } from "./whiteboard-flow"
import { WhiteboardEditContext } from "./whiteboard-edit-context"
import type { BoardSide } from "./whiteboard-model"
import { WhiteboardEmbed } from "./whiteboard-embed"
import type { AnimationCue, BoardElement } from "./whiteboard-model"
import { useWhiteboardDrawing } from "./use-whiteboard-drawing"
import { WhiteboardDrawingFrame } from "./whiteboard-drawing-frame"

function unionBounds(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

type ElementData = { element: Exclude<BoardElement, { type: "arrow" }>; cue?: AnimationCue }
export type WhiteboardNode = Node<ElementData, "element"> | Node<Record<string, never>, "anchor">
export type WhiteboardEdge = Edge<{ element: Extract<BoardElement, { type: "arrow" }>; cue?: AnimationCue }, "arrow">
function Handles() {
  return (Object.entries(SIDE_POSITIONS) as [BoardSide, Position][]).flatMap(([side, position]) => [
    <Handle key={`source-${side}`} type="source" id={`source-${side}`} position={position} isConnectable={false} className="wb-handle" />,
    <Handle key={`target-${side}`} type="target" id={`target-${side}`} position={position} isConnectable={false} className="wb-handle" />,
  ])
}
export const WhiteboardAnchor = memo(function WhiteboardAnchor() { return <Handles /> })

function EditableText({ value, label, onCommit, className = "" }: { value: string; label: string; onCommit(value: string): void; className?: string }) {
  const { disabled } = useContext(WhiteboardEditContext)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const cancel = useRef(false)
  function begin() { if (disabled) return; cancel.current = false; setDraft(value); setEditing(true) }
  if (!editing) return <div className={`wb-label ${className}`} role="button" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled} onKeyDown={event => {
    if (event.key === "Enter" || event.key === "F2") { event.preventDefault(); event.stopPropagation(); begin() }
  }} onDoubleClick={event => { event.stopPropagation(); begin() }}>{value}</div>
  return <textarea autoFocus aria-label={label} className={`wb-edit nodrag nopan nowheel ${className}`} value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => {
    setEditing(false)
    if (!cancel.current && draft !== value) onCommit(draft)
  }} onKeyDown={event => {
    event.stopPropagation()
    if (event.key === "Escape") { cancel.current = true; setEditing(false) }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) event.currentTarget.blur()
  }} />
}

function TableCell({ text, label, onCommit }: { text: string; label: string; onCommit(value: string): void }) {
  const { disabled } = useContext(WhiteboardEditContext)
  const focused = useRef(false)
  const cancelled = useRef(false)
  const [draft, setDraft] = useState<string | null>(null)
  return <input aria-label={label} disabled={disabled} className="nodrag nopan" value={focused.current && draft !== null ? draft : text} onFocus={() => { focused.current = true; cancelled.current = false; setDraft(text) }} onChange={event => setDraft(event.target.value)} onBlur={() => {
    focused.current = false
    if (!cancelled.current && draft !== null && draft !== text) onCommit(draft)
    setDraft(null)
  }} onKeyDown={event => {
    event.stopPropagation()
    if (event.key === "Enter") event.currentTarget.blur()
    if (event.key === "Escape") { cancelled.current = true; event.currentTarget.blur() }
  }} />
}

export const WhiteboardElement = memo(function WhiteboardElement({ id, data, selected, width, height, positionAbsoluteX, positionAbsoluteY }: NodeProps<Extract<WhiteboardNode, { type?: "element" }>>) {
  const { element: e, cue } = data
  const { disabled, write, tableCell } = useContext(WhiteboardEditContext)
  const { t } = useTranslation()
  const gradientId = useId().replace(/:/g, "")
  const w = width ?? e.w, h = height ?? e.h
  const root = useRef<HTMLDivElement>(null)
  const outlinePath = useRef<SVGPathElement>(null)
  const drawing = useWhiteboardDrawing(id, cue, e, root)
  const [drawingBounds, setDrawingBounds] = useState<Rect>({ x: 0, y: 0, width: w, height: h })
  useLayoutEffect(() => {
    if (!drawing) return
    let bounds: Rect = { x: 0, y: 0, width: w, height: h }
    if (e.type === "stroke" && outlinePath.current) {
      const ink = outlinePath.current.getBBox(), halfWidth = (e.width ?? 3) / 2
      bounds = unionBounds(bounds, { x: (ink.x - halfWidth) * w / e.w, y: (ink.y - halfWidth) * h / e.h, width: (ink.width + halfWidth * 2) * w / e.w, height: (ink.height + halfWidth * 2) * h / e.h })
    }
    if ((e.type === "shape" || e.type === "container") && outlinePath.current) bounds = unionBounds(bounds, outlinePath.current.getBBox())
    const title = e.type === "container" ? root.current?.querySelector<HTMLElement>(".wb-label, .wb-edit") : null
    if (title) bounds = unionBounds(bounds, { x: title.offsetLeft, y: title.offsetTop, width: title.offsetWidth, height: title.offsetHeight })
    setDrawingBounds(bounds)
  }, [drawing, e, w, h])
  const update = (patch: Record<string, unknown>) => write([{ op: "update", id, patch }])
  const style = { "--wb-delay": `${cue?.delay ?? 0}ms`, "--wb-trace-duration": `${e.type === "stroke" ? 900 : 520}ms` } as CSSProperties
  const label = <EditableText value={e.text ?? ""} label={t("whiteboard.editLabel")} onCommit={text => update({ text })} />
  let content
  if (e.type === "shape" || e.type === "container") {
    const [body, cap] = shapePaths(e.type === "shape" ? e.kind : "rounded", w, h)
    content = <>
      <svg className="wb-shape-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--wb-fill-lit)" /><stop offset="1" stopColor="var(--wb-fill)" /></linearGradient></defs>
        <path className="wb-fill" d={body} fill={`url(#${gradientId})`} />
        <path ref={outlinePath} className="wb-outline" d={body} pathLength={1} />
        {cap && <path className="wb-cap" d={cap} pathLength={1} />}
        {cue && <circle className="wb-pen" r="3" style={{ offsetPath: `path('${body}')` }} />}
      </svg>
      {label}
    </>
  } else if (e.type === "text") content = label
  else if (e.type === "stroke") {
    const path = strokePath(e.points)
    content = <svg className="wb-stroke-svg" width={w} height={h} viewBox={`0 0 ${e.w} ${e.h}`} aria-label={e.text || "Drawing"} preserveAspectRatio="none"><path ref={outlinePath} className="wb-stroke" d={path} pathLength={1} style={{ strokeWidth: e.width ?? 3 }} />{cue && <circle className="wb-pen" r="3" style={{ offsetPath: `path('${path}')` }} />}</svg>
  }
  else if (e.type === "image") content = <img src={e.src} alt={e.alt ?? e.text ?? ""} draggable={false} referrerPolicy="no-referrer" className="wb-image" />
  else if (e.type === "html") content = <><div className="wb-embed-title">{label}</div><WhiteboardEmbed html={e.html} state={e.state} title={e.text || "Whiteboard application"} disabled={disabled} onState={state => update({ state })} /></>
  else if (e.type === "table") content = <div className="wb-table-scroll nodrag nowheel"><table><thead><tr>{e.columns.map((column, col) => <th key={col}><TableCell text={column} label={`${t("whiteboard.editLabel")} ${col + 1}`} onCommit={text => tableCell(id, -1, col, text)} /></th>)}</tr></thead><tbody>{e.rows.map((row, rowIndex) => <tr key={rowIndex} style={{ "--wb-row-delay": `${rowIndex * 55}ms` } as CSSProperties}>{e.columns.map((_, col) => <td key={col}><TableCell text={row[col] ?? ""} label={`${rowIndex + 1}, ${col + 1}`} onCommit={text => tableCell(id, rowIndex, col, text)} /></td>)}</tr>)}</tbody></table></div>
  return <>
    <NodeResizer isVisible={selected && !disabled} minWidth={32} minHeight={24} onResizeEnd={(_, params) => update({ x: params.x, y: params.y, w: params.width, h: params.height })} />
    <div ref={root} className={`wb-element wb-${e.type} wb-color-${e.color ?? "plain"}${cue ? " wb-drawing" : ""}`} style={style}>{content}</div>
    {drawing && <WhiteboardDrawingFrame id={id} bounds={{ ...drawingBounds, x: positionAbsoluteX + drawingBounds.x, y: positionAbsoluteY + drawingBounds.y }} />}
    <Handles />
  </>
})

export const WhiteboardArrow = memo(function WhiteboardArrow(props: EdgeProps<WhiteboardEdge>) {
  const { data } = props
  const [path, labelX, labelY] = useMemo(() => handdrawnConnectorPath({ id: props.id, sourceX: props.sourceX, sourceY: props.sourceY, targetX: props.targetX, targetY: props.targetY, sourcePosition: props.sourcePosition, targetPosition: props.targetPosition }), [props.id, props.sourceX, props.sourceY, props.targetX, props.targetY, props.sourcePosition, props.targetPosition])
  const { write } = useContext(WhiteboardEditContext)
  const { t } = useTranslation()
  const root = useRef<SVGGElement>(null)
  const arrowPath = useRef<SVGPathElement>(null)
  const labelRoot = useRef<HTMLDivElement>(null)
  const drawing = useWhiteboardDrawing(props.id, data?.cue, data?.element, root, labelRoot)
  const [drawingBounds, setDrawingBounds] = useState<Rect | null>(null)
  useLayoutEffect(() => {
    if (!drawing || !arrowPath.current) return
    const measure = () => {
      const ink = arrowPath.current!.getBBox()
      let bounds: Rect = { x: ink.x, y: ink.y, width: ink.width, height: ink.height }
      const label = labelRoot.current
      if (label) bounds = unionBounds(bounds, { x: labelX - label.offsetWidth / 2, y: labelY - label.offsetHeight / 2, width: label.offsetWidth, height: label.offsetHeight })
      setDrawingBounds(previous => previous && previous.x === bounds.x && previous.y === bounds.y && previous.width === bounds.width && previous.height === bounds.height ? previous : bounds)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (labelRoot.current) observer.observe(labelRoot.current)
    return () => observer.disconnect()
  }, [drawing, path, labelX, labelY, data?.element.label])
  const delay = data?.cue?.delay ?? 0
  const duration = props.sourcePosition === props.targetPosition ? 760 : 420
  const style = { "--wb-delay": `${delay}ms`, "--wb-trace-duration": `${duration}ms`, "--wb-head-delay": `${delay + duration * .8}ms` } as CSSProperties
  const labelStyle = { transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, "--wb-label-delay": `${delay + duration * .55}ms` } as CSSProperties
  return <g ref={root} className={`wb-arrow wb-color-${data?.element.color ?? "plain"}${data?.cue ? " wb-drawing" : ""}${props.selected ? " wb-arrow-selected" : ""}`} style={style}>
    <BaseEdge id={props.id} path={path} pathLength={1} style={{ stroke: "var(--wb-wire)", strokeWidth: props.selected ? 2.5 : 1.5 }} />
    <path ref={arrowPath} className="wb-arrow-head" d={path} fill="none" stroke="none" strokeWidth={props.selected ? 2.5 : 1.5} markerEnd={props.markerEnd} />
    {data?.cue && <circle className="wb-pen" r="3" style={{ offsetPath: `path('${path}')` }} />}
    {data?.element.label && <EdgeLabelRenderer><div ref={labelRoot} className={`wb-arrow-label nodrag nopan${data.cue ? " wb-arrow-label-drawing" : ""}`} style={labelStyle}><div className="wb-arrow-label-content"><EditableText value={data.element.label} label={t("whiteboard.editLabel")} onCommit={label => write([{ op: "update", id: props.id, patch: { label } }])} /></div></div></EdgeLabelRenderer>}
    {drawing && drawingBounds && <WhiteboardDrawingFrame id={props.id} bounds={drawingBounds} />}
  </g>
})
