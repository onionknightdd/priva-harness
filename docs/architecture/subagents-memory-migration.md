# Subagents / Memory migration

This migration adapts the old Python runner's subagent and memory endpoints to
the current TypeScript resource service. The legacy URL shapes and user-workspace
directory migration code are not retained.

```text
Selected harness + optional cwd
              |
              v
 /api/sandbox/resource/{subagents,memory}
              |
       ResourceService contract
              |
       LocalResourceService
         /             \
 SubagentCatalog    MemoryCatalog
         \             /
  Native source discovery + versioned file writes

Subagent test --> AgentHarness.run --> selected provider --> SSE AgentEvent frames
                    |
              fresh runtime, disposed after test
```

## Packages and runtime

- Claude Agent SDK: installed `0.3.250` (Claude CLI `2.1.250`). Runs explicitly
  enable the `user`, `project`, and `local` settings sources.
- Pi SDK: installed `0.84.2`.
- Pi subagents: pinned `@tintinweb/pi-subagents@0.19.0`.
- Pi automatic memory: pinned `pi-code@1.0.64`, only its memory extension is
  activated. The package requires Node `>=22.19`, now reflected by the runner.
- Existing `pi-dynamic-workflows` remains the host's workflow implementation.
  Tintin supplies subagent tools; its `SubagentWorkflow` tool and startup workflow
  flag are not registered. Its own collision detector does not recognize the
  lowercase `workflow` name used by the existing implementation.

The runner relocates each harness's global directory below its configured
runtime home. A global source therefore means `CLAUDE_CONFIG_DIR` or
`PI_CODING_AGENT_DIR`, not necessarily the default directories in the OS home.

## Source semantics

Subagent listings preserve declarations before resolving overrides. IDs include
the harness, source and file, so same-named global/project agents stay separate.
`source.level` preserves native labels; `source.scope` remains the common
global/project/local storage field used by the existing resource contract.

| Harness | Sources, low to high precedence |
| --- | --- |
| Claude | Installed plugin agents (namespaced), user agents, project ancestor agents, current project agents |
| Pi | Package default agents, global `agents`, project `.agents/agents`, project `.pi/agents` |

Pi built-ins and shared `.agents/agents` declarations are read-only, following
the plugin. Plugin agent declarations are also read-only. The catalog uses the
installed Tintin frontmatter parser, including its UTF-8 BOM handling.

With `cwd`, `effective` identifies the winning enabled declaration. Without it,
the response includes known projects and reports `effective: null`: a global
declaration can be overridden in one project and active in another.

Project enumeration reuses session discovery and the runner's active directory.
An explicit existing absolute `cwd` can be queried even before a session exists.
Listing does not start a model session, install packages, or recursively crawl
all working-tree files. File contents load on demand; subagent contents needed
for metadata are cached against inode, nanosecond timestamps and size.

## Memory

```text
Claude                              Pi
  User CLAUDE.md / rules               Global context file
  Ancestor/project/local files         Ancestor/project context files
  Managed CLAUDE.md                    (native SDK candidate precedence)
  Project automatic memory            Project automatic memory (pi-code)
  Per-agent user/project/local        Per-agent user/project/local (Tintin)
```

Pi instruction discovery calls the SDK's `loadProjectContextFiles`, preserving
its candidate precedence and linked-worktree handling. Other context candidates
in those directories remain visible as inactive entries. A missing global or
project instruction has an editable empty entry.

The automatic memory store is project-scoped even when physically inside the
harness's global directory. Pi uses pi-code's repository/worktree resolver and
its hashed project slug. Claude uses the installed SDK's project-key encoding,
including the long-path hash, with a repository-root key. Trusted non-project
Claude `autoMemoryDirectory` overrides are considered separately because Claude
ignores this override in checked-in project settings.

This endpoint is a configuration-file inventory, not a snapshot of a running
session's context. Conditional rules, nested lazy-loaded instruction files and
`@import` expansion remain the harness's responsibility. Claude's built-in agent
prompts are not file-backed and are not synthesized into editable resources.

Pi's memory configuration is independent of Claude, as selected for this app:

