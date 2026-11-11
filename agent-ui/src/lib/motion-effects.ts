import { EASE_OUT_CSS } from "@/lib/ease"

// One-shot feedback played with the Web Animations API: entrances, icon pops
// and other tweens that need no timeline. The browser runs them off the main
// thread and drops them when they finish, so nothing has to be cleared after.
// Every helper skips the motion under `prefers-reduced-motion` and returns a
// function that cancels what it started, which fits an effect's cleanup.

/** Overshoots slightly before settling, for a control confirming a press. */
const EASE_BACK_OUT_CSS = "cubic-bezier(0.34, 1.56, 0.64, 1)"

type MotionTargets = Element | Iterable<Element> | null | undefined

type MotionOptions = {
  /** Milliseconds for one target. */
  duration?: number
  /** Milliseconds between consecutive targets. */
  stagger?: number
  easing?: string
}

function noop() {}

function toElements(targets: MotionTargets) {
  if (!targets) return []
  return targets instanceof Element ? [targets] : [...targets]
}

/**
 * Plays `keyframes` on each target. A single keyframe is the starting state:
 * the browser animates from it to the element's own style.
 */
function playMotion(
  targets: MotionTargets,
  keyframes: Keyframe[],
  { duration = 220, stagger = 0, easing = EASE_OUT_CSS }: MotionOptions = {}
) {
  const elements = toElements(targets)

  if (
    elements.length === 0 ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return noop
  }

  const animations = elements.map((element, index) =>
    element.animate(keyframes, {
      duration,
      easing,
      delay: index * stagger,
      // Later targets hold the starting state while they wait their turn.
      fill: "backwards",
    })
  )

  return () => animations.forEach((animation) => animation.cancel())
}

/** Fade in while rising (or sliding) into place. */
function playEnter(
  targets: MotionTargets,
  { x = 0, y = 0, ...options }: MotionOptions & { x?: number; y?: number } = {}
) {
  return playMotion(
    targets,
    [{ opacity: 0, translate: `${x}px ${y}px` }],
    options
  )
}

/** Press confirmation: the control's icon (or the control) pops back to size. */
function playControlPop(control: Element) {
  return playMotion(
    control.querySelector("svg") ?? control,
    [{ scale: 0.78 }],
    { duration: 280, easing: EASE_BACK_OUT_CSS }
  )
}

export { playControlPop, playEnter, playMotion }
