"use client"

import { useContext, useEffect, useLayoutEffect, useRef, useState, createContext, type ReactNode } from "react"

import { TextCascade } from "@/components/motion/text-cascade"
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
  const live = useContext(LiveTextContext)
  const seen = useRef<Set<string> | null>(null)
  const entered = useRef<Set<string>>(new Set())
  const current = new Set(pieces.map((piece) => piece.id))

  if (seen.current === null) {
    seen.current = new Set()
    if (live) {
      for (const id of current) entered.current.add(id)
    }
  } else {
    for (const id of current) {
      if (!seen.current.has(id) && live) entered.current.add(id)
    }
    for (const id of entered.current) {
      if (!current.has(id)) entered.current.delete(id)
    }
  }
  seen.current = current

  return (
    <span className={cn("inline min-w-0", shimmer && "status-line-shimmer", className)}>
      {pieces.map((piece) => (
        <StablePieceView
          key={piece.id}
          piece={piece}
          enter={entered.current.has(piece.id)}
        />
      ))}
    </span>
  )
}

function StablePieceView({
  piece,
  enter,
}: {
  piece: StablePiece
  enter: boolean
}) {
  if (piece.steady) return <span className="whitespace-pre">{piece.text}</span>
  if (enter) {
    return (
      <CascadeIn
        text={piece.text}
        className={piece.count ? "tabular-nums" : undefined}
      />
    )
  }
  if (piece.count) {
    return (
      <TextCascade
        text={piece.text}
        className="tabular-nums"
      />
    )
  }
  return <HeldLiteral text={piece.text} />
}

function HeldLiteral({ text }: { text: string }) {
  const initial = useRef(text)
  if (text !== initial.current) return <CascadeIn text={text} />
  return <span className="whitespace-pre">{text}</span>
}

/** Plays the cascade once on mount, then again whenever `text` changes. */
function CascadeIn({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const [value, setValue] = useState("")
  useLayoutEffect(() => {
    setValue(text)
  }, [text])
  return <TextCascade text={value} className={className} />
}
