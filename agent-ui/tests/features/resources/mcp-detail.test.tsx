import assert from "node:assert/strict"
import { after, test } from "node:test"
import { registerHooks } from "node:module"
import type { McpCapabilities, McpDetail } from "../../../src/features/resources/resource-api.ts"
import { act, button, click, field, key, React, render, type } from "./resource-test-dom.tsx"

// Check behavior and DOM structure; skip CSS imports in Node.
const hooks = registerHooks({ load: (url, context, nextLoad) => url.endsWith(".css") ? { format: "module", source: "export default {}", shortCircuit: true } : nextLoad(url, context) })
after(() => hooks.deregister())
const { ResourceDetailPane } = await import("../../../src/features/resources/resource-detail.tsx")
const detail: McpDetail = { id: "server", name: "Example server", sourceId: "project", source: { id: "project", harness: "claude", scope: "project", origin: "settings", label: "Project", path: "/workspace/app/.mcp.json", cwd: "/workspace/app", writable: true, canAdd: true }, transport: "http", target: "https://example.invalid/mcp", enabled: true, effective: true, override: false, headerCount: 0, definition: { url: "https://example.invalid/mcp" }, effectiveDefinition: null }
const capabilities: McpCapabilities = { tools: [{ name: "install", description: "Install packages", inputSchema: { type: "object", required: ["packages"], properties: { packages: { type: "array", items: { type: "string" } }, limit: { type: "integer", default: 3 } } } }], prompts: [], resources: [], serverVersion: "2.4.6", testedAt: new Date(0).toISOString() }
const originalFetch = globalThis.fetch
after(() => { globalThis.fetch = originalFetch })

test("MCP details detect status automatically, show metadata pills and run a typed tool form", async () => {
  const requests: { url: URL; body?: Record<string, unknown> }[] = []
  let finish!: (response: Response) => void
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost")
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return url.pathname.endsWith("/capabilities") ? Response.json(capabilities) : new Promise((resolve) => { finish = resolve })
  }
  const page = await render(<ResourceDetailPane kind="mcp" detail={detail} query={{ harness: "claude", cwd: detail.source.cwd! }} file="SKILL.md" onChanged={() => {}} />)
  try {
    assert.equal(requests.length, 1)
    assert.equal(button("Test connection"), undefined)
    const heading = page.host.querySelector("h2")!
    assert.equal(heading.textContent, "Example server")
    assert.equal(heading.parentElement!.querySelector('[data-mcp-status]')!.getAttribute("data-mcp-status"), "online")
    const metadata = page.host.querySelector('[data-mcp-metadata]')!
    assert.deepEqual([...metadata.querySelectorAll('[data-slot="badge"]')].map((pill) => pill.textContent), ["HTTP", "2.4.6", detail.target])
    await click(button("Test tool: install"))
    await act(async () => { await import("../../../src/features/resources/mcp-tool-test-sheet.tsx") })
    assert.ok(field("packages"))
    assert.equal(document.querySelector("textarea"), null)
    await type(field("packages"), "@beui/multi-select")
    await key(field("packages"), "Enter")
    assert.equal(requests.length, 1)
    await click(button("Run tool"))
    assert.equal(requests.length, 2)
    assert.equal(requests[1].url.pathname, "/api/sandbox/resource/mcp/validate/tool")
    assert.equal(requests[1].url.searchParams.get("cwd"), "/workspace/app")
    assert.deepEqual(requests[1].body, { id: "server", name: "install", args: { packages: ["@beui/multi-select"], limit: 3 } })
    assert.ok(field("packages").disabled)
    await act(async () => finish(Response.json({ content: [{ type: "text", text: "done" }] })))
    assert.equal(button("Run tool").disabled, false)
  } finally { await page.close() }
})
