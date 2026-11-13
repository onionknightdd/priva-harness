import { useContext, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { WhiteboardDrawingContext } from "./whiteboard-drawing-context"
import type { AnimationCue, BoardElement } from "./whiteboard-model"

const DRAWING_PLAYBACK_RATE = 2 / 3

// The arrow's label is in a separate portal, so both animation roots participate.
export function useWhiteboardDrawing(id: string, cue: AnimationCue | undefined, element: BoardElement | undefined, root: RefObject<Element | null>, label?: RefObject<Element | null>) {
  const { drawingStarted, drawingFinished } = useContext(WhiteboardDrawingContext)
  const [activeRevision, setActiveRevision] = useState<number | null>(null)
  const previousRevision = useRef<number | undefined>(undefined)
  const revision = cue?.revision
  const delay = cue?.delay
  // Recollect on content updates: a label or table row can arrive mid-drawing.
  useLayoutEffect(() => {
    if (revision === undefined) return
    let disposed = false
    let started = false
    const roots = [root.current, label?.current].filter((element): element is Element => !!element)
    const animations = roots.flatMap(element => element.getAnimations({ subtree: true })).filter((animation): animation is CSSAnimation => animation instanceof CSSAnimation && animation.animationName.startsWith("wb-"))
    animations.forEach(animation => animation.updatePlaybackRate(DRAWING_PLAYBACK_RATE))
    // Batched delete/recreate can retain the DOM while introducing a new cue.
    if (previousRevision.current !== undefined && previousRevision.current !== revision) animations.forEach(animation => { animation.currentTime = 0; animation.play() })
    previousRevision.current = revision
    const start = () => {
      if (disposed || started) return
      started = true
      setActiveRevision(revision)
      drawingStarted(id, revision)
    }
    const hasStarted = () => animations.some(animation => animation.playState !== "finished" && Number(animation.currentTime ?? -1) >= (animation.effect?.getTiming().delay ?? 0))
    const onStart = (event: Event) => {
      if ((event as AnimationEvent).animationName.startsWith("wb-") && hasStarted()) start()
    }
    roots.forEach(element => element.addEventListener("animationstart", onStart))
    // An already-running animation can survive a Strict Mode effect remount.
    if (hasStarted()) start()
    // Cancellation (including reduced motion) is also a completed drawing cue.
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (disposed) return
      setActiveRevision(null)
      drawingFinished(id, revision)
    })
    return () => {
      disposed = true
      roots.forEach(element => element.removeEventListener("animationstart", onStart))
    }
  }, [id, revision, delay, element, root, label, drawingStarted, drawingFinished])
  return revision !== undefined && activeRevision === revision
}
