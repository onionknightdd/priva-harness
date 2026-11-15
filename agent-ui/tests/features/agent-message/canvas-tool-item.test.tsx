import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data.ts"

const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Node", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "MouseEvent", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
// Isolate session transport while keeping the preview providers and tooltip real.
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export default {}", shortCircuit: true }
    if (url.endsWith("/features/chat-session/index.ts")) return { format: "module", shortCircuit: true, source: 'export function useActiveSession() { return { runCwd: "/work", runSessionId: "session" } }' }
    if (url.endsWith("/harness-context.tsx")) return { format: "module", shortCircuit: true, source: 'export function useHarness() { return { runHarnessId: "claude" } }' }
    return nextLoad(url, context)
  },
})
after(() => { hooks.deregister(); dom.window.close() })

const React = await import("react")
const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
const i18n = (await import("i18next")).createInstance()
const { en } = await import("../../../src/i18n/locales/en.ts")
const { zhCN } = await import("../../../src/i18n/locales/zh-CN.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } } })
const { SidebarProvider } = await import("../../../src/components/ui/sidebar.tsx")
const { TooltipProvider } = await import("../../../src/components/ui/tooltip.tsx")
const { WorkspaceFilesProvider, useOptionalWorkspaceFiles, useWorkspaceTab } = await import("../../../src/features/workspace/workspace-files-context.tsx")
const { WorkspaceWhiteboardProvider, useWorkspaceWhiteboard } = await import("../../../src/features/workspace/workspace-whiteboard-context.tsx")
const { ToolResult } = await import("../../../src/components/agents/tool-result.tsx")
const { CanvasToolItem } = await import("../../../src/features/agent-message/components/canvas-tool-item.tsx")

for (const { name, whiteboard, language } of [
  { name: "whiteboard_read", whiteboard: true, language: "en" },
  { name: "mcp__agentWorkshop__whiteboard_write", whiteboard: true, language: "zh-CN" },
  { name: "canvas", whiteboard: false, language: "en" },
]) {
  test(`${name} shares ordinary tool status presentation and preserves successful preview access`, async () => {
    await i18n.changeLanguage(language)
    const host = document.body.appendChild(document.createElement("div"))
    const root = createRoot(host)
    const fileName = whiteboard ? "architecture.board.json" : "architecture.html"
    const path = whiteboard ? `/work/.whiteboard/session/${fileName}` : `/work/${fileName}`
    const errorOutput = JSON.stringify({ path, error: "PRIVATE_ERROR_DETAILS", details: { reason: "INVALID_DRAWING_OPERATION" } })
    let boards!: NonNullable<ReturnType<typeof useWorkspaceWhiteboard>>
    let files!: NonNullable<ReturnType<typeof useOptionalWorkspaceFiles>>
    let tabs!: ReturnType<typeof useWorkspaceTab>
    function PreviewStateProbe() {
      boards = useWorkspaceWhiteboard()!
      files = useOptionalWorkspaceFiles()!
      tabs = useWorkspaceTab()
      return null
    }
    const render = async (state: "running" | "error" | "success") => {
      const block: Extract<StreamBlock, { type: "tool_use" }> = {
        type: "tool_use", blockId: name, id: name, name, index: 0,
        input: { path: fileName },
        tool: { id: name, name, input: { path: fileName }, status: state === "running" ? "running" : "completed",
          ok: state === "running" ? undefined : state === "success",
          output: state === "error" ? errorOutput : state === "success" ? JSON.stringify({ path }) : undefined },
      }
      await act(async () => root.render(
        <I18nextProvider i18n={i18n}><TooltipProvider>
          <SidebarProvider stateCookieName={false} widthCookieName={false} keyboardShortcut={false}>
            <WorkspaceFilesProvider><WorkspaceWhiteboardProvider>
              <PreviewStateProbe />
              <div data-canvas><CanvasToolItem block={block} /></div>
              <div data-ordinary><ToolResult tool="bash" title={<span>pwd</span>} status={state} /></div>
            </WorkspaceWhiteboardProvider></WorkspaceFilesProvider>
          </SidebarProvider>
        </TooltipProvider></I18nextProvider>
      ))
      const button = host.querySelector<HTMLButtonElement>("[data-canvas] button")
      assert.ok(button)
      const statusLabel = i18n.t({ running: "toolCard.running", error: "toolCard.failed", success: "toolCard.completed" }[state])
      const icon = button.querySelector(`span[aria-label="${statusLabel}"]`)
      const ordinaryIcon = host.querySelector(`[data-ordinary] span[aria-label="${statusLabel}"]`)
      assert.equal(button.dataset.toolStatus, state)
      assert.equal(host.querySelector("[data-ordinary] [data-tool-status]")?.getAttribute("data-tool-status"), state)
      if (state !== "success") {
        assert.ok(icon, "running and failed tools share the ordinary tool's accessible indicator")
        assert.ok(ordinaryIcon)
        assert.equal(icon.outerHTML, ordinaryIcon.outerHTML)
        assert.ok(icon.classList.contains(state === "running" ? "text-status-running" : "text-tool-error-foreground"))
        assert.ok(icon.querySelector("svg")?.classList.contains(state === "error" ? "size-3.5" : "size-3"))
        if (state === "error") {
          assert.equal(icon.getAttribute("data-slot"), "tool-error-indicator")
          assert.equal(icon.getAttribute("role"), "img")
          const cutout = icon.querySelector("svg.lucide-circle-x-filled path")
          assert.equal(cutout?.getAttribute("fill"), "currentColor")
          assert.equal(cutout?.getAttribute("fill-rule"), "evenodd")
          assert.equal(cutout?.getAttribute("stroke"), "none")
          assert.equal(button.querySelectorAll('[data-slot="tool-error-indicator"]').length, 1)
          assert.equal(button.querySelectorAll("svg").length, 2, "only the tool icon and outlined failure indicator are visible")
          assert.equal(icon.querySelector(".sr-only")?.textContent, statusLabel)
        }
      } else {
        assert.equal(icon, null, "successful tools do not add a status icon")
        assert.equal(ordinaryIcon, null)
        assert.equal(button.querySelector('[data-slot="tool-error-indicator"]'), null)
        assert.equal(button.querySelector(".sr-only"), null)
        assert.equal(button.querySelectorAll("svg").length, 1, "only the tool kind icon remains")
      }
      assert.ok(!host.querySelector('[data-slot="badge"]'))
      return button
    }
    try {
      const running = await render("running")
      assert.ok(running.querySelector(".shimmer"))
      assert.equal(running.disabled, !whiteboard, "whiteboards retain live preview access during drawing")

      const failed = await render("error")
      assert.equal(failed.disabled, true)
      assert.ok(!host.querySelector("p"), "failures must not render a separate error body")
      assert.ok(failed.textContent?.includes(fileName))
      assert.ok(!failed.querySelector(".shimmer"))
      await act(async () => {
        failed.click()
        failed.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true }))
        await new Promise(resolve => setTimeout(resolve, 1100))
      })
      assert.deepEqual(boards.paths, {}, "failed whiteboards cannot open a preview")
      assert.equal(files.fileOpenNonce, 0, "failed HTML canvases cannot open a preview")
      assert.equal(tabs.activeTabId, null)
      assert.ok(!document.querySelector('[role="tooltip"]'), "failed tools have no details tooltip")
      assert.doesNotMatch(document.body.innerHTML, /PRIVATE_ERROR_DETAILS|INVALID_DRAWING_OPERATION/)
      assert.ok(!host.querySelector("details"))

      const succeeded = await render("success")
      assert.equal(succeeded.disabled, false)
      assert.equal(succeeded.getAttribute("aria-label"), i18n.t("agentMessage.canvasOpenPreview"))
      await act(async () => succeeded.click())
      if (whiteboard) {
        assert.equal(boards.paths["claude:session:/work"], path)
        assert.equal(tabs.activeTabId, "whiteboard")
        assert.equal(files.fileOpenNonce, 0)
      } else {
        assert.equal(files.pendingFilePath, path)
        assert.equal(files.pendingPreviewMode, "render")
        assert.equal(files.fileOpenNonce, 1)
        assert.equal(tabs.activeTabId, "files")
      }
    } finally { await act(async () => root.unmount()); host.remove() }
  })
}
