import { ViewportPortal, type Rect } from "@xyflow/react"

export function WhiteboardDrawingFrame({ id, bounds }: { id: string; bounds: Rect }) {
  const padding = 8
  return <ViewportPortal><div className="wb-drawing-frame" data-element-id={id} aria-hidden="true" style={{ transform: `translate(${bounds.x - padding}px, ${bounds.y - padding}px)`, width: bounds.width + padding * 2, height: bounds.height + padding * 2 }}>
    <div className="wb-drawing-tab"><svg viewBox="0 0 112 26" aria-hidden="true"><path d="M0 26 C7 26 8 20 10 10 C11 4 15 0 21 0 H91 C97 0 101 4 102 10 C104 20 105 26 112 26 Z" /></svg><span>Bambuddy</span></div>
  </div></ViewportPortal>
}
