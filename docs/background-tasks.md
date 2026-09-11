# Session events and background tasks

`WS /api/sandbox/agent/ws/session` uses protocol v2. One connection follows one
provider/session across model replies. Completing or aborting a reply does not
close the connection or imply that detached tasks completed.

```text
SDK / plugin -> persistent runtime mapper -> SessionStream
                                             +-> v2 WebSocket + replay cursor
                                             +-> canonical messages + task cards
                                             +-> session metadata (task state)

Claude native task notification -> native model queue -> next assistant reply
Pi Agent plugin notification    -> native model queue -> next assistant reply
Pi Workflow terminal result     -> one custom follow-up -> next assistant reply
```

## Commands

| Type | Required fields | Optional fields |
| --- | --- | --- |
| `run.start` | `harness`, `text`, `model`, `cwd` | `runId`, `sessionId`, `attachments`, `effort`, `fork`, `promptSuggestions` |
| `session.subscribe` | `harness`, `sessionId` | `streamId`, `sinceSeq` (default 0) |
| `run.abort` | `harness`, one of `runId` / `sessionId` | the other identity |
| `task.stop` | `harness`, `sessionId`, `taskId` | — |

`harness` is `claude` or `pi`. Attachment-only starts may have empty text. The UI
supplies a unique `runId` so optimistic messages can be reconciled. A start is
sent once; reconnect only subscribes and never resubmits an uncertain start.
`run.abort` affects the active model interaction. `task.stop` calls Claude's
native `stopTask`, Pi's scoped subagent stop RPC, or its workflow manager.
Command failures are `error` frames with `code` equal to the command type and the
request's `runId` when supplied. A task stop error leaves other replies intact.

## Events and replay

All session events carry `v: 2`, `harness`, `sessionId`, `streamId`, `seq`, and
`ts`. `runId` identifies an owning reply; session-only events use an empty string.
`run.started` includes a canonical `userMessage` only for user-initiated turns.
Provider-initiated model replies retain their own run identity. `messageTargetId`
is the canonical bubble to update; a task follow-up can target an earlier run's
bubble. `replyTo` records the consumed `notificationIds`, `taskId`, and
`toolUseId`. An optional `turnId` identifies an independent rendered turn for
notifications consumed during an existing reply. Splitting this turn does not
change the SDK run identity, model execution, or composer busy state.

| Event | Payload / meaning |
| --- | --- |
| `session.snapshot` | `messages`, `tasks`, optional `activeRunId`; state at the envelope's sequence |
| `tasks.snapshot` | complete normalized task registry, including retained terminal tasks |
| `task.updated` / `task.notification` | one normalized `task`, joined by `taskId` and `toolUseId` |
| `task.delivered` | native `notification` (`id`, `task`, optional `createdAt` and `turnId`), plus normalized `task`; establishes the reply context |
| `session.state` | native model execution state when the provider emits it |
| `run.completed` / `run.failed` / `run.aborted` | ends that model reply |
| `replay.gap` | cursor cannot be satisfied; an authoritative snapshot follows |

The sequence is session-wide. The in-memory replay buffer keeps 4,096 events.
A matching `streamId` and retained sequence replay only newer events. A
subscription with a cursor also sends a final snapshot to reconcile commands
whose replies were lost. A stale cursor or process change resets via snapshot.
The UI deduplicates streamed events and keeps unsent messages out of replay.
Disconnect removes the subscriber; execution continues.

## Task state and history

Tasks carry `taskId`, `kind`, `status`, and, when known, `toolUseId`,
`originRunId`, `description`, `summary`, `outputFile`, `updatedAt`, and
`stopRequested`. Native deliveries also retain `result`, `tokens`, and `durationMs`
when supplied. A delivered notification with no result sets `result: null`, clearing
an earlier delivery's output. Kinds are bash / agent / workflow / monitor / other. Statuses
are pending / running / paused / completed / failed / cancelled / unknown.
The tool result is a launch receipt; task status describes detached execution.
Workspace Agent output uses the native notification's actual `result`. Each
notification retains its own result, so a second delivery for a resumed agent
does not overwrite the first notification's preview. Bash output continues to
open its SDK-provided file on demand.

