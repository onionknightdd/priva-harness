import assert from "node:assert/strict"
import { test } from "node:test"

import { attachmentsFromMessageText, messageTextWithAttachments } from "../../../src/features/agent-message/message-attachment-text.ts"
import { composeSlashMessage } from "../../../src/features/agent-message/composer-slash-command.ts"
import { formatMessageSelection, messageSelectionPreview, messageSelectionDisplayText, parseMessageSelections, serializeMessageSelections, type MessageSelectionPart } from "../../../src/features/agent-message/message-select-action.ts"

const quote = { type: "selection", selection: { messageRole: "assistant", selectedText: "选中的内容" } } as const

test("preview stops at ten characters or the first newline without truncating the transmitted text", () => {
  assert.equal(messageSelectionPreview("1234567890"), "1234567890")
  assert.equal(messageSelectionPreview("12345678901"), "1234567890......")
  assert.equal(messageSelectionPreview("第一行\n第二行"), "第一行......")
  assert.equal(messageSelectionPreview("第一行\r\n第二行"), "第一行......")
  assert.equal(messageSelectionPreview("\nsecond line"), "......")
  assert.equal(messageSelectionPreview("👩🏽‍💻".repeat(11)), "👩🏽‍💻".repeat(10) + "......")
  const selection = { messageRole: "user" as const, selectedText: "12345678901\n全部保留" }
  assert.equal(messageSelectionDisplayText([{ type: "selection", selection }]), '"1234567890......"')
  assert.deepEqual(parseMessageSelections(formatMessageSelection(selection)), [{ type: "selection", selection }])
})

test("selection markers use the requested fields and preserve the source role", () => {
  for (const messageRole of ["assistant", "user"] as const) {
    const selection = { messageRole, selectedText: "第一行\n第二行" }
    const text = formatMessageSelection(selection)
    assert.equal(text, `\`\`\`message_select_action\nmessage_role: ${messageRole}\nselected_text: 第一行\n第二行\n\`\`\``)
    assert.deepEqual(parseMessageSelections(text), [{ type: "selection", selection }])
  }
})

test("inline references roundtrip in order without consuming user whitespace", () => {
  for (const prefix of ["", "前文 ", "  leading\n\n\n"]) {
    for (const suffix of ["", " 后文", "\n\n\ntrailing  "]) {
      const parts: MessageSelectionPart[] = [
        ...(prefix ? [{ type: "text" as const, text: prefix }] : []),
        quote, quote,
        ...(suffix ? [{ type: "text" as const, text: suffix }] : []),
      ]
      assert.deepEqual(parseMessageSelections(serializeMessageSelections(parts)), parts)
    }
  }
})

test("selected Markdown and nested code fences remain intact", () => {
  const selectedText = 'Example:\n```ts\nconst a = "quoted"\n```\n\n````message_select_action\nmessage_role: user\nselected_text: nested\n````'
  const selection = { messageRole: "user" as const, selectedText }
  const serialized = formatMessageSelection(selection)
  assert.ok(serialized.startsWith("`````message_select_action\n"))
  assert.deepEqual(parseMessageSelections(serialized), [{ type: "selection", selection }])
})

test("invalid markers and quoted protocol examples stay literal text", () => {
  for (const content of [
    "ordinary text\n\n",
    formatMessageSelection(quote.selection).replace("assistant", "system"),
    formatMessageSelection(quote.selection).replace("选中的内容", ""),
    formatMessageSelection(quote.selection).slice(0, -3),
    "````markdown\n" + formatMessageSelection(quote.selection) + "\n````",
    "> " + formatMessageSelection(quote.selection).replaceAll("\n", "\n> "),
  ]) {
    assert.deepEqual(parseMessageSelections(content), [{ type: "text", text: content }])
  }
})

test("upload manifests and selection references survive history reconstruction together", () => {
  const text = serializeMessageSelections([{ type: "text", text: "请看 " }, quote]).trim()
  const attachments = [{ name: "report.csv", path: "/workspace/report.csv", mimeType: "text/csv", size: 123 }]
  const restored = attachmentsFromMessageText(messageTextWithAttachments(text, attachments))!
  assert.deepEqual(restored.attachments, attachments)
  assert.equal(restored.content, text)
  assert.deepEqual(parseMessageSelections(restored.content), [{ type: "text", text: "请看 " }, quote])
})

test("slash commands retain the reference fence and its complete arguments", () => {
  const text = composeSlashMessage("review", serializeMessageSelections([quote]))
  assert.deepEqual(parseMessageSelections(text), [{ type: "text", text: "/review " }, quote])
})
