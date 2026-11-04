import { elementBox, elementLabel, HtmlElementRegistry, pickHtmlElement } from "./html-element-picker"
import { parseHtmlAssistCommand } from "./html-assist-protocol"
import { HTML_TARGET_LIMITS, type HtmlAssistEvent, type HtmlElementBox, type HtmlElementLocator, type HtmlHoverCandidate } from "./html-assist.types"

type EventPayload = HtmlAssistEvent extends infer Event ? Event extends HtmlAssistEvent ? Omit<Event, "channel" | "nonce"> : never : never

function startRuntime(nonce: string): void {
  const registry = new HtmlElementRegistry(document)
  let enabled = false
  let candidate: HtmlHoverCandidate | null = null
  let lastCandidate: string | null = null
  let draft: string | null = null
  let items: string[] = []
  let reference: string | null = null
  let pointer: { x: number; y: number; parent: boolean } | null = null
  let sequence = 0
  let frame = 0
  let contentDirty = false
  let hitDirty = false
  let geometry = ""
  let skipDisabledClick = false
  const invalidated = new Set<string>()
  let observedRoots = new Set<ShadowRoot>()
  const observer = new MutationObserver(() => {
    contentDirty = true
    hitDirty = true
    schedule()
  })

  function post(event: EventPayload): void {
    window.parent.postMessage({ channel: "html-assist", nonce, ...event }, "*")
  }

  function retained(): Set<string> {
    return new Set([...items, ...(draft ? [draft] : []), ...(lastCandidate ? [lastCandidate] : []), ...(reference ? [reference] : [])])
  }

  function prune(): void {
    const keep = retained()
    registry.retain(keep)
    for (const nodeId of invalidated) if (!keep.has(nodeId)) invalidated.delete(nodeId)
    const roots = new Set<ShadowRoot>()
    for (const nodeId of keep) {
      const element = registry.get(nodeId)
      if (!element?.isConnected) continue
      let root = element.getRootNode()
      while (root instanceof ShadowRoot) {
        roots.add(root)
        root = root.host.getRootNode()
      }
    }
    if (roots.size !== observedRoots.size || [...roots].some((root) => !observedRoots.has(root))) {
      observer.disconnect()
      observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
      for (const root of roots) observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true })
      observedRoots = roots
      contentDirty = true
    }
  }

  function hover(element: Element | null): void {
    const box = element && elementBox(element)
    const next = element && box ? { nodeId: registry.remember(element), label: elementLabel(element), box } : null
    if (next) lastCandidate = next.nodeId
    if (JSON.stringify(candidate) !== JSON.stringify(next)) {
      candidate = next
      post({ type: "hover", candidate })
    }
    schedule()
  }

  function refreshHit(): void {
    if (!enabled || draft || !pointer) return
    hover(pickHtmlElement(document, pointer.x, pointer.y, pointer.parent))
  }

  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(update)
  }

  function update(): void {
    frame = 0
    prune()
    if (hitDirty) {
      hitDirty = false
      refreshHit()
    }
    const checkContent = contentDirty
    contentDirty = false
    const nodes: { nodeId: string; box: HtmlElementBox | null }[] = []
    for (const nodeId of retained()) {
      const element = registry.get(nodeId)
      if (checkContent && !invalidated.has(nodeId)) {
        const validation = registry.validateStored(nodeId)
        if (!validation.valid) {
          invalidated.add(nodeId)
          post({ type: "invalid", nodeIds: [nodeId], reason: validation.reason })
        }
      }
      nodes.push({ nodeId, box: element?.isConnected && !invalidated.has(nodeId) ? elementBox(element) : null })
    }
    const serialized = JSON.stringify(nodes)
    if (geometry !== serialized) {
      geometry = serialized
      post({ type: "geometry", nodes })
    }
    // CSS transitions and animation can change geometry without a DOM mutation.
    if (retained().size) schedule()
  }

  function capture(nodeId: string, requestId: string): void {
    try {
      const target = registry.capture(nodeId)
      draft = nodeId
      invalidated.delete(nodeId)
      post({ type: "lock", requestId, target })
      schedule()
    } catch (error) {
      const message = error instanceof Error && ["changed", "unavailable", "ambiguous", "selector-too-long"].includes(error.message) ? error.message : "unavailable"
      post({ type: "error", requestId, message })
    }
  }

  function reveal(locator: HtmlElementLocator, requestId: string): void {
    const result = registry.reveal(locator)
    if (!result.valid) {
      post({ type: "error", requestId, message: result.reason === "ambiguous" ? "ambiguous" : "changed" })
      return
    }
    result.element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" })
    const box = elementBox(result.element)
    if (!box) {
      post({ type: "error", requestId, message: "unavailable" })
      return
    }
    reference = registry.remember(result.element)
    prune()
    post({ type: "revealed", requestId, nodeId: reference, box })
    schedule()
  }

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window.parent) return
    const command = parseHtmlAssistCommand(event.data)
    if (!command || command.nonce !== nonce) return
    switch (command.type) {
      case "enable":
        enabled = command.enabled
        if (!enabled) {
          candidate = null
          lastCandidate = null
          draft = null
          items = []
          reference = null
          pointer = null
          post({ type: "hover", candidate: null })
          prune()
        }
        break
      case "draft":
        if (draft && !command.nodeId) {
          candidate = null
          post({ type: "hover", candidate: null })
        }
        draft = command.nodeId
        schedule()
        break
      case "reset-hover":
        candidate = null
        lastCandidate = null
        pointer = null
        post({ type: "hover", candidate: null })
        schedule()
        break
      case "clear-reference":
        reference = null
        prune()
        schedule()
        break
      case "items": items = [...new Set(command.nodeIds)].slice(0, HTML_TARGET_LIMITS.items); schedule(); break
      case "capture": if (enabled) capture(command.nodeId, command.requestId); break
      case "validate":
        post({ type: "validation", requestId: command.requestId, results: command.locators.map((locator) => {
          const result = registry.validate(locator)
          return result.valid ? { nodeId: locator.nodeId, valid: true } : { nodeId: locator.nodeId, valid: false, reason: result.reason }
        }) })
        break
      case "reveal": reveal(command.locator, command.requestId); break
    }
  })

  window.addEventListener("pointermove", (event) => {
    if (!enabled || draft) return
    pointer = { x: event.clientX, y: event.clientY, parent: event.altKey }
    hitDirty = true
    schedule()
  }, true)

  window.addEventListener("pointerout", (event) => {
    if (enabled && !event.relatedTarget && !draft) {
      pointer = null
      hover(null)
    }
  }, true)

  const suppress = (event: Event) => {
    if (!enabled) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  function activate(event: MouseEvent, prefix: string): void {
    if (draft) {
      draft = null
      post({ type: "cancel" })
      prune()
      return
    }
    // Keep the element shown by Alt-hover even if Alt was released just before
    // this click. A new pointer move naturally replaces the shown candidate.
    if (!candidate) hover(pickHtmlElement(document, event.clientX, event.clientY, event.altKey))
    if (candidate) capture(candidate.nodeId, `${prefix}-${++sequence}`)
  }
  window.addEventListener("pointerdown", (event) => {
    skipDisabledClick = false
    suppress(event)
  }, { capture: true, passive: false })
  window.addEventListener("pointerup", (event) => {
    if (!enabled) return
    suppress(event)
    // Native disabled controls often emit pointer events but no click at all.
    // Use the same displayed candidate and absorb a browser's optional click.
    if (event.button === 0 && event.composedPath().some((node) => node instanceof Element && node.matches(":disabled"))) {
      skipDisabledClick = true
      activate(event, "disabled")
    }
  }, { capture: true, passive: false })
  for (const type of ["mousedown", "mouseup", "dblclick", "contextmenu", "dragstart"]) window.addEventListener(type, suppress, { capture: true, passive: false })
  window.addEventListener("click", (event) => {
    if (!enabled) return
    suppress(event)
    if (skipDisabledClick) {
      skipDisabledClick = false
      return
    }
    activate(event, "pointer")
  }, { capture: true, passive: false })

  window.addEventListener("keydown", (event) => {
    if (!enabled || event.isComposing || event.keyCode === 229) return
    if (event.key === "Alt" && pointer && !draft) {
      pointer.parent = true
      refreshHit()
    } else if (event.key === "Escape") {
      suppress(event)
      draft = null
      hover(null)
      post({ type: "cancel" })
    } else if (event.key === "Tab" && !event.shiftKey && candidate && !draft) {
      suppress(event)
      post({ type: "focus-menu" })
    } else if (event.key === "Enter" || event.key === " ") {
      suppress(event)
      if (candidate && !draft) capture(candidate.nodeId, `keyboard-${++sequence}`)
    }
  }, true)

  for (const type of ["scroll", "resize"]) window.addEventListener(type, () => {
    hitDirty = true
    schedule()
  }, true)
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
  post({ type: "ready", documentId: registry.documentId })
}

const script = document.currentScript
const nonce = script instanceof HTMLScriptElement ? script.dataset.htmlAssistNonce : undefined
script?.remove()
if (nonce && /^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(nonce) && window.parent !== window) startRuntime(nonce)
