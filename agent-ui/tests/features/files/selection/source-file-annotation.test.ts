import assert from "node:assert/strict"
import { test } from "node:test"
import { JSDOM } from "jsdom"

import { readSourceFileAnnotation } from "../../../../src/features/files/selection/source-file-annotation.ts"

function fixture() {
  const dom = new JSDOM(`<div id="surface"><div><span>1</span><code data-source-line="1"><span>alpha</span><span> beta</span></code></div><div><span>2</span><code data-source-line="2">\u200b</code></div><div><span>3</span><code data-source-line="3">gamma\u200b</code></div></div>`)
  const surface = dom.window.document.getElementById("surface")!
  const codes = surface.querySelectorAll("code")
  return { dom, surface, codes, range: dom.window.document.createRange(), content: "alpha beta\r\n\r\ngamma\u200b" }
}

test("source annotations preserve partial token lines and original text without gutters or empty-line placeholders", () => {
  const { dom, surface, codes, range, content } = fixture()
  try {
    range.setStart(codes[0].firstChild!.firstChild!, 2)
    range.setEnd(codes[2].firstChild!, 3)
    assert.deepEqual(readSourceFileAnnotation(surface, range, "/test.txt", content), {
      kind: "text", filePath: "/test.txt", lineNum: "L1-L3", selectedText: "pha beta\r\n\r\ngam",
    })
    range.selectNodeContents(codes[2])
    assert.deepEqual(readSourceFileAnnotation(surface, range, "/test.txt", content), {
      kind: "text", filePath: "/test.txt", lineNum: "L3-L3", selectedText: "gamma\u200b",
    })
  } finally {
    dom.window.close()
  }
})

test("an endpoint at the next line's offset zero preserves the newline without including that line", () => {
  const { dom, surface, codes, range, content } = fixture()
  try {
    range.setStart(codes[0].firstChild!.firstChild!, 2)
    range.setEnd(codes[2].firstChild!, 0)
    assert.deepEqual(readSourceFileAnnotation(surface, range, "/test.txt", content), {
      kind: "text", filePath: "/test.txt", lineNum: "L1-L2", selectedText: "pha beta\r\n\r\n",
    })
    range.collapse(true)
    assert.equal(readSourceFileAnnotation(surface, range, "/test.txt", content), null)
    range.selectNodeContents(codes[1])
    assert.equal(readSourceFileAnnotation(surface, range, "/test.txt", content), null)
  } finally {
    dom.window.close()
  }
})
