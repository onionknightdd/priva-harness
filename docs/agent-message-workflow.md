# Agent message workflow UI

`Workflow` tool invocations render once at their position in the assistant's
process. The message shows only phase navigation and the selected phase's agent
list. Each agent has a square-arrow-out-up-right icon labeled “Open in Workspace”. It opens the
Tasks & Activity workspace module and selects that agent in the full workflow.
Repeated links navigate the same module rather than creating duplicate tabs.

```text
Agent message
  + Workflow title + description; status / counts / duration / usage below
  | Phase 1       | Agent A / metadata / status / share
  | Phase 2       | Agent B / metadata / status / share
  +---------------+-----------------------------------+
                                              |
                                              v
Workspace / Tasks & Activity
  + Workflow title + description; metadata below
  | Phase / agents | Selected agent title + status beside the title
  |   Agent A      | Agent metadata
  |   Agent B      | Prompt / Execution / Output / Copy
  | Phase 2        | Independently scrolling content
  +----------------+-----------------------------------+

Below 640 px of container width:
  Message: phases -> agent list -> share
  Workspace: selected agent detail -> Back to phase / agent list

Live message data -> session-scoped workspace target -> full workflow view
```

Both views respond to their own container width, not the browser viewport.
The workspace target retains the session/runtime identity and detail loader;
message-level synchronization updates the selected workflow even when its
process disclosure is closed. Changing sessions clears the previous target.

## Data contract

The Claude adapter joins the tool-use ID, background task ID, and workflow run
ID. `workflow.progress.workflow` carries a normalized, cumulative `WorkflowState`.
The same state is returned in `GET /api/sandbox/agent/sessions/:session_id/thread`
under each message's `workflows` array. Workflow fields use camelCase, matching
stream frames and message blocks; the obsolete snake_case workflow projection
has been removed. `workflowRunId` is distinct from the enclosing stream's `runId`.

```text
SDK tool result + task_started / task_progress / task_updated / task_notification
                                 |
                                 v
                     ClaudeWorkflows (identity + merge)
                                 |
                      workflow.progress.workflow
                                 |
                         thread / frontend reducers
                                 |
                  WorkflowOverview / WorkflowPipeline

Historical transcript -> launch runId -> session/workflows/<runId>.json
                                 |
                         same normalized state

Select agent -> session-scoped detail endpoint -> agent transcript
```

History reads the snapshot adjacent to the selected session, since its main
transcript does not contain all agent progress. Task completion notifications
update the original workflow message and are not shown as user messages.
A missing or malformed snapshot produces an explicit unavailable state. Phase
and agent arrays are never inferred by executing the workflow script.

`GET /api/sandbox/agent/sessions/:session_id/workflows/:workflow_id/agents/:agent_id?harness=claude`
returns `{ prompt: string | null, result: string | null, process: WorkflowExecutionEntry[] }`. It reads only beneath
that session's `subagents/workflows/<runId>/` directory, validates identifiers,
and rejects symlink escapes. The result prefers the final `StructuredOutput`
input over assistant prose. The UI fetches on selection and execution-status or
attempt changes, cancels stale requests, and caches completed results locally.
While expanded, running agents refresh every two seconds without overlapping
requests. Execution entries retain assistant text and join tool input and result
by tool-use ID, including failures and recorded `thinking` blocks in their original order.
Signatures and opaque `redacted_thinking` blocks are omitted. The UI hides
`StructuredOutput` calls and tool labels; their result remains available in the
Output tab. Workflow headers use a muted background, with an icon beside the title; agent
titles use a bot icon with status immediately after the title, grouped on the left.

`async_launched` means running, not completed. A business verdict such as
`accepted: false` does not mark an agent failed. Pending/running agents left
without a terminal outcome when the workflow finishes are shown as unknown;
cancellation marks unfinished agents cancelled. Counts and percentages use only
known agents and can change when the workflow fans out dynamically.

## Interaction and motion

- Message overviews start open while running; historical workflows start
  collapsed. Workspace navigation opens the full pipeline and selects the linked
  agent immediately, including narrow views.
- The message defaults to a phase with a running agent, then the first phase.
  Workspace detail defaults to the linked agent. Manual
  selection remains stable through incoming progress updates. Phase groups can
  collapse independently; the master list scrolls vertically. Compact spacing
  keeps agent rows readable at 12 px and caps the list at 24 rem. The three
  detail tabs each scroll within an 18 rem region. Execution is the default tab;
  updates follow its end only while the reader remains near the bottom.
- Card selection uses a 150 ms background/border/shadow transition. New live
  agents and inspector swaps use opacity/transform with the shared `EASE_OUT`
  token at 180 ms. Status and copy feedback use 160 ms transitions.
- Expand/collapse reuses `AgentDisclosure`. History does not replay live entrance
  animations. Keyboard interactions avoid the inspector movement; reduced-motion
  preferences disable movement and spinners while retaining labels.
- Narrow-screen Back returns focus to the selected agent and reopens its phase.
  Native buttons and Base UI tabs
  preserve keyboard access. Detail failures offer retry, and truncated previews
  are labeled separately from complete transcript content.

## Verification

Run backend checks from `services/agent-runner/ts/`:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Run frontend checks from `agent-ui/`:

```sh
npm run lint
npm run build
```

For a repeatable manual interaction check, run `npm run dev` in `agent-ui/` and
open `/tests/workflow-preview.html`. This isolated test page uses the real
Workspace shell and synthetic data
and is not an application route or production entry point. Check phase selection, agent share navigation, repeated jumps, workspace resize,
progress updates while the message is collapsed, and agent selection,
Prompt/Execution/Output tabs and independent scrolling, copy feedback, phase collapse, narrow-screen Back/focus return, dynamic agent insertion,
completion, failure, missing snapshots, detail failures/retry, reduced motion,
and dark theme. At 390 px, verify list-to-detail navigation without horizontal overflow.
Frontend automated test tooling remains unconfigured.
