import assert from "node:assert/strict"
import { test } from "node:test"
import type { RJSFSchema } from "@rjsf/utils"
import { act, button, click, field, i18n, key, React, render, select, type } from "./resource-test-dom.tsx"

const { McpToolForm } = await import("../../../src/features/resources/mcp-tool-form.tsx")

test("tool schemas render typed inputs, descriptions, defaults and nested objects", async () => {
  const schema: RJSFSchema = { type: "object", required: ["query", "limit"], properties: {
    query: { type: "string", description: "Search terms", minLength: 2 }, limit: { type: "integer", default: 10, minimum: 1 },
    weight: { type: "number" }, enabled: { type: "boolean", default: false }, mode: { type: "string", enum: ["fast", "complete"] },
    config: { type: "object", properties: { path: { type: "string" } } },
  } }
  let submitted: Record<string, unknown> | undefined
  const page = await render(<McpToolForm schema={schema} running={false} onSubmit={(data) => { submitted = data }} />)
  try {
    assert.ok(page.host.textContent!.includes("Search terms"))
    assert.equal(field("limit").value, "10")
    assert.equal(field("limit").type, "number")
    assert.equal(field("enabled").getAttribute("role"), "switch")
    await type(field("query"), "find this")
    await type(field("limit"), "3")
    await type(field("weight"), "0.25")
    await click(field("enabled"))
    await select("mode", "complete")
    await type(field("path"), "/workspace/app")
    await click(button("Run tool"))
    assert.deepEqual(submitted, { query: "find this", limit: 3, weight: 0.25, enabled: true, mode: "complete", config: { path: "/workspace/app" } })
    assert.equal(page.host.querySelector("pre, textarea"), null)
  } finally { await page.close() }
})

test("string lists add on Enter, preserve duplicates and spaces, support removal and never submit on Enter", async () => {
  let submitted: Record<string, unknown> | undefined
  const schema: RJSFSchema = { type: "object", properties: { packages: { type: "array", items: { type: "string" }, description: "Packages to install" } } }
  const page = await render(<McpToolForm schema={schema} running={false} onSubmit={(data) => { submitted = data }} />)
  try {
    await type(field("packages"), "react")
    await key(field("packages"), "Enter", true)
    assert.equal(button("Remove react"), undefined)
    await key(field("packages"), "Enter")
    assert.equal(submitted, undefined)
    await type(field("packages"), "react")
    await key(field("packages"), "Enter")
    await type(field("packages"), " literal value ")
    await key(field("packages"), "Enter")
    await click(button("Remove react"))
    assert.equal(document.activeElement, field("packages"))
    await type(field("packages"), "unfinished")
    await click(button("Run tool"))
    assert.equal(submitted, undefined, "Uncommitted input must not silently disappear from the request")
    await key(field("packages"), "Enter")
    await click(button("Run tool"))
    assert.deepEqual(submitted, { packages: ["react", " literal value ", "unfinished"] })
  } finally { await page.close() }
})

test("required fields and schema constraints block invalid calls and can recover", async () => {
  let submitted: Record<string, unknown> | undefined
  const schema: RJSFSchema = { type: "object", required: ["query", "values"], properties: { query: { type: "string", minLength: 3 }, values: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", pattern: "^ok" } } } }
  const page = await render(<McpToolForm schema={schema} running={false} onSubmit={(data) => { submitted = data }} />)
  try {
    await type(field("query"), "x")
    await type(field("values"), "bad")
    await key(field("values"), "Enter")
    await click(button("Run tool"))
    assert.equal(submitted, undefined)
    assert.ok(document.querySelector('[role="alert"]'))
    await type(field("query"), "valid")
    await click(button("Remove bad"))
    await type(field("values"), "okay")
    await key(field("values"), "Enter")
    await type(field("values"), "okay")
    await key(field("values"), "Enter")
    assert.ok(field("values").validationMessage.includes("unique"))
    await type(field("values"), "")
    await click(button("Run tool"))
    assert.deepEqual(submitted, { query: "valid", values: ["okay"] })
  } finally { await page.close() }
})

test("enum selections preserve numeric and boolean types, and array enums render removable chips", async () => {
  let submitted: Record<string, unknown> | undefined
  const schema: RJSFSchema = { type: "object", required: ["active"], properties: {
    level: { type: "integer", enum: [1, 2] }, flags: { type: "array", uniqueItems: true, items: { type: "string", enum: ["read", "write"] } },
    active: { type: "boolean" }, optionalFlag: { type: "boolean" }, defaultFlag: { type: "boolean", default: true },
  } }
  const page = await render(<McpToolForm schema={schema} running={false} onSubmit={(data) => { submitted = data }} />)
  try {
    await select("level", "2")
    await select("flags", "read")
    await select("flags", "write")
    await click(button("Remove read"))
    await click(button("Run tool"))
    assert.deepEqual(submitted, { level: 2, flags: ["write"], active: false, defaultFlag: true })
  } finally { await page.close() }
})

test("array objects, references and empty tools remain executable without a JSON editor", async () => {
  let submitted: Record<string, unknown> | undefined
  const schema: RJSFSchema = { type: "object", definitions: { row: { type: "object", properties: { name: { type: "string" }, count: { type: "integer", default: 2 } }, required: ["name"] } }, properties: { rows: { type: "array", items: { $ref: "#/definitions/row" } } } }
  const page = await render(<McpToolForm schema={schema} running={false} onSubmit={(data) => { submitted = data }} />)
  try {
    await click(button("Add item"))
    await type(field("name"), "first")
    await click(button("Run tool"))
    assert.deepEqual(submitted, { rows: [{ name: "first", count: 2 }] })
    await page.update(<McpToolForm key="empty" schema={{ type: "object", properties: {} }} running={false} onSubmit={(data) => { submitted = data }} />)
    await click(button("Run tool"))
    assert.deepEqual(submitted, {})
    await act(async () => { await i18n.changeLanguage("zh-CN") })
    assert.ok(button("执行工具"))
  } finally { await page.close(); await i18n.changeLanguage("en") }
})
