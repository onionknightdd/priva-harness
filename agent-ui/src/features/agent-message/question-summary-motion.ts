import { EASE_OUT } from "@/lib/ease"

export function questionSummaryTransition(open: boolean, instant: boolean) {
  return {
    type: "tween" as const,
    duration: instant ? 0 : open ? 0.18 : 0.12,
    ease: EASE_OUT,
  }
}

// Move a 20% soft edge from the top right to the bottom left. Both endpoints
// extend beyond the content so the closed mask hides all text and the open
// mask leaves every line fully opaque.
export const questionSummaryMask = {
  closed: "linear-gradient(to bottom left, #000 -20%, transparent 0%)",
  open: "linear-gradient(to bottom left, #000 100%, transparent 120%)",
} as const
