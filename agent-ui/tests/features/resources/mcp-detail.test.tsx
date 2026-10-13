import assert from "node:assert/strict"
import { after, test } from "node:test"
import { registerHooks } from "node:module"
import type { McpCapabilities, McpDetail } from "../../../src/features/resources/resource-api.ts"
import { act, button, click, field, key, React, render, type } from "./resource-test-dom.tsx"

// Check behavior and DOM structure; skip CSS imports in Node.
const hooks = registerHooks({ load: (url, context, nextLoad) => url.endsWith(".css") ? { format: "module", source: "export default {}", shortCircuit: true } : nextLoad(url, context) })
after(() => hooks.deregister())
const { ResourceDetailPane } = await import("../../../src/features/resources/resource-detail.tsx")
const detail: McpDetail = { id: "server", name: "Example server", sourceId: "project", source: { id: "project", harness: "claude", scope: "project", origin: "settings", label: "Project", path: "/workspace/app/.mcp.json", cwd: "/workspace/app", writable: true, canAdd: true }, transport: "http", target: "https://example.invalid/mcp", enabled: true, canToggle: true, disabledReason: null, effective: true, override: false, headerCount: 0, definition: { url: "https://example.invalid/mcp" }, effectiveDefinition: null }
const capabilities: McpCapabilities = { toolStates: [{ name: "install", enabled: true, canToggle: true, disabledReason: null }], tools: [{ name: "install", description: "Install packages", inputSchema: { type: "object", required: ["packages"], properties: { packages: { type: "array", items: { type: "string" } }, limit: { type: "integer", default: 3 } } } }], prompts: [], resources: [], serverVersion: "2.4.6", testedAt: new Date(0).toISOString() }
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

test("server and tool switches retain inventory, block duplicate saves, and preserve state on failure", async () => {
  let finish!: (response: Response) => void
  const mutations: { url: string; body: { name?: string; enabled: boolean } }[] = []
  globalThis.fetch = async (input, init) => {
    if (!init?.method) return Response.json(capabilities)
    mutations.push({ url: String(input), body: JSON.parse(String(init.body)) })
    return new Promise((resolve) => { finish = resolve })
  }
  function Page() {
    const [current, setCurrent] = React.useState(detail)
    return <ResourceDetailPane kind="mcp" detail={current} query={{ harness: "claude", cwd: detail.source.cwd! }} file="SKILL.md" onChanged={() => assert.fail("Toggle must not remount the details")} onResourceUpdated={async (updated) => setCurrent(updated as McpDetail)} />
  }
  const page = await render(<Page />)
  try {
    const row = page.host.querySelector('[data-mcp-tool="install"]')!
    const panel = row.closest<HTMLElement>('[role="tabpanel"]')!
    panel.scrollTop = 120
    const toggle = button("Enable tool: install")
    await click(toggle)
    await click(toggle)
    assert.equal(mutations.length, 1)
    assert.deepEqual(mutations[0].body, { name: "install", enabled: false })
    assert.equal(toggle.disabled, true)
    assert.equal(toggle.getAttribute("aria-checked"), "true")
    await act(async () => finish(Response.json({ name: "install", enabled: false, canToggle: true, disabledReason: "Disabled here" })))
    assert.equal(toggle.getAttribute("aria-checked"), "false")
    assert.equal(button("Test tool: install").disabled, true)
    assert.ok(page.host.textContent?.includes("0/1"))
    assert.equal(page.host.querySelector('[data-mcp-tool="install"]'), row)
    assert.equal(panel.scrollTop, 120)

    await click(toggle)
    await act(async () => finish(Response.json({ detail: "Save rejected" }, { status: 403 })))
    assert.equal(toggle.getAttribute("aria-checked"), "false")
    assert.ok(page.host.textContent?.includes("Save rejected"))
    assert.equal(toggle.disabled, false)

    await click(button("Enable MCP server"))
    await act(async () => finish(Response.json({ ...structuredClone(detail), enabled: false })))
    assert.equal(toggle.disabled, true)
    assert.equal(page.host.querySelector('[data-mcp-tool="install"]'), row)
    assert.equal(panel.scrollTop, 120)
    assert.equal(page.host.querySelector('[data-mcp-status]')?.getAttribute("data-mcp-status"), "disabled")
    assert.ok(page.host.textContent?.includes("Saved."))
    assert.deepEqual(mutations[2].body, { enabled: false })
  } finally { await page.close() }
})

test("inherited restrictions expose their reason and disable only the affected control", async () => {
  globalThis.fetch = async () => Response.json({ ...capabilities, toolStates: [{ name: "install", enabled: false, canToggle: false, disabledReason: "mcp__example__* in user settings" }] })
  const page = await render(<ResourceDetailPane kind="mcp" detail={detail} query={{ harness: "claude" }} file="SKILL.md" onChanged={() => {}} />)
  try {
    assert.equal(button("Enable MCP server").disabled, false)
    assert.equal(button("Enable tool: install").disabled, true)
    assert.equal(button("Test tool: install").disabled, true)
    assert.ok(page.host.textContent?.includes("mcp__example__* in user settings"))
  } finally { await page.close() }
})

test("Pi calling mode changes preserve current credentials and tool policy", async () => {
  const native: McpDetail = { ...detail, source: { ...detail.source, harness: "pi" }, definition: { ...detail.definition, headers: { Authorization: "fixture" } } }
  const latest = { ...native, definition: { ...native.definition, toolExposure: { install: "hidden" } } }
  const mutations: Record<string, unknown>[] = []
  let current = native
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("capabilities")) return Response.json(capabilities)
    if (!init?.method) return Response.json(latest)
    const body = JSON.parse(String(init.body)) as { definition: Record<string, unknown> }
    mutations.push(body)
    current = { ...native, definition: body.definition }
    return Response.json(current)
  }
  function Page() {
    const [value, setValue] = React.useState(native)
    return <ResourceDetailPane kind="mcp" detail={value} query={{ harness: "pi" }} file="" onChanged={() => assert.fail("Must preserve detail pane")} onResourceUpdated={async (updated) => setValue(updated as McpDetail)} />
  }
  const page = await render(<Page />)
  try {
    const select = page.host.querySelector<HTMLElement>('[data-mcp-call-mode] [role="combobox"]')!
    assert.match(select.textContent ?? "", /Codemode/u)
    await click(select)
    await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === "Search before calling")!)
    assert.deepEqual(mutations, [{ definition: { ...latest.definition, exposure: "deferred" } }])
    assert.match(select.textContent ?? "", /Search before calling/u)
    assert.ok(page.host.textContent?.includes("Saved."))
  } finally { await page.close() }
})

test("Claude has no Pi calling mode and read-only Pi mode cannot be edited", async () => {
  globalThis.fetch = async () => Response.json(capabilities)
  const page = await render(<ResourceDetailPane kind="mcp" detail={detail} query={{ harness: "claude" }} file="" onChanged={() => {}} />)
  try {
    assert.equal(page.host.querySelector('[data-mcp-call-mode]'), null)
    await page.update(<ResourceDetailPane kind="mcp" detail={{ ...detail, canToggle: false, source: { ...detail.source, harness: "pi", writable: false }, definition: { ...detail.definition, exposure: "direct" } }} query={{ harness: "pi" }} file="" onChanged={() => {}} />)
    assert.ok(page.host.querySelector<HTMLButtonElement>('[data-mcp-call-mode] [role="combobox"]')?.disabled)
  } finally { await page.close() }
})
