import assert from "node:assert/strict"
import { test } from "node:test"

import { imageOutputPath, imageToolInput, imageToolString, type ImageToolBlock } from "../../../src/features/agent-message/image-tool-data.ts"

const block: ImageToolBlock = {
  type: "tool_use", blockId: "image", id: "image", index: 0, name: "image_gen",
  input: { prompt: "A quiet forest", size: "1536x1024" },
}

test("streamed tool input retains fields while the final input takes precedence", () => {
  const input = imageToolInput({
    ...block,
    tool: { id: "image", name: "image_gen", status: "running", input: { prompt: "A forest at night" } },
  })
  assert.deepEqual(input, { prompt: "A forest at night", size: "1536x1024" })
  assert.equal(imageToolString(input, "prompt"), "A forest at night")
})

test("incomplete input never renders raw JSON, arrays, or non-string values", () => {
  for (const input of [undefined, null, [], "{\"prompt\":", 7]) {
    assert.deepEqual(imageToolInput({ ...block, input }), {})
  }
  assert.equal(imageToolString({ prompt: { text: "forest" } }, "prompt"), "")
})

test("successful output accepts local image paths, including spaces and Windows paths", () => {
  assert.equal(imageOutputPath(" /workspace/.images/night scene.png\n"), "/workspace/.images/night scene.png")
  assert.equal(imageOutputPath("C:\\workspace\\.images\\output.JPG"), "C:/workspace/.images/output.JPG")
})

test("error text, remote URLs, structured data, and partial output are never loaded as images", () => {
  for (const output of [undefined, "", "Generation failed", "Error: /workspace/file.png", "https://example.com/image.png", "data:image/png;base64,AA", ".images/file.png", "/workspace/image.png\nmore text", '{"path":"/workspace/image.png"}', "/workspace/file.txt"]) {
    assert.equal(imageOutputPath(output), "", String(output))
  }
})
