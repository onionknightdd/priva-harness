import type { Transition } from "motion/react"
import { SPRING_HEADER_SEARCH } from "./ease"

// Project and Skill headers share the same search expansion and icon glide.
export function headerSearchMotion(reduced: boolean) {
  const transition: Transition = reduced
    ? { duration: 0 }
    : SPRING_HEADER_SEARCH
  const animate = { opacity: 1, transform: "translateY(0px) scaleX(1)" }
  return {
    transition,
    input: {
      initial: reduced ? false as const : { opacity: 0, transform: "translateY(-2px) scaleX(0.94)" },
      animate,
      exit: reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(-1px) scaleX(0.96)" },
      transition,
    },
    actions: {
      initial: reduced ? false as const : { opacity: 0, transform: "translateY(1px) scaleX(0.96)" },
      animate,
      exit: reduced ? { opacity: 0 } : { opacity: 0, transform: "translateY(1px) scaleX(0.94)" },
      transition,
    },
  }
}
