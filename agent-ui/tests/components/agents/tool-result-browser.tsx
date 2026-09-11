import { createInstance } from "i18next"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { FileDiff } from "../../../src/components/agents/file-diff"
import { FileRead } from "../../../src/components/agents/file-read"
import { ToolResult } from "../../../src/components/agents/tool-result"
import { OverflowMarquee } from "../../../src/components/motion/overflow-marquee"
import { SidebarProvider } from "../../../src/components/ui/sidebar"
import { FilePathLink } from "../../../src/features/files/file-path-link"
import { rememberFileExists } from "../../../src/features/files/file-existence"
import { WorkspaceFilesProvider } from "../../../src/features/workspace/workspace-files-context"
import { WorkspaceAgentView } from "../../../src/features/workspace/views/workspace-agent-view"
import { AgentMessageItem } from "../../../src/features/agent-message/components/agent-message-item"
import type { AgentToolView } from "../../../src/features/agent-message/agent-tool-data"
import { en } from "../../../src/i18n/locales/en"
import { zhCN } from "../../../src/i18n/locales/zh-CN"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
const reduced = query.has("reduced-motion")
document.documentElement.classList.toggle("dark", query.has("dark"))
if (reduced) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => media === "(prefers-reduced-motion)"
    ? Object.assign(new EventTarget(), { matches: true, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList
    : matchMedia(media)
}
const i18n = createInstance()
await i18n.use(initReactI18next).init({ lng: query.has("zh") ? "zh-CN" : "en", resources: { en: { translation: en }, "zh-CN": { translation: zhCN } }, interpolation: { escapeValue: false } })

const longInput = `node scripts/check.mjs --input=${"very_long_input_".repeat(35)} --last-argument=visible`
const longFile = `${"very-long-file-name-".repeat(25)}.ts`
const inlinePath = "/workspace/images/screenshot.png"
rememberFileExists(inlinePath, true)
const agent: AgentToolView = {
  id: "fixture-agent", label: "Agent steps", state: "completed", toolCount: 1, notifications: [], inbox: [],
  blocks: [{ type: "tool_use", blockId: "long-bash", id: "long-bash", index: 0, name: "bash",
    tool: { id: "long-bash", name: "bash", status: "completed", ok: true, input: { command: longInput }, output: "done" } }],
}

export function Fixtures() {
  return <main className="mx-auto max-w-3xl space-y-8 p-4">
    <section data-case="main-chat"><AgentMessageItem message={{ id: "main-chat", role: "assistant", status: "streaming", createdAt: "2026-09-12T00:00:00Z", content: "A main chat response.", blocks: agent.blocks }} /></section>
    <section data-case="inline-file"><SidebarProvider className="block min-h-0" defaultOpen={false} stateCookieName={false} widthCookieName={false}><WorkspaceFilesProvider>
      <p className="text-ui leading-normal">文件 <FilePathLink path={inlinePath} label={inlinePath} showIcon variant="code" />，检查 g / p / y 下伸部分。</p>
    </WorkspaceFilesProvider></SidebarProvider></section>
    <section data-case="workspace"><WorkspaceAgentView target={{ sourceKey: "fixture", agents: [agent], selectedId: agent.id, navigationId: 0 }} /></section>
    <section data-case="long"><ToolResult tool="bash" title={longInput} status="success" defaultOpen={false}>Input detail</ToolResult></section>
    <section data-case="short"><ToolResult tool="bash" title="pwd" status="success" defaultOpen={false}>/workspace</ToolResult></section>
    <section data-case="read"><FileRead tool="Read" file={longFile} status="complete" defaultOpen={false} view={{ kind: "text", content: "const ok = true", startLine: 1 }} /></section>
    <section data-case="diff"><FileDiff tool="Edit" file={longFile} status="complete" defaultOpen={false} lines={[{ id: "line-1", type: "added", content: "const ok = true" }]} /></section>
    <section data-case="controlled" className="w-40"><OverflowMarquee active={!reduced}>{longInput}</OverflowMarquee></section>
  </main>
}

const root = createRoot(document.getElementById("root")!)
function render() { flushSync(() => root.render(<I18nextProvider i18n={i18n}><Fixtures key={crypto.randomUUID()} /></I18nextProvider>)) }
render()
async function until(condition: () => boolean, label: string) {
  const deadline = performance.now() + 5000
  while (!condition()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
}
const shifted = (element: Element) => {
  const transform = getComputedStyle(element).transform
  return transform !== "none" && new DOMMatrixReadOnly(transform).m41 < -1
}
const pointer = (type: string, pointerType = "mouse") => new PointerEvent(type, { bubbles: true, pointerType, isPrimary: true })

document.getElementById("run")!.addEventListener("click", async () => {
  const run = document.getElementById("run") as HTMLButtonElement
  const results = document.getElementById("results")!
  run.disabled = true
  render()
  const passed: string[] = []
  const check = (label: string, condition: boolean) => { if (!condition) throw new Error(label); passed.push(label) }
  const item = (name: string) => document.querySelector<HTMLElement>(`[data-case="${name}"]`)!
  const marquee = (name: string) => item(name).querySelector<HTMLElement>('[data-slot="overflow-marquee"]')!
  results.textContent = "Running…"
  try {
    await until(() => Boolean(marquee("workspace")), "actual Agent step mounts")
    await until(() => Boolean(marquee("main-chat")), "main chat process mounts")
    check("main chat disclosure keeps the tool within the message column", marquee("main-chat").getBoundingClientRect().right <= item("main-chat").getBoundingClientRect().right)
    const fileLabel = item("inline-file").querySelector<HTMLButtonElement>("button")!.lastElementChild!
    const glyphs = document.createRange()
    glyphs.selectNodeContents(fileLabel)
    check("inline file links leave room for the font descenders", glyphs.getBoundingClientRect().bottom <= fileLabel.getBoundingClientRect().bottom + 0.5 && glyphs.getBoundingClientRect().top >= fileLabel.getBoundingClientRect().top - 0.5)
    check("long tool inputs never widen the Agent process viewport", [...item("workspace").querySelectorAll<HTMLElement>('[tabindex="0"]')].every((element) => element.scrollWidth <= element.clientWidth))
    check("tool and file headers fit their available width", ["long", "short", "read", "diff"].every((name) => item(name).scrollWidth <= item(name).clientWidth))
    check("long input starts with an ellipsis", getComputedStyle(marquee("long").firstElementChild!).textOverflow === "ellipsis")
    check("short headers retain their natural width", item("short").querySelector("button")!.getBoundingClientRect().width < item("short").clientWidth / 2)
    marquee("main-chat").dispatchEvent(pointer("pointerover"))
    await until(() => marquee("main-chat").dataset.overflowing === "true", "main chat measures the long command")
    if (!reduced) await until(() => shifted(marquee("main-chat").firstElementChild!), "main chat starts marquee")
    check("main chat hover remains inside the message column", marquee("main-chat").getBoundingClientRect().right <= item("main-chat").getBoundingClientRect().right)
    marquee("main-chat").dispatchEvent(pointer("pointerout"))
    item("main-chat").querySelector<HTMLButtonElement>('[data-state] > button[aria-controls]')!.click()
    await until(() => (item("main-chat").querySelector<HTMLElement>('[role="log"]')?.clientHeight ?? 0) > 0, "main chat tool output expands")
    check("expanded main chat tools do not introduce horizontal scrolling", [...item("main-chat").querySelectorAll<HTMLElement>('[role="log"]')].every(el => el.scrollWidth <= el.clientWidth))
    const originalText = marquee("long").textContent
    marquee("long").dispatchEvent(pointer("pointerover"))
    await until(() => marquee("long").dataset.overflowing === "true", "hover measures long input")
    if (reduced) {
      check("reduced motion retains static readable text", !shifted(marquee("long").firstElementChild!) && getComputedStyle(marquee("long").firstElementChild!).textOverflow === "ellipsis")
    } else {
      await until(() => shifted(marquee("long").firstElementChild!), "hover starts the marquee")
      check("only the text moves while the page remains within its width", document.documentElement.scrollWidth <= window.innerWidth)
      check("marquee retains the entire input", marquee("long").textContent === originalText && originalText!.endsWith("--last-argument=visible"))
    }
    marquee("long").dispatchEvent(pointer("pointerout"))
    await until(() => !shifted(marquee("long").firstElementChild!) && !marquee("long").dataset.overflowing, "pointer exit restores input")
    check("pointer exit returns to the truncated first frame", getComputedStyle(marquee("long").firstElementChild!).textOverflow === "ellipsis")
    marquee("long").dispatchEvent(pointer("pointerover", "touch"))
    check("touch does not start a marquee", !marquee("long").dataset.overflowing)
    for (const name of ["read", "diff"]) {
      const header = item(name).querySelector<HTMLElement>('.group\\/item')!
      header.dispatchEvent(pointer("pointerover"))
      await until(() => marquee(name).dataset.overflowing === "true", `${name} hover measures file label`)
      if (!reduced) await until(() => shifted(marquee(name).firstElementChild!), `${name} file name scrolls`)
      header.dispatchEvent(pointer("pointerout"))
      item(name).querySelector<HTMLButtonElement>("button")!.click()
      await until(() => item(name).querySelector("button")!.getAttribute("aria-expanded") === "true", `${name} expands`)
      check(`${name} still expands with its original action`, item(name).querySelector("button")!.getAttribute("aria-expanded") === "true")
    }
    if (!reduced) await until(() => shifted(marquee("controlled").firstElementChild!), "existing controlled marquee still animates")
    check("page stays within its viewport", document.documentElement.scrollWidth <= window.innerWidth)
    results.textContent = `PASS (${passed.length})\n${passed.join("\n")}`
  } catch (error) {
    results.textContent = `FAIL after ${passed.length} checks\n${error instanceof Error ? error.stack : String(error)}`
  } finally { run.disabled = false }
})
