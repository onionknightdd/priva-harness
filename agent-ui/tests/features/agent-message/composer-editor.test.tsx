import assert from "node:assert/strict"
import { after, test } from "node:test"
import { JSDOM } from "jsdom"

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Node", "Text", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "InputEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "DOMRect", "DOMException", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
})
dom.window.matchMedia = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
dom.window.scrollBy = () => {}
dom.window.HTMLElement.prototype.getAnimations = () => []
Object.assign(globalThis, { ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } })
dom.window.Range.prototype.getBoundingClientRect = () => new DOMRect(10, 10, 100, 20)
dom.window.Range.prototype.getClientRects = () => Object.assign([new DOMRect(10, 10, 100, 20)], { item: (index: number) => index === 0 ? new DOMRect(10, 10, 100, 20) : null })
after(() => dom.window.close())

const React = await import("react")
const { act, createRef, useState } = React
const { createRoot } = await import("react-dom/client")
const { MotionConfig } = await import("motion/react")
const { ComposerEditor } = await import("../../../src/features/agent-message/components/composer-editor.tsx")
const { MessageSelectionContent } = await import("../../../src/features/agent-message/components/message-selection-quote.tsx")
const { MessageSelectionActions } = await import("../../../src/features/agent-message/components/message-selection-actions.tsx")
const { QuoteSelectable } = await import("../../../src/features/agent-message/components/quote-selectable.tsx")
const { formatMessageSelection, parseMessageSelections } = await import("../../../src/features/agent-message/message-select-action.ts")
const { default: i18n } = await import("../../../src/i18n/index.ts")
await i18n.changeLanguage("zh-CN")
import type { ComposerEditorHandle } from "../../../src/features/agent-message/components/composer-editor.tsx"
import type { QuoteInChat } from "../../../src/features/agent-message/selection-actions-context.ts"

const quote = { messageRole: "assistant", selectedText: "第一行\n第二行 `code`" } as const

async function mountEditor(initial = "") {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const inputRef = createRef<HTMLDivElement>()
  const ref = createRef<ComposerEditorHandle>()
  let draft = initial
  let updateDraft: (value: string) => void = () => {}
  const keys: { key: string; atStart: boolean }[] = []
  function Fixture() {
    const [value, setValue] = useState(initial)
    updateDraft = setValue
    return <ComposerEditor ref={ref} inputRef={inputRef} draft={value} placeholder="输入消息"
      onChange={(next) => { draft = next; setValue(next) }}
      onKeyDown={(event, atStart) => { keys.push({ key: event.key, atStart }); return event.key === "Enter" && !event.shiftKey }} />
  }
  await act(async () => root.render(<React.StrictMode><Fixture /></React.StrictMode>))
  return {
    host, ref, keys, input: inputRef.current!, draft: () => draft,
    update: async (value: string) => { draft = value; await act(async () => updateDraft(value)) },
    unmount: async () => { await act(async () => root.unmount()); host.remove() },
  }
}

async function key(input: HTMLElement, name: string, options: KeyboardEventInit = {}) {
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...options })) })
}

function clipboard(type: "paste" | "copy" | "cut", text = "") {
  const data = new Map<string, string>([["text/plain", text]])
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => data.get(type) ?? "", setData: (type: string, value: string) => data.set(type, value), clearData: () => data.clear() } })
  return { event, data }
}

test("native text edits update the controlled draft", async () => {
  const editor = await mountEditor("abc")
  try {
    await act(async () => {
      editor.ref.current!.focus()
      const text = editor.input.firstChild as Text
      text.appendData("d")
      const range = document.createRange()
      range.setStart(text, 4)
      range.collapse(true)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      editor.input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "d" }))
    })
    assert.equal(editor.draft(), "abcd")
  } finally { await editor.unmount() }
})

test("selecting a message outside the composer preserves its insertion caret", async () => {
  const editor = await mountEditor("before after")
  const message = document.body.appendChild(document.createElement("div"))
  message.textContent = quote.selectedText
  try {
    await act(async () => {
      editor.ref.current!.focus()
      const range = document.createRange()
      range.setStart(editor.input.firstChild!, 7)
      range.collapse(true)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      document.dispatchEvent(new Event("selectionchange"))
    })
    await act(async () => {
      const range = document.createRange()
      range.selectNodeContents(message)
      window.getSelection()!.removeAllRanges()
      window.getSelection()!.addRange(range)
      document.dispatchEvent(new Event("selectionchange"))
    })
    await act(async () => {
      window.getSelection()!.removeAllRanges()
      editor.ref.current!.insertSelection(quote)
    })
    assert.deepEqual(parseMessageSelections(editor.draft()), [
      { type: "text", text: "before " }, { type: "selection", selection: quote }, { type: "text", text: "after" },
    ])
  } finally { await editor.unmount(); message.remove() }
})

test("the mounted editor inserts inline nodes, deletes by button/Backspace and restores with Undo", async () => {
  const editor = await mountEditor("前文 ")
  try {
    await act(async () => editor.ref.current!.insertSelection(quote))
    assert.equal(editor.input.textContent, '前文 "第一行......"')
    assert.equal(editor.input.querySelectorAll("[data-message-selection-quote]").length, 1)
    assert.ok(editor.input.querySelector(".lucide-message-circle-code"))
    assert.deepEqual(parseMessageSelections(editor.draft()), [{ type: "text", text: "前文 " }, { type: "selection", selection: quote }])
    assert.equal(document.activeElement, editor.input)
    await key(editor.input, "Backspace", { keyCode: 8 })
    assert.equal(editor.draft(), "前文 ")
    await key(editor.input, "z", { ctrlKey: true, keyCode: 90 })
    assert.equal(editor.input.querySelectorAll("[data-message-selection-quote]").length, 1)
    await act(async () => editor.input.querySelector<HTMLButtonElement>('button[aria-label="删除引用"]')!.click())
    assert.equal(editor.draft(), "前文 ")
    assert.equal(editor.input.querySelectorAll("[data-message-selection-quote]").length, 0)
  } finally { await editor.unmount() }
})

