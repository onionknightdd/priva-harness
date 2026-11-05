import * as React from "react"
import { createRoot } from "react-dom/client"
import { BoxGeometry } from "three"
import { ThemeProvider } from "next-themes"
import i18n from "../../../../src/i18n"
import "../../../../src/index.css"
import { SidebarProvider } from "../../../../src/components/ui/sidebar"
import { RichFilePreview } from "../../../../src/features/files/preview/rich-file-preview"
import { WorkspaceFilesProvider, useOptionalWorkspaceFiles } from "../../../../src/features/workspace/workspace-files-context"
import type { FileAnnotationInput } from "../../../../src/features/agent-message/file-annotation"
import type { PreviewFile } from "../../../../src/features/files/model/file.types"

const query = new URLSearchParams(location.search)
await i18n.changeLanguage(query.has("zh") ? "zh-CN" : "en")
const geometry = new BoxGeometry(2, 2, 2).toNonIndexed()
const positions = geometry.getAttribute("position")
const triangles = []
for (let i = 0; i < positions.count; i += 3) triangles.push(`facet normal 0 0 0\nouter loop\n${[i, i + 1, i + 2].map((index) => `vertex ${positions.getX(index)} ${positions.getY(index)} ${positions.getZ(index)}`).join("\n")}\nendloop\nendfacet`)
geometry.dispose()
const stl = query.has("colored")
  ? await fetch(new URL("./model/fixtures/colored-cube.stl", import.meta.url)).then((response) => response.arrayBuffer())
  : `solid box\n${triangles.join("\n")}\nendsolid box`
const fileName = query.get("name") ?? (query.has("colored") ? "colored-cube.stl" : "box.stl")
const filePath = `/fixture/${fileName}`
const mediaType = fileName.toLowerCase().endsWith(".3mf") ? "model/3mf" : "model/stl"
const fileSize = typeof stl === "string" ? stl.length : stl.byteLength
const observed = { frames: 0, requests: 0, delayNextAssetMs: 0, annotations: [] as FileAnnotationInput[], errors: [] as string[] }
for (const method of ["drawArrays", "drawElements"] as const) {
  const draw = WebGL2RenderingContext.prototype[method]
  Object.defineProperty(WebGL2RenderingContext.prototype, method, { value: function (...args: unknown[]) { observed.frames++; return Reflect.apply(draw, this, args) } })
}
Object.assign(window, { modelFixture: observed })
window.addEventListener("unhandledrejection", (event) => observed.errors.push(String(event.reason)))
const nativeFetch = fetch.bind(window)
window.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href)
  if (url.pathname === "/api/sandbox/models/inspect") return Response.json({ name: fileName, path: filePath, size: fileSize, revision: "a".repeat(64), mediaType, pointCloud: null })
  if (url.pathname === "/api/sandbox/models/asset") {
    observed.requests++
    const delay = observed.delayNextAssetMs
    observed.delayNextAssetMs = 0
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    init?.signal?.throwIfAborted()
    return new Response(stl, { headers: { "Content-Type": mediaType, "Content-Length": String(fileSize) } })
  }
  if (url.pathname.startsWith("/api/")) throw new Error("Unexpected fixture request: " + url.pathname)
  return nativeFetch(input, init)
}

function Fixture() {
  const workspace = useOptionalWorkspaceFiles()!
  const [active, setActive] = React.useState(true)
  const [mounted, setMounted] = React.useState(true)
  const [generation, setGeneration] = React.useState(0)
  const [fileId, setFileId] = React.useState("box")
  const files: PreviewFile[] = [{ id: "box", path: filePath, name: fileName, mediaType, renderKind: "model", renderSource: "fixture", status: "ready", previewGeneration: generation }, { id: "text", path: "/fixture/note.txt", name: "note.txt", mediaType: "text/plain", content: "A text file", status: "ready" }]
  React.useEffect(() => workspace.registerFileAnnotationComposer((items) => { observed.annotations.push(...items); return true }), [workspace.registerFileAnnotationComposer])
  return <div className="w-full">
    <nav className="mb-3 flex flex-wrap gap-3 text-sm"><button onClick={() => setActive(!active)}>{active ? "Hide preview" : "Show preview"}</button><button onClick={() => setMounted(!mounted)}>{mounted ? "Unmount" : "Mount"}</button><button onClick={() => setGeneration(generation + 1)}>Refresh</button></nav>
    <div id="preview" style={{ height: "75vh", minHeight: 450, display: active ? "flex" : "none" }}>{mounted && <RichFilePreview active={active} activeFileId={fileId} files={files} onActiveFileChange={setFileId} onCloseAll={() => {}} onFileClose={() => {}} />}</div>
  </div>
}
createRoot(document.getElementById("root")!).render(<ThemeProvider attribute="class" forcedTheme={query.has("dark") ? "dark" : "light"}><SidebarProvider><WorkspaceFilesProvider onShowChat={() => {}}><Fixture /></WorkspaceFilesProvider></SidebarProvider></ThemeProvider>)
