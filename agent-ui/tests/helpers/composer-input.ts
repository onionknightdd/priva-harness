export function fillComposerInput(input: HTMLElement, text: string) {
  input.focus()
  const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", keyCode: 65, ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true }))
  const clipboardData = new DataTransfer()
  clipboardData.setData("text/plain", text)
  input.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }))
}
