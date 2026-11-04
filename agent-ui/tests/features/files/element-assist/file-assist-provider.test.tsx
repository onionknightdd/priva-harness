import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MutationObserver", "getComputedStyle"]) {
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
const { FileAssistProvider, useFileAssist } = await import("../../../../src/features/files/element-assist/file-assist-provider.tsx")
const { default: i18n } = await import("../../../../src/i18n/index.ts")
await i18n.changeLanguage("en")
import type { FileAnnotationInput } from "../../../../src/features/agent-message/file-annotation.ts"
import type { PreviewFile } from "../../../../src/features/files/model/file.types.ts"
import type { HtmlElementTarget } from "../../../../src/features/files/html-assist/html-assist.types.ts"

const files: PreviewFile[] = ["first", "second"].map((id) => ({ id, path: `/workspace/${id}.html`, name: `${id}.html`, mediaType: "text/html", renderKind: "html", status: "ready", content: "<button>Save</button>" }))
const target: HtmlElementTarget = {
  kind: "html", elementType: "element", label: "button", text: "Save", coordinateSpace: "html-viewport-css-pixels",
  boxes: [{ surfaceIndex: 0, x: 10, y: 20, width: 80, height: 30 }],
  locator: { documentId: "document-one", nodeId: "node-one", selectors: ["button"], tagName: "button", snapshotHash: "0123456789abcdef" },
  html: "<button>Save</button>", ancestors: ["body"], textTruncated: false, htmlTruncated: false,
}

function deferred() {
  let resolve!: (valid: boolean) => void
  const promise = new Promise<boolean>((done) => { resolve = done })
  return { promise, resolve }
}

async function mount() {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  let current: NonNullable<ReturnType<typeof useFileAssist>>
  let activeFile = files[0]
  let showProvider = true
  let accept = true
  const received: FileAnnotationInput[][] = []
  function Reader() { current = useFileAssist()!; return null }
  function Fixture() {
    const workspace = useOptionalWorkspaceFiles()!
    const register = workspace.registerFileAnnotationComposer
    React.useEffect(() => register((items) => { if (!accept) return false; received.push([...items]); return true }), [register])
    return showProvider ? <FileAssistProvider activeFile={activeFile} files={files} mode="edit"><Reader /></FileAssistProvider> : null
  }
  const render = () => root.render(<SidebarProvider stateCookieName={false} widthCookieName={false}><WorkspaceFilesProvider><Fixture /></WorkspaceFilesProvider></SidebarProvider>)
  await act(async () => render())
  await act(async () => current.registerRevision(files[0].id, "a".repeat(64)))
  return {
    api: () => current,
    batches: received,
    reject: (value: boolean) => { accept = !value },
    add: async (question = "Review") => {
      await act(async () => current.lock(target))
      await act(async () => current.confirm(question))
    },
    switchFile: async () => { activeFile = files[1]; await act(async () => render()) },
    hideProvider: async () => { showProvider = false; await act(async () => render()) },
    unmount: async () => { await act(async () => root.unmount()); host.remove() },
  }
}

for (const mutation of ["clear", "remove"] as const) test(`${mutation} cancels an in-flight validated batch before React commits the mutation`, async () => {
  const fixture = await mount()
  try {
    await fixture.add()
    const validation = deferred()
    fixture.api().registerValidator(files[0].id, () => validation.promise)
    let sending: Promise<void> | undefined
    await act(async () => { sending = fixture.api().send() })
    assert.equal(fixture.api().sending, true)
    await act(async () => {
      if (mutation === "clear") fixture.api().clear()
      else fixture.api().remove(fixture.api().items[0].annotation.selectionId)
      validation.resolve(true)
      // The response arrives in the same event, before the state update commits.
      await sending
    })
    assert.equal(fixture.batches.length, 0)
    assert.equal(fixture.api().items.length, 0)
    assert.equal(fixture.api().sending, false)
  } finally { await fixture.unmount() }
})

for (const transition of ["file switch", "unmount"] as const) test(`${transition} cancels a pending batch without inserting into the still-mounted composer`, async () => {
  const fixture = await mount()
  try {
    await fixture.add()
    const validation = deferred()
    fixture.api().registerValidator(files[0].id, () => validation.promise)
    let sending: Promise<void> | undefined
    await act(async () => { sending = fixture.api().send() })
    if (transition === "file switch") await fixture.switchFile()
    else await fixture.hideProvider()
    await act(async () => { validation.resolve(true); await sending })
    assert.equal(fixture.batches.length, 0)
  } finally { await fixture.unmount() }
})

test("concurrent delivery requests insert once, while a rejected insertion preserves the batch for retry", async () => {
  const fixture = await mount()
  try {
    await fixture.add("First")
    const validation = deferred()
    fixture.api().registerValidator(files[0].id, () => validation.promise)
    fixture.reject(true)
    let sending: Promise<void> | undefined
    await act(async () => { sending = fixture.api().send(); fixture.api().send() })
    await act(async () => { validation.resolve(true); await sending })
    assert.equal(fixture.batches.length, 0)
    assert.equal(fixture.api().items.length, 1)
    assert.equal(fixture.api().sending, false)
    fixture.reject(false)
    await act(async () => { sending = fixture.api().send(); fixture.api().send(); await sending })
    assert.equal(fixture.batches.length, 1)
    assert.equal(fixture.batches[0][0].question, "First")
    assert.equal(fixture.api().items.length, 0)
  } finally { await fixture.unmount() }
})

test("HTML batch limit retains the unconfirmed question target instead of exceeding the bridge limit", async () => {
  const fixture = await mount()
  try {
    for (let index = 0; index < 200; index += 1) await fixture.add(`Question ${index}`)
    await act(async () => fixture.api().lock(target))
    await act(async () => fixture.api().confirm("One too many"))
    assert.equal(fixture.api().items.length, 200)
    assert.equal(fixture.api().draft, target)
    assert.equal(fixture.api().error, i18n.t("filePreview.htmlAssist.limitReached", { count: 200 }))
  } finally { await fixture.unmount() }
})
