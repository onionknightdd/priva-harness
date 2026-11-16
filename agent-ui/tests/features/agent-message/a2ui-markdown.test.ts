import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { defaultRemarkPlugins, Streamdown } from "streamdown"

import { parseDashboardMarkdown, remarkDashboardImages } from "../../../src/features/agent-message/a2ui-markdown.ts"
import { assistantReplyMarkdown } from "../../../src/features/agent-message/reply-download.ts"

const source = 'root = Table(["状态"], [["已连接"]], "状态概览")'
const fence = `\`\`\`a2ui id=services\n${source}\n\`\`\``
const reference = "![服务状态](a2ui:services)"
const reply = `正文前。\n\n${reference}\n\n${fence}\n\n正文后。`

test("extracts raw source and hides its definition while preserving image placement and text", () => {
  const parsed = parseDashboardMarkdown(reply, false)
  assert.deepEqual(parsed.definitions.get("services"), { status: "ready", source })
  assert.equal(parsed.markdown.includes(source), false)
  assert.equal(parsed.markdown.includes(reference), true)
  assert.match(parsed.markdown, /^正文前。/)
  assert.match(parsed.markdown, /正文后。$/)
})

test("waits for the original closing fence and original complete image reference", () => {
  for (const ending of ["", "`", "``"]) {
    const partial = `${reference}\n\n\`\`\`a2ui id=services\n${source}\n${ending}`
    assert.deepEqual(parseDashboardMarkdown(partial, true).definitions.get("services"), { status: "pending" })
    assert.equal(parseDashboardMarkdown(partial, false).definitions.get("services")?.status, "error")
  }
  const partialImage = `${fence}\n\n![服务状态](a2ui:services`
  assert.equal(parseDashboardMarkdown(partialImage, true).definitions.get("services")?.status, "pending")
  for (const partialHeader of ["```a2ui", "```a2ui id=", "```a2ui id=sal"]) {
    assert.ok([...parseDashboardMarkdown(partialHeader, true).definitions.values()].every((definition) => definition.status === "pending"))
  }
})

test("supports source-before-reference, tilde fences, longer fences and CRLF", () => {
  for (const delimiter of ["~~~", "````"]) {
    const markdown = `${delimiter}a2ui id=services\r\n${source}\r\n${delimiter}\r\n\r\n${reference}`
    assert.deepEqual(parseDashboardMarkdown(markdown, false).definitions.get("services"), { status: "ready", source })
  }
  const longerClose = `${reference}\n\n\`\`\`a2ui id=services\n${source}\n\`\`\`\``
  assert.equal(parseDashboardMarkdown(longerClose, false).definitions.get("services")?.status, "ready")
})

test("missing, duplicate and malformed IDs have explicit errors instead of guessed definitions", () => {
  assert.deepEqual(parseDashboardMarkdown(reference, false).definitions.get("services"), { status: "error", error: "missing" })
  assert.equal(parseDashboardMarkdown(fence, false).definitions.get("services")?.status, "error")
  for (const duplicate of [`${reference}\n\n${fence}\n\n${fence}`, `${reference}\n\n${reference}\n\n${fence}`]) {
    assert.deepEqual(parseDashboardMarkdown(duplicate, false).definitions.get("services"), { status: "error", error: "duplicate" })
  }
  assert.equal(parseDashboardMarkdown("![x](a2ui:Invalid_ID)", false).definitions.get("Invalid_ID")?.status, "error")
  const invalidFence = parseDashboardMarkdown('```a2ui\nroot = Column([])\n```', false)
  assert.equal([...invalidFence.definitions.values()][0]?.status, "error")
})

test("Markdown examples and ordinary code never create dashboards", () => {
  const literal = `\`\`\`\`markdown\n${reply}\n\`\`\`\``
  const parsed = parseDashboardMarkdown(literal, false)
  assert.equal(parsed.definitions.size, 0)
  assert.equal(parsed.markdown, literal)
  assert.equal(parseDashboardMarkdown('`![x](a2ui:demo)`', false).definitions.size, 0)
  assert.equal(parseDashboardMarkdown('```ts\nconst source = "a2ui"\n```', false).definitions.size, 0)
})

test("remark creates a block node without an img request or invalid paragraph nesting", () => {
  const parsed = parseDashboardMarkdown(reply, false)
  const html = renderToStaticMarkup(createElement(Streamdown, {
    mode: "static", remarkPlugins: [...Object.values(defaultRemarkPlugins), remarkDashboardImages],
    allowedTags: { "agent-dashboard": ["embed", "label"] },
  }, parsed.markdown))
  assert.match(html, /<agent-dashboard embed="services" label="服务状态"><\/agent-dashboard>/)
  assert.doesNotMatch(html, /<p[^>]*><agent-dashboard/)
  assert.doesNotMatch(html, /<img|src="a2ui:/)
})

test("Markdown export preserves image references and their source definitions", () => {
  const exported = assistantReplyMarkdown({ id: "reply", role: "assistant", content: reply, status: "complete", createdAt: "2026-11-16T00:00:00Z" })
  assert.equal(exported, reply)
})
