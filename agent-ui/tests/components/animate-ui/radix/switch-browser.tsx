import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"

import { Switch } from "../../../../src/components/animate-ui/components/radix/switch"
import "../../../../src/index.css"

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const query = new URLSearchParams(location.search)
const reducedMotion = query.has("reduced-motion")
document.documentElement.classList.toggle("dark", query.has("dark"))

if (reducedMotion) {
  const matchMedia = window.matchMedia.bind(window)
  // Only the fixture overrides the media query; production reads user settings.
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
  return <form id="switch-form" className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="controlled">Controlled switch</label>
      <Switch id="controlled" name="controlled" checked={checked} onCheckedChange={(next) => { events.push(`controlled:${next}`); setChecked(next) }} />
    </div>
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="uncontrolled">Uncontrolled switch</label>
      <Switch id="uncontrolled" name="uncontrolled" defaultChecked onCheckedChange={(next) => events.push(`uncontrolled:${next}`)} />
    </div>
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="disabled">Disabled switch</label>
      <Switch id="disabled" checked disabled onCheckedChange={() => events.push("disabled")} />
    </div>
    <div className="flex items-center justify-between gap-3">
      <label htmlFor="pending">Pending server switch</label>
      <Switch id="pending" checked={false} onCheckedChange={(next) => events.push(`pending:${next}`)} startIcon={<span>+</span>} />
    </div>
    <output id="value">Controlled: {String(checked)}</output>
  </form>
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
  const wait = async (ms = 400) => {
    // Motion schedules gesture callbacks after rendering; commit their React
    // updates before waiting for the resulting animation to settle.
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
    check("controlled and uncontrolled initial values", !isChecked("controlled") && isChecked("uncontrolled"))
    const bounds = getSwitch("controlled").getBoundingClientRect()
    check("standard 32 × 20 size fits compact rows", bounds.width === 32 && bounds.height === 20 && host.scrollWidth === host.clientWidth)

    await click("controlled")
    check("controlled click changes value once", isChecked("controlled") && events.join() === "controlled:true")
    check("native form value tracks checked state", new FormData(host.querySelector<HTMLFormElement>("form")!).get("controlled") === "on")
    await act(async () => { host.querySelector<HTMLLabelElement>('label[for="controlled"]')!.click() })
    check("label activation toggles the control", !isChecked("controlled") && events.at(-1) === "controlled:false")
    check("unchecked value is absent from form", !new FormData(host.querySelector<HTMLFormElement>("form")!).has("controlled"))

    await click("uncontrolled")
    check("uncontrolled defaultChecked remains interactive", !isChecked("uncontrolled") && events.at(-1) === "uncontrolled:false")
    await click("disabled")
    check("disabled switch ignores activation", getSwitch("disabled").disabled && isChecked("disabled") && !events.includes("disabled"))

    await click("pending")
    await wait()
    check("pending server value stays controlled", !isChecked("pending") && events.filter((event) => event === "pending:true").length === 1)
    const pendingIcon = getSwitch("pending").querySelector<HTMLElement>('[data-slot="switch-left-icon"]')!
    check("pending switch icon agrees with supplied value", getComputedStyle(pendingIcon).opacity === "0")

    for (let index = 0; index < 3; index += 1) await click("controlled")
    await wait()
    check("rapid toggles settle at the last state", isChecked("controlled") && events.filter((event) => event.startsWith("controlled:")).length === 5)
    const thumb = getSwitch("controlled").querySelector<HTMLElement>('[data-slot="switch-thumb"]')!
    check("checked thumb settles on the right", thumb.getBoundingClientRect().right > getSwitch("controlled").getBoundingClientRect().right - 4)

    const pointer = (type: string) => new PointerEvent(type, { bubbles: true, button: 0, isPrimary: true, pointerType: "mouse", pointerId: 1 })
    await act(async () => { getSwitch("controlled").dispatchEvent(pointer("pointerdown")) })
    await wait()
    const pressedWidth = thumb.getBoundingClientRect().width
    check(reducedMotion ? "reduced motion disables press stretching" : "press stretches the thumb", reducedMotion ? pressedWidth === 16 : pressedWidth > 18)
    await act(async () => { getSwitch("controlled").dispatchEvent(pointer("pointerup")) })
    await wait()
    check("release restores thumb width", Math.abs(thumb.getBoundingClientRect().width - 16) < 0.1)

    results.textContent = `PASS (${passed.length}, ${reducedMotion ? "reduced motion" : "normal motion"})\n${passed.join("\n")}`
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
