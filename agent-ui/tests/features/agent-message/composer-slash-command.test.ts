import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { SlashCommand } from "../../../src/lib/api/slash-commands.ts"
import {
  applySlashSelection,
  composeSlashMessage,
  filterSlashCommands,
  groupSlashCommands,
  parseSlashTrigger,
  positionSlashMenuPanel,
  shouldDeleteSlashChip,
  slashKindLabelKey,
  slashOriginLabelKey,
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

  it("maps kind and origin to hover-card badge labels", () => {
    assert.equal(slashKindLabelKey("command"), "agentMessage.slashCommandGroup")
    assert.equal(slashKindLabelKey("skill"), "agentMessage.slashSkillGroup")
    assert.equal(slashOriginLabelKey("builtin"), "agentMessage.slashOriginBuiltin")
    assert.equal(slashOriginLabelKey("user"), "agentMessage.slashOriginUser")
    assert.equal(slashOriginLabelKey("project"), "agentMessage.slashOriginProject")
  })

  it("keeps the slash menu inside the viewport above the composer", () => {
    assert.deepEqual(positionSlashMenuPanel(700, 48, 1280, 800, 720), {
      left: 48,
      bottom: 108,
      width: 720,
    })
    assert.deepEqual(positionSlashMenuPanel(40, 1200, 1280, 800, 320), {
      left: 952,
      bottom: 768,
      width: 320,
    })
  })
})
