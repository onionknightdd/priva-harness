import assert from "node:assert/strict"
import { after, test } from "node:test"
import type { McpCapabilities, McpDetail } from "../../../src/features/resources/resource-api.ts"
import { act, React, render } from "./resource-test-dom.tsx"

const { useMcpProbe } = await import("../../../src/features/resources/use-mcp-probe.ts")
const { McpStatusDot } = await import("../../../src/features/resources/mcp-status-dot.tsx")
const capabilities: McpCapabilities = { toolStates: [{ name: "read_file", enabled: true, canToggle: true, disabledReason: null }], tools: [{ name: "read_file" }], prompts: [], resources: [], testedAt: new Date(0).toISOString(), serverVersion: "1.2.3" }
const detail: McpDetail = { id: "test-server", name: "example", sourceId: "project", source: { id: "project", harness: "claude", scope: "project", origin: "settings", label: "Project", path: "/workspace/app/.mcp.json", cwd: "/workspace/app", writable: true, canAdd: true }, transport: "http", target: "https://example.invalid/mcp", enabled: true, canToggle: true, disabledReason: null, effective: true, override: false, headerCount: 0, definition: { url: "https://example.invalid/mcp" }, effectiveDefinition: null }
let state: ReturnType<typeof useMcpProbe>
const requests: { url: URL; signal?: AbortSignal | null }[] = []
let reply: () => Response | Promise<Response> = () => Response.json(capabilities)
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => { requests.push({ url: new URL(String(input), "http://localhost"), signal: init?.signal }); return await reply() }
after(() => { globalThis.fetch = originalFetch })

function Monitor({ server = detail }: { server?: McpDetail }) {
  state = useMcpProbe(server, { harness: server.source.harness, cwd: server.source.cwd ?? undefined })
  return <McpStatusDot probe={state} />
}
const reset = () => { requests.length = 0; reply = () => Response.json(capabilities); Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }) }

test("probes immediately and every 30 seconds without overlapping requests", async (context) => {
  reset()
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const page = await render(<Monitor />)
  try {
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url.searchParams.get("cwd"), "/workspace/app")
    assert.equal(state.status, "online")
    assert.equal(state.capabilities?.serverVersion, "1.2.3")
    assert.equal(page.host.querySelector('[role="status"]')!.getAttribute("aria-label"), "Server online")
    let finish!: (response: Response) => void
    reply = () => new Promise((resolve) => { finish = resolve })
    await act(async () => context.mock.timers.tick(30_000))
    assert.equal(requests.length, 2)
    assert.equal(state.testing, true)
    assert.equal(state.status, "online")
    assert.equal(state.capabilities?.tools[0].name, "read_file")
    await act(async () => context.mock.timers.tick(90_000))
    assert.equal(requests.length, 2)
    await act(async () => finish(Response.json({ ...capabilities, serverVersion: "2.0" })))
    assert.equal(state.capabilities?.serverVersion, "2.0")
  } finally { await page.close() }
  await act(async () => context.mock.timers.tick(60_000))
  assert.equal(requests.length, 2)
})

