"use client"

import { ease } from "@animate-ui/react/utils/motion"
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { flushSync } from "react-dom"

// Animate UI Page Transition's zoom, using the browser API on React 19.2.
// Snapshots let live panels unmount immediately and kept panels retain state.
// https://animate-ui.com/docs/primitives/animate-ui/page-transition
export function PageTransition({
  pageKey,
  disabled = false,
  reducedMotion = false,
  className,
  children,
}: {
  pageKey: string | null
  disabled?: boolean
  reducedMotion?: boolean
  className?: string
  children: (key: string | null) => ReactNode
}) {
  const name = `page-${useId().replace(/[^a-z0-9]/gi, "")}`
  const panelRef = useRef<HTMLDivElement>(null)
  const clipStyleRef = useRef<HTMLStyleElement>(null)
  const transitionRef = useRef<ViewTransition | null>(null)
  const displayedKeyRef = useRef(pageKey)
  const [displayedKey, setDisplayedKey] = useState(pageKey)

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || displayedKeyRef.current === pageKey) return

    const commit = () => {
      displayedKeyRef.current = pageKey
      setDisplayedKey(pageKey)
    }
    if (disabled || !document.startViewTransition || !panel.getClientRects().length) {
      commit()
      return
    }

    let cancelled = false
    if (clipStyleRef.current) {
      clipStyleRef.current.textContent = `::view-transition-image-pair(${name}) { border-radius: ${getComputedStyle(panel).borderRadius}; }`
    }
    panel.style.viewTransitionName = name
    document.documentElement.setAttribute("data-page-transition", name)
    const transition = document.startViewTransition(() => {
      if (!cancelled) flushSync(commit)
    })
    transitionRef.current = transition
    // Skipping a snapshot (rapid navigation or a hidden document) rejects ready,
    // but still runs the update callback and resolves finished.
    void transition.ready.catch(() => {})
    void transition.finished.finally(() => {
      if (transitionRef.current !== transition) return
      transitionRef.current = null
      panel.style.removeProperty("view-transition-name")
      if (document.documentElement.getAttribute("data-page-transition") === name) {
        document.documentElement.removeAttribute("data-page-transition")
      }
    })

    return () => {
      cancelled = true
      transition.skipTransition()
    }
  }, [disabled, name, pageKey])

  const scope = `:root[data-page-transition="${name}"]`
  const out = `cubic-bezier(${ease.out.join(",")})`
  const leave = `cubic-bezier(${ease.leave.join(",")})`

  return (
    <div ref={panelRef} data-slot="page-transition" className={className}>
      <style>{`
        ${scope} { view-transition-name: none; }
        ${scope}::view-transition { pointer-events: none; }
        ${scope}::view-transition-group(${name}) { animation: none; }
        ${scope}::view-transition-image-pair(${name}) {
          overflow: clip; isolation: isolate;
        }
        ${scope}::view-transition-old(${name}),
        ${scope}::view-transition-new(${name}) {
          height: 100%; width: 100%; mix-blend-mode: normal;
          background: var(--workspace-panel); transform-origin: center;
        }
        ${scope}::view-transition-old(${name}) {
          animation: ${name}-out 200ms ${leave} both;
        }
        ${scope}::view-transition-new(${name}) {
          animation: ${name}-in 400ms ${out} both;
        }
        @keyframes ${name}-in {
          from { opacity: 0; transform: ${reducedMotion ? "none" : "scale(0.94)"}; }
          to { opacity: 1; transform: none; }
        }
        @keyframes ${name}-out {
          from { opacity: 1; transform: none; }
          to { opacity: 0; transform: ${reducedMotion ? "none" : "scale(1.04)"}; }
        }
        @media (prefers-reduced-motion: reduce) {
          ${scope}::view-transition-old(${name}),
          ${scope}::view-transition-new(${name}) { transform: none !important; }
        }
      `}</style>
      <style ref={clipStyleRef} />
      {children(displayedKey)}
    </div>
  )
}
