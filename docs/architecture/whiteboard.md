# Whiteboard

Agent Workspace has a dedicated Whiteboard tab that streams the complete React
Flow canvas. Live whiteboard writes open that tab; historical tool cards open
it on click, without disclosure or embedded canvas expansion. The file preview
also renders `*.board.json` with React Flow. Claude and Pi
create and edit boards using `whiteboard_read` and `whiteboard_write`; users can
move, resize, edit text and table cells, delete elements, and operate embedded
apps. This implements the approved Agent-first editing scope. Manual creation,
pen input, undo/redo, and multiplayer cursors are not included.

```text
Claude SDK / Claude native MCP / Pi SDK / Pi native
                whiteboard_read / whiteboard_write
                              |
                    Runner HTTP bridge
                              v
                      WhiteboardService <---- WebSocket ----> Workspace
                  validate -> serialize -> write              React Flow
                              |                               Whiteboard tab
                              v
           .whiteboard/<sessionId>/<name>.board.json
```

The Runner owns the writer. Native providers run tools in separate processes;
`PRIVA_WHITEBOARD_ENDPOINT_FILE` identifies the Runner's local endpoint discovery
file and is propagated into their launch environments. Tools reread discovery
on every call so surviving terminals can reconnect after a Runner restart. They
never write board files themselves.

## File and operations

A board is `{v:1,title,revision,order,elements}`. `elements` maps stable IDs to
records; `order` contains every ID once. Coordinates are canvas units; children
use positions relative to their `parentId` container. All positioned elements
require `x`, `y`, `w`, `h`.

| Type | Additional fields |
| --- | --- |
| shape | `kind`: rect, rounded, pill, ellipse, diamond, hexagon, parallelogram, database, queue, document, cloud, person |
| text / container | `text` |
| arrow | `from`, `to`: node ID or `{x,y}`; optional sides and label |
| table | `columns: string[]`, `rows: string[][]` |
| html | `html`, optional JSON `state` |
| image | `src`: HTTP(S) or image data URL; optional `alt` |
| stroke | `points: [number,number][]`, optional `width` |

Positioned elements also accept `text`, `color`, and `parentId`. Colors are plain,
blue, green, amber, rose, violet, and gray. An SVG image is supplied as an image
data URL, not inserted into the host document.

