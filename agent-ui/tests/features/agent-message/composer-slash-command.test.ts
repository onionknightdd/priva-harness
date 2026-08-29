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
  slashGroupId,
  slashKindLabelKey,
  slashMenuHoverMoved,
  slashOriginLabelKey,
  slashRevealTargetId,
  visibleSlashCommands,
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

const clear: SlashCommand = {
  name: "clear",
  description:
    "Start a new session with empty context; previous session stays on disk",
  kind: "command",
  origin: "builtin",
}

const context: SlashCommand = {
  name: "context",
  description: "Show current context usage",
  kind: "command",
  origin: "builtin",
}

const codeReview: SlashCommand = {
  name: "code-review",
  description: "Review the current diff",
  kind: "skill",
  origin: "builtin",
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

  it("ranks /co by name prefix and ignores short description hits", () => {
    const matches = filterSlashCommands(
      [clear, compact, context, codeReview, review],
      "co"
    )
    assert.deepEqual(
      matches.map((command) => command.name),
      ["compact", "context", "code-review"]
    )
    assert.deepEqual(
      visibleSlashCommands(matches).map((command) => command.name),
      ["compact", "context", "code-review"]
    )
  })

  it("lists commands before skills so Tab completes the first visible row", () => {
    assert.deepEqual(visibleSlashCommands([review, compact]), [compact, review])
    assert.deepEqual(
      visibleSlashCommands(filterSlashCommands([review, compact], "")),
      [compact, review]
    )
  })

  it("does not treat a still pointer as a hover move", () => {
    assert.equal(slashMenuHoverMoved(null, { x: 10, y: 20 }), false)
    assert.equal(
      slashMenuHoverMoved({ x: 10, y: 20 }, { x: 10, y: 20 }),
      false
    )
    assert.equal(
      slashMenuHoverMoved({ x: 10, y: 20 }, { x: 11, y: 20 }),
      true
    )
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

  it("reveals the group title when the first row of a group is highlighted", () => {
    const groups = groupSlashCommands([compact, review])
    assert.equal(slashRevealTargetId("m", 0, groups), slashGroupId("m", "command"))
    assert.equal(slashRevealTargetId("m", 1, groups), slashGroupId("m", "skill"))
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
