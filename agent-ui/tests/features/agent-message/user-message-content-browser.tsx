import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"
import { MotionConfig } from "motion/react"

import { AgentMessageItem } from "../../../src/features/agent-message/components/agent-message-item"
import { formatMessageSelection } from "../../../src/features/agent-message/message-select-action"
import { rememberFileExists } from "../../../src/features/files/file-existence"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import { en } from "../../../src/i18n/locales/en"
import { zhCN } from "../../../src/i18n/locales/zh-CN"
import "../../../src/index.css"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.has("dark"))
const i18n = i18next.createInstance()
await i18n.use(initReactI18next).init({
  lng: query.has("zh") ? "zh-CN" : "en",
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
})
const lines = (count: number) => Array.from({ length: count }, (_, index) => `第 ${index + 1} 行：保留完整的消息内容。`).join("\n")
const samples = [
  { id: "short", label: "Short message", content: "这是一条短消息。" },
  { id: "five", label: "Exactly five lines", content: lines(5) },
  { id: "six", label: "Six lines", content: lines(6) },
  { id: "long", label: "Long message / internal scrolling", content: lines(40) },
  { id: "responsive", label: "Responsive wrapping", content: "窗口变窄时，应根据文字实际换行重新判断是否折叠。".repeat(4) },
  { id: "unbroken", label: "Unbroken text", content: "abcdefghij".repeat(80) },
  { id: "rich", label: "Attachments and quoted selection", content: `引用：\n\n${formatMessageSelection({ messageRole: "assistant", selectedText: "完整引用的文字应保留\n第二行引用" })}\n\n\n${lines(8)}`,
    attachments: [{ path: "/fixture/notes.md", name: "notes.md", mimeType: "text/markdown", size: 20 }] },
  { id: "error", label: "Failed user message", content: lines(8), status: "error" as const },
]
rememberFileExists("/fixture/notes.md", true)
const host = document.querySelector<HTMLElement>("#fixtures")!
if (query.has("narrow")) host.style.maxWidth = "342px"
const results = document.querySelector<HTMLElement>("#results")!
const run = document.querySelector<HTMLButtonElement>("#run")!
const root = createRoot(host)
await act(async () => root.render(
  <StrictMode><I18nextProvider i18n={i18n}><TooltipProvider>
    <MotionConfig reducedMotion={query.has("reduced-motion") ? "always" : "user"}>
      {samples.map((sample) => <section key={sample.id} id={sample.id} className="min-w-0">
        <h2 className="mb-2 text-xs text-muted-foreground">{sample.label}</h2>
        <AgentMessageItem message={{ role: "user", status: "complete", createdAt: new Date(0).toISOString(), ...sample }} />
      </section>)}
    </MotionConfig>
  </TooltipProvider></I18nextProvider></StrictMode>,
))

