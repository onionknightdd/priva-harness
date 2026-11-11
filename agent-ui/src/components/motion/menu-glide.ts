import * as React from "react"

// Sliding row highlight for Base UI menus and lists (dropdown, context menu,
// select, combobox). Base UI marks the active row with `data-highlighted`; this
// hook mirrors that row's box into CSS variables on the scrolling container,
// and the `[data-menu-glide]::before` rule in index.css paints and transitions
// the block. It runs only when the highlighted row changes: no React renders,
// no per-frame work. With reduced motion the CSS rule does not apply and rows
// keep their static background.

const HIGHLIGHTED = "[data-highlighted]"

/** Offset of `element` inside `container`, ignoring transforms so the popup's
 * opening scale does not skew the block. */
function offsetWithin(element: HTMLElement, container: HTMLElement) {
  let top = 0
  let left = 0
  let node: HTMLElement | null = element
  while (node && node !== container) {
    top += node.offsetTop
    left += node.offsetLeft
    const parent: Element | null = node.offsetParent
    if (!(parent instanceof HTMLElement) || !container.contains(parent)) {
      break
    }
    node = parent
  }
  return { top, left }
}

// Moving between rows clears the highlight before the next row takes it, and
// separators and labels leave short gaps. Holding the block this long lets it
// glide across instead of fading out and back in.
const IDLE_DELAY_MS = 90

function attachMenuGlide(container: HTMLElement) {
  container.setAttribute("data-menu-glide", "idle")
  let idleTimer = 0

  const sync = () => {
    const row = container.querySelector<HTMLElement>(HIGHLIGHTED)
    // Destructive rows keep their own tinted background.
    if (!row || row.dataset.variant === "destructive") {
      if (!idleTimer && container.getAttribute("data-menu-glide") !== "idle") {
        idleTimer = window.setTimeout(() => {
          idleTimer = 0
          container.setAttribute("data-menu-glide", "idle")
        }, IDLE_DELAY_MS)
      }
      return
    }

    window.clearTimeout(idleTimer)
    idleTimer = 0
    const wasIdle = container.getAttribute("data-menu-glide") !== "active"
    const { top, left } = offsetWithin(row, container)
    const place = () => {
      container.style.setProperty("--menu-glide-top", `${top}px`)
      container.style.setProperty("--menu-glide-left", `${left}px`)
      container.style.setProperty("--menu-glide-width", `${row.offsetWidth}px`)
      container.style.setProperty("--menu-glide-height", `${row.offsetHeight}px`)
    }

    if (wasIdle) {
      // First row after no highlight: land in place and fade in, rather than
      // sliding in from wherever the block last rested.
      container.setAttribute("data-menu-glide", "snap")
      place()
      void container.offsetWidth
    } else {
      place()
    }
    container.setAttribute("data-menu-glide", "active")
  }

  const observer = new MutationObserver(sync)
  observer.observe(container, {
    attributes: true,
    attributeFilter: ["data-highlighted"],
    childList: true,
    subtree: true,
  })
  sync()

  return () => {
    observer.disconnect()
    window.clearTimeout(idleTimer)
    container.removeAttribute("data-menu-glide")
  }
}

/** Ref for the element that scrolls the rows. Forwards to `externalRef`. */
function useMenuGlide<T extends HTMLElement>(
  externalRef?: React.Ref<T>,
  enabled = true
) {
  return React.useCallback(
    (node: T | null) => {
      const detach = node && enabled ? attachMenuGlide(node) : undefined
      const release =
        typeof externalRef === "function" ? externalRef(node) : undefined
      if (externalRef && typeof externalRef !== "function") {
        externalRef.current = node
      }

      return () => {
        detach?.()
        if (typeof release === "function") {
          release()
        } else if (typeof externalRef === "function") {
          externalRef(null)
        } else if (externalRef) {
          externalRef.current = null
        }
      }
    },
    [enabled, externalRef]
  )
}

export { useMenuGlide }
