# Skill tool display

Skill calls use the shared ToolResult row with a ScrollText icon, localized action text, skill name, and execution status. The expandable body renders Markdown with MessageResponse inside a viewport capped at 280 px. It retains the shared disclosure animation, reduced-motion behavior, and copy action.

Claude can return only a launch acknowledgement in tool_result, then send the skill body in a separate user message identified by sourceToolUseID. The event mapper attaches that body to the matching Skill tool as its output. Transcript loading preserves this association through SDK merging and session normalization; replay consumes the companion message without creating a user turn. Other metadata messages remain excluded.

Regression coverage: services/agent-runner/ts/tests/unit/provider/claude/claude-skill.test.ts covers live mapping, unknown tool IDs, transcript merging, and history replay.
