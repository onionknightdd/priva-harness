import assert from "node:assert/strict"
import { test } from "node:test"
import { angleBetween, distanceBetween, displayDistance } from "../../../../src/features/files/preview/model/model-measurement.ts"
import { previewResponseToFile } from "../../../../src/features/file-browser/file-browser-data.ts"
import { skillFileKind } from "../../../../src/features/resources/skill-file-kind.ts"

test("physical display units preserve geometry distance, unknown units stay explicit", () => {
  const distance = distanceBetween([1e9, 2e9, 0], [1e9 + 0.125, 2e9, 0])
  assert.equal(distance, 0.125)
  assert.equal(displayDistance(distance, { metersPerUnit: 1, source: "format", displayUnit: "mm" }), 125)
  assert.equal(displayDistance(distance, { metersPerUnit: null, source: "unknown", displayUnit: "mm" }), 0.125)
  assert.equal(angleBetween([1, 0, 0], [0, 0, 0], [0, 1, 0]), 90)
  assert.equal(angleBetween([1, 0, 0], [0, 0, 0], [-1, 0, 0]), 180)
  assert.equal(angleBetween([0, 0, 0], [0, 0, 0], [1, 0, 0]), null)
})

test("all model formats reach binary rendering even when source text exceeds its budget", () => {
  for (const extension of ["glb", "gltf", "OBJ", "stl", "ply", "pcd", "step", "stp", "iges", "igs", "las", "laz", "copc.laz"]) {
    const name = `model.${extension}`
    const result = previewResponseToFile({ name, path: `/workspace/${name}`, mime_type: "application/octet-stream", size: 5e6, content: null, is_binary: false, preview_url: null, preview_error: "too-large", revision: "a".repeat(64) })
    assert.equal(result.renderKind, "model", extension)
    assert.equal(result.status, "ready", extension)
    assert.ok(result.renderSource)
    assert.equal(result.content, undefined)
    assert.equal(result.revision, "a".repeat(64))
    assert.equal(skillFileKind(name), "model")
  }
  assert.equal(skillFileKind("unknown.bin"), "text")
  assert.equal(previewResponseToFile({ name: "large.txt", path: "/large.txt", mime_type: "text/plain", size: 5e6, content: null, is_binary: false, preview_url: null, preview_error: "too-large" }).status, "error")
})
