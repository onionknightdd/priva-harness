import { ViewportPortal, type Rect } from "@xyflow/react"
import { useLayoutEffect, useRef, type RefObject } from "react"
import { cancelFrame, frame, useMotionValue } from "motion/react"
import { Cursor, CursorFollow, CursorProvider } from "@/components/animate-ui/primitives/animate-ui/cursor"

type RevealProgress = { animations: CSSAnimation[] | null; from: number; duration: number; progress: number }

function drawingProgress(animations: CSSAnimation[], reveal: RevealProgress) {
  const active = animations.filter(animation => animation.playState !== "idle")
  if (!active.length) return 0
  const trace = active.find(animation => animation.animationName === "wb-trace" && animation.effect instanceof KeyframeEffect && animation.effect.target?.matches(".wb-outline, .wb-stroke, .react-flow__edge-path"))
  if (trace?.effect instanceof KeyframeEffect && trace.effect.target) {
    // CSS keyframe easing is already reflected in the rendered ink position.
    return Math.max(0, Math.min(1, 1 - Number.parseFloat(getComputedStyle(trace.effect.target).strokeDashoffset)))
  }
  let start = Infinity, end = 0, remaining = 0
  for (const animation of active) {
    if (!animation.effect) continue
    const timing = animation.effect.getComputedTiming()
    start = Math.min(start, timing.delay ?? 0)
    end = Math.max(end, Number(timing.endTime))
    // Appended rows start their own local clock; compare remaining durations.
    remaining = Math.max(remaining, Number(timing.endTime) - Number(animation.currentTime ?? 0))
  }
  if (reveal.animations !== animations) {
    reveal.duration = reveal.animations ? remaining : Math.max(0, end - start)
    reveal.from = reveal.progress
    reveal.animations = animations
  }
  const progress = reveal.duration > 0 ? 1 - remaining / reveal.duration : 1
  reveal.progress = Math.max(reveal.progress, Math.min(1, reveal.from + (1 - reveal.from) * progress))
  return reveal.progress
}

export function WhiteboardDrawingFrame({ id, bounds, animations }: { id: string; bounds: Rect; animations: RefObject<CSSAnimation[]> }) {
  const padding = 8
  const width = bounds.width + padding * 2, height = bounds.height + padding * 2
  const outline = useRef<SVGSVGElement>(null)
  const cursorX = useMotionValue(padding * 2)
  const cursorY = useMotionValue(padding * 2)
  const reveal = useRef<RevealProgress>({ animations: null, from: 0, duration: 0, progress: 0 })
  useLayoutEffect(() => {
    let previousTransform = ""
    const update = () => {
      if (!outline.current) return
      const progress = drawingProgress(animations.current, reveal.current)
      const drawnWidth = padding * 2 + bounds.width * progress
      const drawnHeight = padding * 2 + bounds.height * progress
      const transform = `scale(${drawnWidth / width}, ${drawnHeight / height})`
      if (previousTransform !== transform) {
        outline.current.style.transform = transform
        outline.current.style.visibility = "visible"
        cursorX.set(drawnWidth)
        cursorY.set(drawnHeight)
        previousTransform = transform
      }
    }
    update()
    // Sample before Motion renders cursor positions, so all three paint together.
    frame.update(update, true)
    return () => cancelFrame(update)
  }, [animations, bounds.width, bounds.height, width, height, cursorX, cursorY])
  return <ViewportPortal><div className="wb-drawing-frame" data-element-id={id} aria-hidden="true" style={{ transform: `translate(${bounds.x - padding}px, ${bounds.y - padding}px)`, width, height }}>
    <svg ref={outline} className="wb-drawing-outline" width={width} height={height} aria-hidden="true"><rect x=".75" y=".75" width={width - 1.5} height={height - 1.5} rx="3" vectorEffect="non-scaling-stroke" /></svg>
    <CursorProvider x={cursorX} y={cursorY}>
      <Cursor className="wb-drawing-cursor"><svg viewBox="0 0 40 40" aria-hidden="true"><path fill="currentColor" d="M1.8 4.4 7 36.2c.3 1.8 2.6 2.3 3.6.8l3.9-5.7c1.7-2.5 4.5-4.1 7.5-4.3l6.9-.5c1.8-.1 2.5-2.4 1.1-3.5L5 2.5c-1.4-1.1-3.5 0-3.3 1.9Z" /></svg></Cursor>
      <CursorFollow className="wb-drawing-cursor-label">Bambuddy</CursorFollow>
    </CursorProvider>
  </div></ViewportPortal>
}
