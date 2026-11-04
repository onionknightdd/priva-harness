export const HTML_TARGET_LIMITS = {
  label: 160,
  text: 4000,
  html: 8000,
  ancestors: 8,
  ancestor: 256,
  selectors: 16,
  selector: 2048,
  identity: 128,
  tagName: 64,
  snapshotHash: 16,
  coordinate: 10000000,
  items: 200,
} as const

export type HtmlElementBox = {
  surfaceIndex: 0
  x: number
  y: number
  width: number
  height: number
}

export type HtmlElementLocator = {
  documentId: string
  nodeId: string
  /** One selector per root, from the document through any open shadow roots. */
  selectors: string[]
  tagName: string
  /** A non-cryptographic snapshot fingerprint; session identity is checked separately. */
  snapshotHash: string
}

export type HtmlElementTarget = {
  kind: "html"
  elementType: "element"
  label: string
  text: string
  coordinateSpace: "html-viewport-css-pixels"
  boxes: HtmlElementBox[]
  locator: HtmlElementLocator
  html: string
  ancestors: string[]
  textTruncated: boolean
  htmlTruncated: boolean
}

export type HtmlHoverCandidate = {
  nodeId: string
  label: string
  box: HtmlElementBox
}

export type HtmlInvalidReason = "removed" | "changed" | "unavailable" | "ambiguous"

type Envelope = { channel: "html-assist"; nonce: string }

export type HtmlAssistCommand = Envelope & (
  | { type: "enable"; enabled: boolean }
  | { type: "reset-hover" }
  | { type: "clear-reference" }
  | { type: "draft"; nodeId: string | null }
  | { type: "items"; nodeIds: string[] }
  | { type: "capture"; requestId: string; nodeId: string }
  | { type: "validate"; requestId: string; locators: HtmlElementLocator[] }
  | { type: "reveal"; requestId: string; locator: HtmlElementLocator }
)

export type HtmlAssistEvent = Envelope & (
  | { type: "ready"; documentId: string }
  | { type: "hover"; candidate: HtmlHoverCandidate | null }
  | { type: "lock"; requestId: string; target: HtmlElementTarget }
  | { type: "cancel" }
  | { type: "focus-menu" }
  | { type: "geometry"; nodes: { nodeId: string; box: HtmlElementBox | null }[] }
  | { type: "invalid"; nodeIds: string[]; reason: HtmlInvalidReason }
  | { type: "validation"; requestId: string; results: { nodeId: string; valid: boolean; reason?: HtmlInvalidReason }[] }
  | { type: "revealed"; requestId: string; nodeId: string; box: HtmlElementBox }
  | { type: "error"; requestId?: string; message: string }
)
