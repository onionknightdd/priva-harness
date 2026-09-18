import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { SessionInfo, SessionProjectGroup } from "../../../../src/lib/api/sandbox-sessions.ts"
import { sortProjectGroupsByRecency } from "../../../../src/features/sidebar/content/session-projects.ts"

function session(
  sessionId: string,
  lastModified: number,
  extra?: Partial<SessionInfo>
): SessionInfo {
  return {
    sessionId,
    summary: sessionId,
    lastModified,
    customTitle: null,
    firstPrompt: sessionId,
    cwd: extra?.cwd ?? null,
    tag: null,
    tags: [],
    tagColors: {},
    pinned: false,
    archived: false,
    runMode: "agent",
    ...extra,
  }
}

function group(
  cwd: string,
  sessions: SessionInfo[],
  extra?: Partial<SessionProjectGroup>
): SessionProjectGroup {
  return { cwd, pinned: false, sessions, hasMore: false, ...extra }
}

describe("sortProjectGroupsByRecency", () => {
  it("orders projects by the newest session and sessions by lastModified", () => {
    const sorted = sortProjectGroupsByRecency([
      group("/older", [
        session("older-pinned", 20, { cwd: "/older", pinned: true }),
        session("stale", 10, { cwd: "/older" }),
      ]),
      group("/recent", [
        session("older-in-recent", 40, { cwd: "/recent", pinned: true }),
        session("newest", 100, { cwd: "/recent" }),
      ]),
    ])

    assert.deepEqual(
      sorted.map((item) => item.cwd),
      ["/recent", "/older"]
    )
    assert.deepEqual(
      sorted[0]?.sessions.map((item) => item.sessionId),
      ["newest", "older-in-recent"]
    )
    assert.deepEqual(
      sorted[1]?.sessions.map((item) => item.sessionId),
      ["older-pinned", "stale"]
    )
  })

  it("does not keep a pinned session above a newer unpinned session", () => {
    const sorted = sortProjectGroupsByRecency([
      group("/work", [
        session("pinned-old", 1, { cwd: "/work", pinned: true }),
        session("fresh", 50, { cwd: "/work" }),
      ]),
    ])

    assert.deepEqual(
      sorted[0]?.sessions.map((item) => item.sessionId),
      ["fresh", "pinned-old"]
    )
  })
})
