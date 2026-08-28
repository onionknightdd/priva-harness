import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { SlashCommand } from "../../../src/lib/api/slash-commands.ts"
import {
  applySlashSelection,
  composeSlashMessage,
  filterSlashCommands,
  groupSlashCommands,
  parseSlashTrigger,
  shouldDeleteSlashChip,
} from "../../../src/features/agent-message/composer-slash-command.ts"

const compact: SlashCommand = {
  name: "compact",
  description: "Compact context",
  kind: "command",
  origin: "builtin",
  aliases: ["cost"],
}

const review: SlashCommand = {
  name: "review",
  description: "Review a change",
  kind: "skill",
  origin: "project",
}

describe("composer slash command helpers", () => {
  it("parses a leading slash token without whitespace as a trigger", () => {
    assert.deepEqual(parseSlashTrigger("/"), { query: "" })
    assert.deepEqual(parseSlashTrigger("/com"), { query: "com" })
    assert.equal(parseSlashTrigger("/compact now"), null)
    assert.equal(parseSlashTrigger("hello"), null)
    assert.equal(parseSlashTrigger(" /com"), null)
  })

  it("filters by name, alias, and description", () => {
    assert.deepEqual(filterSlashCommands([compact, review], "cost"), [compact])
    assert.deepEqual(filterSlashCommands([compact, review], "change"), [review])
    assert.equal(filterSlashCommands([compact, review], "").length, 2)
  })

  it("groups commands before skills and composes the send payload", () => {
    assert.deepEqual(groupSlashCommands([review, compact]), [
      { kind: "command", commands: [compact] },
      { kind: "skill", commands: [review] },
    ])
    assert.equal(composeSlashMessage("compact", ""), "/compact")
    assert.equal(composeSlashMessage("compact", "summarize this"), "/compact summarize this")
    assert.equal(applySlashSelection("/"), "")
    assert.equal(applySlashSelection("/com"), "")
    assert.equal(applySlashSelection("/com leftover"), "leftover")
    assert.equal(composeSlashMessage("review", "   "), "/review")
  })

  it("deletes the chip only when the caret is at the start", () => {
    assert.equal(shouldDeleteSlashChip(0, 0), true)
    assert.equal(shouldDeleteSlashChip(1, 1), false)
    assert.equal(shouldDeleteSlashChip(0, 3), false)
  })
})
