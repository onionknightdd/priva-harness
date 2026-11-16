import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { animate } from "motion/react"
import { ease } from "@animate-ui/react/utils/motion"
import { Tabs } from "radix-ui"

/** Animate live panels inside the message's clipping and stacking boundaries. */
export function DashboardTabsPanel({ value, active, direction, instant, children }: {
  value: string
  active: boolean
  direction: 1 | -1
  instant: boolean
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previous = useRef({ active, direction, instant })
  const visible = useRef(active)
  const [exiting, setExiting] = useState(false)

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (previous.current.active === active && previous.current.direction === direction && previous.current.instant === instant) return
    previous.current = { active, direction, instant }
    if (instant) {
      panel.style.opacity = active ? "1" : "0"
      panel.style.transform = "translateX(0px)"
      visible.current = active
      setExiting(false)
      return
    }
    if (active) {
      // A reversal keeps the current frame. Only a fully hidden panel starts
      // from the edge, so rapid selections do not restart an in-flight slide.
      if (!visible.current) {
        panel.style.opacity = "0"
        panel.style.transform = `translateX(${direction * 60}px)`
      }
      visible.current = true
      setExiting(false)
    } else {
      if (!visible.current) return
      setExiting(true)
    }
    const animation = animate(panel, {
      opacity: active ? 1 : 0,
      transform: active ? "translateX(0px)" : `translateX(${-direction * 60}px)`,
    }, {
      duration: active ? 0.25 : 0.2,
      ease: active ? ease.out : ease.leave,
      onComplete: () => {
        if (!active) {
          visible.current = false
          setExiting(false)
        }
      },
    })
    // Motion commits the current rendered frame when stopped, allowing the
    // next selection to retarget it instead of jumping to an endpoint.
    return () => animation.stop()
  }, [active, direction, instant])

  return <Tabs.Content
    ref={panelRef}
    value={value}
    forceMount
    hidden={!active && !exiting}
    inert={!active}
    aria-hidden={!active}
    tabIndex={active ? 0 : -1}
    data-active={active}
    data-exiting={exiting ? "true" : undefined}
    className="a2ui-tabs-panel"
  >
    {children}
  </Tabs.Content>
}
