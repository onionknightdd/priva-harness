import { fillComposerInput } from "../../helpers/composer-input"

export async function runTerminalReplayChecks({ host, start, update, finish, reducedMotion }: {
  host: HTMLElement
  start: (text: string) => void
  update: (text: string) => void
  finish: () => void
  reducedMotion: boolean
}) {
  const passed: string[] = []
  const check = (label: string, valid: boolean) => {
    if (!valid) throw new Error(`${label}\nPassed: ${passed.join("; ")}`)
    passed.push(label)
  }
  const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))
  const wait = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return
      await settle()
    }
    throw new Error("Timed out waiting for terminal replay fixture")
  }
  const input = () => host.querySelector<HTMLElement>('[data-agent-composer="prompt"]')!
  const tab = (name: string) => host.querySelector<HTMLButtonElement>(`[role="tab"][aria-label="${name}"]`)!
  const chat = () => input().closest("section")!
  const tokens = () => [...chat().querySelectorAll<HTMLElement>("[data-sd-animate]")]
  const animations = () => tokens().flatMap((token) => token.getAnimations())
  const running = () => animations().some((animation) => animation.playState === "running")
  const switchTo = async (name: string) => {
    tab(name).click()
    await new Promise(requestAnimationFrame)
  }
  await wait(() => Boolean(input()))
  fillComposerInput(input(), "Start terminal replay checks")
  await wait(() => Boolean(host.querySelector('button[type="submit"]:not(:disabled)')))
  input().closest("form")!.requestSubmit()
  await wait(() => Boolean(tab("Terminal")) && !tab("Terminal").disabled)
  await wait(() => !host.querySelector('button[aria-label="Stop"]'))

  const text = "An already received answer should be visible immediately when returning to the chat view."
  start(text)
  await wait(() => chat().textContent!.includes(text))
  check(reducedMotion ? "reduced motion shows live text without animation" : "new live text uses streaming animations", running() !== reducedMotion)
  await switchTo("Terminal")
  finish()
  await wait(() => !chat().querySelector('[aria-busy="true"]'))
  await switchTo("Chat")
  check("a reply completed in TUI appears in full without animation", chat().textContent!.includes(text) && !running())

  start("Text received before opening the terminal.")
  await wait(() => chat().textContent!.includes("Text received before opening the terminal."))
  await switchTo("Terminal")
  const hiddenText = "More text received while the chat view was hidden is already available on return."
  update(hiddenText)
  await wait(() => chat().textContent!.includes(hiddenText))
  await switchTo("Chat")
  check("returning to Chat does not replay text received in TUI while completion is pending", !running())
  check("received text is fully visible on the first frame", tokens().every((token) => getComputedStyle(token).opacity === "1"))
  update(`${hiddenText} Fresh live tokens still animate normally.`)
  await wait(() => chat().textContent!.includes("Fresh live tokens still animate normally."))
  check(reducedMotion ? "reduced motion also applies to new text after returning" : "new text after returning to Chat still streams", running() !== reducedMotion)
  await switchTo("Terminal")
  await switchTo("Chat")
  check("repeated view switches do not restart existing text animations", !running())
  finish()
  await wait(() => !chat().querySelector('[aria-busy="true"]'))
  check("finishing the run keeps all received text", chat().textContent!.includes("Fresh live tokens still animate normally."))
  return passed
}
