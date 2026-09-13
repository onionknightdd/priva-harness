import assert from "node:assert/strict"
import { test } from "node:test"

import { mcpHeaderRows, mcpHeaders } from "../../../src/features/resources/mcp-headers.ts"

test("headers round-trip without changing credentials, empty values or provider placeholders", () => {
  const headers = { Authorization: "Bearer ${TOKEN}", "X-Options": "key=value:other", "X-Empty": "", "X-Spaces": " keep spaces " }
  const rows = mcpHeaderRows(headers)!
  assert.deepEqual(mcpHeaders(rows), { headers })
  assert.deepEqual(mcpHeaders([...rows, { id: 9, key: " ", value: "" }]), { headers })
  assert.deepEqual(mcpHeaders([{ id: 0, key: " X-Test ", value: " value " }]), { headers: { "X-Test": " value " } })
})

test("blank rows are omitted but values without keys and duplicate header names are rejected", () => {
  assert.deepEqual(mcpHeaders([]), { headers: {} })
  assert.deepEqual(mcpHeaders([{ id: 0, key: "", value: "secret" }]), { error: "resources.headerKeyRequired" })
  assert.deepEqual(mcpHeaders([{ id: 0, key: "Authorization", value: "one" }, { id: 1, key: " authorization ", value: "two" }]), { error: "resources.duplicateHeader" })
  const result = mcpHeaders([{ id: 0, key: "__proto__", value: "literal" }])
  assert.equal(Object.hasOwn(result.headers!, "__proto__"), true)
})

test("JSON conversion rejects non-string header objects instead of losing or coercing values", () => {
  assert.deepEqual(mcpHeaderRows(undefined), [])
  assert.deepEqual(mcpHeaderRows({}), [])
  for (const value of [null, [], "headers", { count: 3 }, { auth: { token: "value" } }]) assert.equal(mcpHeaderRows(value), null)
})
