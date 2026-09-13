import assert from "node:assert/strict"
import { after } from "node:test"
import { JSDOM } from "jsdom"

export const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true })
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLTextAreaElement", "HTMLFormElement", "Element", "Node", "NodeFilter", "DocumentFragment", "ShadowRoot", "SVGElement", "Event", "InputEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "DOMRect", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof typeof dom.window] })
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
})
dom.window.matchMedia = (query) => ({ matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null })
dom.window.HTMLElement.prototype.getAnimations = () => []
dom.window.HTMLElement.prototype.scrollIntoView = () => {}
after(() => dom.window.close())

export const React = await import("react")
export const { act } = React
const { createRoot } = await import("react-dom/client")
const { I18nextProvider, initReactI18next } = await import("react-i18next")
export const i18n = (await import("i18next")).default.createInstance()
const { resourcesEn, resourcesZh } = await import("../../../src/i18n/locales/resources.ts")
await i18n.use(initReactI18next).init({ lng: "en", resources: { en: { translation: { resources: resourcesEn } }, "zh-CN": { translation: { resources: resourcesZh } } } })

export const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === text || element.getAttribute("aria-label") === text)!
export const field = (name: string) => {
  const label = [...document.querySelectorAll<HTMLLabelElement>("label")].find((label) => label.textContent?.replace(/\s*\*$/, "") === name)
  return (label ? document.getElementById(label.htmlFor) : document.querySelector(`[aria-label="${name}"]`)) as HTMLInputElement
}
export const click = async (element: HTMLElement) => { assert.ok(element); await act(async () => { if (element instanceof HTMLButtonElement) element.focus(); element.click() }) }
export const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  assert.ok(element)
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value)
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
  })
}
export const key = async (element: HTMLElement, key: string, isComposing = false) => { await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing, bubbles: true, cancelable: true }))) }
export const select = async (name: string, option: string) => {
  const input = field(name)
  await act(async () => input.focus())
  await key(input, "ArrowDown")
  await type(input, option)
  await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === option)!)
}
export async function render(content: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  const update = async (next: React.ReactNode) => { await act(async () => root.render(<I18nextProvider i18n={i18n}>{next}</I18nextProvider>)) }
  await update(content)
  return { host, update, async close() { await act(async () => root.unmount()); host.remove() } }
}
