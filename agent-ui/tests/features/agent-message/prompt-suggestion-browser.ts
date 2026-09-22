import { fillComposerInput } from "../../helpers/composer-input"

export async function runPromptSuggestionChecks({ host, show, snapshot, count, rebind, disconnect, disabled }: {
  host: HTMLElement; show: (text: string) => void; snapshot: () => void; count: () => number
  rebind: () => void; disconnect: () => void; disabled: boolean
}) {
  const passed: string[] = []
  const check = (label: string, valid: boolean) => { if (!valid) throw new Error(label); passed.push(label) }
  const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))
  const input = () => host.querySelector<HTMLElement>('[data-agent-composer="prompt"]')!
  const hint = () => host.querySelector<HTMLButtonElement>('[data-prompt-suggestion]')
  const key = (key: string, extra: KeyboardEventInit = {}) => {
    input().focus()
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }))
  }
  const fill = async (text: string) => { fillComposerInput(input(), text); await settle() }
  const suggest = async (text: string) => { show(text); await settle(200) }
  const wait = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (predicate()) return; await settle(50) }
    throw new Error("Timed out waiting for fixture")
  }
  await wait(() => Boolean(input()))
  await fill("Start suggestion checks")
  await wait(() => Boolean(host.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)')))
  input().closest("form")!.requestSubmit()
  await wait(() => count() > 0 && !host.querySelector('button[aria-label="Stop"],button[aria-label="停止"]'))
  await suggest("检查子 agent 的输出")
  if (disabled) {
    check("input-suggestion preference hides native suggestions", !hint())
    key("Tab")
    await settle()
    check("disabled suggestions cannot be accepted", input().textContent === "")
    return passed
  }
  check("native hint appears without modifying the draft", Boolean(hint()) && input().textContent === "")
  check("an unaccepted suggestion cannot be sent", Boolean(host.querySelector('button[type="submit"]:disabled')))
  check("hint fits the input width", hint()!.getBoundingClientRect().width <= input().getBoundingClientRect().width + 1)
  const before = count()
  key("Tab", { isComposing: true })
  await settle()
  check("IME composition does not accept a suggestion", input().textContent === "")
  key("Tab", { shiftKey: true })
  await settle()
  check("Shift+Tab retains backward keyboard navigation", input().textContent === "")
  key("Tab")
  await settle()
  check("Tab fills editable text without sending", input().textContent === "检查子 agent 的输出" && count() === before)
  key("Enter")
  await wait(() => count() === before + 2)
  check("Enter sends the accepted draft once", count() === before + 2)
  await suggest("右箭头建议")
  key("ArrowRight")
  await settle()
  check("Right arrow accepts the suggestion", input().textContent === "右箭头建议")
  await fill("")
  await suggest("点击建议 👋")
  hint()!.click()
  await settle()
  check("pointer acceptance fills the draft and restores editor focus", input().textContent === "点击建议 👋" && document.activeElement === input())
  await suggest("不能覆盖已有草稿")
  check("new suggestions do not overwrite a draft", !hint() && input().textContent === "点击建议 👋")
  await fill("")
  await suggest("手动输入前的建议")
  await fill("自己的输入")
  await fill("")
  snapshot()
  await settle()
  check("typing dismisses a hint across repeated snapshots", !hint())
  await suggest("按 Escape 关闭")
  key("Escape")
  await settle()
  snapshot()
  await settle()
  check("Escape dismisses the current hint", !hint())
  await suggest("重连后恢复")
  disconnect()
  await settle(30)
  check("disconnected composers hide suggestions", !hint())
  await wait(() => Boolean(hint()))
  check("reconnect restores the current native suggestion", hint()!.textContent!.includes("重连后恢复"))
  rebind()
  await settle(200)
  check("native session rebinding clears the old suggestion", !hint())
  await suggest("检查子 agent 的输出")
  return passed
}
