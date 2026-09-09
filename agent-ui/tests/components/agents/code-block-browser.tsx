import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { CodeBlock } from "../../../src/components/agents/code-block"
import { MessageResponse } from "../../../src/components/ai-elements/message"
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

const initialCode = [
  `const endpoint = "https://example.test/${"segment/".repeat(24)}";`,
  `  const identifier = "${"x".repeat(240)}";`,
  '\tconsole.log("中文 / English", endpoint);',
].join("\n")
const appendedCode = `${initialCode}\nconsole.log("追加内容", identifier);`
let copiedText = ""
Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (text: string) => { copiedText = text } },
})

export function Fixtures() {
  const [code, setCode] = useState(initialCode)
  const [streaming, setStreaming] = useState(true)
  const [controlledWrap, setControlledWrap] = useState(false)

  return <I18nextProvider i18n={i18n}><TooltipProvider>
    <div className="space-y-4 text-foreground">
      <button id="append" onClick={() => setCode(appendedCode)}>Append streamed code</button>
      <button id="finish" onClick={() => setStreaming(false)}>Finish message</button>
      <section id="message" aria-label="Agent result message">
        <MessageResponse mode={streaming ? "streaming" : "static"} isAnimating={streaming}>
          {`\`\`\`typescript\n${code}${streaming ? "" : "\n```"}`}
        </MessageResponse>
      </section>
      <section id="plain" aria-label="Plain text code">
        <CodeBlock code={"unbroken".repeat(60)} language="text" copyable={false} />
      </section>
      <section id="controlled" aria-label="Controlled code">
        <CodeBlock code={initialCode} wrap={controlledWrap} onWrapChange={setControlledWrap} filename="long-file-name.ts" />
      </section>
      <section id="scrollable" aria-label="Code with both scrollbars">
        <CodeBlock code={Array.from({ length: 8 }, () => initialCode).join("\n")} maxHeight={120} />
      </section>
    </div>
  </TooltipProvider></I18nextProvider>
}

const host = document.querySelector<HTMLDivElement>("#fixtures")!
const results = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
await act(async () => { root.render(<Fixtures />) })

const section = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!
const wrapButton = (id = "message") => section(id).querySelector<HTMLButtonElement>('[aria-pressed]')!
const viewport = (id = "message") => section(id).querySelector<HTMLElement>('[data-slot="code-block-viewport"]')!
const lines = (id = "message") => Array.from(section(id).querySelectorAll<HTMLElement>("code > span"))
const isWrapped = (id = "message") => wrapButton(id).getAttribute("aria-pressed") === "true"
const contentLines = () => lines().map((line) => line.querySelector(".line")!.textContent)
const click = async (button: HTMLButtonElement) => {
  await act(async () => { button.click() })
  await act(async () => { await new Promise(requestAnimationFrame) })
}
const waitFor = async (condition: () => boolean) => {
  const deadline = performance.now() + 5000
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error("Timed out waiting for rendered code")
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
  }
}

async function showsHint(button: HTMLButtonElement, text: string) {
  const rect = button.getBoundingClientRect()
  const coordinates = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }
  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", ...coordinates }))
    button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, ...coordinates }))
    button.dispatchEvent(new MouseEvent("mouseenter", coordinates))
    button.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, ...coordinates }))
  })
  const hint = () => document.querySelector('[data-slot="tooltip-content"][data-open]')?.textContent
  await waitFor(() => hint() === text)
  const matches = hint() === text
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }))
    button.dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: document.body }))
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: innerWidth - 2, clientY: innerHeight - 2 }))
  })
  return matches
}