test("hidden details and background documents pause probes and resume immediately", async (context) => {
  reset()
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const content = (mode: "visible" | "hidden") => <React.Activity mode={mode}><Monitor /></React.Activity>
  const page = await render(content("visible"))
  try {
    await page.update(content("hidden"))
    await act(async () => context.mock.timers.tick(60_000))
    assert.equal(requests.length, 1)
    await page.update(content("visible"))
    assert.equal(requests.length, 2)
    await act(async () => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")) })
    await act(async () => context.mock.timers.tick(60_000))
    assert.equal(requests.length, 2)
    await act(async () => { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")) })
    assert.equal(requests.length, 3)
  } finally { await page.close() }
})

test("changed services discard stale responses and disabled services are not probed", async () => {
  reset()
  let finish!: (response: Response) => void
  reply = () => new Promise((resolve) => { finish = resolve })
  const page = await render(<Monitor />)
  try {
    assert.equal(state.status, "checking")
    reply = () => Response.json({ ...capabilities, serverVersion: "new-service" })
    await page.update(<Monitor server={{ ...detail, id: "new-service" }} />)
    assert.equal(requests[0].signal?.aborted, true)
    await act(async () => finish(Response.json({ ...capabilities, serverVersion: "stale-service" })))
    assert.equal(state.capabilities?.serverVersion, "new-service")
    await page.update(<Monitor server={{ ...detail, enabled: false }} />)
    assert.equal(state.status, "disabled")
    assert.equal(requests.length, 2)
    await page.update(<Monitor server={{ ...detail, definition: { url: "https://example.invalid/updated" } }} />)
    assert.equal(requests.length, 3)
  } finally { await page.close() }
})

test("failed background probes retain the inventory and recover on the next interval", async (context) => {
  reset()
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const page = await render(<Monitor />)
  try {
    const previous = state.capabilities
    reply = () => Response.json({ detail: "Connection failed" }, { status: 502 })
    await act(async () => context.mock.timers.tick(30_000))
    assert.equal(state.status, "offline")
    assert.equal(state.capabilities, previous)
    assert.equal(state.error, "Connection failed")
    reply = () => Response.json(capabilities)
    await act(async () => context.mock.timers.tick(30_000))
    assert.equal(state.status, "online")
    assert.equal(state.error, null)
  } finally { await page.close() }
})

test("policy toggles preserve the inventory while stopping probes and ignoring pre-save responses", async (context) => {
  reset()
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const page = await render(<Monitor />)
  try {
    let finish!: (response: Response) => void
    reply = () => new Promise((resolve) => { finish = resolve })
    await act(async () => context.mock.timers.tick(30_000))
    await act(async () => state.updateTool({ name: "read_file", enabled: false, canToggle: true, disabledReason: null }))
    await act(async () => finish(Response.json(capabilities)))
    assert.equal(state.capabilities?.toolStates[0].enabled, false)
    const retained = state.capabilities
    await page.update(<Monitor server={{ ...structuredClone(detail), enabled: false }} />)
    assert.equal(state.capabilities, retained)
    await act(async () => context.mock.timers.tick(60_000))
    assert.equal(requests.length, 2)
    reply = () => Response.json({ ...capabilities, toolStates: [{ name: "read_file", enabled: false, canToggle: true, disabledReason: null }] })
    await page.update(<Monitor server={structuredClone(detail)} />)
    assert.equal(requests.length, 3)
    assert.equal(state.capabilities?.toolStates[0].enabled, false)
  } finally { await page.close() }
})


test("provider-managed authentication stays unverified instead of offline", async () => {
  reset()
  reply = () => Response.json({ detail: "Use native /mcp to authenticate and inspect this connection" }, { status: 422 })
  const page = await render(<Monitor server={{ ...detail, source: { ...detail.source, harness: "pi" }, definition: { url: "https://example.invalid/mcp", oauth: {} } }} />)
  try {
    assert.equal(state.status, "unverified")
    assert.equal(state.errorStatus, 422)
    assert.match(state.error ?? "", /native \/mcp/u)
    assert.equal(page.host.querySelector('[role="status"]')!.getAttribute("aria-label"), "Connection not verified")
  } finally { await page.close() }
})

test("native Pi enablement and exposure changes retain the tool inventory", async () => {
  reset()
  const native = { ...detail, source: { ...detail.source, harness: "pi" as const }, definition: { ...detail.definition, enabled: true, exposure: "codemode" } }
  const page = await render(<Monitor server={native} />)
  try {
    const retained = state.capabilities
    await page.update(<Monitor server={{ ...native, definition: { ...native.definition, exposure: "direct", toolExposure: { read_file: "hidden" } } }} />)
    assert.equal(requests.length, 1)
    assert.equal(state.capabilities, retained)
    await page.update(<Monitor server={{ ...native, enabled: false, definition: { ...native.definition, enabled: false } }} />)
    assert.equal(state.status, "disabled")
    assert.equal(state.capabilities, retained)
  } finally { await page.close() }
})
