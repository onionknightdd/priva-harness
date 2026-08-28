import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  isImageEditTool,
  isImageGenTool,
  isImageReadTool,
} from "../../../src/features/agent-message/image-tools.ts"

describe("image tool names", () => {
  it("matches bare and Claude MCP aliases", () => {
    assert.equal(isImageGenTool("image_gen"), true)
    assert.equal(isImageGenTool("mcp__agentWorkshop__image_gen"), true)
    assert.equal(isImageReadTool("image_read"), true)
    assert.equal(isImageEditTool("mcp__agentWorkshop__image_edit"), true)
    assert.equal(isImageGenTool("canvas"), false)
  })
})
