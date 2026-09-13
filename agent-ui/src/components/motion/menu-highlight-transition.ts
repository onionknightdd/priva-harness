import type { Transition } from "motion/react"

// Shared by the sidebar menu, file tree and slash menu highlights. Hover
// indicators are seen tens of times a day, so the motion has to be almost
// imperceptible: critically damped (no overshoot), ~90 ms to 90% of the way
// and ~130 ms to settle between adjacent rows.
// A spring rather than a tween so rapid pointer movement between rows carries
// velocity instead of restarting.
const menuHighlightTransition: Transition = {
  type: "spring",
  stiffness: 2800,
  damping: 106,
}

export { menuHighlightTransition }
