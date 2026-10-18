# Harness API Reference — local preview

Desktop API reference for the proposed shared harness stream and A2A 1.0 interface.
All examples are synthetic. This site makes no model requests and changes no production interface.

```text
reference.json + stream.json
          |
          v
React reference pages / sequential fixture reducer
          |
          v
localhost browser: fields, examples, raw frames, accumulated components
```

## Run

From this directory:

```sh
npm ci
npm run dev -- --port 4176 --strictPort
```

Open http://127.0.0.1:4176/ . The host binds to loopback only.
The event player is at http://127.0.0.1:4176/#stream-playground .

## Verify

```sh
npm test
npm run build
```

Tests exercise atomic delta application, replay, deduplication, sequence gaps,
raw-event preservation, detached background output, documentation coverage,
field paths, and the JSON/SSE examples. They do not verify a live backend or
A2A client interoperability.

## Content

- `src/data/reference.json`: browsable documentation, based on [`../api/harness-http-api-reference.md`](../api/harness-http-api-reference.md).
- `src/data/stream.json`: 17 complete frames from the incremental proposal fixture.
- `src/lib/stream.mjs`: demonstration reducer; not a production wire-schema validator.
- `public/reference.md`, `public/session.sse`, `public/reconnect.sse`: downloadable reference and fixtures.
- `public/harness-stream-v3.schema.json`: previous full-component proposal, only retained for the source document's link; does not validate the new delta operations.

Foundational Button and Input components are reused from the repository's shadcn/ui primitives.
No hosting registration or deployment is configured. All materials for this proposal are indexed in [../README.md](../README.md).

## Field provenance

Every documented field carries explicit `provenance` metadata in `reference.json`:
`origin` (`a2a`, `harness`, or `transport`), `ref` into `provenanceSources`, and
optional `convention` / `note`. Platform conventions are a second dimension,
not an alternative field definition source. The renderer rejects missing
provenance. Keep badges, search/copy output and downloadable reference aligned.
These annotations never enter request/response payloads. Open JSON and native
harness payload contents retain their own provenance.
