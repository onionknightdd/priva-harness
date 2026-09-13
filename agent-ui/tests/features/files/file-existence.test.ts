import assert from "node:assert/strict"
import { test } from "node:test"

import {
  checkFileExists,
  peekFileExists,
  rememberFileExists,
} from "../../../src/features/files/file-existence.ts"

type Call = { url: string; paths: string[] }

function stubFetch(
  context: { mock: { method: typeof import("node:test").mock.method } },
  respond: (paths: string[]) => Response | Promise<Response>
) {
  const calls: Call[] = []
  context.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const paths = (JSON.parse(String(init?.body)) as { paths: string[] }).paths
    calls.push({ url: String(input), paths })
    return respond(paths)
  })
  return calls
}

test("checks requested in the same tick go out as one request", async (context) => {
  const calls = stubFetch(context, (paths) =>
    Response.json({ exists: Object.fromEntries(paths.map((path) => [path, path.endsWith(".ts")])) })
  )

  const [a, b, c] = await Promise.all([
    checkFileExists("/batch/one.ts"),
    checkFileExists("/batch/two.md"),
    checkFileExists("/batch/one.ts"),
  ])

  assert.deepEqual([a, b, c], [true, false, true])
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, "/api/sandbox/files/exists")
  assert.deepEqual(calls[0]?.paths, ["/batch/one.ts", "/batch/two.md"], "duplicates share one entry")
  assert.equal(peekFileExists("/batch/one.ts"), true)
  assert.equal(peekFileExists("/batch/two.md"), false)
})

test("cached and remembered paths never reach the network", async (context) => {
  const calls = stubFetch(context, () => Response.json({ exists: {} }))
  rememberFileExists("/cached/known.ts", true)

  assert.equal(await checkFileExists("/cached/known.ts"), true)
  assert.equal(await checkFileExists(""), false)
  assert.equal(calls.length, 0)
})

test("a failed request reports every path in the batch as missing", async (context) => {
  const calls = stubFetch(context, () => Response.json({ detail: "boom" }, { status: 500 }))

  const results = await Promise.all([
    checkFileExists("/failed/a.ts"),
    checkFileExists("/failed/b.ts"),
  ])

  assert.deepEqual(results, [false, false])
  assert.equal(calls.length, 1)
})

test("batches larger than the server limit are split", async (context) => {
  const calls = stubFetch(context, (paths) =>
    Response.json({ exists: Object.fromEntries(paths.map((path) => [path, true])) })
  )
  const paths = Array.from({ length: 501 }, (_, index) => `/many/${index}.ts`)

  const results = await Promise.all(paths.map((path) => checkFileExists(path)))

  assert.ok(results.every(Boolean))
  assert.deepEqual(calls.map((call) => call.paths.length), [500, 1])
})