const section = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!
const bubble = (id: string) => section(id).querySelector<HTMLElement>("[data-user-message-bubble]")!
const viewport = (id: string) => section(id).querySelector<HTMLElement>("[data-user-message-viewport]")!
const text = (id: string) => section(id).querySelector<HTMLElement>("[data-user-message-text]")!
const toggle = (id: string) => section(id).querySelector<HTMLButtonElement>("[data-user-message-toggle]")
const opened = (id: string) => toggle(id)?.getAttribute("aria-expanded") === "true"
const height = (node: Element) => node.getBoundingClientRect().height
const lineHeight = (id: string) => Number.parseFloat(getComputedStyle(text(id)).lineHeight)
const settle = async (ms = 50) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
const click = async (id: string, pointer = false) => {
  await act(async () => {
    if (pointer) toggle(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
    else toggle(id)!.click()
  })
}

async function runChecks() {
  run.disabled = true
  run.removeAttribute("data-result")
  results.textContent = ""
  let passed = 0
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed += 1
    results.textContent += `PASS ${name}\n`
  }
  try {
    for (const sample of samples) if (opened(sample.id)) await click(sample.id)
    await settle()
    check("short and exactly five-line messages stay complete without a toggle", !toggle("short") && !toggle("five") && height(viewport("five")) >= height(text("five")) - 1)
    for (const id of ["six", "long", "unbroken", "rich", "error"]) {
      check(`${id}: starts folded to five rendered text lines`, !opened(id) && Boolean(toggle(id)) && Math.abs(viewport(id).getBoundingClientRect().bottom - text(id).getBoundingClientRect().top - 5 * lineHeight(id)) < 1)
      check(`${id}: button is right aligned on the fifth line with a gradient`, Math.abs(toggle(id)!.getBoundingClientRect().right - viewport(id).getBoundingClientRect().right) < 1 && Math.abs(toggle(id)!.parentElement!.getBoundingClientRect().top - text(id).getBoundingClientRect().top - 4 * lineHeight(id)) < 1 && getComputedStyle(toggle(id)!.parentElement!).backgroundImage.includes("linear-gradient"))
    }
    check("collapsed content cannot be revealed by scrolling", getComputedStyle(viewport("long")).overflowY === "hidden")
    await act(async () => bubble("long").dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))
    await settle()
    check("hover leaves the message folded", !opened("long"))
    await click("six"); await settle()
    check("expanding exposes every line without unnecessary scrolling", opened("six") && viewport("six").clientHeight >= viewport("six").scrollHeight - 1 && height(bubble("six")) <= innerHeight / 2 + 1)
    check("each message keeps its own expanded state", !opened("long"))
    check("the native toggle describes its region and expanded state", toggle("six")!.getAttribute("aria-controls") === viewport("six").id && toggle("six")!.textContent?.includes(String(i18n.t("common.collapse"))) === true)

    await click("long"); await settle()
    check("the whole expanded bubble is capped at half the viewport", opened("long") && Math.abs(height(bubble("long")) - (visualViewport?.height ?? innerHeight) / 2) <= 1)
    check("long content scrolls inside a named keyboard-accessible region", viewport("long").scrollHeight > viewport("long").clientHeight && getComputedStyle(viewport("long")).overflowY === "auto" && viewport("long").tabIndex === 0 && Boolean(viewport("long").getAttribute("aria-label")))
    check("a stable gutter and extra right padding keep the scrollbar off the text", getComputedStyle(viewport("long")).scrollbarGutter === "stable" && viewport("long").getBoundingClientRect().right - text("long").getBoundingClientRect().right >= 12)
    viewport("long").scrollTop = viewport("long").scrollHeight
    check("the final line and collapse button remain reachable", Math.abs(text("long").getBoundingClientRect().bottom - viewport("long").getBoundingClientRect().bottom) < 1 && toggle("long")!.getBoundingClientRect().top >= viewport("long").getBoundingClientRect().bottom - 1 && text("long").textContent === samples.find((sample) => sample.id === "long")!.content)
    await click("long"); await settle()
    check("collapse resets the internal scroll to the first five lines", !opened("long") && viewport("long").scrollTop === 0 && Math.abs(height(viewport("long")) - lineHeight("long") * 5) < 1)

    section("responsive").style.width = "180px"
    await settle()
    check("narrowing the column measures real wrapping and adds the toggle", Boolean(toggle("responsive")) && !opened("responsive"))
    await click("responsive"); await settle()
    check("wrapped text fits the narrow bubble without horizontal scrolling", viewport("responsive").scrollWidth === viewport("responsive").clientWidth)
    section("responsive").style.width = ""
    await settle()
    if (!query.has("narrow")) check("widening removes the toggle when the full message fits five lines", !toggle("responsive"))
    check("unbroken strings wrap within the message column", viewport("unbroken").scrollWidth === viewport("unbroken").clientWidth && document.documentElement.scrollWidth <= innerWidth)
    await click("rich"); await settle()
    check("attachments and readonly selection previews survive expansion", section("rich").querySelectorAll('[role="listitem"]').length === 1 && section("rich").querySelectorAll("[data-message-selection-quote]").length === 1 && !text("rich").textContent?.includes("message_select_action"))
    await click("error"); await settle()
    check("failed messages retain their alert and expand control", bubble("error").getAttribute("role") === "alert" && opened("error"))
    await click("long", true); await settle(40); await click("long", true); await settle(250)
    check("rapid pointer toggles settle back to the collapsed height", !opened("long") && Math.abs(height(viewport("long")) - 5 * lineHeight("long")) < 1)
    for (const sample of samples) if (opened(sample.id)) await click(sample.id)
    await settle()
    results.textContent += `\n${passed} checks passed`
    run.dataset.result = "passed"
  } catch (error) {
    results.textContent += `\nFAIL ${error instanceof Error ? error.stack : String(error)}`
    run.dataset.result = "failed"
  } finally { run.disabled = false }
}
run.onclick = () => { void runChecks() }
