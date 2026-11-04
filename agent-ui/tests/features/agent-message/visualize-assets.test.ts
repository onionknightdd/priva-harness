import assert from "node:assert/strict"
import { test } from "node:test"
import { createVisualizeAssetReader, visualizeAssetsFromInput, VISUALIZE_ASSET_LIMIT } from "../../../src/features/agent-message/visualize-sandbox/assets.ts"
import { createVisualizeSrcdoc } from "../../../src/features/agent-message/visualize-sandbox/create-srcdoc.ts"

test("visualize resources are an explicit bounded list, not network URLs or directory grants", () => {
  assert.deepEqual(visualizeAssetsFromInput({ assets: "/work/texture.png\n/work/model.bin\n/work/texture.png" }), ["/work/texture.png", "/work/model.bin"])
  for (const assets of ["https://example.com/data", "../secret", "/work/*", "/bad\0path", Array.from({ length: 17 }, (_, index) => `/file-${index}`).join("\n")]) {
    assert.deepEqual(visualizeAssetsFromInput({ assets }), [])
  }
})

test("resource bridge deduplicates reads and rejects undeclared paths before any network request", async () => {
  const requests: { url: string; init?: RequestInit }[] = []
  const reader = createVisualizeAssetReader(["/work/a.bin"], (async (url, init) => {
    requests.push({ url: String(url), init })
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "application/octet-stream" } })
  }) as typeof fetch)
  await assert.rejects(reader.read("/work/secret"), /not declared/)
  assert.equal(requests.length, 0)
  const [a, b] = await Promise.all([reader.read("/work/a.bin"), reader.read("/work/a.bin")])
  assert.equal(requests.length, 1)
  assert.equal(a, b)
  assert.deepEqual([...new Uint8Array(a.data)], [1, 2, 3])
  assert.equal(requests[0].url, "/api/sandbox/files/download?path=%2Fwork%2Fa.bin")
  assert.equal(requests[0].init?.redirect, "error")
  reader.dispose()
  assert.equal(requests[0].init?.signal?.aborted, true)
  await assert.rejects(reader.read("/work/a.bin"), /closed/)
})

test("resource limits apply to streamed bytes even when Content-Length is absent", async () => {
  const reader = createVisualizeAssetReader(["/large.bin"], (async () => new Response(new Uint8Array(VISUALIZE_ASSET_LIMIT + 1))) as typeof fetch)
  await assert.rejects(reader.read("/large.bin"), /memory limit/)
  reader.dispose()
})

test("sandbox bootstrap contains only local runtime and safely escaped frame identity", () => {
  const doc = createVisualizeSrcdoc({ runtimeJs: 'const a = "</script>"', frameId: "test</script>", themeCss: ":root{color:red}" })
  assert.equal((doc.match(/<\/script>/g) ?? []).length, 2)
  assert.match(doc, /visualize-theme/)
  assert.match(doc, /VisualizeSandbox.start/)
  assert.doesNotMatch(doc, /https:\/\//)
})
