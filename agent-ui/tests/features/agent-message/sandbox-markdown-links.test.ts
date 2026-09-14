import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { defaultRemarkPlugins, Streamdown } from "streamdown"

import { remarkSandboxFileLinks, sandboxFilePath } from "../../../src/features/agent-message/sandbox-markdown-links.ts"

test("sandbox links decode local absolute paths once and preserve filename characters", () => {
  for (const [url, path] of [
    ["sandbox:/workspace/test.md", "/workspace/test.md"],
    ["sandbox:/mnt/data/测试文件.md", "/mnt/data/测试文件.md"],
    ["SANDBOX:/workspace/%E6%B5%8B%E8%AF%95%20file.md", "/workspace/测试 file.md"],
    ["sandbox:C:/workspace/test.md", "C:/workspace/test.md"],
    ["sandbox:C:\\workspace\\test.md", "C:/workspace/test.md"],
    ["sandbox:/workspace/100%25%20done%23%3F.md", "/workspace/100% done#?.md"],
    ["sandbox:/workspace/%252Ftest.md", "/workspace/%2Ftest.md"],
  ]) assert.equal(sandboxFilePath(url), path, url)
})

test("invalid schemes, authorities, relative paths and malformed encodings are rejected", () => {
  for (const url of [
    undefined, null, 1, {}, "", "/workspace/test.md", "https://example.com/test.md",
    "javascript:alert(1)", "data:text/html,test", " sandbox:/workspace/test.md",
    "sandbox:", "sandbox:test.md", "sandbox:../test.md", "sandbox:C:test.md",
    "sandbox://server/test.md", "sandbox:///workspace/test.md", "sandbox:\\\\server\\test.md",
    "sandbox:/%2Fserver/test.md", "sandbox:%2f%2fserver/test.md", "sandbox:/\\server/test.md",
    "sandbox:/workspace/%00test.md", "sandbox:/workspace/\ntest.md", "sandbox:/workspace/%7ftest.md",
    "sandbox:/workspace/%test.md", "sandbox:/workspace/%E6.md",
  ]) assert.equal(sandboxFilePath(url), null, String(url))
})

test("Markdown code examples stay literal in static and streaming rendering", () => {
  const markdown = "`[测试文件](sandbox:/workspace/test.md)`\n\n```text\n[测试文件](sandbox:/workspace/test.md)\n```"
  for (const mode of ["static", "streaming"] as const) {
    const html = renderToStaticMarkup(createElement(Streamdown, {
      mode,
      remarkPlugins: [...Object.values(defaultRemarkPlugins), remarkSandboxFileLinks],
      allowedTags: { "sandbox-file": ["url", "label"] },
    }, markdown))
    assert.ok(html.includes("[测试文件](sandbox:/workspace/test.md)"))
    assert.ok(!html.includes("<sandbox-file"))
    assert.ok(!html.includes("[blocked]"))
  }
})
