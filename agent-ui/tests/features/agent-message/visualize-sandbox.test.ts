import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { transform } from "sucrase"

import { completeJsxTag } from "../../../src/features/agent-message/visualize-sandbox/complete-jsx.ts"
import { escapeScriptText } from "../../../src/features/agent-message/visualize-sandbox/escape-script.ts"
import { isVisualizeSandboxMessage } from "../../../src/features/agent-message/visualize-sandbox/protocol.ts"
import {
  VISUALIZE_SANDBOX_CSP,
  VISUALIZE_SANDBOX_IFRAME,
} from "../../../src/features/agent-message/visualize-sandbox/sandbox-css.ts"
import { wrapVisualizeSource } from "../../../src/features/agent-message/visualize-sandbox/wrap-source.ts"

function compile(source: string) {
  return transform(wrapVisualizeSource(source), {
    transforms: ["typescript", "jsx"],
    jsxRuntime: "classic",
    production: true,
    filePath: "visualize.jsx",
  }).code
}

describe("wrapVisualizeSource", () => {
  it("wraps a JSX snippet in App", () => {
    const wrapped = wrapVisualizeSource("<button>Hi</button>")
    assert.match(wrapped, /function App\(\)/)
    assert.match(wrapped, /<button>Hi<\/button>/)
  })

  it("keeps an App function and strips imports", () => {
    const wrapped = wrapVisualizeSource(`
import { useState } from "react"
export default function App() {
  const [n, setN] = useState(0)
  return <button onClick={() => setN(n + 1)}>{n}</button>
}
`)
    assert.match(wrapped, /^function App\(\)/)
    assert.doesNotMatch(wrapped, /\bimport\b/)
    assert.doesNotMatch(wrapped, /\bexport\b/)
  })
})

describe("compileVisualizeJsx", () => {
  it("compiles interactive state into React.createElement", () => {
    const code = compile(`
function App() {
  const [n, setN] = useState(0)
  return <button onClick={() => setN(n + 1)}>{n}</button>
}
`)
    assert.match(code, /React\.createElement/)
    assert.match(code, /onClick/)
    assert.match(code, /useState/)
  })
})

describe("visualize sandbox security", () => {
  it("uses a tight CSP and does not enable eval or same-origin", () => {
    assert.match(VISUALIZE_SANDBOX_CSP, /connect-src 'none'/)
    assert.match(VISUALIZE_SANDBOX_CSP, /form-action 'none'/)
    assert.match(VISUALIZE_SANDBOX_CSP, /script-src 'unsafe-inline'/)
    assert.doesNotMatch(VISUALIZE_SANDBOX_CSP, /unsafe-eval/)
    assert.equal(VISUALIZE_SANDBOX_IFRAME.sandbox, "allow-scripts")
    assert.doesNotMatch(VISUALIZE_SANDBOX_IFRAME.sandbox, /same-origin/)
  })

  it("escapes user script that would break out of the HTML script tag", () => {
    const embedded = `<script>${escapeScriptText('const html = "</script><script>steal()"')}</script>`
    assert.equal((embedded.match(/<\/script>/gi) ?? []).length, 1)
  })
})

describe("completeJsxTag", () => {
  it("closes an incomplete opening tag during streaming", () => {
    assert.equal(completeJsxTag("<div><span>hi"), "<div><span>hi</span></div>")
  })
})

describe("isVisualizeSandboxMessage", () => {
  it("accepts resize messages from the sandbox and rejects others", () => {
    assert.equal(
      isVisualizeSandboxMessage({
        source: "visualize-sandbox",
        kind: "resize",
        id: "a",
        height: 120,
      }),
      true
    )
    assert.equal(
      isVisualizeSandboxMessage({
        source: "other",
        kind: "resize",
        id: "a",
        height: 120,
      }),
      false
    )
  })
})