| Setting | Claude | Pi |
| --- | --- | --- |
| Global settings | `CLAUDE_CONFIG_DIR/settings.json` | `PI_CODING_AGENT_DIR/settings.json` |
| Project toggle writes | Highest native local settings path | `<cwd>/.pi/settings.json` |
| Environment override | `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | `PI_CODE_DISABLE_AUTO_MEMORY` |
| Managed policy | Native SDK settings cascade | Not applicable |

The Pi adapter substitutes only pi-code's configuration dependencies. Its
memory tool, index limits, prompting and lifecycle use the installed extension.
The memory extension is omitted when disabled. Host-only factories are not added
to on-disk package settings, so Tintin children do not automatically inherit the
main conversation's host memory extension; their `memory` field selects their
own store.

Tintin's source modules assume a single CLI working directory and contain a
module-level agent registry. Each host session receives a separate Jiti module
graph and lexical `process.cwd()` binding. This does not change the server's
working directory. Module transformation also maps legacy Pi AI imports to the
current SDK compatibility entry point. Package versions are pinned and the
adapter is exercised against the installed source, including concurrent project
factories and production compilation.

## HTTP contract

Every endpoint uses `?harness=claude|pi`; `cwd` is optional for browsing and
required for changing a project's memory toggle. New source creation uses a
`sourceId` obtained from a listing, including empty writable source groups.

| Method | `/api/sandbox/resource` path | Body / result |
| --- | --- | --- |
| GET | `/subagents` | Grouped metadata, diagnostics, known projects |
| GET | `/subagents/catalog` | Native tools, fields, memory scopes, model hint |
| GET | `/subagents/:id` | Definition, prompt, source, revision |
| POST | `/subagents` | `{sourceId, definition, prompt}` |
| PATCH | `/subagents/:id` | `{definition, prompt, revision}` |
| DELETE | `/subagents/:id` | `{revision}` |
| POST | `/subagents/:id/test/stream` | `{prompt, model?}`; SSE frames |
| GET | `/memory` | Grouped files plus project automatic-memory controls |
| GET | `/memory/:id` | Content, source, revision |
| PATCH | `/memory/:id` | `{content, revision}` |
| DELETE | `/memory/:id` | `{revision}`; existing automatic/agent memory only |
| PUT | `/memory/auto/enabled` | `{enabled}` |

Changing a subagent's `definition.name` renames its runtime identity while
retaining the file and resource ID. Advanced frontmatter is preserved; known
fields using the other harness's naming convention are rejected.

Mutation requests check the revision and use atomic file replacement. Stale
edits return 409, linked files/directories are read-only, and duplicate creation
returns 409. Successful edits invalidate warm runtimes through the existing
resource-change mechanism. Current turns finish with their current configuration.

The test endpoint validates the selected definition in the test project's
effective registry before running. It uses the existing model profile and
harness event pipeline, disposes the test runtime afterward, and aborts it when
the response stream closes. Like the legacy test, it delegates by prompt through
the real Agent tool; actual model behavior is not replaced by a synthetic reply.

## UI integration status

The browser API client and incremental SSE decoder are implemented. Layout
implementation is pending the required wireframe approval in
[the frontend design rules](../front-end-desgin.md#layout-approval).
The proposed desktop layout uses a source rail and editor, with a collapsible
subagent test pane. Mobile navigates from the rail to the editor and opens test
output in a sheet. Components and transitions will reuse the existing resource
pages, shadcn primitives and Motion.

## Verification

From `services/agent-runner/ts`: `npm run lint`, `npm run typecheck`, `npm test`,
and `npm run build`.

Focused tests cover source precedence, native field names, source identity,
CRUD/rename, stale edits, symlinks, independent memory settings, shared
repository memory, package loading, isolated project factories, and SSE routes.
HTTP test runs use a fake model provider; a paid live model request is not part
of this verification.

From the repository root, the browser streaming decoder tests run with:

```sh
./services/agent-runner/ts/node_modules/.bin/tsx --test agent-ui/tests/features/resources/agent-resource-api.test.ts
```
