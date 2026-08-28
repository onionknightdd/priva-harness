import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  createHtmlPreviewDocument,
  HTML_PREVIEW_CSP,
  HTML_PREVIEW_IFRAME,
} from "../../../../src/features/files/preview/renderers/html-preview-sandbox.ts"

describe("HTML preview sandbox", () => {
  it("allows inline scripts without eval, network, or same-origin", () => {
    assert.match(HTML_PREVIEW_CSP, /script-src 'unsafe-inline'/)
    assert.match(HTML_PREVIEW_CSP, /connect-src 'none'/)
    assert.match(HTML_PREVIEW_CSP, /form-action 'none'/)
    assert.doesNotMatch(HTML_PREVIEW_CSP, /unsafe-eval/)
    assert.equal(HTML_PREVIEW_IFRAME.sandbox, "allow-scripts")
    assert.doesNotMatch(HTML_PREVIEW_IFRAME.sandbox, /same-origin/)
  })

  it("injects the preview CSP into complete HTML documents", () => {
    const document = createHtmlPreviewDocument(
      "<!doctype html><html><head><title>Deck</title></head><body><button>Go</button></body></html>"
    )
    assert.match(document, /Content-Security-Policy/)
    assert.match(document, /script-src 'unsafe-inline'/)
    assert.match(document, /<button>Go<\/button>/)
  })
})
