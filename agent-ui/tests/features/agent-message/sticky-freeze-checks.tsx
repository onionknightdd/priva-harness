import { act, StrictMode, useLayoutEffect, useState, type ComponentProps } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"

import { StickyFreeze } from "../../../src/features/agent-message/components/sticky-freeze"

type Geometry = { user: number; working: number }

export async function runStickyFreezeChecks(check: (name: string, condition: boolean) => void) {
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const originalObserver = globalThis.IntersectionObserver
  const originalRect = HTMLElement.prototype.getBoundingClientRect
  const observers = new Map<Element, IntersectionObserverCallback>()
  const viewportTop = 100
  let geometry: Geometry = { user: 300, working: 400 }
  let observerDeliveries = 0

  // Deliberately withhold the asynchronous first intersection notification.
  globalThis.IntersectionObserver = class {
    targets = new Set<Element>()
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.targets.add(target)
      observers.set(target, this.callback)
    }
    disconnect() {
      this.targets.forEach((target) => observers.delete(target))
    }
  } as unknown as typeof IntersectionObserver
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.dataset.slot === "message-scroller-viewport") {
      return new DOMRect(0, viewportTop, 500, 600)
    }
    const bar = this.nextElementSibling
    if (bar?.getAttribute("data-slot") === "sticky-freeze") {
      const key = bar.textContent as keyof Geometry
      return new DOMRect(0, geometry[key] - 1, 500, 1)
    }
    return originalRect.call(this)
  }

  function Transcript({
    restored,
    stacked = false,
    top = 0,
    onStuckChange,
  }: {
    restored: Geometry
    stacked?: boolean
    top?: number
    onStuckChange?: (stuck: boolean) => void
  }) {
    const [workingStuck, setWorkingStuck] = useState(false)
    // The real scroller restores history after its child bars' layout effects.
    useLayoutEffect(() => { geometry = restored }, [restored])
    return <div data-slot="message-scroller-viewport">
      <StickyFreeze top={top} showBelowMask={!workingStuck} onStuckChange={onStuckChange}>user</StickyFreeze>
      {stacked ? <StickyFreeze top={62.25} onStuckChange={setWorkingStuck}>working</StickyFreeze> : null}
    </div>
  }

  const bar = (name: keyof Geometry) => [...host.querySelectorAll<HTMLElement>('[data-slot="sticky-freeze"]')]
    .find((element) => element.textContent === name)!
  const hasMask = (name: keyof Geometry) => Boolean(bar(name)?.querySelector('[data-slot="sticky-freeze-mask"]'))
  const mount = async (key: string, props: ComponentProps<typeof Transcript>) => {
    geometry = { user: 300, working: 400 }
    await act(async () => {
      flushSync(() => root.render(<Transcript key={key} {...props} />))
      // This checkpoint precedes timers / animation frames / observer delivery.
      await Promise.resolve()
      check(`${key}: initial mask matches the restored scroll position before observer delivery`,
        hasMask("user") === (props.restored.user <= viewportTop + (props.top ?? 0) && !props.stacked))
    })
  }
  const deliver = async (name: keyof Geometry, bottom: number) => {
    const sentinel = bar(name).previousElementSibling!
    const callback = observers.get(sentinel)
    if (!callback) throw new Error(`No observer for ${name}`)
    geometry = { ...geometry, [name]: bottom }
    await act(async () => {
      observerDeliveries += 1
      callback([{
        target: sentinel,
        rootBounds: new DOMRect(0, viewportTop, 500, 600),
        boundingClientRect: sentinel.getBoundingClientRect(),
      } as IntersectionObserverEntry], {} as IntersectionObserver)
    })
  }

  try {
    await mount("reloaded-history", { restored: { user: 80, working: 400 } })
    check("history initializes without an intersection callback", observerDeliveries === 0)
    check("the restored user bar is marked as stuck", bar("user").dataset.stuck === "true")

    await mount("unscrolled-history", { restored: { user: 160, working: 400 } })
    await deliver("user", 99)
    check("later scrolling still reveals the mask", hasMask("user"))
    await deliver("user", 101)
    check("scrolling back removes the mask", !hasMask("user"))

    await mount("fractional-sticky-offset", { top: 62.25, restored: { user: 162.1, working: 400 } })
    await mount("below-fractional-offset", { top: 62.25, restored: { user: 162.4, working: 400 } })

    await mount("stacked-streaming-bars", { stacked: true, restored: { user: 80, working: 145 } })
    check("only the lower streaming bar gets the initial mask", hasMask("working") && !hasMask("user"))
    await deliver("working", 180)
    check("the mask moves back to the user bar when working is no longer stuck", hasMask("user") && !hasMask("working"))

    let staleUpdates = 0
    await act(async () => {
      flushSync(() => root.render(<Transcript key="removed" restored={{ user: 80, working: 400 }} onStuckChange={() => { staleUpdates += 1 }} />))
      flushSync(() => root.render(null))
      await Promise.resolve()
      check("unmount cancels pending initialization and observers", staleUpdates === 0 && observers.size === 0)
    })

    geometry = { user: 300, working: 400 }
    await act(async () => {
      flushSync(() => root.render(<StrictMode><Transcript restored={{ user: 80, working: 400 }} /></StrictMode>))
      await Promise.resolve()
      check("StrictMode remount initializes the mask before observer delivery", hasMask("user"))
      check("StrictMode cleans up the previous observer", observers.size === 1)
    })
  } finally {
    await act(async () => root.unmount())
    host.remove()
    globalThis.IntersectionObserver = originalObserver
    HTMLElement.prototype.getBoundingClientRect = originalRect
  }
}
