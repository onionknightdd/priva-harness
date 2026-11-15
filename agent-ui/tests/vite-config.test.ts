import assert from "node:assert/strict"
import path from "node:path"
import { test } from "node:test"
import { resolveConfig } from "vite"

const root = path.resolve(import.meta.dirname, "..")
const configFile = path.join(root, "vite.config.ts")
const resolveDev = (port?: number) => resolveConfig({ root, configFile, logLevel: "silent", server: port === undefined ? {} : { port } }, "serve")

test("merged CLI ports isolate optimizer caches and keep a stable path across restarts", async () => {
  const defaultPort = await resolveDev()
  const forwarded = await resolveDev(15173)
  const restarted = await resolveDev(15173)
  assert.equal(defaultPort.server.port, 5173)
  assert.equal(defaultPort.server.strictPort, true, "auto-incrementing the port would reuse the wrong cache")
  assert.equal(defaultPort.cacheDir, path.join(root, "node_modules/.vite-5173"))
  assert.equal(forwarded.cacheDir, path.join(root, "node_modules/.vite-15173"))
  assert.notEqual(forwarded.cacheDir, defaultPort.cacheDir)
  assert.equal(restarted.cacheDir, forwarded.cacheDir)
  for (const dependency of ["@xyflow/react", "@animate-ui/react/primitives/slot", "@animate-ui/react/utils/motion"]) {
    assert.ok(defaultPort.optimizeDeps.include?.includes(dependency), `${dependency} must be ready before opening the lazy whiteboard preview`)
  }
})

test("an explicitly isolated fixture cache survives app config merging and CLI port overrides", async () => {
  const config = await resolveConfig({ root, configFile: path.join(root, "tests/features/agent-message/image-tools-browser.config.ts"), logLevel: "silent", server: { port: 15185 } }, "serve")
  assert.equal(config.server.port, 15185)
  assert.equal(config.cacheDir, path.join(root, "node_modules/.vite-image-tools-checks"))
})

test("explicit development options can override the strict-port default", async () => {
  const config = await resolveConfig({ root, configFile, logLevel: "silent", server: { port: 15185, strictPort: false } }, "serve")
  assert.equal(config.server.strictPort, false)
  assert.equal(config.cacheDir, path.join(root, "node_modules/.vite-15185"))
})

test("production builds retain Vite's build cache instead of a development port cache", async () => {
  const config = await resolveConfig({ root, configFile, logLevel: "silent" }, "build")
  assert.equal(config.cacheDir, path.join(root, "node_modules/.vite"))
})
