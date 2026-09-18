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
  it("orders projects by newest activity and keeps pinned sessions first", () => {
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
      ["older-in-recent", "newest"]
    )
    assert.deepEqual(
      sorted[1]?.sessions.map((item) => item.sessionId),
      ["older-pinned", "stale"]
    )
  })

  it("keeps a pinned session above a newer unpinned session without moving its project", () => {
    const sorted = sortProjectGroupsByRecency([
      group("/quiet", [
        session("fresh-unpinned", 50, { cwd: "/quiet" }),
      ]),
      group("/work", [
        session("pinned-old", 1, { cwd: "/work", pinned: true }),
        session("older-unpinned", 20, { cwd: "/work" }),
      ]),
    ])

    assert.deepEqual(
      sorted.map((item) => item.cwd),
      ["/quiet", "/work"]
    )
    assert.deepEqual(
      sorted[1]?.sessions.map((item) => item.sessionId),
      ["pinned-old", "older-unpinned"]
    )
  })
})
