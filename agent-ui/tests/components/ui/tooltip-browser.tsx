import { act, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import i18next from "i18next"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { Button } from "../../../src/components/ui/button"
import { PopupsArmedContext } from "../../../src/components/ui/popups-armed-context"
import { Tooltip, TooltipContent, TooltipHint, TooltipProvider, TooltipTrigger } from "../../../src/components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "../../../src/components/ui/popover"
import { ComposerContextRing } from "../../../src/features/agent-message/components/composer-context-ring"
import { ComposerSlashChip } from "../../../src/features/agent-message/components/composer-slash-chip"
import { en } from "../../../src/i18n/locales/en"
import { runFilePathLinkChecks } from "../../features/files/file-path-link-checks"
import "../../../src/index.css"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
document.documentElement.classList.toggle("dark", new URLSearchParams(location.search).has("dark"))
const i18n = i18next.createInstance()
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } })
let clicks = 0
let armDeferred: (armed: boolean) => void = () => {}

// Mirrors a transcript message: tooltip roots stay unmounted until armed.
function DeferredFixtures() {
  const [armed, setArmed] = useState(false)
  armDeferred = setArmed
  return (
    <PopupsArmedContext.Provider value={armed}>
      <div id="deferred" className="flex items-center gap-4">
        <TooltipHint content="Deferred hint"><Button id="deferred-hint" onClick={() => { clicks += 1 }}>Deferred control</Button></TooltipHint>
        <Tooltip>
          <TooltipTrigger render={<Button id="deferred-explicit">Deferred explicit</Button>} />
          <TooltipContent>Deferred explicit hint</TooltipContent>
        </Tooltip>
      </div>
    </PopupsArmedContext.Provider>
  )
}

export function Fixtures() {
  const anchorRef = useRef<HTMLDivElement>(null)
  return <I18nextProvider i18n={i18n}><TooltipProvider>
    <div ref={anchorRef} className="flex flex-wrap items-center gap-6 text-foreground">
      <Tooltip>
        <TooltipTrigger render={<Button id="first">First control</Button>} />
        <TooltipContent>First hint</TooltipContent>
      </Tooltip>
      <TooltipHint content="Second hint"><Button id="second" onClick={() => { clicks += 1 }}>Second control</Button></TooltipHint>
      <TooltipHint content={'/fixture/long-file-name.ts\nFile details'}><span id="path">File name</span></TooltipHint>
      <div id="context"><ComposerContextRing anchorRef={anchorRef} /></div>
      <div id="slash"><ComposerSlashChip command={{ name: "example", description: "Slash hint", kind: "command", origin: "user" }} onRemove={() => { clicks += 1 }} /></div>
      <Popover>
        <TooltipHint content="Popover hint"><PopoverTrigger render={<Button id="popover">Popover control</Button>} /></TooltipHint>
        <PopoverContent>Popover opened</PopoverContent>
      </Popover>
      <TooltipHint content={undefined}><Button id="empty">No hint</Button></TooltipHint>
      <TooltipHint content="Parent hint"><div id="parent" className="p-4">Parent <TooltipHint content="Child hint"><Button id="child">Child control</Button></TooltipHint></div></TooltipHint>
      <DeferredFixtures />
    </div>
  </TooltipProvider></I18nextProvider>
}

const host = document.querySelector<HTMLDivElement>("#fixtures")!
const results = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
await act(async () => { root.render(<Fixtures />) })
const target = (id: string) => host.querySelector<HTMLElement>(`#${id}`)!
const popup = () => document.querySelector<HTMLElement>('[data-slot="tooltip-content"][data-open]')
const wait = async (ms: number) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
const until = async (condition: () => boolean, timeout = 3000) => {
  const started = performance.now()
  while (!condition()) {
    if (performance.now() - started > timeout) throw new Error("Timed out waiting for tooltip")
    await wait(20)
  }
}
let hovered: HTMLElement | null = null
async function hover(element: HTMLElement | null) {
  const previous = hovered
  const rect = element?.getBoundingClientRect()
  const coordinates = { clientX: rect ? rect.left + rect.width / 2 : innerWidth - 2, clientY: rect ? rect.top + rect.height / 2 : innerHeight - 2 }
  await act(async () => {
    if (previous) {
      previous.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: element ?? document.body, ...coordinates }))
      previous.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: element ?? document.body, ...coordinates }))
      previous.dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: element ?? document.body, ...coordinates }))
    }
    if (element) {
      element.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", relatedTarget: previous, ...coordinates }))
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: previous, ...coordinates }))
      element.dispatchEvent(new MouseEvent("mouseenter", { relatedTarget: previous, ...coordinates }))
      element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, ...coordinates }))
    } else document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, ...coordinates }))
  })
  hovered = element
}

