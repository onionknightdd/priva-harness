"use client"

import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react"
import { useContext, useEffect, useLayoutEffect, useRef, useState, createContext, memo, type ReactNode } from "react"

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
  const previousReduce = useRef(reduce)
  useLayoutEffect(() => { previousReduce.current = reduce }, [reduce])
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
      <StablePieceView
        text={piece.text}
        count={piece.count}
        steady={piece.steady}
        suppressEnter={Boolean(previousReduce.current)}
      />
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

const StablePieceView = memo(function StablePieceView({
  text, count, steady, suppressEnter,
}: Omit<StablePiece, "id"> & { suppressEnter: boolean }) {
  const live = useContext(LiveTextContext)
  // Restoring motion remounts the presence subtree, but is not a text change.
  const enter = useRef(live && !suppressEnter).current
  if (steady) return <span className="whitespace-pre">{text}</span>
  return (
    <TextCascade
      text={text}
      animateOnMount={enter}
      className={count ? "tabular-nums" : undefined}
    />
  )
})