test("plain-text paste, selection replacement and copy/cut preserve reference metadata", async () => {
  const editor = await mountEditor("remove me")
  try {
    await act(async () => editor.ref.current!.focus())
    await key(editor.input, "a", { ctrlKey: true, keyCode: 65 })
    const source = `前文 \n\n${formatMessageSelection(quote)}\n\n 后文`
    await act(async () => editor.input.dispatchEvent(clipboard("paste", source).event))
    assert.equal(editor.draft(), source)
    assert.equal(editor.input.textContent, '前文 "第一行......" 后文')
    await key(editor.input, "a", { ctrlKey: true, keyCode: 65 })
    const copied = clipboard("copy")
    await act(async () => editor.input.dispatchEvent(copied.event))
    assert.equal(copied.data.get("text/plain"), source)
    const cut = clipboard("cut")
    await act(async () => editor.input.dispatchEvent(cut.event))
    assert.equal(cut.data.get("text/plain"), source)
    assert.equal(editor.draft(), "")
    assert.equal(editor.input.dataset.empty, "true")
  } finally { await editor.unmount() }
})

test("Shift+Enter inserts a newline, IME Enter is ignored, and external send clears undo history", async () => {
  const editor = await mountEditor("")
  try {
    await act(async () => editor.ref.current!.focus())
    await key(editor.input, "Enter", { shiftKey: true, keyCode: 13 })
    assert.equal(editor.draft(), "\n")
    assert.deepEqual(editor.keys.at(-1), { key: "Enter", atStart: true })
    const count = editor.keys.length
    await key(editor.input, "Enter", { isComposing: true, keyCode: 229 })
    assert.equal(editor.keys.length, count)
    await act(async () => editor.ref.current!.insertSelection(quote))
    await editor.update("")
    await key(editor.input, "z", { ctrlKey: true, keyCode: 90 })
    assert.equal(editor.input.textContent, "")
    assert.equal(editor.input.dataset.empty, "true")
  } finally { await editor.unmount() }
})

test("external draft updates and remounts retain the same references", async () => {
  const source = `\n\n${formatMessageSelection(quote)}\n\n suffix`
  const editor = await mountEditor(source)
  try {
    assert.equal(editor.input.textContent, '"第一行......" suffix')
    await editor.update(`prefix ${source}`)
    assert.equal(editor.input.textContent, 'prefix "第一行......" suffix')
    await editor.update(source)
    assert.equal(editor.input.textContent, '"第一行......" suffix')
  } finally { await editor.unmount() }
})

test("sent references render inline and readonly, including restored multiline content", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  try {
    await act(async () => root.render(<MessageSelectionContent content={`前文 \n\n${formatMessageSelection(quote)}\n\n 后文`} />))
    assert.equal(host.textContent, '前文 "第一行......" 后文')
    assert.equal(host.querySelector("button"), null)
    assert.ok(host.querySelector(".lucide-message-circle-code"))
    assert.equal(host.querySelector("[data-message-role]")?.getAttribute("data-message-role"), "assistant")
    const trigger = host.querySelector<HTMLElement>("[data-message-selection-quote]")!
    assert.ok(trigger.hasAttribute("data-base-ui-tooltip-trigger"))
    await act(async () => {
      trigger.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", clientX: 20, clientY: 20 }))
      trigger.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 20, clientY: 20 }))
      trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, clientX: 20, clientY: 20 }))
      trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 20, clientY: 20 }))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
    assert.equal(document.querySelector('[data-slot="tooltip-content"]')?.textContent, quote.selectedText)
  } finally { await act(async () => root.unmount()); host.remove() }
})

test("both message roles show exactly one quote action and keep the captured source role", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const actions: QuoteInChat[] = []
  try {
    await act(async () => root.render(<MotionConfig reducedMotion="always">
      <QuoteSelectable messageRole="assistant">Assistant text</QuoteSelectable>
      <QuoteSelectable messageRole="user">User text</QuoteSelectable>
      <MessageSelectionActions onAction={(action) => actions.push(action)} />
    </MotionConfig>))
    for (const role of ["assistant", "user"] as const) {
      const surface = host.querySelector(`[data-message-selectable="${role}"]`)!
      await act(async () => {
        const range = document.createRange()
        range.selectNodeContents(surface)
        window.getSelection()!.removeAllRanges()
        window.getSelection()!.addRange(range)
        document.dispatchEvent(new Event("selectionchange"))
      })
      const toolbar = document.querySelector('[role="toolbar"]')!
      assert.equal(toolbar.querySelectorAll("button").length, 1)
      assert.equal(toolbar.textContent, "在对话中引用")
      await act(async () => toolbar.querySelector<HTMLButtonElement>("button")!.click())
      assert.deepEqual(actions.at(-1), { type: "selection", selection: { messageRole: role, selectedText: surface.textContent } })
    }
  } finally { await act(async () => root.unmount()); host.remove() }
})