async function runChecks() {
  const passed: string[] = []
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed.push(name)
    results.textContent = `Running (${passed.length})…\n${passed.join("\n")}`
  }
  const instantHint = async (element: HTMLElement, text: string) => {
    const started = performance.now()
    await hover(element)
    await until(() => popup()?.textContent?.includes(text) === true, 250)
    check(`${text} opens immediately during continuous hover`, performance.now() - started < 200)
    const style = getComputedStyle(popup()!)
    check(`${text} skips the enter animation`, style.transitionProperty === "none" || style.transitionDuration === "0s")
  }

  try {
    results.textContent = "Running…"
    hovered = null
    clicks = 0
    await act(async () => { root.render(<Fixtures key={crypto.randomUUID()} />) })
    check("hints keep original elements and component slots without native titles", target("first").tagName === "BUTTON" && target("second").getAttribute("data-slot") === "button" && target("path").tagName === "SPAN" && !host.querySelector("[title]"))

    const started = performance.now()
    await hover(target("first"))
    await wait(800)
    check("first hover stays closed before one second", !popup())
    await until(() => popup()?.textContent === "First hint", 500)
    check("first hover opens after one second", performance.now() - started >= 950)
    await instantHint(target("second"), "Second hint")
    await instantHint(target("path"), "File details")
    check("file hints preserve multiline content", getComputedStyle(popup()!).whiteSpace === "pre-line")
    await instantHint(target("context").querySelector<HTMLElement>('[data-base-ui-tooltip-trigger]')!, i18n.t("agentMessage.contextUsage.tooltipEmpty"))
    await instantHint(target("slash").querySelector<HTMLElement>('[data-base-ui-tooltip-trigger]')!, "Slash hint")
    await instantHint(target("child"), "Child hint")
    check("nested hints show only the nearest target", document.querySelectorAll('[data-slot="tooltip-content"][data-open]').length === 1)

    await hover(null)
    await until(() => !popup())
    await wait(450)
    await hover(target("second"))
    await wait(800)
    check("leaving hints for 400ms restores the initial delay", !popup())
    await until(() => popup()?.textContent === "Second hint", 500)

    await act(async () => { target("second").click() })
    check("hint wrapping preserves button clicks", clicks === 1)
    await hover(null)
    await until(() => !popup())
    await wait(450)
    await hover(target("first"))
    await wait(100)
    await hover(null)
    await wait(1100)
    check("brief hover cancels the pending hint", !popup())

    await hover(target("empty"))
    await wait(1100)
    check("empty hints stay disabled", !popup())
    await hover(null)

    const deferred = target("deferred")
    check("deferred hints render their element without a tooltip root", deferred.querySelectorAll("[data-base-ui-tooltip-trigger], [data-open]").length === 0 && target("deferred-hint").getAttribute("data-slot") === "button" && target("deferred-explicit").getAttribute("data-slot") === "tooltip-trigger")
    await hover(target("deferred-hint"))
    await wait(1100)
    check("deferred hints stay silent before arming", !popup())
    await act(async () => { target("deferred-hint").click() })
    check("deferred hint wrapping preserves button clicks", clicks === 2)
    // The embedded browser may lack window focus, so emit the focus event React
    // would otherwise receive from the real focus change.
    await act(async () => { target("deferred-explicit").focus(); target("deferred-explicit").dispatchEvent(new FocusEvent("focusin", { bubbles: true })) })
    await act(async () => { armDeferred(true) })
    check("arming keeps focus on the focused deferred trigger", document.activeElement === target("deferred-explicit") && target("deferred-explicit").hasAttribute("data-base-ui-tooltip-trigger"))
    await hover(null)
    await wait(450)
    await hover(target("deferred-hint"))
    await until(() => popup()?.textContent === "Deferred hint", 1500)
    check("armed deferred hints open on hover", true)
    await instantHint(target("deferred-explicit"), "Deferred explicit hint")
    await hover(null)
    await until(() => !popup())
    await wait(450)
    await runFilePathLinkChecks(check)
    await act(async () => { target("popover").click() })
    await until(() => Boolean(document.querySelector('[data-slot="popover-content"][data-open]')))
    check("composed popover triggers retain their original action", document.querySelector('[data-slot="popover-content"]')?.textContent?.includes("Popover opened") === true)
    results.textContent = `PASS (${passed.length})\n${passed.join("\n")}`
  } catch (error) {
    results.textContent = `FAIL after ${passed.length} checks\n${error instanceof Error ? error.stack : String(error)}`
  } finally {
    await hover(null)
    await act(async () => { root.render(<Fixtures key={crypto.randomUUID()} />) })
  }
}

document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  try { await runChecks() } finally { button.disabled = false }
})
