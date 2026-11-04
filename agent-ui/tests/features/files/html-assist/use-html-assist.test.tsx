import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MessageEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window) })
dom.window.matchMedia = (media) => ({ matches: false, media, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
after(() => dom.window.close())

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { SidebarProvider } = await import("../../../../src/components/ui/sidebar.tsx")
const { WorkspaceFilesProvider, useOptionalWorkspaceFiles } = await import("../../../../src/features/workspace/workspace-files-context.tsx")
const { FileAssistProvider } = await import("../../../../src/features/files/element-assist/file-assist-provider.tsx")
const { useHtmlAssist } = await import("../../../../src/features/files/html-assist/use-html-assist.ts")
const { default: i18n } = await import("../../../../src/i18n/index.ts")
await i18n.changeLanguage("en")
import type { HtmlFileAnnotation } from "../../../../src/features/agent-message/file-annotation.ts"
import type { PreviewFile } from "../../../../src/features/files/model/file.types.ts"
import type { HtmlAssistCommand, HtmlElementTarget } from "../../../../src/features/files/html-assist/html-assist.types.ts"

const source = "<button>Save</button>"
const files: PreviewFile[] = ["first", "second"].map((id) => ({ id, path: `/workspace/${id}.html`, name: `${id}.html`, mediaType: "text/html", renderKind: "html", status: "ready", content: source }))
const target: HtmlElementTarget = {
  kind: "html", elementType: "element", label: "button", text: "Save", coordinateSpace: "html-viewport-css-pixels",
  boxes: [{ surfaceIndex: 0, x: 10, y: 20, width: 80, height: 30 }],
  locator: { documentId: "document-one", nodeId: "node-one", selectors: ["button"], tagName: "button", snapshotHash: "0123456789abcdef" },
  html: source, ancestors: ["body"], textTruncated: false, htmlTruncated: false,
}
const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source))), (byte) => byte.toString(16).padStart(2, "0")).join("")

