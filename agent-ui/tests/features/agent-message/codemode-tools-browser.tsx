import { createInstance } from "i18next"
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { Button } from "../../../src/components/ui/button"
import { ToolItem } from "../../../src/features/agent-message/components/assistant-process"
import type { StreamBlock } from "../../../src/features/agent-message/agent-message-data"
import { en } from "../../../src/i18n/locales/en"
import { zhCN } from "../../../src/i18n/locales/zh-CN"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.has("dark"))
if (query.has("reduced-motion")) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => media === "(prefers-reduced-motion)"
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}
const i18n = createInstance()
await i18n.use(initReactI18next).init({ lng: query.has("zh") ? "zh-CN" : "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } }, interpolation: { escapeValue: false } })

function Fixture() {
  const [running, setRunning] = useState(false)
  const parent: Extract<StreamBlock, { type: "tool_use" }> = { type: "tool_use", id: "code", blockId: "code", index: 0, name: "codemode",
    input: { code: 'const docs = await tools.mcp__docs__read({path:"notes"});\ntext(await models.classify({prompt:docs}));' },
    tool: { id: "code", name: "codemode", status: running ? "running" : "completed", ok: true, nestedCallsComplete: false,
      modelCalls: [
        { id: "image", parentToolCallId: "code", operation: "generateImages", provider: "image-provider", model: "native-image", status: running ? "running" : "completed", ...(running ? {} : { durationMs: 2500, artifacts: [{ path: "/image-tool-fixtures/result.png", mimeType: "image/png" }] }) },
        { id: "classify", parentToolCallId: "code", operation: "classify", provider: "classifier-provider", model: "judge", status: running ? "running" : "completed", ...(running ? {} : { durationMs: 280, result: { label: "accepted", confidence: 0.95 } }) },
        { id: "cancel", parentToolCallId: "code", operation: "classify", provider: "classifier-provider", model: "cancelled-judge", status: "aborted", error: "Cancelled by user" },
      ], output: running ? undefined : "Script completed" } }
  const child: Extract<StreamBlock, { type: "tool_use" }> = { type: "tool_use", id: "mcp", blockId: "mcp", index: 1, name: "mcp__docs__read", input: { path: "notes" }, tool: { id: "mcp", name: "mcp__docs__read", parentToolCallId: "code", status: "completed", ok: true, structuredContent: { title: "Planning notes", count: 2 }, output: "Read 2 documents" } }
  return <main className="mx-auto max-w-3xl space-y-4 p-4"><Button variant="outline" onClick={() => setRunning(!running)}>{running ? "Complete calls" : "Start calls"}</Button><ToolItem block={parent} blocks={[parent, child]} /></main>
}
if (query.has("mobile") && !query.has("embed")) {
  const iframe = document.createElement("iframe")
  iframe.src = `${location.pathname}?${query.toString()}&embed`
  iframe.title = "390px Codemode tools"
  iframe.style.cssText = "width:390px;height:1050px;border:0"
  document.body.replaceChildren(iframe)
} else {
  createRoot(document.getElementById("root")!).render(<I18nextProvider i18n={i18n}><Fixture /></I18nextProvider>)
}
