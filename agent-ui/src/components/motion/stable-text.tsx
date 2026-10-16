"use client"

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react"
import { useContext, useEffect, useRef, useState, createContext, type ReactNode } from "react"

import { TextCascade } from "@/components/motion/text-cascade"
import { SPRING_SWAP } from "@/lib/ease"
import { cn } from "@/lib/utils"

export type StablePiece = {
  id: string
  text: string
  count?: boolean
  /** Changing text stays put. Used for the running clock. */
  steady?: boolean
}

const LiveTextContext = createContext(false)

/**
 * Text that mounts under an already-live scope cascades in. Text present on
 * the scope's first paint stays still until its own characters change.
 */
export function LiveTextScope({ children }: { children: ReactNode }) {
  const [live, setLive] = useState(false)
  useEffect(() => {
    setLive(true)
  }, [])
  return <LiveTextContext.Provider value={live}>{children}</LiveTextContext.Provider>
}

export function StableText({
  pieces,
  shimmer = false,
  className,
}: {
  pieces: readonly StablePiece[]
  shimmer?: boolean
  className?: string
}) {
  const reduce = useReducedMotionConfig()
  const content = pieces.map((piece) => (
    <motion.span
      key={piece.id}
      aria-hidden="true"
      className="inline-block whitespace-pre align-baseline"
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SPRING_SWAP}
    >
      <StablePieceView piece={piece} />
    </motion.span>
  ))

  return (
    <span className={cn("relative inline min-w-0", shimmer && "status-line-shimmer", className)}>
      <span className="sr-only">{pieces.map((piece) => piece.text).join("")}</span>
      {/* Keep removed phrases visible while their replacements enter. Popped
          layers don't stretch the new sentence or duplicate accessible text. */}
      {reduce ? content : (
        <AnimatePresence mode="popLayout" initial={false}>
          {content}
        </AnimatePresence>
      )}
    </span>
  )
}

function StablePieceView({
  piece,
}: {
  piece: StablePiece
}) {
  const live = useContext(LiveTextContext)
  const enter = useRef(live).current
  if (piece.steady) return <span className="whitespace-pre">{piece.text}</span>
  return (
    <TextCascade
      text={piece.text}
      animateOnMount={enter}
      className={piece.count ? "tabular-nums" : undefined}
    />
  )
}
