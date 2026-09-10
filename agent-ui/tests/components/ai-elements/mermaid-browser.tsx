import { lazy, Suspense, useState } from "react"
import { createRoot } from "react-dom/client"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { MessageResponse } from "../../../src/components/ai-elements/message"
import { MermaidRenderBoundary } from "../../../src/components/ai-elements/mermaid-render-boundary"
import { TooltipProvider } from "../../../src/components/ui/tooltip"
import { en } from "../../../src/i18n/locales/en"
import { zhCN } from "../../../src/i18n/locales/zh-CN"
import "../../../src/index.css"

const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.has("dark"))
const i18n = i18next.createInstance()
await i18n.use(initReactI18next).init({
  lng: query.has("zh") ? "zh-CN" : "en",
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
})

const diagram = "graph TD\n  A[Session] --> B[Message]"
const moduleError = new TypeError("Failed to fetch dynamically imported module: mermaid.js")
const BrokenMermaid = lazy(() => Promise.reject(moduleError))
const caught: unknown[] = []
const uncaught: unknown[] = []
const host = document.querySelector<HTMLDivElement>("#fixtures")!
const results = document.querySelector<HTMLPreElement>("#results")!

export function Fixtures() {
  const [failed, setFailed] = useState(false)
  const [clicks, setClicks] = useState(0)
  return <I18nextProvider i18n={i18n}><TooltipProvider>
    <section id="healthy">
      <MessageResponse mode="static">{`Message before diagram.\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\nMessage after diagram.`}</MessageResponse>
    </section>
    <button id="fail" onClick={() => setFailed(true)}>Simulate module load failure</button>
    <section id="failure">
      {failed ? <MermaidRenderBoundary code={diagram}>
        <Suspense fallback={<p>Loading diagram…</p>}><BrokenMermaid /></Suspense>
      </MermaidRenderBoundary> : null}
    </section>
    <button id="interactive" onClick={() => setClicks(clicks + 1)}>Still interactive: {clicks}</button>
  </TooltipProvider></I18nextProvider>
}

const root = createRoot(host, {
  onCaughtError: (error) => { caught.push(error) },
  onUncaughtError: (error) => { uncaught.push(error) },
})
root.render(<Fixtures />)

async function waitFor(condition: () => boolean) {
  const deadline = performance.now() + 15000
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error("Timed out waiting for Mermaid rendering")
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  results.textContent = "Running…"
  const passed: string[] = []
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed.push(name)
  }
  try {
    await waitFor(() => Boolean(host.querySelector('#healthy [data-streamdown="mermaid"] svg')))
    check("real MessageResponse loads the Mermaid module and renders SVG", true)
    host.querySelector<HTMLButtonElement>("#fail")!.click()
    await waitFor(() => Boolean(host.querySelector('#failure [data-slot="mermaid-render-error"]')))
    check("React.lazy module rejection is caught locally", caught.includes(moduleError))
    check("fallback displays the localized failure message", host.querySelector('#failure [role="status"]')?.textContent === i18n.t("common.mermaidLoadFailed"))
    check("fallback preserves Mermaid source", host.querySelector("#failure code")?.textContent?.includes("A[Session] --> B[Message]") === true)
    check("fallback keeps the source copy action", Boolean(host.querySelector(`#failure button[aria-label="${i18n.t("common.copyCode")}"]`)))
    check("surrounding messages survive the failed import", host.querySelector("#healthy")?.textContent?.includes("Message before diagram.") === true && host.querySelector("#healthy")?.textContent?.includes("Message after diagram.") === true)
    host.querySelector<HTMLButtonElement>("#interactive")!.click()
    await waitFor(() => host.querySelector("#interactive")?.textContent === "Still interactive: 1")
    check("the rest of the page remains interactive", true)
    check("no error escapes to the application root", uncaught.length === 0)
    results.textContent = `PASS (${passed.length})\n${passed.join("\n")}`
  } catch (error) {
    results.textContent = `FAIL after ${passed.length} checks\n${error instanceof Error ? error.stack : String(error)}`
  }
})
