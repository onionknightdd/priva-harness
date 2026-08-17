import type { Transition } from "motion/react"

const menuHighlightTransition: Transition = {
  type: "spring",
  stiffness: 350,
  damping: 35,
}

export { menuHighlightTransition }
