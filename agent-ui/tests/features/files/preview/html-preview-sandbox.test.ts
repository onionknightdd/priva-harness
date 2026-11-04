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

  it("installs the picker before page scripts without allowing a script closing tag to escape", () => {
    const nonce = "01234567-89ab-cdef-0123-456789abcdef"
    const document = createHtmlPreviewDocument(
      '<html><head><script>window.pageLoaded = true</script></head><body>Body</body></html>',
      { nonce, code: 'window.example = "</script><script>untrusted()</script>"' }
    )
    assert.ok(document.indexOf("Content-Security-Policy") < document.indexOf("data-html-assist-nonce"))
    assert.ok(document.indexOf("data-html-assist-nonce") < document.indexOf("window.pageLoaded"))
    assert.ok(document.includes('<\\/script><script>untrusted()<\\/script>'))
    assert.throws(() => createHtmlPreviewDocument("Body", { nonce: '\" onclick=\"oops', code: "" }))
  })
})
