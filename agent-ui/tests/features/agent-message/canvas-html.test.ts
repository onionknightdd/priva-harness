import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  canvasPathFromTool,
  canvasTitleFromInput,
  isCanvasTool,
  parseCanvasArtifactPath,
} from "../../../src/features/agent-message/canvas-html.ts"

describe("isCanvasTool", () => {
  it("accepts the product name and Claude MCP alias", () => {
    assert.equal(isCanvasTool("canvas"), true)
    assert.equal(isCanvasTool("Canvas"), true)
    assert.equal(isCanvasTool("mcp__agentWorkshop__canvas"), true)
    assert.equal(isCanvasTool("visualize"), false)
    assert.equal(isCanvasTool("mcp__github__create_issue"), false)
  })
})

describe("parseCanvasArtifactPath", () => {
  it("reads a bare html path", () => {
    assert.equal(
      parseCanvasArtifactPath("/work/.canvas/report.html"),
      "/work/.canvas/report.html"
    )
  })

  it("reads a labeled path and ignores html payloads", () => {
    assert.equal(
      parseCanvasArtifactPath("path: /tmp/.canvas/deck.html"),
      "/tmp/.canvas/deck.html"
    )
    assert.equal(
      parseCanvasArtifactPath("<!doctype html><html><body>Hi</body></html>"),
      ""
    )
    assert.equal(
      parseCanvasArtifactPath('{"path":"/work/.canvas/board.html"}'),
      "/work/.canvas/board.html"
    )
  })
})

describe("canvasPathFromTool", () => {
  it("prefers the tool output path over input", () => {
    assert.equal(
      canvasPathFromTool("/work/.canvas/out.html", {
        html: "<h1>secret</h1>",
        path: "/work/.canvas/in.html",
      }),
      "/work/.canvas/out.html"
    )
    assert.equal(
      canvasPathFromTool("", { file_path: "/work/.canvas/in.html" }),
      "/work/.canvas/in.html"
    )
  })

  it("does not treat html input as a path", () => {
    assert.equal(
      canvasPathFromTool("", { html: "<html><body>nope</body></html>" }),
      ""
    )
  })
})

describe("canvasTitleFromInput", () => {
  it("reads title then name", () => {
    assert.equal(
      canvasTitleFromInput({ title: "Board", name: "board.html" }),
      "Board"
    )
    assert.equal(canvasTitleFromInput({ name: "notes" }), "notes")
    assert.equal(canvasTitleFromInput({ html: "<p>x</p>" }), "")
  })
})
