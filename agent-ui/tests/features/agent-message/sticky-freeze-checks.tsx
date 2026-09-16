import React, { act, StrictMode, useLayoutEffect } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

import { StickyFreeze } from "../../../src/features/agent-message/components/sticky-freeze"
import { ThreadGlass } from "../../../src/features/agent-message/components/thread-glass"
import { AGENT_CHAT_HEADER_HEIGHT } from "../../../src/features/agent-message/agent-chat-layout"

type BarBounds = { top: number; height: number }
type Geometry = { user: BarBounds; working?: BarBounds }

export async function runStickyFreezeChecks(check: (name: string, condition: boolean) => void) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const originalIntersection = globalThis.IntersectionObserver
  const originalResize = globalThis.ResizeObserver
  const originalRect = HTMLElement.prototype.getBoundingClientRect
  const intersections = new Set<Element>()
  const resizes = new Map<Element, ResizeObserverCallback>()
  const viewportTop = 100
  let geometry: Geometry = { user: { top: 300, height: 62.25 } }

  // Withhold initial observer delivery to check restored history before paint.
  globalThis.IntersectionObserver = class {
    observe(target: Element) { intersections.add(target) }
    unobserve(target: Element) { intersections.delete(target) }
    disconnect() { intersections.clear() }
  } as unknown as typeof IntersectionObserver
  globalThis.ResizeObserver = class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) { resizes.set(target, this.callback) }
    unobserve(target: Element) { resizes.delete(target) }
    disconnect() { resizes.clear() }
  } as unknown as typeof ResizeObserver
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.dataset.slot === "message-scroller-viewport") {
      return new DOMRect(0, viewportTop, 500, 600)
    }
    if (this.dataset.slot === "sticky-freeze") {
      const bounds = geometry[this.textContent as keyof Geometry]!
      return new DOMRect(0, bounds.top, 500, bounds.height)
    }
    return originalRect.call(this)
  }

  function Transcript({ restored }: { restored: Geometry }) {
    useLayoutEffect(() => { geometry = restored }, [restored])
    return <div data-slot="message-scroller-viewport" ref={(element) => {
      if (element) Object.defineProperty(element, "clientHeight", { configurable: true, value: 600 })
    }}>
      <ThreadGlass />
      <div data-slot="message-scroller-content">
        <StickyFreeze top={AGENT_CHAT_HEADER_HEIGHT}>user</StickyFreeze>
        {restored.working ? <StickyFreeze top={AGENT_CHAT_HEADER_HEIGHT + restored.user.height}>working</StickyFreeze> : null}
      </div>
    </div>
  }

  const glassHeight = () => Number.parseFloat(host.querySelector<HTMLElement>('[data-slot="thread-glass"]')!.style.height)
  const userBar = () => host.querySelector<HTMLElement>('[data-slot="sticky-freeze"]')!
  const mount = async (key: string, restored: Geometry, expectedHeight: number) => {
    geometry = { user: { top: 300, height: 62.25 } }
    await act(async () => {
      flushSync(() => root.render(<Transcript key={key} restored={restored} />))
      await Promise.resolve()
      check(`${key}: restored glass height is ready before observer delivery`, glassHeight() === expectedHeight)
    })
  }
  const scroll = async (next: Geometry) => {
    geometry = next
    await act(async () => {
      host.querySelector('[data-slot="message-scroller-viewport"]')!.dispatchEvent(new Event("scroll"))
      await new Promise(requestAnimationFrame)
    })
  }

  try {
    await mount("reloaded-history", { user: { top: 135, height: 62.25 } }, 97.25)
    check("one continuous surface covers header and restored user", glassHeight() === 97.25)
    await mount("unscrolled-history", { user: { top: 160, height: 62.25 } }, 35)
    check("before sticking only the header has glass", glassHeight() === 35)
    await scroll({ user: { top: 135, height: 62.25 } })
    check("glass extends exactly at the native sticky boundary", glassHeight() === 97.25)
    await scroll({ user: { top: 136, height: 62.25 } })
    check("glass releases below the header without an early sentinel trigger", glassHeight() === 35)

    await mount("streaming", { user: { top: 135, height: 62.25 }, working: { top: 197.25, height: 20 } }, 117.25)
    check("the shared glass extends to the lower streaming bar", glassHeight() === 117.25)
    await act(async () => {
      root.render(<Transcript key="streaming" restored={{ user: { top: 135, height: 62.25 } }} />)
    })
    check("removing the working bar restores the user boundary", glassHeight() === 97.25 && intersections.size === 1)

    geometry = { user: { top: 135, height: 88.5 } }
    await act(async () => {
      resizes.get(userBar())!([], {} as ResizeObserver)
      await new Promise(requestAnimationFrame)
    })
    check("expanded messages resize the glass without rounding", glassHeight() === 123.5)
    await scroll({ user: { top: 60, height: 62.25 } })
    check("outgoing bubbles leave only the header glass", glassHeight() === 35)
    check("clipping the foreground does not change the observed bar", userBar().style.clipPath === "" && (userBar().firstElementChild as HTMLElement).style.clipPath.startsWith("inset(75px "))

    await act(async () => {
      root.render(<StrictMode><Transcript restored={{ user: { top: 135, height: 62.25 } }} /></StrictMode>)
    })
    check("StrictMode restores one glass observer", intersections.size === 1 && glassHeight() === 97.25)
  } finally {
    await act(async () => root.unmount())
    check("unmount cleans up observers", intersections.size === 0 && resizes.size === 0)
    host.remove()
    globalThis.IntersectionObserver = originalIntersection
    globalThis.ResizeObserver = originalResize
    HTMLElement.prototype.getBoundingClientRect = originalRect
  }
}
