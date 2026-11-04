import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"
import type { UploadBatchResult } from "../../../src/features/uploads/upload.types.ts"

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
dom.window.matchMedia = (query) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
after(() => dom.window.close())
const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { SidebarProvider } = await import("../../../src/components/ui/sidebar.tsx")
const { WorkspaceFilesProvider, useOptionalWorkspaceFiles } = await import("../../../src/features/workspace/workspace-files-context.tsx")
const { UploadQueueContext } = await import("../../../src/features/uploads/upload-queue-context.ts")
const { useComposerAttachments } = await import("../../../src/features/agent-message/use-composer-attachments.ts")
const { readyComposerAttachments, partitionComposerUploads } = await import("../../../src/features/agent-message/composer-attachments.ts")

test("preview screenshot uses the existing upload queue, blocks early send, and yields a vision image path", async () => {
  let files!: NonNullable<ReturnType<typeof useOptionalWorkspaceFiles>>
  let attachments!: ReturnType<typeof useComposerAttachments>
  let finish!: (result: UploadBatchResult) => void
  let shown = 0
  const requests: { directory: string; files: File[]; purpose: string | undefined }[] = []
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  function Reader() { files = useOptionalWorkspaceFiles()!; return null }
  function Composer() {
    const current = useComposerAttachments("/work", "claude", "session")
    attachments = current
    const register = useOptionalWorkspaceFiles()!.registerAttachmentComposer
    React.useLayoutEffect(() => register(current.add), [register, current.add])
    return null
  }
  async function render(composer: boolean) {
    await act(async () => root.render(<React.StrictMode><SidebarProvider stateCookieName={false} widthCookieName={false} keyboardShortcut={false}>
      <WorkspaceFilesProvider onShowChat={() => shown++}>
        <UploadQueueContext.Provider value={{ enqueueFiles: (directory, selected, options) => {
          requests.push({ directory, files: selected, purpose: options?.purpose })
          return { cancel() {}, taskIds: ["screenshot"], completion: new Promise((resolve) => { finish = resolve }) }
        } }}>
          <Reader />{composer ? <Composer /> : null}
        </UploadQueueContext.Provider>
      </WorkspaceFilesProvider>
    </SidebarProvider></React.StrictMode>))
  }
  try {
    const screenshot = new File([new Uint8Array([137, 80, 78, 71])], "model-view.png", { type: "image/png" })
    await render(false)
    assert.equal(files.canAttachFiles, false)
    assert.equal(files.addAttachmentFiles([screenshot]), false)
    await render(true)
    assert.equal(files.canAttachFiles, true)
    assert.equal(files.addAttachmentFiles([]), false)
    await act(async () => assert.equal(files.addAttachmentFiles([screenshot]), true))
    assert.equal(shown, 1)
    assert.deepEqual(requests, [{ directory: "/work", files: [screenshot], purpose: "attachment" }])
    assert.equal(readyComposerAttachments(attachments.attachments), null)
    await act(async () => finish({ total: 1, succeeded: 1, failed: 0, canceled: 0, results: [
      { status: "succeeded", file: { path: "/work/.priva-attachments/view.png", name: "model-view.png", size: 4 } },
    ] }))
    const uploaded = readyComposerAttachments(attachments.attachments)!
    assert.deepEqual(partitionComposerUploads(uploaded, true), { files: [], imagePaths: ["/work/.priva-attachments/view.png"] })
    await render(false)
    assert.equal(files.canAttachFiles, false)
    assert.equal(files.addAttachmentFiles([screenshot]), false)
  } finally { await act(async () => root.unmount()); host.remove() }
})