The write tool requires `path` and `ops`, a JSON-encoded array (matching product
tools' string argument convention), plus optional `title` and JSON `claim`.
The Runner resolves every tool path under the current session's board directory,
`<cwd>/.whiteboard/<sessionId>/`. The Agent chooses a meaningful filename from
the board's content topic, such as `login-flow.board.json`, and explicitly passes
it on creation. Subsequent edits reuse that path. There is no default filename;
missing, empty, or whitespace-only paths are rejected. A short path such as `flow.board.json` or
`diagrams/flow.board.json` is relative to that directory. The workspace-relative
`.whiteboard/<sessionId>/...` form and returned absolute paths are also accepted,
provided they remain inside the current session's directory. Paths for another
session, legacy `.canvas` paths, and traversal outside the session directory are
rejected. Existing files are not moved or migrated.

The session ID comes from the tool's current session context on every call; the
Agent does not supply it as a tool argument. Switching or rebinding a session
therefore changes the board directory, even when the same filename is reused.

```text
workspace/
  .whiteboard/
    session-a/
      login-flow.board.json
      data-model.board.json
    session-b/
      login-flow.board.json
```

```json
{
  "path": "flow.board.json",
  "title": "Data flow",
  "ops": "[{\"op\":\"set\",\"id\":\"store\",\"element\":{\"type\":\"shape\",\"kind\":\"database\",\"x\":80,\"y\":80,\"w\":180,\"h\":120,\"color\":\"green\",\"text\":\"Data\"}}]"
}
```

Operations are `set` with a complete `element`, `update` with only changed fields
in `patch`, and `delete`. All operations in one batch are validated together;
invalid references or table rows reject the whole batch. Changes to different
fields merge against the current board. The latest accepted write wins for the
same field. There is no whole-board replacement API.

Writes are serialized per canonical path, saved using a temporary file, synced,
and atomically renamed before broadcasting. Deleting a node also deletes its
attached arrows. Deleting a container preserves its children at their absolute
positions, reparenting them to the enclosing container where applicable.
Tool paths must remain within the current session's directory in the supplied
workspace; symlink escapes and symlink board files are rejected.
Limits: 500 operations per batch, 2,000 elements,
4 MiB per board. Direct edits with file tools do not generate live events;
Agents must use the whiteboard tools.

## Live protocol and context

`POST /api/sandbox/whiteboards/read` accepts `{path,cwd,sessionId}` and returns the board,
resolved path, viewer context, and claims. The write endpoint accepts
`{path,cwd,sessionId,owner,ops,title?,claim?}` and returns `{path,board}`. These are internal
single-user sandbox endpoints, not an additional public Agent API.

`POST /api/sandbox/whiteboards/list` accepts only `{cwd,sessionId}` and returns
`{files:[{name,path}]}`. It recursively lists `.board.json` files within that
session, with basename labels and canonical absolute paths, sorted by name and
path. Missing directories return an empty list without creating anything. Root
symlinks are rejected; descendant symlinks and non-board files are skipped.

`/api/sandbox/whiteboards/stream?path=...` (optional `cwd`) emits a `snapshot`
followed by revisioned `change` messages containing final `order`, `ops`, title,
and `source` (`agent` or `user`). Client writes carry `{type:"write",requestId,ops}`;
the server returns `ack` or `error`. A subscription may precede file creation: it receives an empty revision-zero
snapshot without writing anything, then live changes when the Agent creates
the board. Reconnection starts with a fresh snapshot.
The UI reports errors and does not replay unacknowledged edits automatically.

Live navigation uses the event's current session ID and workspace to resolve the
same session-relative tool path before the first write finishes. Without a
session ID or an explicit valid path it waits instead of inventing a directory
or filename.
The Workspace remembers one selected path per harness/session/workspace scope
in memory. Multiple boards within a session use different filenames; there is
no board-list registry. History restores the most recent valid path without
changing the active tab. Switching paths reconnects the viewer to that file.
The top-left filename menu reads the session directory through the list endpoint.
Visible filename labels omit the trailing `.json`; selection still uses the full path.
It refreshes on scope/path changes, menu opening, and the first persisted revision
received for a path; the revision-zero placeholder does not consume that refresh.
Stale requests are aborted and ignored. Without an existing selection, Workspace
opens the first listed file; user selections do not replay drawing. Loading or
failed files keep the filename menu available so another file can be selected.

```text
Open -> snapshot -> changes -> disconnect -> reconnect -> fresh snapshot
User edit -> write(requestId) -> validation/save -> change + ack
Selection / viewport / layout issues -> context -> whiteboard_read
Agent claim -> presence -> work-area rectangle -> clear or expire
Filename menu -> current session directory -> selected path -> new viewer socket
```

Claims are temporary work rectangles (`id,label,x,y,w,h`), renewed by the Agent
and cleared with the JSON string `null`. They expire after 60 seconds. Viewer
context is scoped to its socket and removed when it disconnects.

## Visuals and embedded applications

The approved sample establishes stronger pastel fills, sharp edges, top lighting
and elevation. Database top caps and queue end caps retain their ellipse borders.
Agent additions draw their outlines and paths, then reveal fills and text;
Historical snapshots and user adjustments do not replay the drawing sequence.
Connectors use deterministic Rough.js pen paths: aligned ports have a gentle
curve, and same-side ports keep their return route. The arrowhead and label
appear as the drawing reaches them. Freehand point samples use D3's centripetal
Catmull–Rom interpolation, preserving smooth underlines, circles, and waves
instead of turning the samples into zigzags.
A newly opened live-tool view can animate its first snapshot when creation
finished before the viewer subscribed; reconnecting never replays it.
Reduced motion displays the complete result immediately.
All drawing animations play at two-thirds speed (50% longer), keeping paths,
fills, arrowheads, labels and the drawing-presence frame synchronized.

While a new element is actually drawing, a transient viewport overlay surrounds
it with a light blue (`rgb(96,165,250)`) dashed frame, a matching fill at 6% opacity,
and an attached upper-left tab labelled `Bambuddy`. The tab text is white in
light mode and `#071e40` in dark mode. The overlay does not intercept interaction.
Node frames sit outside clipped HTML/table content; connector frames include
their complete curve and opaque label. The overlay follows the canvas viewport.

```text
New Agent element cue
  -> first CSS animation starts -> frame + Bambuddy tab
  -> all element animations finish -> remove frame and cue
```

Completion follows the actual CSS animation lifecycle, including portal-rendered
connector labels and staggered table rows. There is no fixed cleanup timeout.
Queued elements do not show a frame before drawing starts. Removing an element,
resetting the board, cancelling animations, or enabling reduced motion removes
the presentation state. The drawing frames are client-only and are separate
from the Agent's 60-second work-area claims; neither is persisted in board JSON.

Embedded applications use an opaque-origin `allow-scripts` iframe, a restrictive
CSP, and no network access. The API is `window.whiteboard.state`,
`window.whiteboard.setState(next)`, and `window.whiteboard.subscribe(listener)`.
Only messages from that element's iframe and channel update its persisted state.

## PNG and PDF export

The download menu follows the delete action. Export clones the current viewport
into an isolated, inert stage, strips drawing/selection overlays, and renders the
completed elements without advancing the live animations or changing zoom/pan.
The stage retains React Flow's ancestor class so connector SVG overflow and
positioning remain intact. Bounds include negative coordinates, overflowing
shapes, strokes, connector paths and labels, with 32 pixels of padding.
Tables retain their current internal scroll position and displayed dimensions.

```text
Download PNG / PDF
  -> clone final element state + capture sandboxed HTML
  -> measure complete content bounds + padding
  -> rasterize PNG
       -> PNG download
       -> fit to one custom-sized PDF page -> PDF download
```

HTML elements snapshot their own current DOM through a separate
`priva-whiteboard-export` request/response channel. The parent checks iframe
identity and request ID and replaces each cloned iframe with its PNG before
mounting the clone. The existing opaque-origin sandbox and CSP remain in force.
Missing images, iframe failures and timeouts surface as export errors instead
of silently producing partial files. The temporary stage and capture contexts
are cleaned up after success or failure.

Raster output uses up to 2× resolution, bounded by 8,192 pixels per side and
32 million total pixels. PDF uses the same complete image on a single page with
the canvas aspect ratio, uniformly scaled to the 14,400-point page limit when
needed. It does not split elements across fixed paper pages. Both formats use
the current board's basename with `.png` or `.pdf` replacing `.board.json`.
