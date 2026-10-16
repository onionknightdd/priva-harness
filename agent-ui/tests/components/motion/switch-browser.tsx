import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"

import { Switch } from "../../../src/components/motion/switch"
import "../../../src/index.css"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const query = new URLSearchParams(location.search)
const reducedMotion = query.has("reduced-motion")
document.documentElement.classList.toggle("dark", query.has("dark"))

if (reducedMotion) {
  const matchMedia = window.matchMedia.bind(window)
  window.matchMedia = (media) => media === "(prefers-reduced-motion)"
    ? Object.assign(new EventTarget(), {
        matches: true, media, onchange: null,
        addListener() {}, removeListener() {},
      }) as MediaQueryList
    : matchMedia(media)
}

const events: string[] = []

export function Fixtures() {
  const [checked, setChecked] = React.useState(false)
  const [labeled, setLabeled] = React.useState(true)
  return <div id="switch-fixtures" className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="controlled">Controlled switch</label>
      <Switch id="controlled" checked={checked} onCheckedChange={(next) => { events.push(`controlled:${next}`); setChecked(next) }} />
    </div>
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="disabled">Disabled switch</label>
      <Switch id="disabled" checked disabled ariaLabel="Disabled switch" onCheckedChange={() => events.push("disabled")} />
    </div>
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="pending">Pending server switch</label>
      <Switch id="pending" checked={false} onCheckedChange={(next) => events.push(`pending:${next}`)} />
    </div>
    <Switch id="labeled" checked={labeled} onCheckedChange={(next) => { events.push(`labeled:${next}`); setLabeled(next) }} label="Labeled switch" />
    <output id="value">Controlled: {String(checked)}</output>
  </div>
}

const host = document.querySelector<HTMLDivElement>("#fixtures")!
const results = document.querySelector<HTMLPreElement>("#results")!
const root = createRoot(host)
await act(async () => { root.render(<Fixtures />) })

async function runChecks() {
  const passed: string[] = []
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed.push(name)
  }
  const wait = async (ms = 700) => {
    await act(async () => { await new Promise(requestAnimationFrame) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
  }
  const getSwitch = (id: string) => host.querySelector<HTMLButtonElement>(`#${id}`)!
  const isChecked = (id: string) => getSwitch(id).getAttribute("aria-checked") === "true"
  const click = async (id: string) => { await act(async () => { getSwitch(id).click() }) }
  const reset = async () => {
    await act(async () => { root.render(<Fixtures key={crypto.randomUUID()} />) })
    events.length = 0
  }

  try {
    results.textContent = "Running…"
    await reset()
    check("all controls expose switch semantics", host.querySelectorAll('[role="switch"]').length === 4)
    check("controlled starts off and labeled starts on", !isChecked("controlled") && isChecked("labeled"))
    const bounds = getSwitch("controlled").getBoundingClientRect()
    const thumb = getSwitch("controlled").firstElementChild as HTMLElement
    check("standard 48 × 28 size fits compact rows", bounds.width === 48 && bounds.height === 28 && thumb.getBoundingClientRect().height === 20 && host.scrollWidth === host.clientWidth)

    await click("controlled")
    check("controlled click changes value once", isChecked("controlled") && events.join() === "controlled:true")
    await act(async () => { host.querySelector<HTMLLabelElement>('label[for="controlled"]')!.click() })
    check("external label activation toggles the control", !isChecked("controlled") && events.at(-1) === "controlled:false")
    await act(async () => { host.querySelector<HTMLLabelElement>('label[for="labeled"]')!.click() })
    check("built-in label activation toggles the control", !isChecked("labeled") && events.at(-1) === "labeled:false")

    await click("disabled")
    check("disabled switch ignores activation", getSwitch("disabled").disabled && isChecked("disabled") && !events.includes("disabled"))

    await click("pending")
    await wait(50)
    check("pending server value stays controlled", !isChecked("pending") && events.filter((event) => event === "pending:true").length === 1)

    for (let index = 0; index < 3; index += 1) await click("controlled")
    await wait()
    check("rapid toggles settle at the last state", isChecked("controlled") && events.filter((event) => event.startsWith("controlled:")).length === 5)
    const settledThumb = getSwitch("controlled").firstElementChild as HTMLElement
    check("checked thumb settles on the right", settledThumb.getBoundingClientRect().right > getSwitch("controlled").getBoundingClientRect().right - 8)

    const pointer = (type: string) => new PointerEvent(type, { bubbles: true, button: 0, isPrimary: true, pointerType: "mouse", pointerId: 1 })
    await act(async () => { getSwitch("controlled").dispatchEvent(pointer("pointerdown")) })
    await wait()
    const pressedWidth = settledThumb.getBoundingClientRect().width
    check(reducedMotion ? "reduced motion disables press squish" : "press squashes the thumb", reducedMotion ? Math.abs(pressedWidth - 20) < 0.1 : pressedWidth < 19)
    await act(async () => { getSwitch("controlled").dispatchEvent(pointer("pointerup")) })
    await wait()
    check("release restores thumb width", Math.abs(settledThumb.getBoundingClientRect().width - 20) < 0.1)

    results.textContent = `PASS (${passed.length}, ${reducedMotion ? "reduced motion" : "normal motion"}${query.has("dark") ? ", dark" : ""})\n${passed.join("\n")}`
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
