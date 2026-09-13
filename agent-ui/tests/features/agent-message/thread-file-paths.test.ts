import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { AgentThreadMessage } from "../../../src/features/agent-message/agent-message-data.ts"
import { collectThreadFilePaths } from "../../../src/features/agent-message/thread-file-paths.ts"

const base = { createdAt: "2026-01-01T00:00:00.000Z", status: "complete" as const }

describe("collectThreadFilePaths", () => {
  it("collects path-like inline code from assistant text and skips fenced blocks", () => {
    const messages: AgentThreadMessage[] = [
      { ...base, id: "a", role: "assistant", content: "See `src/app.ts` and `README.md`, not `npm test`.\n```ts\nconst x = `lib/skip.ts`\n```" },
    ]

    assert.deepEqual(collectThreadFilePaths(messages, "/repo"), ["/repo/src/app.ts", "/repo/README.md"])
  })

  it("prefers text blocks when present and adds tool file arguments", () => {
    const messages: AgentThreadMessage[] = [
      {
        ...base,
        id: "a",
        role: "assistant",
        content: "ignored `content/only.ts`",
        blocks: [
          { type: "text", blockId: "t", index: 0, text: "Edited `/abs/file.tsx`." },
          { type: "tool_use", blockId: "u", index: 1, id: "1", name: "Read", input: { file_path: "docs/x.md", limit: 5 } },
          { type: "tool_use", blockId: "v", index: 2, id: "2", name: "Bash", input: { command: "ls" } },
        ],
      },
      { ...base, id: "b", role: "user", content: "`user/skip.ts`" },
    ]

    assert.deepEqual(collectThreadFilePaths(messages, "/repo"), ["/abs/file.tsx", "/repo/docs/x.md"])
  })

  it("deduplicates repeated references", () => {
    const messages: AgentThreadMessage[] = [
      { ...base, id: "a", role: "assistant", content: "`a.ts` then `a.ts` again" },
    ]

    assert.deepEqual(collectThreadFilePaths(messages, "/repo"), ["/repo/a.ts"])
  })
})
