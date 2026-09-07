# Agent tool view

Agent/Task calls and nested execution data are joined by parentToolUseId into one message entry at the original tool position. Orphaned sidechains remain accessible. A compact Card shows the Bot icon, status, and metadata below its title. It has no disclosure or execution body; the external-arrow button opens all execution content in the activity inspector. Its external-arrow button selects the Agent in Workspace > Tasks & Activity.

Workspace uses a list/detail layout at container widths of 640 px and above. Narrow containers show one pane at a time and restore list focus when navigating back. Details contain Prompt, Execution, and Output tabs with a 288 px scrolling viewport. Prompt and output render Markdown; execution renders expanded reasoning (including its live state), Markdown text, images, existing tool components, and received communication in arrival order. Scrolling follows updates only near the bottom. Detail changes use a 150 ms opacity transition, disabled for keyboard navigation and reduced motion.

The active session owns the Agent catalog. A session change clears the inspector; updates refresh the selected Agent without remounting its tabs. Agent tool results preserve totalTokens and totalDurationMs through live events and history snapshots. Cards and activity headers show these recorded metrics, including zero. Missing model, duration, and token data are not inferred. It does not fabricate unrecorded communication.

Claude SDK subagent ID lists are normalized before loading history. Background launch acknowledgements do not finish an Agent. Failed and cancelled outcomes are preserved, and completing a nested Agent tool does not finish its parent. Communication uses a receipt ID for deduplication and an insertion position among execution blocks. Communication absent from the provider history cannot be restored from that history alone.

Verification:
- Frontend: npm run lint; npm run build (agent-ui).
- Focused data tests: see AGENTS.md.
- Backend: npm run lint; npm run typecheck; npm test; npm run build (services/agent-runner/ts).
- Browser fixture: /tests/agent-preview.html; toggle the container width, change Agents and tabs, expand tools/reasoning, and verify internal scrolling.

History ownership fix: SDK enumeration includes Workflow workers, which may have no parent tool ID. The history loader now admits only sidechains attached to an Agent/Task call reachable from the main conversation, recovering ordinary Agent ownership from tool results when needed. Unowned Workflow records remain in the workflow detail endpoint. This prevents internal enforcement prompts and worker answers from being replayed as main user/assistant turns. StructuredOutput is hidden case-insensitively in visible process rows, labels, and activity counts; structured results remain available as output.
