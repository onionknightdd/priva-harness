const LOCK_MS = 400
const MIN_DELTA_PX = 0.5

type ExpandAnchor = {
  element: Element
  top: number
  until: number
}

let anchor: ExpandAnchor | null = null

export function captureExpandTrigger(target: EventTarget | null) {
  if (
    target === null ||
    typeof target !== "object" ||
    !("closest" in target) ||
    typeof target.closest !== "function"
  ) {
    return
  }

  const trigger = (target as Element).closest("[aria-expanded]")
  if (
    trigger === null ||
    typeof trigger.getBoundingClientRect !== "function"
  ) {
    return
  }

  anchor = {
    element: trigger,
    top: trigger.getBoundingClientRect().top,
    until: performance.now() + LOCK_MS,
  }
}

export function isExpandScrollLocked() {
  if (anchor === null) {
    return false
  }
  if (performance.now() > anchor.until) {
    anchor = null
    return false
  }
  return true
}

export function keepExpandTriggerInPlace(viewport: HTMLElement) {
  if (anchor === null || !anchor.element.isConnected) {
    anchor = null
    return false
  }
  if (performance.now() > anchor.until) {
    anchor = null
    return false
  }

  const delta = anchor.element.getBoundingClientRect().top - anchor.top
  if (Math.abs(delta) >= MIN_DELTA_PX) {
    viewport.scrollTop += delta
    anchor.top = anchor.element.getBoundingClientRect().top
  }
  return true
}

export function resetExpandAnchor() {
  anchor = null
}
