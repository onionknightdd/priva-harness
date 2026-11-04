import * as React from "react"
import { useTranslation } from "react-i18next"

import type { HtmlFileAnnotation } from "@/features/agent-message/file-annotation"
import { useFileAssist } from "../element-assist/file-assist-provider"
import { useOptionalWorkspaceFiles } from "@/features/workspace/workspace-files-context"

import { parseHtmlAssistEvent } from "./html-assist-protocol"
import type { HtmlAssistCommand, HtmlAssistEvent, HtmlElementBox, HtmlElementLocator, HtmlHoverCandidate } from "./html-assist.types"

type Command = HtmlAssistCommand extends infer Item ? Item extends HtmlAssistCommand ? Omit<Item, "channel" | "nonce"> : never : never
function errorTranslationKey(code: string) {
  switch (code) {
    case "changed": return "filePreview.htmlAssist.changed"
    case "ambiguous": return "filePreview.htmlAssist.ambiguous"
    case "selector-too-long": return "filePreview.htmlAssist.selectorTooLong"
    default: return "filePreview.htmlAssist.unavailable"
  }
}

type Request = { resolve: (event: HtmlAssistEvent) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

export function useHtmlAssist({ fileId, content, nonce, iframeRef, menuRef }: {
  fileId: string
  content: string
  nonce: string
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  menuRef: React.RefObject<HTMLDivElement | null>
}) {
  const { t } = useTranslation()
  const assist = useFileAssist()
  const workspace = useOptionalWorkspaceFiles()
  const isActiveFile = assist?.activeFile?.id === fileId
  const draft = isActiveFile && assist?.draft?.kind === "html" ? assist.draft : null
  const items = isActiveFile ? assist?.items.filter((item): item is typeof item & { annotation: HtmlFileAnnotation } => item.annotation.kind === "html") ?? [] : []
  const scope = React.useMemo(() => ({ content, fileId, nonce }), [content, fileId, nonce])
  const currentScope = React.useRef<typeof scope | null>(scope)
  currentScope.current = scope
  const [candidate, setCandidate] = React.useState<HtmlHoverCandidate | null>(null)
  const [geometry, setGeometry] = React.useState<Record<string, HtmlElementBox | null>>({})
  const [revealed, setRevealed] = React.useState<{ nodeId: string; index: number; box: HtmlElementBox } | null>(null)
  const [readyScope, setReadyScope] = React.useState<typeof scope | null>(null)
  const [fileRevision, setFileRevision] = React.useState<{ scope: typeof scope; value: string } | null>(null)
  const ready = readyScope === scope
  const revision = fileRevision?.scope === scope ? fileRevision.value : null
  const enabled = Boolean(assist?.enabled && isActiveFile && ready && revision)
  const pending = React.useRef(new Map<string, Request>())
  const confirming = React.useRef<symbol | null>(null)
  const live = React.useRef({ assist, enabled, isActiveFile, draft, candidate, t })
  live.current = { assist, enabled, isActiveFile, draft, candidate, t }

  const post = React.useCallback((command: Command) => {
    if (currentScope.current === scope) iframeRef.current?.contentWindow?.postMessage({ ...command, channel: "html-assist", nonce } satisfies HtmlAssistCommand, "*")
  }, [iframeRef, nonce, scope])
  const request = React.useCallback((command: Command & { requestId: string }) => new Promise<HtmlAssistEvent>((resolve, reject) => {
    if (currentScope.current !== scope || !iframeRef.current?.contentWindow) {
      reject(new Error(live.current.t("filePreview.htmlAssist.unavailable")))
      return
    }
    const timer = setTimeout(() => {
      pending.current.delete(command.requestId)
      reject(new Error(live.current.t("filePreview.htmlAssist.unavailable")))
    }, 5000)
    pending.current.set(command.requestId, { resolve, reject, timer })
    post(command)
  }), [iframeRef, post, scope])

  React.useEffect(() => {
    let active = true
    void crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)).then((digest) => {
      if (!active || currentScope.current !== scope) return
      const value = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
      setFileRevision({ scope, value })
      live.current.assist?.registerRevision(fileId, value)
    }).catch((error) => {
      if (active && currentScope.current === scope && live.current.isActiveFile) live.current.assist?.reportError(String(error))
    })
    return () => { active = false }
  }, [content, fileId, scope])

  React.useLayoutEffect(() => {
    currentScope.current = scope
    setReadyScope(null)
    confirming.current = null
    let focusFrame: number | null = null
    setCandidate(null)
    setGeometry({})
    setRevealed(null)
    const requests = pending.current
    const onMessage = (event: MessageEvent) => {
      if (currentScope.current !== scope || event.source !== iframeRef.current?.contentWindow) return
      const message = parseHtmlAssistEvent(event.data)
      if (!message || message.nonce !== nonce) return
      if ("requestId" in message && message.requestId) {
        const task = requests.get(message.requestId)
        if (task) {
          clearTimeout(task.timer)
          requests.delete(message.requestId)
          if (message.type === "error") task.reject(new Error(live.current.t(errorTranslationKey(message.message))))
          else task.resolve(message)
        }
      }
      const current = live.current
      switch (message.type) {
        case "ready": setReadyScope(scope); break
        case "focus-menu":
          if (!current.enabled) break
          if (focusFrame !== null) cancelAnimationFrame(focusFrame)
          focusFrame = requestAnimationFrame(() => {
            focusFrame = null
            if (currentScope.current === scope && live.current.enabled) menuRef.current?.querySelector<HTMLButtonElement>("[data-selection-action-id]")?.focus({ preventScroll: true })
          })
          break
        case "hover":
          if (!current.enabled || current.draft) break
          // Crossing into the parent popover must not make its trigger disappear.
          if (!message.candidate && !iframeRef.current?.matches(":hover")) break
          setCandidate(message.candidate)
          break
        case "lock":
          if (!current.enabled || current.draft) break
          current.assist?.reportError(null)
          current.assist?.lock(message.target)
          setCandidate(null)
          break
        case "cancel":
          if (!current.isActiveFile) break
          current.assist?.cancelDraft()
          setCandidate(null)
          break
        case "geometry":
          setGeometry(Object.fromEntries(message.nodes.map((node) => [node.nodeId, node.box])))
          break
        case "invalid": {
          if (!current.isActiveFile) break
          const affected = new Set(message.nodeIds)
          let changed = false
          if (current.draft && affected.has(current.draft.locator.nodeId)) { current.assist?.cancelDraft(); changed = true }
          if (current.candidate && affected.has(current.candidate.nodeId)) setCandidate(null)
          for (const item of current.assist?.items ?? []) {
            if (item.annotation.kind === "html" && affected.has(item.annotation.locator.nodeId)) {
              current.assist?.remove(item.annotation.selectionId)
              changed = true
            }
          }
          if (changed) current.assist?.reportError(current.t("filePreview.htmlAssist.changed"))
          setRevealed((value) => value && affected.has(value.nodeId) ? null : value)
          break
        }
        case "error":
          if (current.isActiveFile) current.assist?.reportError(current.t(errorTranslationKey(message.message)))
          break
      }
    }
    window.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("message", onMessage)
      if (currentScope.current === scope) currentScope.current = null
      if (focusFrame !== null) cancelAnimationFrame(focusFrame)
      for (const task of requests.values()) { clearTimeout(task.timer); task.reject(new Error("HTML preview closed")) }
      requests.clear()
    }
  }, [iframeRef, menuRef, nonce, scope])

  React.useEffect(() => {
    if (!ready) return
    post({ type: "enable", enabled: enabled && Boolean(revision) })
    if (!enabled) setCandidate(null)
  }, [enabled, post, ready, revision])
  const retained = JSON.stringify(items.map((item) => item.annotation.locator.nodeId))
  // Retain confirmed nodes before unlocking the draft in the iframe.
  React.useEffect(() => {
    if (ready) post({ type: "items", nodeIds: JSON.parse(retained) as string[] })
  }, [post, ready, retained])
  React.useEffect(() => {
    if (ready) post({ type: "draft", nodeId: draft?.locator.nodeId ?? null })
  }, [draft, post, ready])
  React.useEffect(() => {
    setCandidate(null)
    if (ready) post({ type: "reset-hover" })
  }, [assist?.clearEpoch, post, ready])

  const validate = React.useCallback(async (locators: HtmlElementLocator[]) => {
    let response: HtmlAssistEvent
    try {
      response = await request({ type: "validate", requestId: crypto.randomUUID(), locators })
    } catch (error) {
      if (currentScope.current !== scope) return false
      throw error
    }
    if (currentScope.current !== scope) return false
    const valid = response.type === "validation" && response.results.length === locators.length &&
      response.results.every((result, index) => result.nodeId === locators[index].nodeId && result.valid)
    if (!valid && live.current.isActiveFile) live.current.assist?.reportError(live.current.t("filePreview.htmlAssist.changed"))
    return valid
  }, [request, scope])
  const registerValidator = assist?.registerValidator
  React.useEffect(() => {
    if (!ready || !revision) return
    return registerValidator?.(fileId, (annotations) => validate(annotations.filter((annotation): annotation is HtmlFileAnnotation => annotation.kind === "html").map((annotation) => annotation.locator)))
  }, [fileId, ready, registerValidator, revision, validate])

  const pendingAnnotation = workspace?.pendingAnnotation
  const clearPendingAnnotation = workspace?.clearPendingAnnotation
  const activePath = assist?.activeFile?.path
  React.useEffect(() => {
    if (!isActiveFile || !ready || !revision || !pendingAnnotation || pendingAnnotation.kind !== "html" || pendingAnnotation.filePath !== activePath) return
    let active = true
    if (pendingAnnotation.fileRevision !== revision) {
      clearPendingAnnotation?.(pendingAnnotation.selectionId)
      live.current.assist?.reportError(live.current.t("filePreview.officeAssist.fileChanged"))
      return
    }
    void request({ type: "reveal", requestId: crypto.randomUUID(), locator: pendingAnnotation.locator }).then((response) => {
      if (!active || currentScope.current !== scope) return
      if (response.type === "revealed") setRevealed({ nodeId: response.nodeId, box: response.box, index: pendingAnnotation.index })
      else live.current.assist?.reportError(live.current.t("filePreview.htmlAssist.revealFailed"))
      clearPendingAnnotation?.(pendingAnnotation.selectionId)
    }).catch(() => {
      if (!active || currentScope.current !== scope) return
      live.current.assist?.reportError(live.current.t("filePreview.htmlAssist.revealFailed"))
      clearPendingAnnotation?.(pendingAnnotation.selectionId)
    })
    return () => { active = false }
  }, [activePath, clearPendingAnnotation, isActiveFile, pendingAnnotation, ready, request, revision, scope])

  const capture = () => {
    const current = live.current.candidate
    if (live.current.enabled && current) post({ type: "capture", requestId: crypto.randomUUID(), nodeId: current.nodeId })
  }
  const confirm = async (question: string) => {
    const current = live.current
    if (!current.enabled || !current.draft || confirming.current) return
    const confirmation = Symbol("html-assist-confirmation")
    confirming.current = confirmation
    try {
      if (await validate([current.draft.locator]) && currentScope.current === scope && live.current.draft === current.draft && live.current.enabled) live.current.assist?.confirm(question)
    } catch (error) {
      if (currentScope.current === scope && live.current.draft === current.draft) live.current.assist?.reportError(error instanceof Error ? error.message : String(error))
    } finally { if (confirming.current === confirmation) confirming.current = null }
  }
  const cancel = React.useCallback(() => {
    if (live.current.isActiveFile) live.current.assist?.cancelDraft()
    setCandidate(null)
    post({ type: "reset-hover" })
  }, [post])

  React.useEffect(() => {
    if (!enabled) return
    let blurTimer: ReturnType<typeof setTimeout> | null = null
    const onBlur = () => {
      if (blurTimer !== null) clearTimeout(blurTimer)
      // Focus entering the child frame blurs this Window, but the document
      // still owns focus. Wait for that transfer before deciding it was lost.
      blurTimer = setTimeout(() => { if (!document.hasFocus()) cancel() }, 0)
    }
    const onVisibility = () => { if (document.visibilityState === "hidden") cancel() }
    const isControl = (target: EventTarget | null) => target instanceof Element &&
      (menuRef.current?.contains(target) || target.closest("[data-html-assist-overlay], [data-office-assist-controls]"))
    const onDown = (event: PointerEvent) => { if (event.button === 0 && !isControl(event.target)) cancel() }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229 &&
          !(event.target instanceof Element && event.target.closest("[data-selection-action-input]"))) cancel()
    }
    const onMove = (event: PointerEvent) => {
      if (live.current.draft || isControl(event.target)) return
      const frame = iframeRef.current?.getBoundingClientRect()
      const menu = menuRef.current?.getBoundingClientRect()
      const selected = live.current.candidate?.box
      if (!frame || !menu || !selected) return
      const left = frame.left + selected.x, top = frame.top + selected.y
      const insideCorridor = event.clientX >= Math.min(left, menu.left) - 8 && event.clientX <= Math.max(left + selected.width, menu.right) + 8 &&
        event.clientY >= Math.min(top, menu.top) - 8 && event.clientY <= Math.max(top + selected.height, menu.bottom) + 8
      if (!insideCorridor) setCandidate(null)
    }
    window.addEventListener("blur", onBlur)
    document.addEventListener("visibilitychange", onVisibility)
    document.addEventListener("pointerdown", onDown, true)
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointermove", onMove)
    return () => {
      if (blurTimer !== null) clearTimeout(blurTimer)
      window.removeEventListener("blur", onBlur)
      document.removeEventListener("visibilitychange", onVisibility)
      document.removeEventListener("pointerdown", onDown, true)
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointermove", onMove)
    }
  }, [cancel, enabled, iframeRef, menuRef])

  return { assist, enabled, draft, items, candidate, geometry, revealed, ready, capture, confirm, cancel, closeReveal: () => { setRevealed(null); post({ type: "clear-reference" }) } }
}
