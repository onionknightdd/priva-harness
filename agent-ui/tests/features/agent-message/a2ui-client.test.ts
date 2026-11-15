import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { compiledA2uiMessages, compileDashboard } from "../../../src/features/agent-message/a2ui-client.ts"

const fixture = JSON.parse(readFileSync(new URL("../../fixtures/a2ui/sales-dashboard.json", import.meta.url), "utf8"))

test("accepts official canonical responses and rejects other versions or extra surfaces", () => {
  assert.equal(compiledA2uiMessages(fixture).length, fixture.messages.length)
  for (const invalid of [undefined, {}, { ...fixture, version: "0.9" }, { ...fixture, messages: [...fixture.messages, fixture.messages[0]] },
    { ...fixture, messages: [{ version: "v1.0", deleteSurface: { surfaceId: "main" } }] },
    { ...fixture, messages: [...fixture.messages, { version: "v1.0", updateDataModel: { surfaceId: "other", value: {} } }] }]) {
    assert.throws(() => compiledA2uiMessages(invalid))
  }
})

test("posts plain source to the internal compiler and shares completed compilation", async () => {
  const original = globalThis.fetch
  const calls: { url: string; body: unknown }[] = []
  globalThis.fetch = async (input, init) => { calls.push({ url: String(input), body: JSON.parse(String(init?.body)) }); return Response.json(fixture) }
  try {
    const source = 'root = Text("cache-test")'
    const [first, second] = await Promise.all([compileDashboard(source), compileDashboard(source)])
    assert.equal(first, second)
    assert.deepEqual(calls, [{ url: "/api/sandbox/a2ui/compile", body: { source } }])
  } finally { globalThis.fetch = original }
})

test("compiler errors retain their actionable text and failed requests are not cached", async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return Response.json({ error: "Unknown component Missing" }, { status: 422 }) }
  try {
    for (let i = 0; i < 2; i += 1) await assert.rejects(compileDashboard('root = Missing("error-test")'), /Unknown component Missing/)
    assert.equal(calls, 2)
  } finally { globalThis.fetch = original }
})
