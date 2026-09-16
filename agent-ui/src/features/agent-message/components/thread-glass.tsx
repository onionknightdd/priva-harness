import { useLayoutEffect, useRef } from "react"

import { AGENT_CHAT_HEADER_HEIGHT } from "../agent-chat-layout"

const BAR_SELECTOR = '[data-slot="sticky-freeze"]'

export function ThreadGlass() {
  const surfaceRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    const viewport = surface?.closest<HTMLElement>('[data-slot="message-scroller-viewport"]')
    const content = viewport?.querySelector('[data-slot="message-scroller-content"]')
    if (!surface || !viewport || !content) return

    const observed = new Set<HTMLElement>()
    const visible = new Set<HTMLElement>()
    let frame = 0
    let disposed = false
    const clearClip = (bar: HTMLElement) => {
      const foreground = bar.firstElementChild as HTMLElement
      foreground.style.clipPath = ""
    }

    const paint = () => {
      cancelAnimationFrame(frame)
      frame = 0
      const viewportTop = viewport.getBoundingClientRect().top
      const viewportBottom = viewportTop + viewport.clientHeight
      let bottom = AGENT_CHAT_HEADER_HEIGHT
      for (const bar of visible) {
        const bounds = bar.getBoundingClientRect()
        const foreground = bar.firstElementChild as HTMLElement
        const clip = Math.max(0, viewportTop + AGENT_CHAT_HEADER_HEIGHT - bounds.top)
        // Outgoing bubbles slide beneath the header without covering its title.
        // Clip the foreground, not the observed bar: clipping that box would
        // change its intersection and cause repeated hide/show notifications.
        foreground.style.clipPath = clip > 0 ? `inset(${clip}px 0 0)` : ""
        const stickyTop = viewportTop + Number.parseFloat(bar.style.top)
        if (bounds.top <= stickyTop && bounds.top < viewportBottom) {
          bottom = Math.max(bottom, bounds.bottom - viewportTop)
        }
      }
      surface.style.height = `${bottom}px`
    }
    const schedulePaint = () => {
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const intersections = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const bar = entry.target as HTMLElement
        if (entry.isIntersecting) visible.add(bar)
        else {
          visible.delete(bar)
          clearClip(bar)
        }
      }
      paint()
    }, { root: viewport, threshold: 0 })
    const resize = new ResizeObserver(schedulePaint)
    resize.observe(viewport)

    const syncBars = () => {
      const next = new Set(content.querySelectorAll<HTMLElement>(BAR_SELECTOR))
      for (const bar of observed) {
        if (!next.has(bar)) {
          intersections.unobserve(bar)
          resize.unobserve(bar)
          observed.delete(bar)
          visible.delete(bar)
          clearClip(bar)
        }
      }
      for (const bar of next) {
        if (!observed.has(bar)) {
          observed.add(bar)
          // Include new bars in the first pre-paint pass; the observer narrows
          // subsequent scroll reads to the handful currently in the viewport.
          visible.add(bar)
          intersections.observe(bar)
          resize.observe(bar)
        }
      }
    }
    syncBars()
    const mutations = new MutationObserver((records) => {
      const barsChanged = records.some((record) => record.type === "childList" &&
        [...record.addedNodes, ...record.removedNodes].some((node) =>
          node instanceof Element && (node.matches(BAR_SELECTOR) || node.querySelector(BAR_SELECTOR))
        ))
      if (barsChanged) syncBars()
      paint()
    })
    mutations.observe(content, { childList: true, subtree: true })
    viewport.addEventListener("scroll", schedulePaint, { passive: true })
    // Ancestor layout effects restore history after this effect; read the
    // restored native sticky positions before the first frame is painted.
    queueMicrotask(() => { if (!disposed) paint() })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      viewport.removeEventListener("scroll", schedulePaint)
      mutations.disconnect()
      intersections.disconnect()
      resize.disconnect()
      observed.forEach(clearClip)
    }
  }, [])

  return (
    <div aria-hidden className="pointer-events-none sticky top-0 z-[15] h-0">
      <div
        ref={surfaceRef}
        data-slot="thread-glass"
        data-glass-surface
        className="absolute inset-x-0 top-0 bg-background supports-backdrop-filter:bg-background/60 supports-backdrop-filter:backdrop-blur-[20px]"
        style={{ height: AGENT_CHAT_HEADER_HEIGHT }}
      />
    </div>
  )
}
