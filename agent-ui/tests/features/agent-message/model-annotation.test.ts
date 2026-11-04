import assert from "node:assert/strict"
import { test } from "node:test"
import { undo } from "prosemirror-history"

import { fileAnnotationLabel, formatFileAnnotation, isSpatialFileAnnotation, parseFileAnnotationBlock, type ModelFileAnnotation } from "../../../src/features/agent-message/file-annotation.ts"
import { composerDocument, createComposerState, insertFileAnnotation, serializeComposerContent } from "../../../src/features/agent-message/composer-editor-state.ts"
import { parseMessageSelections } from "../../../src/features/agent-message/message-select-action.ts"

const model: ModelFileAnnotation = {
  kind: "model", filePath: "/workspace/fixture.glb", fileRevision: "c".repeat(64), selectionId: "measure-1", index: 1,
  selectedText: "Distance between the two selected vertices", coordinateSpace: "model-world",
  units: { metersPerUnit: 1, source: "format", displayUnit: "mm" },
  selection: { kind: "distance", anchors: [
    { position: [0, 0, 0], locator: { sourceNodePath: [0], nodeId: "2-1-0-3", vertexIndex: 1 } },
    { position: [3, 4, 0], locator: { sourceNodePath: [0], vertexIndex: 2 } },
  ], distance: 5 },
  view: { camera: { position: [5, 5, 5], target: [0, 0, 0], up: [0, 1, 0], projection: "perspective", zoom: 1 }, clipping: { normal: [1, 0, 0], constant: 0 }, animationTime: 1.25 },
  screenshotPath: "/workspace/fixture-view.png",
}

test("3D annotations retain units, stable source anchors and camera through history and Composer undo", () => {
  const formatted = formatFileAnnotation(model)
  assert.deepEqual(parseFileAnnotationBlock(formatted), model)
  assert.equal(isSpatialFileAnnotation(model), true)
  assert.equal(fileAnnotationLabel(model), "fixture.glb · 3D #1")
  let state = createComposerState("original draft")
  insertFileAnnotation(model, "Explain this distance")(state, (transaction) => { state = state.apply(transaction) })
  const serialized = serializeComposerContent(state.doc.content)
  assert.ok(serialized.includes("original draft"))
  assert.ok(state.doc.eq(composerDocument(serialized)))
  assert.deepEqual(parseMessageSelections(formatted), [{ type: "file_annotation", annotation: model }])
  undo(state, (transaction) => { state = state.apply(transaction) })
  assert.equal(serializeComposerContent(state.doc.content), "original draft")
})

test("3D annotations preserve unknown units and validate the middle-vertex angle", () => {
  const angle: ModelFileAnnotation = { ...model, units: { metersPerUnit: null, source: "unknown", displayUnit: "model" },
    selection: { kind: "angle", angle: 90, anchors: [
      { position: [1, 0, 0], locator: { sourceNodePath: [] } },
      { position: [0, 0, 0], locator: { sourceNodePath: [] } },
      { position: [0, 1, 0], locator: { sourceNodePath: [] } },
    ] },
  }
  assert.deepEqual(parseFileAnnotationBlock(formatFileAnnotation(angle)), angle)
  assert.equal(parseFileAnnotationBlock(formatFileAnnotation({ ...angle, selection: { ...angle.selection, angle: 45 } })), null)
  assert.equal(parseFileAnnotationBlock(formatFileAnnotation({ ...angle, selection: { ...angle.selection, anchors: [angle.selection.anchors[1], ...angle.selection.anchors.slice(1)] } })), null)
})

test("malformed model references stay text, including misleading measurements and runtime identities", () => {
  const raw = JSON.parse(formatFileAnnotation(model).split("\n").slice(1, -1).join("\n"))
  const changes = [
    (value: typeof raw) => { value.file_revision = "old-file" },
    (value: typeof raw) => { value.coordinate_space = "viewport-pixels" },
    (value: typeof raw) => { value.units = { meters_per_unit: null, source: "unknown", display_unit: "mm" } },
    (value: typeof raw) => { value.units.meters_per_unit = 0 },
    (value: typeof raw) => { value.selection.distance = 5000 },
    (value: typeof raw) => { value.selection.anchors[0].position = [0, 0] },
    (value: typeof raw) => { value.selection.anchors[0].locator = { uuid: "runtime-uuid" } },
    (value: typeof raw) => { value.selection.anchors[0].locator.source_node_path = [-1] },
    (value: typeof raw) => { value.selection.anchors[0].locator.node_id = "x".repeat(257) },
    (value: typeof raw) => { value.view.camera.zoom = -1 },
    (value: typeof raw) => { value.view.camera.projection = "orthographic" },
    (value: typeof raw) => { value.view.animationTime = -1 },
    (value: typeof raw) => { value.view.animationTime = Infinity },
    (value: typeof raw) => { value.view.animationTime = "1.25" },
    (value: typeof raw) => { value.view.clipping.normal = [0, 0, 0] },
    (value: typeof raw) => { value.screenshot_path = "https://untrusted.invalid/image.png" },
  ]
  for (const change of changes) {
    const value = structuredClone(raw)
    change(value)
    assert.equal(parseFileAnnotationBlock("```file_annotation\n" + JSON.stringify(value) + "\n```"), null)
  }
})
