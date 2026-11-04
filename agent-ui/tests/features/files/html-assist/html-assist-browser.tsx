import * as React from "react"
import { createRoot } from "react-dom/client"

import i18n from "../../../../src/i18n"
import "../../../../src/index.css"
import { SidebarProvider } from "../../../../src/components/ui/sidebar"
import { ComposerEditor, type ComposerEditorHandle } from "../../../../src/features/agent-message/components/composer-editor"
import type { FileAnnotationInput } from "../../../../src/features/agent-message/file-annotation"
import { parseMessageSelections } from "../../../../src/features/agent-message/message-select-action"
import { rememberFileExists } from "../../../../src/features/files/file-existence"
import type { FilePreviewMode, PreviewFile } from "../../../../src/features/files/model/file.types"
import { RichFilePreview } from "../../../../src/features/files/preview/rich-file-preview"
import { WorkspaceFilesProvider, useOptionalWorkspaceFiles } from "../../../../src/features/workspace/workspace-files-context"

const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.has("dark"))
await i18n.changeLanguage(query.has("zh") ? "zh-CN" : "en")

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
body { margin: 24px; font: 16px/1.5 system-ui; color: #172033; background: white; }
button { padding: 12px 20px; font: inherit; } .card { width: 420px; padding: 20px; border: 1px solid #999; }
#scroller { margin-top: 16px; width: 440px; height: 180px; overflow: auto; border: 1px solid #aaa; }
#scroller > div { height: 550px; padding: 12px; } #scroll-target { margin-top: 190px; width: 260px; padding: 15px; background: #eaf1ff; }
svg { vertical-align: middle; } #tail { margin-top: 180px; }
</style></head><body>
<article class="card"><h1>Review a landing page</h1><p>Plain HTML source is preserved.</p>
<button id="action"><span>Review this button</span></button>
<button id="disabled-action" disabled>Disabled action</button>
<button id="icon" aria-label="Favorite"><svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 15 9 23 9 17 14 19 22 12 17 5 22 7 14 1 9 9 9Z" fill="#dba100"/></svg></button>
<p id="remove-target">A removable paragraph</p><a id="link" href="#tail">Jump to footer</a>
</article>
<div id="shadow-host"></div>
<div style="position:relative;width:220px;height:48px;margin-top:8px"><span>Under a transparent control</span><button id="transparent-control" aria-label="Transparent control" style="position:absolute;inset:0;opacity:0">Overlay action</button></div>
<div id="scroller"><div><p>Scrollable content</p><p id="scroll-target">Keep this selection attached while scrolling.</p></div></div>
<footer id="tail">Footer</footer>
<script>window.fixtureClicks = 0; document.getElementById('action').addEventListener('click', () => { window.fixtureClicks += 1; }); document.getElementById('shadow-host').attachShadow({mode:'open'}).innerHTML = '<button style="padding:12px;margin-top:8px" aria-label="Shadow action">Shadow action</button>';</script>
</body></html>`
const baseFiles: PreviewFile[] = [
  { id: "html", path: "/html-assist-fixture/review.html", name: "review.html", mediaType: "text/html", renderKind: "html", status: "ready", content: html },
  { id: "other", path: "/html-assist-fixture/other.html", name: "other.html", mediaType: "text/html", renderKind: "html", status: "ready", content: "<h1>Another file</h1><p>Independent selection session.</p>" },
]
baseFiles.forEach((file) => rememberFileExists(file.path, true))
const originalFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href)
  if (url.pathname.startsWith("/api/")) throw new Error("Unexpected real API request: " + url.pathname)
  return originalFetch(input, init)
}

const initialDraft = "Existing chat draft. "
const observed: { batches: FileAnnotationInput[][]; errors: string[] } = { batches: [], errors: [] }
window.addEventListener("unhandledrejection", (event) => { observed.errors.push(String(event.reason)) })

export function Fixture() {
  const [activeFileId, setActiveFileId] = React.useState("html")
  const [mode, setMode] = React.useState<FilePreviewMode>("render")
  const [active, setActive] = React.useState(true)
  const [mounted, setMounted] = React.useState(true)
  const [rejectInsert, setRejectInsert] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const [draft, setDraft] = React.useState(initialDraft)
  const inputRef = React.useRef<HTMLDivElement>(null)
  const editorRef = React.useRef<ComposerEditorHandle>(null)
  const workspace = useOptionalWorkspaceFiles()!
  const files = React.useMemo(() => baseFiles.map((file) => file.id === "html"
    ? { ...file, content: file.content + `\n<!-- revision ${revision} -->` } : file), [revision])
  const { fileOpenNonce, pendingFilePath, pendingPreviewMode } = workspace
  React.useLayoutEffect(() => {
    if (!fileOpenNonce) return
    const file = baseFiles.find((value) => value.path === pendingFilePath)
    if (file) {
      setActiveFileId(file.id)
      setMode(pendingPreviewMode ?? "render")
      setActive(true)
    }
  }, [fileOpenNonce, pendingFilePath, pendingPreviewMode])
  const register = workspace.registerFileAnnotationComposer
  React.useLayoutEffect(() => register((items) => {
    if (rejectInsert) return false
    editorRef.current?.focus(true)
    const inserted = editorRef.current?.insertFileAnnotations(items) ?? false
    if (inserted) observed.batches.push([...items])
    return inserted
  }), [register, rejectInsert])
  const state = { draft, activeFileId, mode, active, mounted, rejectInsert, revision,
    parsed: parseMessageSelections(draft), batches: observed.batches, errors: observed.errors }
  return <>
    <nav className="mb-2 flex flex-wrap gap-4 text-sm">
      <button type="button" data-preview-active-toggle onClick={() => setActive((value) => !value)}>{active ? "Hide preview" : "Show preview"}</button>
      <button type="button" data-preview-mount-toggle onClick={() => setMounted((value) => !value)}>{mounted ? "Unmount preview" : "Remount preview"}</button>
      <button type="button" data-preview-revision onClick={() => setRevision((value) => value + 1)}>Change source revision</button>
      <label><input type="checkbox" checked={rejectInsert} onChange={(event) => setRejectInsert(event.target.checked)} data-reject-insert /> Reject composer insertion</label>
    </nav>
    <div id="preview" className="flex border border-border" style={{ width: "min(1080px,100%)", height: 610, display: active ? undefined : "none" }}>
      {mounted && <RichFilePreview files={files} activeFileId={activeFileId} mode={mode} active={active}
        onActiveFileChange={setActiveFileId} onModeChange={setMode} onCloseAll={() => {}} onFileClose={() => {}} />}
    </div>
    <div className="mt-3 max-w-5xl rounded-md border border-border p-3" data-composer-fixture>
      <ComposerEditor ref={editorRef} inputRef={inputRef} draft={draft} placeholder="Chat draft"
        onChange={setDraft} onImagesPaste={() => {}} onKeyDown={() => false} />
    </div>
    <pre id="fixture-state" className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(state)}</pre>
  </>
}

createRoot(document.getElementById("root")!).render(
  <SidebarProvider className="block min-h-0" defaultOpen={false} stateCookieName={false} widthCookieName={false}>
    <WorkspaceFilesProvider><Fixture /></WorkspaceFilesProvider>
  </SidebarProvider>,
)
