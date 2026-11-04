import { finder } from "@medv/finder"
import { HTML_TARGET_LIMITS as limits, type HtmlElementBox, type HtmlElementLocator, type HtmlElementTarget, type HtmlInvalidReason } from "./html-assist.types"

const interactiveSelector = "button,a[href],input,select,textarea,summary,[role],[tabindex],[contenteditable]"

export function elementBox(element: Element): HtmlElementBox | null {
  const box = element.getBoundingClientRect()
  const numbers = [box.x, box.y, box.width, box.height]
  if (!numbers.every((value) => Number.isFinite(value) && Math.abs(value) <= limits.coordinate) || box.width <= 0 || box.height <= 0) return null
  return { surfaceIndex: 0, x: box.x, y: box.y, width: box.width, height: box.height }
}

function parentElement(element: Element): Element | null {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  return root instanceof ShadowRoot ? root.host : null
}

function transparent(color: string): boolean {
  return color === "transparent" || /^rgba\([^)]*,\s*0\s*\)$/.test(color)
}

/** Deliberately narrow: event listeners cannot be inferred from DOM appearance. */
function decorativeOverlay(element: Element, view: Window): boolean {
  if (!(element instanceof HTMLElement) || element.matches(interactiveSelector) || element.childElementCount || element.textContent?.trim()) return false
  if (element.getAttributeNames().some((name) => name.startsWith("on"))) return false
  const style = view.getComputedStyle(element)
  if (style.position !== "absolute" && style.position !== "fixed") return false
  const box = element.getBoundingClientRect()
  return box.width * box.height >= view.innerWidth * view.innerHeight * 0.8 && transparent(style.backgroundColor) && style.backgroundImage === "none" && style.boxShadow === "none" && [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].every((width) => Number.parseFloat(width) === 0)
}

export function pickHtmlElement(document: Document, x: number, y: number, parent = false): Element | null {
  const view = document.defaultView
  if (!view) return null
  const stack = document.elementsFromPoint(x, y)
  let element = stack.find((candidate) => !decorativeOverlay(candidate, view)) ?? null
  const visited = new Set<Element>()
  while (element?.shadowRoot && !visited.has(element)) {
    visited.add(element)
    const root = element.shadowRoot
    const children = typeof root.elementsFromPoint === "function" ? root.elementsFromPoint(x, y) : []
    const nested = children.find((candidate) => candidate !== element && candidate.getRootNode() === root && !decorativeOverlay(candidate, view))
    if (!nested) break
    element = nested
  }
  if (!element || ["head", "script", "style", "meta", "link"].includes(element.localName)) return null
  if (parent) {
    let ancestor: Element | null = element
    while (ancestor && ancestor.localName !== "table") ancestor = parentElement(ancestor)
    element = ancestor ?? parentElement(element) ?? element
  }
  return elementBox(element) ? element : null
}

function description(element: Element, max: number): string {
  const name = element.getAttribute("aria-label") ?? element.getAttribute("alt") ?? element.getAttribute("title") ?? element.getAttribute("name")
  const role = element.getAttribute("role")
  return `${element.localName}${role ? ` (${role})` : ""}${name ? ` · ${name.replace(/\s+/g, " ").trim()}` : ""}`.slice(0, max)
}

export const elementLabel = (element: Element): string => description(element, limits.label)

export function snapshotHash(html: string): string {
  // Two 32-bit accumulators avoid BigInt work on large HTML snapshots. This is
  // a change detector, never a substitute for a live node's object identity.
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < html.length; index++) {
    const code = html.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85ebca6b)
  }
  return (first >>> 0).toString(16).padStart(8, "0") + (second >>> 0).toString(16).padStart(8, "0")
}

function selectedText(element: Element): { text: string; truncated: boolean } {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest("script,style,noscript,template") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  let text = ""
  let count = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    text += `${node.textContent ?? ""} `
    text = text.replace(/\s+/g, " ").trimStart()
    if (text.length > limits.text || ++count > 10000) return { text: text.slice(0, limits.text).trim(), truncated: true }
  }
  return { text: text.trim(), truncated: false }
}

function selectorPath(element: Element): string[] {
  const selectors: string[] = []
  let current = element
  while (true) {
    const root = current.getRootNode()
    if (!(root instanceof Document) && !(root instanceof ShadowRoot)) throw new Error("changed")
    // finder supports query roots at runtime; its public type only lists Element.
    const selector = finder(current, { root: root as unknown as Element, timeoutMs: 50, maxNumberOfPathChecks: 1000 })
    if (!selector || selector.length > limits.selector || selectors.length >= limits.selectors) throw new Error("selector-too-long")
    const matches = root.querySelectorAll(selector)
    if (matches.length !== 1 || matches[0] !== current) throw new Error("ambiguous")
    selectors.unshift(selector)
    if (root instanceof Document) return selectors
    current = root.host
  }
}

type StoredNode = { element: Element; locator?: HtmlElementLocator }
type CapturedNode = { element: WeakRef<Element>; locator: HtmlElementLocator }
export type Validation = { valid: true; element: Element } | { valid: false; reason: HtmlInvalidReason }

export class HtmlElementRegistry {
  readonly documentId: string
  private nextId = 0
  private readonly identities = new WeakMap<Element, string>()
  private readonly nodes = new Map<string, StoredNode>()
  private readonly captures = new Map<string, CapturedNode>()
  private readonly collected = new FinalizationRegistry<string>((nodeId) => this.captures.delete(nodeId))

  constructor(readonly document: Document, documentId?: string) {
    const random = new Uint32Array(4)
    document.defaultView?.crypto.getRandomValues(random)
    this.documentId = documentId ?? `doc-${Array.from(random, (part) => part.toString(16)).join("-")}`
  }