async function mount(mode: "edit" | "render" = "edit") {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let nonce = "html-first"
  let content = source
  let workspace: NonNullable<ReturnType<typeof useOptionalWorkspaceFiles>>
  type View = { state: ReturnType<typeof useHtmlAssist>; frame: React.RefObject<HTMLIFrameElement | null>; menu: React.RefObject<HTMLDivElement | null> }
  const views = new Map<string, View>()
  const commands = new Map<string, HtmlAssistCommand[]>()
  function Viewer({ file, nonce, content }: { file: PreviewFile; nonce: string; content: string }) {
    const iframeRef = React.useRef<HTMLIFrameElement>(null)
    const menuRef = React.useRef<HTMLDivElement>(null)
    const state = useHtmlAssist({ fileId: file.id, nonce, content, iframeRef, menuRef })
    views.set(file.id, { state, frame: iframeRef, menu: menuRef })
    return <><iframe ref={iframeRef} title={file.name} />{state.candidate && <div ref={menuRef}><button data-selection-action-id="ask-agent">Ask</button></div>}</>
  }
  function Fixture() {
    workspace = useOptionalWorkspaceFiles()!
    return <FileAssistProvider activeFile={files[0]} files={files} mode={mode}>
      <Viewer file={files[0]} nonce={nonce} content={content} />
      <Viewer file={files[1]} nonce="html-second" content={source} />
    </FileAssistProvider>
  }
  const render = () => root.render(<SidebarProvider stateCookieName={false} widthCookieName={false}><WorkspaceFilesProvider><Fixture /></WorkspaceFilesProvider></SidebarProvider>)
  await act(async () => render())
  for (const [id, view] of views) {
    commands.set(id, [])
    view.frame.current!.contentWindow!.postMessage = (message) => { commands.get(id)!.push(message as HtmlAssistCommand) }
  }
  const emit = (id: string, type: string, fields: object = {}, messageNonce = id === "first" ? nonce : "html-second") => {
    window.dispatchEvent(new MessageEvent("message", { source: views.get(id)!.frame.current!.contentWindow, data: { channel: "html-assist", nonce: messageNonce, type, ...fields } }))
  }
  await act(async () => {
    emit("first", "ready", { documentId: "document-one" })
    emit("second", "ready", { documentId: "document-two" })
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  return {
    view: (id = "first") => views.get(id)!,
    workspace: () => workspace,
    commands: (id = "first") => commands.get(id)!,
    emit,
    newDocument: async () => { nonce = "html-new"; content = source + "<!--changed-->"; await act(async () => render()) },
    unmount: async () => { await act(async () => root.unmount()); host.remove() },
  }
}

test("pending HTML references are consumed after reveal succeeds, so their highlight survives the workspace update", async () => {
  const fixture = await mount("render")
  try {
    const annotation: HtmlFileAnnotation = { ...target, filePath: files[0].path, fileRevision: hash, selectedText: target.text, selectionId: "selection-one", index: 4 }
    await act(async () => fixture.workspace().openFileInWorkspace(annotation.filePath, { annotation, previewMode: "render" }))
    const command = fixture.commands().findLast((command) => command.type === "reveal")
    assert.equal(command?.type, "reveal")
    assert.equal(fixture.workspace().pendingAnnotation?.selectionId, annotation.selectionId)
    await act(async () => fixture.emit("first", "revealed", { requestId: command!.requestId, nodeId: target.locator.nodeId, box: target.boxes[0] }))
    assert.equal(fixture.view().state.revealed?.index, 4)
    assert.equal(fixture.workspace().pendingAnnotation, null)
    assert.equal(fixture.commands("second").some((command) => command.type === "reveal"), false)
    await act(async () => fixture.view().state.closeReveal())
    assert.equal(fixture.commands().at(-1)?.type, "clear-reference")
  } finally { await fixture.unmount() }
})

test("a replaced iframe rejects old confirmations without reporting an error or retaining old readiness", async () => {
  const fixture = await mount()
  try {
    assert.equal(fixture.view().state.enabled, true)
    await act(async () => fixture.emit("first", "lock", { requestId: "lock-one", target }))
    let confirmation: Promise<void> | undefined
    await act(async () => { confirmation = fixture.view().state.confirm("Old document question") })
    const command = fixture.commands().findLast((command) => command.type === "validate")
    assert.equal(command?.type, "validate")
    await fixture.newDocument()
    await act(async () => { await confirmation })
    assert.equal(fixture.view().state.ready, false)
    assert.equal(fixture.view().state.enabled, false)
    assert.equal(fixture.view().state.assist?.error, null)
    await act(async () => fixture.emit("first", "validation", { requestId: command!.requestId, results: [{ nodeId: target.locator.nodeId, valid: true }] }, "html-first"))
    assert.equal(fixture.view().state.assist?.items.length, 0)
  } finally { await fixture.unmount() }
})

test("inactive HTML iframes cannot cancel or invalidate the active file's same-numbered node", async () => {
  const fixture = await mount()
  try {
    await act(async () => fixture.emit("first", "lock", { requestId: "lock-one", target }))
    await act(async () => fixture.emit("second", "cancel"))
    assert.equal(fixture.view().state.draft?.locator.nodeId, target.locator.nodeId)
    assert.equal(fixture.view("second").state.draft, null)
    await act(async () => fixture.view().state.assist!.confirm("Saved question"))
    await act(async () => fixture.emit("second", "invalid", { nodeIds: [target.locator.nodeId], reason: "removed" }))
    assert.equal(fixture.view().state.items.length, 1)
    assert.equal(fixture.view("second").state.items.length, 0)
    assert.equal(fixture.view().state.assist?.error, null)
  } finally { await fixture.unmount() }
})

test("keyboard handoff focuses the parent action and cancelling resets the iframe hover cache", async () => {
  const fixture = await mount()
  try {
    await act(async () => {
      fixture.emit("first", "hover", { candidate: { nodeId: target.locator.nodeId, label: target.label, box: target.boxes[0] } })
      fixture.emit("first", "focus-menu")
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)) })
    assert.ok(document.activeElement === fixture.view().menu.current?.querySelector("button"), "parent menu receives keyboard focus")
    await act(async () => fixture.view().state.cancel())
    assert.equal(fixture.view().state.candidate, null)
    assert.equal(fixture.commands().at(-1)?.type, "reset-hover")
  } finally { await fixture.unmount() }
})

test("focus transfers into the iframe retain the draft; actual focus loss cancels only the unfinished draft", async () => {
  const fixture = await mount()
  const original = document.hasFocus
  try {
    await act(async () => fixture.emit("first", "lock", { requestId: "lock-one", target }))
    await act(async () => fixture.view().state.assist!.confirm("Saved question"))
    await act(async () => fixture.emit("first", "lock", { requestId: "lock-two", target }))
    document.hasFocus = () => true
    await act(async () => { window.dispatchEvent(new Event("blur")); await new Promise((resolve) => setTimeout(resolve, 10)) })
    assert.ok(fixture.view().state.draft)
    document.hasFocus = () => false
    await act(async () => { window.dispatchEvent(new Event("blur")); await new Promise((resolve) => setTimeout(resolve, 10)) })
    assert.equal(fixture.view().state.draft, null)
    assert.equal(fixture.view().state.items.length, 1)
  } finally { document.hasFocus = original; await fixture.unmount() }
})
