# Pi Dynamic Workflows

The Pi provider embeds `@quintinshaw/pi-dynamic-workflows` 3.10.1 as its `workflow`
tool. It reuses the existing message overview and Workspace Tasks & Activity
workflow view. No separate workflow tab or provider-specific layout is added.

```text
Pi host session (OpenAI Responses)
  └─ workflow tool / WorkflowManager
       ├─ lifecycle + usage → PiWorkflows → PiEventMapper
       │                                    └─ workflow.progress / completed
       │                                         └─ existing message + Workspace UI
       ├─ terminal background result -> native follow-up -> model reply
       └─ real WorkflowAgent sessions
            └─ session-scoped raw transcripts + invocation entry IDs
                 └─ PiSessionStore.workflowAgent → prompt / process / result
```

## Behavior

- Subagents inherit the host model and model runtime, including its endpoint and
  credentials. Explicit per-agent model routing still takes precedence.
- Foreground structured updates and background manager events both use the
  shared workflow state. A model reply completes independently of detached work;
  the session stream remains subscribed. Stopping a reply leaves background work
  running; `task.stop` cancels the selected workflow or subagent.
- Terminal background workflows deliver their result once through the native
  session `sendCustomMessage` follow-up queue. Agent notifications keep the
  subagent plugin as their only sender. Runtime retention covers queued results.
  See [the session protocol](background-tasks.md).
- Phase names map to one-based UI indices. Agent identity uses the plugin's
  journal call ID, not the label, so equal labels and parallel agents stay distinct.
- The UI shows per-agent model, provider token usage, timing, and full tool counts.
  The plugin's standalone estimated `tokens` value is not treated as billed usage.
- Failed agents prevent a completed script from appearing successful. Cancelled,
  paused, and skipped states remain distinct.
- Details use full Pi transcript messages rather than the plugin's truncated
  history. Thinking blocks, tool arguments, results and assistant text retain their
  order; tool results join by call ID. Internal structured-output tools are hidden.
- Retained threads and retry attempts are associated with their exact transcript
  entry IDs, so an agent detail does not absorb earlier agents' messages.
- Resuming a workflow reloads its scoped transcript associations. A run belonging
  to another host session cannot be resumed through this tool.

Snapshots and subagent transcripts live under
`<agentDir>/workflow-data/<sha256(sessionId)>/`. Snapshot files are atomically
replaced; detail reads verify that resolved transcript paths remain inside that
session root. Subagent transcripts stay outside the top-level session index.
Deleting a host session removes these UI records. The plugin additionally keeps
its own execution journal in its standard project-scoped workflow directory.

Replaying a host transcript hydrates the tool's original `runId` from the latest
saved UI state, so a background launch does not revert to an empty running card.
The integration embeds the workflow tool and execution library; it does not mount
the plugin's terminal widgets or terminal slash-command navigator in the web UI.

## Verification

Run from `services/agent-runner/ts/`:

```sh
npx vitest run tests/unit/provider/pi
npm run typecheck
npm run lint
npm run build
```

Tests cover phase/state normalization, exact model selection over a local
Responses SSE server, parallel agents sharing a label, background cancellation,
stream completion, transcript entry scoping, cross-session/path rejection and
history replay. The local HTTP test uses synthetic data and needs no API key.

A live validation on 2026-09-07 used an existing DeepSeek OpenAI-compatible
configuration and `deepseek-v4-flash` through `openai-responses`. Both the published
plugin and the integrated product session factory were exercised. The product
path ran a real `read` call, returned a sum of 18, exposed thinking/tool/result
entries, and restored one completed workflow through `PiSessionStore.replay` and
`foldThread`. That workflow reported 3,635 tokens and 1,817 ms. Credentials were
read at runtime; no keys or live transcripts are included in the repository.

The shared Pi loader declares its Pi AI runtime dependency and resolves the
`pi-ai/compat` and `typebox/value` subpaths explicitly. The loader smoke test
covers this host-entry requirement before a workflow can start.