async function runChecks() {
  const passed: string[] = []
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed.push(name)
  }
  const reset = async () => {
    await act(async () => { root.render(<Fixtures key={crypto.randomUUID()} />) })
    host.style.width = "360px"
    copiedText = ""
  }

  try {
    results.textContent = "Running…"
    await reset()
    await waitFor(() => Boolean(section("message").querySelector('.line span[style*="--shiki-light"]')))
    check("long highlighted code starts unwrapped and scrolls horizontally", !isWrapped() && viewport().scrollWidth > viewport().clientWidth)
    const copy = section("message").querySelector<HTMLButtonElement>(`button[aria-label="${i18n.t("common.copyCode")}"]`)!
    check("wrap control appears immediately before copy", wrapButton().nextElementSibling === copy)
    const header = wrapButton().parentElement!.parentElement!
    const headerHeight = header.getBoundingClientRect().height
    const unwrappedHeight = lines()[1].getBoundingClientRect().height
    const unwrappedIcon = wrapButton().querySelector("svg")!.innerHTML
    const horizontalBar = (id: string) => section(id).querySelector<HTMLElement>('[data-slot="code-block-scrollbar"][data-orientation="horizontal"]')!
    check("message code keeps space between the header and first line", lines()[0].getBoundingClientRect().top - header.getBoundingClientRect().bottom >= 8)
    check("short code places the horizontal scrollbar below its last line", horizontalBar("message").getBoundingClientRect().top >= lines().at(-1)!.getBoundingClientRect().bottom)
    await waitFor(() => Boolean(horizontalBar("scrollable")))
    await act(async () => { viewport("scrollable").scrollTop = viewport("scrollable").scrollHeight })
    check("vertically scrolled code keeps the last line above the horizontal scrollbar", horizontalBar("scrollable").getBoundingClientRect().top >= lines("scrollable").at(-1)!.getBoundingClientRect().bottom)
    check("both scrollbars remain inside the code block", horizontalBar("scrollable").getBoundingClientRect().bottom <= section("scrollable").getBoundingClientRect().bottom && section("scrollable").querySelector('[data-orientation="vertical"]')!.getBoundingClientRect().bottom <= viewport("scrollable").getBoundingClientRect().bottom)

    await click(wrapButton())
    await waitFor(() => viewport().scrollWidth <= viewport().clientWidth + 1)
    check("wrap fits URLs and unbroken strings inside the viewport", isWrapped() && lines()[1].getBoundingClientRect().height > unwrappedHeight)
    check("toggle exposes its state and disable hint", await showsHint(wrapButton(), i18n.t("common.disableCodeWrap")))
    check("enabled wrap displays a different icon", wrapButton().querySelector("svg")!.innerHTML !== unwrappedIcon)
    check("toggling preserves the compact header height", Math.abs(header.getBoundingClientRect().height - headerHeight) < 0.1)
    check("line numbers still match original source lines", lines().map((line) => line.firstElementChild!.textContent).join() === "1,2,3")
    check("wrapping preserves indentation and original content", contentLines().join("\n") === initialCode)
    check("code blocks keep independent wrap state", !isWrapped("plain"))

    await click(host.querySelector<HTMLButtonElement>("#append")!)
    await waitFor(() => contentLines().join("\n") === appendedCode)
    check("streaming append retains the selected wrap mode", isWrapped() && viewport().scrollWidth <= viewport().clientWidth + 1)
    await click(host.querySelector<HTMLButtonElement>("#finish")!)
    await waitFor(() => Boolean(section("message").querySelector('[data-state="complete"]')))
    check("completed Markdown retains wrap mode", isWrapped())
    await click(copy)
    check("copy returns original source without display line breaks", copiedText === appendedCode)

    await click(wrapButton())
    await waitFor(() => viewport().scrollWidth > viewport().clientWidth)
    check("disabling wrap restores horizontal scrolling and line height", !isWrapped() && lines()[1].getBoundingClientRect().height === unwrappedHeight)
    check("disabled wrap exposes the enable hint", await showsHint(wrapButton(), i18n.t("common.enableCodeWrap")))
    check("disabled wrap restores its original icon", wrapButton().querySelector("svg")!.innerHTML === unwrappedIcon)

    await click(wrapButton("plain"))
    await waitFor(() => viewport("plain").scrollWidth <= viewport("plain").clientWidth + 1)
    check("plain text can wrap when copy is disabled", isWrapped("plain") && section("plain").querySelectorAll("button").length === 1)
    await click(wrapButton("controlled"))
    check("controlled wrap updates through onWrapChange", isWrapped("controlled"))
    await click(wrapButton("controlled"))
    check("controlled wrap can be disabled again", !isWrapped("controlled"))

    host.style.width = "320px"
    await click(wrapButton())
    await waitFor(() => viewport().scrollWidth <= viewport().clientWidth + 1)
    const bounds = section("message").getBoundingClientRect()
    check("header actions remain visible in a narrow code block", copy.getBoundingClientRect().right <= bounds.right && wrapButton().getBoundingClientRect().left >= bounds.left)
    check("narrow wrapped code stays inside its viewport", isWrapped() && viewport().scrollWidth <= viewport().clientWidth + 1)

    results.textContent = `PASS (${passed.length})\n${passed.join("\n")}`
  } catch (error) {
    results.textContent = `FAIL after ${passed.length} checks\n${error instanceof Error ? error.stack : String(error)}`
  } finally {
    await reset()
  }
}

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  try { await runChecks() } finally { button.disabled = false }
})
