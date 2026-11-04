import { HTML_TARGET_LIMITS as limits, type HtmlAssistCommand, type HtmlAssistEvent, type HtmlElementBox, type HtmlElementLocator, type HtmlElementTarget } from "./html-assist.types"

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => Boolean(value) && typeof value === "object" && !Array.isArray(value)
const keys = (value: RecordValue, required: string[], optional: string[] = []) => required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
const string = (value: unknown, max: number, empty = false): value is string => typeof value === "string" && (empty || value.trim().length > 0) && value.length <= max
const identity = (value: unknown): value is string => string(value, limits.identity) && /^[A-Za-z][A-Za-z0-9-]*$/.test(value)
const requestId = (value: unknown): value is string => string(value, limits.identity)
const list = (value: unknown, test: (item: unknown) => boolean, max: number, min = 0): value is unknown[] => Array.isArray(value) && value.length >= min && value.length <= max && value.every(test)
const reason = (value: unknown) => typeof value === "string" && ["removed", "changed", "unavailable", "ambiguous"].includes(value)

export function isHtmlElementBox(value: unknown): value is HtmlElementBox {
  return record(value) && keys(value, ["surfaceIndex", "x", "y", "width", "height"]) && value.surfaceIndex === 0 && [value.x, value.y, value.width, value.height].every((number) => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= limits.coordinate) && Number(value.width) > 0 && Number(value.height) > 0
}

export function isHtmlElementLocator(value: unknown): value is HtmlElementLocator {
  return record(value) && keys(value, ["documentId", "nodeId", "selectors", "tagName", "snapshotHash"]) && identity(value.documentId) && identity(value.nodeId) && list(value.selectors, (item) => string(item, limits.selector), limits.selectors, 1) && string(value.tagName, limits.tagName) && /^[a-z][a-z0-9:-]*$/.test(value.tagName) && typeof value.snapshotHash === "string" && /^[a-f0-9]{16}$/.test(value.snapshotHash)
}

export function isHtmlElementTarget(value: unknown): value is HtmlElementTarget {
  return record(value) && keys(value, ["kind", "elementType", "label", "text", "coordinateSpace", "boxes", "locator", "html", "ancestors", "textTruncated", "htmlTruncated"]) && value.kind === "html" && value.elementType === "element" && value.coordinateSpace === "html-viewport-css-pixels" && string(value.label, limits.label) && string(value.text, limits.text, true) && string(value.html, limits.html) && list(value.boxes, isHtmlElementBox, 1, 1) && isHtmlElementLocator(value.locator) && list(value.ancestors, (item) => string(item, limits.ancestor), limits.ancestors) && typeof value.textTruncated === "boolean" && typeof value.htmlTruncated === "boolean"
}

function envelope(value: unknown): value is RecordValue {
  return record(value) && value.channel === "html-assist" && identity(value.nonce) && typeof value.type === "string"
}

export function parseHtmlAssistCommand(value: unknown): HtmlAssistCommand | null {
  if (!envelope(value)) return null
  const fields = ["channel", "nonce", "type"]
  let valid = false
  switch (value.type) {
    case "enable": valid = keys(value, [...fields, "enabled"]) && typeof value.enabled === "boolean"; break
    case "reset-hover": valid = keys(value, fields); break
    case "clear-reference": valid = keys(value, fields); break
    case "draft": valid = keys(value, [...fields, "nodeId"]) && (value.nodeId === null || identity(value.nodeId)); break
    case "items": valid = keys(value, [...fields, "nodeIds"]) && list(value.nodeIds, identity, limits.items); break
    case "capture": valid = keys(value, [...fields, "requestId", "nodeId"]) && requestId(value.requestId) && identity(value.nodeId); break
    case "validate": valid = keys(value, [...fields, "requestId", "locators"]) && requestId(value.requestId) && list(value.locators, isHtmlElementLocator, limits.items); break
    case "reveal": valid = keys(value, [...fields, "requestId", "locator"]) && requestId(value.requestId) && isHtmlElementLocator(value.locator); break
  }
  return valid ? value as HtmlAssistCommand : null
}

export function parseHtmlAssistEvent(value: unknown): HtmlAssistEvent | null {
  if (!envelope(value)) return null
  const fields = ["channel", "nonce", "type"]
  let valid = false
  switch (value.type) {
    case "ready": valid = keys(value, [...fields, "documentId"]) && identity(value.documentId); break
    case "hover": valid = keys(value, [...fields, "candidate"]) && (value.candidate === null || (record(value.candidate) && keys(value.candidate, ["nodeId", "label", "box"]) && identity(value.candidate.nodeId) && string(value.candidate.label, limits.label) && isHtmlElementBox(value.candidate.box))); break
    case "lock": valid = keys(value, [...fields, "requestId", "target"]) && requestId(value.requestId) && isHtmlElementTarget(value.target); break
    case "cancel": valid = keys(value, fields); break
    case "focus-menu": valid = keys(value, fields); break
    case "geometry": valid = keys(value, [...fields, "nodes"]) && list(value.nodes, (node) => record(node) && keys(node, ["nodeId", "box"]) && identity(node.nodeId) && (node.box === null || isHtmlElementBox(node.box)), limits.items + 3); break
    case "invalid": valid = keys(value, [...fields, "nodeIds", "reason"]) && list(value.nodeIds, identity, limits.items + 3) && reason(value.reason); break
    case "validation": valid = keys(value, [...fields, "requestId", "results"]) && requestId(value.requestId) && list(value.results, (result) => record(result) && keys(result, ["nodeId", "valid"], ["reason"]) && identity(result.nodeId) && typeof result.valid === "boolean" && (!Object.hasOwn(result, "reason") || reason(result.reason)), limits.items); break
    case "revealed": valid = keys(value, [...fields, "requestId", "nodeId", "box"]) && requestId(value.requestId) && identity(value.nodeId) && isHtmlElementBox(value.box); break
    case "error": valid = keys(value, [...fields, "message"], ["requestId"]) && string(value.message, 1000) && (!Object.hasOwn(value, "requestId") || requestId(value.requestId)); break
  }
  return valid ? value as HtmlAssistEvent : null
}
