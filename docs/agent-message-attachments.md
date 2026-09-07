# Message attachments

Selecting files in the composer starts uploads immediately. The existing upload
queue reports progress and supports cancellation. Failed or canceled uploads can
be retried or removed in the composer. Sending is enabled only when every selected
file has uploaded successfully; an attachment-only message is valid.

```text
Composer -> upload queue -> POST /api/sandbox/files/upload
                               directory = current run cwd
                               purpose = attachment
                                      |
                                      v
                         .priva-attachments/file-<unique>/<original name>
                                      |
                                      v
Send -> frontend formats user text + Markdown attachment manifest
                                      |
                                      v
                         WebSocket init { text }
                                      |
                                      v
                         Claude / Pi native user message
                                      |
                                      v
                         transcript -> thread API -> frontend parses manifest
                                      |
                                      v
                         user message with attachments above original text

User message (narrow widths wrap or truncate the file labels):
+-------------------------------------------+
| [file report.csv] [file notes.txt]         |
|                                           |
| Please analyze the attached files.        |
+-------------------------------------------+
```

The file upload response retains `path`, `name`, and `size`. The composer keeps
these values and the MIME type as structured attachment data for display. Existing
uploads without `purpose` continue to write to their chosen directory; chat
attachments use unique subdirectories to preserve same-name files.

The frontend appends a fenced code block with language `AgentAttachments` after
the user's original text. Each file uses a Markdown list entry with its attributes
aligned using two-space indentation, and a blank line between files:

````text
Please analyze this file.

```AgentAttachments
- name: report.csv
  path: /workspace/.priva-attachments/file-unique/report.csv
  MIME: text/csv
  size: 1234 bytes
```
````

Backslashes and line breaks in attribute values are escaped so file names cannot
break the manifest structure. Other punctuation is literal inside the code block.
The WebSocket frame sends the formatted
`text` without a separate `attachments` field, so the existing backend forwards
ordinary text to the provider without adding another manifest. File bytes are not
embedded into the prompt; images and documents are inspected using the available
tools. The envelope remains in the native transcript for resume/fork.

The frontend uses Streamdown's Markdown block parser to recognize code blocks
whose language is exactly `AgentAttachments` when loading user messages from the
thread API, restoring the original body and structured attachments. Ordinary code
blocks and examples nested inside another code fence remain text. Assistant
messages are left intact. Invalid or incomplete manifests remain visible as ordinary text.
Session summaries have the manifest removed even if the provider flattened or
truncated the original prompt.

Attachment-only messages begin directly with the code fence and need no generated
user text. Claude's session index accepts this prefix, while XML-prefixed prompts
are skipped when deriving a session summary.

The UI displays file links above the user text and opens them in the existing
workspace preview. Sending clears the draft attachments. Changing the working
directory, harness, or existing session cancels pending draft uploads and clears
their local previews. Removing a draft attachment does not delete a completed
upload from disk; uploaded files remain workspace files so historical references
stay usable. Deleting those files later makes their historical links unavailable.

Verification commands:

- From `agent-ui/`: `npm run lint`, `npm run build`.
- From `agent-ui/`: `node --test tests/features/agent-message/composer-attachments.test.ts tests/features/agent-message/composer-primary-action.test.ts tests/features/agent-message/slash-command-envelope.test.ts`.
- From the repository root: `./services/agent-runner/ts/node_modules/.bin/tsx --tsconfig agent-ui/tsconfig.app.json --test agent-ui/tests/features/agent-message/message-attachments.test.ts`.
- From `services/agent-runner/ts/`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