  remember(element: Element): string {
    let nodeId = this.identities.get(element)
    if (!nodeId) {
      nodeId = `node-${++this.nextId}`
      this.identities.set(element, nodeId)
    }
    if (!this.nodes.has(nodeId)) this.nodes.set(nodeId, { element, locator: this.captures.get(nodeId)?.locator })
    return nodeId
  }

  get(nodeId: string): Element | null {
    return this.nodes.get(nodeId)?.element ?? this.captures.get(nodeId)?.element.deref() ?? null
  }

  private stored(nodeId: string): StoredNode | null {
    const active = this.nodes.get(nodeId)
    if (active) return active
    const capture = this.captures.get(nodeId)
    const element = capture?.element.deref()
    return capture && element ? { element, locator: capture.locator } : null
  }

  /** Only current hover, draft, confirmed items and a reference retain DOM nodes. */
  retain(nodeIds: Set<string>): void {
    for (const nodeId of this.nodes.keys()) if (!nodeIds.has(nodeId)) this.nodes.delete(nodeId)
  }

  capture(nodeId: string): HtmlElementTarget {
    const stored = this.stored(nodeId)
    if (!stored?.element.isConnected) throw new Error("changed")
    const element = stored.element
    const box = elementBox(element)
    if (!box) throw new Error("unavailable")
    const html = element.outerHTML
    const locator: HtmlElementLocator = { documentId: this.documentId, nodeId, selectors: selectorPath(element), tagName: element.localName.toLowerCase(), snapshotHash: snapshotHash(html) }
    stored.locator = locator
    if (!this.captures.has(nodeId)) this.collected.register(element, nodeId)
    this.captures.set(nodeId, { element: new WeakRef(element), locator })
    const text = selectedText(element)
    const ancestors: string[] = []
    let ancestor = parentElement(element)
    while (ancestor && ancestors.length < limits.ancestors) {
      ancestors.push(description(ancestor, limits.ancestor))
      ancestor = parentElement(ancestor)
    }
    return { kind: "html", elementType: "element", label: elementLabel(element), text: text.text, coordinateSpace: "html-viewport-css-pixels", boxes: [box], locator, html: html.slice(0, limits.html), ancestors, textTruncated: text.truncated, htmlTruncated: html.length > limits.html }
  }

  validate(locator: HtmlElementLocator): Validation {
    if (locator.documentId !== this.documentId) return { valid: false, reason: "unavailable" }
    const stored = this.stored(locator.nodeId)
    if (!stored?.element.isConnected) return { valid: false, reason: "removed" }
    if (!stored.locator || stored.element.localName.toLowerCase() !== locator.tagName || stored.locator.snapshotHash !== locator.snapshotHash || snapshotHash(stored.element.outerHTML) !== locator.snapshotHash || this.resolveSelectors(locator) !== stored.element) return { valid: false, reason: "changed" }
    return { valid: true, element: stored.element }
  }

  validateStored(nodeId: string): Validation {
    const stored = this.stored(nodeId)
    if (!stored?.element.isConnected) return { valid: false, reason: "removed" }
    return stored.locator ? this.validate(stored.locator) : { valid: true, element: stored.element }
  }

  reveal(locator: HtmlElementLocator): Validation {
    if (locator.documentId === this.documentId) return this.validate(locator)
    let root: Document | ShadowRoot = this.document
    let element: Element | null = null
    try {
      for (let index = 0; index < locator.selectors.length; index++) {
        const matches: NodeListOf<Element> = root.querySelectorAll(locator.selectors[index]!)
        if (matches.length !== 1) return { valid: false, reason: "ambiguous" }
        const match: Element = matches[0]!
        element = match
        if (index < locator.selectors.length - 1) {
          if (!match.shadowRoot) return { valid: false, reason: "unavailable" }
          root = match.shadowRoot
        }
      }
      if (!element || element.localName.toLowerCase() !== locator.tagName || snapshotHash(element.outerHTML) !== locator.snapshotHash) return { valid: false, reason: "changed" }
      // An unchanged nth-selector can silently identify an identical sibling.
      // Cross-document replay therefore also requires a unique snapshot across
      // all accessible roots, and fails closed when the bounded scan runs out.
      const roots: (Document | ShadowRoot)[] = [this.document]
      let count = 0
      let matches = 0
      for (const searchRoot of roots) {
        for (const candidate of searchRoot.querySelectorAll("*")) {
          if (++count > 10000) return { valid: false, reason: "unavailable" }
          if (candidate.shadowRoot) roots.push(candidate.shadowRoot)
          if (candidate.localName.toLowerCase() === locator.tagName && snapshotHash(candidate.outerHTML) === locator.snapshotHash && ++matches > 1) return { valid: false, reason: "ambiguous" }
        }
      }
      return matches === 1 ? { valid: true, element } : { valid: false, reason: "unavailable" }
    } catch {
      return { valid: false, reason: "unavailable" }
    }
  }

  private resolveSelectors(locator: HtmlElementLocator): Element | null {
    let root: Document | ShadowRoot = this.document
    let element: Element | null = null
    try {
      for (let index = 0; index < locator.selectors.length; index++) {
        const matches: NodeListOf<Element> = root.querySelectorAll(locator.selectors[index]!)
        if (matches.length !== 1) return null
        const match: Element = matches[0]!
        element = match
        if (index < locator.selectors.length - 1) {
          if (!match.shadowRoot) return null
          root = match.shadowRoot
        }
      }
    } catch {
      return null
    }
    return element
  }
}