A task disappearing from the SDK's active set becomes unknown until terminal
evidence arrives. An older running snapshot cannot reverse a terminal state.
Ambient SDK tasks are excluded. Native tool identities remain in the mapper
across replies, so a late notification updates its original tool card.

Normalized task state is saved through the existing session metadata repository,
including tasks without a visible launch tool. Writes are serialized and
persistence errors appear in the session stream. Native transcripts remain the
conversation source. History merges saved task state onto its original tool.
After a service restart, confirmed terminal records survive; previously active
tasks are unknown and `stopRequested` is cleared. Tasks do not resume across
service processes.

Claude history recognizes XML when `origin.kind` is `task-notification`, or a
native `attachment` has `type: queued_command` and `commandMode: task-notification`,
and the expected task fields are valid. The shared native input reader normalizes
the latter to a user-shaped delivery with `origin.delivery: absorbed_mid_turn`,
retaining its attachment UUID, payload, and timestamp. Queue enqueue/remove records
are bookkeeping and do not create a second delivery. `/thread` places standalone
notifications and their continuation in the bubble owning the launch tool.
An absorbed batch instead starts an independent assistant turn at its consumption
position, containing the batch's notifications followed by the main assistant
continuation. The first attachment UUID supplies the stable `task-turn:<uuid>` ID.
Consecutive attachments share that turn; a later batch after assistant activity
starts another. The earlier response remains complete in its original bubble.
Native record order determines consumption order; attachment timestamps may precede
the tool result after which they were consumed and must not reorder the blocks.
A real human message starts an independent bubble and clears the reply target.
User-authored XML stays visible. Pi custom
notification metadata provides the equivalent provenance, including grouped
agent notifications. The host never sends Claude's XML back to the model.

A system `task_notification` changes lifecycle state; it does not establish that
the model consumed the result. The installed Claude SDK omits synthetic user
messages from the live stream, even with replay-user-messages enabled. Before
the first main assistant frame, the runtime incrementally reads the native JSONL
records appended since query startup and resolves that assistant's input
context. Only validated native deliveries in the two supported forms generate
`task.delivered`. Streaming and history use the same mapper and reply tracker;
there is no additional prompt injection or host-generated model turn.

```text
system/task_notification -> task.notification -> update launch task state
native user/origin notice -> task.delivered -> notification block at launch bubble
                         -> replyTo         -> main assistant stream to same bubble
                                                     |
                                               next notification / reply
queued_command task attachment -> task.delivered + turnId -> complete earlier bubble
                                                        -> new turn: batch notifications
main assistant continuation    -> replyTo.turnId         -> append to that new turn
notification click -> Workspace -> matching Agent -> Output (native result)
real user message -> independent run and assistant bubble
```

Delivery UUIDs are deduplicated independently from task IDs. Consecutive
notifications consumed together contribute all their IDs to `replyTo`; one
combined assistant response is anchored after the last delivery. If they belong
to different launch bubbles, that response uses the last delivery's owner.
The Workspace Agent catalog joins notifications across the entire thread by
tool/task identity, including notifications in independent turns. Selecting an
older notification still displays that delivery's output after the agent resumes.
Subagent frames retain their `parentToolUseId` routing. Lifecycle-only events
never move a human reply. Reconnect snapshots contain the same notification
blocks and merged bubbles as the live stream.

Warm runtime limits and expiry protect background work and pending native result
delivery. Changing incompatible credentials or runtime options while background
work is active returns an explicit busy error. Claude uses native idle events
when available; SDK versions that do not emit them end replies at their native
result event. The installed SDK's live Bash probe used the latter path.

## Verification

From `services/agent-runner/ts/`:

```sh
npm run lint
npm run typecheck
npm test
npm run build
node --import tsx tests/fixtures/resources/pi-mcp-probe.ts dist/provider/pi/pi-resource-loader.js
```

Frontend commands are maintained in [the frontend guide](front-end-desgin.md).
Regression cases cover response/task independence, ordered snapshot replay,
origin validation, original-tool ownership, persisted terminal states, warm
runtime retention, native notification handoff, absorbed batches with intervening
human messages, live turn splitting and reconnect parity, and single Workflow delivery.
Live Claude checks exercise background Bash completion, another user message
during execution, independent stop, output preview, and reconnect.
