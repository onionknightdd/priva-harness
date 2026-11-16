import { useRef, useState, type ReactNode } from "react"
import { useReducedMotion } from "motion/react"
import { Tabs } from "radix-ui"

import { DashboardTabsPanel } from "./tabs-panel"

/** The catalog owns the content; selection and motion stay local to this embed. */
export function DashboardTabs({ tabs, buildChild }: {
  tabs: { title: string; child: string }[]
  buildChild: (id: string) => ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const keyboard = useRef(false)
  const [selection, setSelection] = useState({ value: "0", direction: 1 as 1 | -1, instant: false })

  return <Tabs.Root
    value={selection.value}
    onValueChange={(value) => setSelection((previous) => value === previous.value ? previous : {
      value,
      direction: Number(value) > Number(previous.value) ? 1 : -1,
      instant: keyboard.current,
    })}
    onKeyDownCapture={() => { keyboard.current = true }}
    onPointerDownCapture={() => { keyboard.current = false }}
    className="a2ui-tabs"
  >
    <Tabs.List className="a2ui-tabs-list" onFocusCapture={(event) => {
      // Reveal long labels inside the tab strip without scrolling the conversation.
      const tab = event.target as HTMLElement
      if (tab.getAttribute("role") !== "tab") return
      const list = event.currentTarget
      const viewport = list.getBoundingClientRect()
      const bounds = tab.getBoundingClientRect()
      const offset = bounds.left < viewport.left ? bounds.left - viewport.left : bounds.right > viewport.right ? bounds.right - viewport.right : 0
      if (offset) list.scrollLeft += offset
    }}>
      {tabs.map((tab, index) => <Tabs.Trigger key={index} value={String(index)} className="a2ui-tabs-trigger">{tab.title}</Tabs.Trigger>)}
    </Tabs.List>
    <div className="a2ui-tabs-content">
      {tabs.map((tab, index) => {
        const value = String(index)
        return <DashboardTabsPanel
          key={index}
          value={value}
          active={value === selection.value}
          direction={selection.direction}
          instant={selection.instant || Boolean(reducedMotion)}
        >
          {buildChild(tab.child)}
        </DashboardTabsPanel>
      })}
    </div>
  </Tabs.Root>
}
