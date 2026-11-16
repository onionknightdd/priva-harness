import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveWhiteboardPath, whiteboardPathFromTool, whiteboardToolKind } from "../../../src/features/agent-message/whiteboard-tools.ts"
import { createLiveWhiteboardNavigation } from "../../../src/features/agent-message/live-whiteboard-navigation.ts"
import { externalMcpToolName } from "../../../src/features/agent-message/mcp-tool-data.ts"
import { classifyToolName, toolItemStatusLabel } from "../../../src/features/agent-message/tool-activity.ts"
import { createInstance } from "i18next"
import { en } from "../../../src/i18n/locales/en.ts"

test("whiteboard cards recognize native aliases without swallowing other tools", () => {
  assert.equal(whiteboardToolKind("mcp__agentWorkshop__whiteboard_write"), "write")
  assert.equal(whiteboardToolKind("WHITEBOARD_READ"), "read")
  assert.equal(whiteboardToolKind("whiteboard_write_extra"), null)
  assert.equal(externalMcpToolName("mcp__agentWorkshop__whiteboard_read"), null)
  assert.deepEqual(externalMcpToolName("mcp__github__read"), { serverName: "github", toolName: "read" })
  assert.equal(classifyToolName("mcp__agentWorkshop__whiteboard_write"), "write")
})

test("whiteboard preview paths prefer resolved tool results and reject non-board payloads", () => {
  assert.equal(whiteboardPathFromTool('{"path":"/work/.whiteboard/session/demo.board.json","revision":2}', { path: "other.board.json" }, "/work", "session"), "/work/.whiteboard/session/demo.board.json")
  assert.equal(whiteboardPathFromTool(undefined, { path: "demo.board.json" }, "/work", "session"), "/work/.whiteboard/session/demo.board.json")
  assert.equal(whiteboardPathFromTool('{"path":"/private/tmp/work/.whiteboard/session/demo.board.json"}', {}, "/tmp/work", "session"), "/private/tmp/work/.whiteboard/session/demo.board.json", "canonical workspace aliases from the server are authoritative")
  for (const path of ["<html>.board.json", "x\n.board.json", "board.json", "board.html"]) {
    assert.equal(whiteboardPathFromTool(JSON.stringify({ path }), {}, "/work", "session"), "")
  }
})

test("short, workspace-relative and absolute tool paths resolve into the current native session directory", () => {
  for (const session of ["session", "other-session", "8a8319fe-8221-4263-b223-86dc98720a61"]) {
    const expected = `/work/.whiteboard/${session}/sub/architecture.board.json`
    for (const path of ["sub/architecture.board.json", `./.whiteboard/${session}/sub/architecture.board.json`, expected]) {
      assert.equal(resolveWhiteboardPath(path, "/work", session), expected)
    }
    assert.equal(whiteboardPathFromTool(undefined, {}, "/work", session), "", "read requires an explicit path")
  }
  for (const path of [".canvas/demo.board.json", "./.canvas/demo.board.json", "/work/.canvas/demo.board.json", ".whiteboard/other-session/demo.board.json", "/work/.whiteboard/other-session/demo.board.json", "../other-session/demo.board.json", "/other/.whiteboard/session/demo.board.json", "sub/../../other-session/demo.board.json", "demo.BOARD.JSON", "demo.board.json\n", "sub\\demo.board.json", "demo\u007f.board.json"]) {
    assert.equal(resolveWhiteboardPath(path, "/work", "session"), "", path)
    assert.equal(whiteboardPathFromTool(undefined, { path, ops: "[]" }, "/work", "session"), "", "invalid explicit input does not open a board")
  }
  for (const session of [undefined, null, "", ".", "../session", "claude:session", "a/b"]) {
    assert.equal(whiteboardPathFromTool(undefined, { path: "theme.board.json", ops: "[]" }, "/work", session), "")
    assert.equal(whiteboardPathFromTool('{"path":"/work/.whiteboard/session/demo.board.json"}', {}, "/work", session), "")
  }
  assert.equal(whiteboardPathFromTool('{"path":"/work/.whiteboard/other/demo.board.json"}', { path: "safe.board.json" }, "/work", "session"), "", "a wrong-session result is never replaced with a guessed input path")
})

test("live navigation waits for the actual session and shares the same path before and after writes", () => {
  const navigation = createLiveWhiteboardNavigation()
  const started = { type: "tool.started", id: "write", name: "mcp__agentWorkshop__whiteboard_write", input: { path: "architecture.board.json", ops: "[]" } }
  assert.equal(navigation.receive(started, "/work", undefined), null)
  assert.deepEqual(navigation.receive({ type: "session.config" }, "/work", "native-session"), {
    path: "/work/.whiteboard/native-session/architecture.board.json", focus: true, animateInitial: true,
  })
  assert.equal(navigation.receive({ type: "tool.completed", id: "write", output: '{"path":"/work/.whiteboard/native-session/architecture.board.json"}' }, "/work", "native-session"), null)
  assert.deepEqual(navigation.receive({ ...started, input: { path: "sub/architecture.board.json", ops: "[]" } }, "/work", "second-session"), {
    path: "/work/.whiteboard/second-session/sub/architecture.board.json", focus: true, animateInitial: true,
  })
  assert.equal(navigation.receive({ type: "tool.completed", id: "write", output: '{"path":"/work/.whiteboard/second-session/sub/architecture.board.json"}' }, "/work", "second-session"), null)
  navigation.receive({ type: "session.rebound", sessionId: "second-session", nextSessionId: "resumed-session" }, "/work", "second-session")
  assert.deepEqual(navigation.receive(started, "/new-work", "resumed-session"), {
    path: "/new-work/.whiteboard/resumed-session/architecture.board.json", focus: true, animateInitial: true,
  })
  const earlyArguments = createLiveWhiteboardNavigation()
  assert.equal(earlyArguments.receive(started, "/work", undefined), null)
  assert.deepEqual(earlyArguments.receive({ type: "run.started", sessionId: "bound-session" }, "/work", "bound-session"), {
    path: "/work/.whiteboard/bound-session/architecture.board.json", focus: true, animateInitial: true,
  }, "the first run.started binding does not discard pending arguments")
  const missingPath = createLiveWhiteboardNavigation()
  for (const type of ["tool.started", "tool.running", "tool.completed"]) {
    assert.equal(missingPath.receive({ ...started, type, input: { ops: "[]" } }, "/work", "native-session"), null, "a missing path never guesses a default")
  }
  for (const input of [undefined, {}, { path: "" }, { path: "  " }]) {
    assert.equal(whiteboardPathFromTool(undefined, input, "/work", "native-session"), "")
  }
  assert.equal(navigation.receive({ ...started, id: "old-location", input: { path: ".canvas/old.board.json", ops: "[]" } }, "/new-work", "resumed-session"), null)
})

test("whiteboard activity labels distinguish reading and drawing", async () => {
  const i18n = createInstance()
  await i18n.init({ lng: "en", resources: { en: { translation: en } } })
  assert.equal(toolItemStatusLabel("whiteboard_read", true, i18n.t), "Reading whiteboard")
  assert.equal(toolItemStatusLabel("whiteboard_write", true, i18n.t), "Drawing whiteboard")
  assert.equal(toolItemStatusLabel("whiteboard_write", false, i18n.t), "Whiteboard")
})
