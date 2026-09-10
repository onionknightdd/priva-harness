import assert from "node:assert/strict"
import { test } from "node:test"
import { createInstance } from "i18next"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { I18nextProvider, initReactI18next } from "react-i18next"

import { previewResponseToFile } from "../../../src/features/file-browser/file-browser-data.ts"
import { checkFileExists } from "../../../src/features/files/file-existence.ts"
import {
  canEditHtmlFile,
  canRenderFile,
  canShowFileSource,
} from "../../../src/features/files/model/file.types.ts"
import { PreviewRequestState } from "../../../src/features/files/preview/preview-request-state.tsx"
import { en } from "../../../src/i18n/locales/en.ts"
import { zhCN } from "../../../src/i18n/locales/zh-CN.ts"
import { getDownloadUrl, type FilePreviewResponse } from "../../../src/lib/api/sandbox-files.ts"

function preview(overrides: Partial<FilePreviewResponse> = {}): FilePreviewResponse {
  return {
    path: "/workspace/report.txt",
    name: "report.txt",
    mime_type: "text/plain",
    size: 4,
    content: "text",
    is_binary: false,
    preview_url: null,
    preview_error: null,
    ...overrides,
  }
}

test("successful text previews retain their content, including empty files", () => {
  for (const content of ["text", ""]) {
    const file = previewResponseToFile(preview({ content, size: content.length }))
    assert.equal(file.status, "ready")
    assert.equal(file.content, content)
    assert.equal(file.previewError, undefined)
    assert.equal(canShowFileSource(file), true)
  }
})

test("oversized text reports a preview error and cannot fall through to a renderer", () => {
  for (const name of ["report.txt", "report.html", "report.md", "report.json", "report.csv"]) {
    const file = previewResponseToFile(preview({
      name,
      path: `/workspace/${name}`,
      size: 3 * 1024 * 1024 + 1,
      content: null,
      preview_error: "too-large",
    }))
    assert.equal(file.status, "error")
    assert.equal(file.previewError, "too-large")
    assert.equal(file.content, undefined)
    assert.equal(file.renderSource, undefined)
    assert.equal(canShowFileSource(file), false)
    assert.equal(canRenderFile(file), false)
    assert.equal(canEditHtmlFile(file), false)
    assert.ok(getDownloadUrl(file.path).includes("/download?path="))
  }
})

test("large image and PDF previews retain their download-backed renderer", () => {
  for (const [name, mimeType, kind] of [["image.png", "image/png", "image"], ["document.pdf", "application/pdf", "pdf"]]) {
    const source = getDownloadUrl(`/workspace/${name}`)
    const file = previewResponseToFile(preview({ name, mime_type: mimeType, size: 4 * 1024 * 1024, content: null, preview_url: source }))
    assert.equal(file.status, "ready")
    assert.equal(file.renderKind, kind)
    assert.equal(file.renderSource, source)
    assert.equal(file.previewError, undefined)
  }
})

test("binary files keep the unsupported state instead of a size error", () => {
  const file = previewResponseToFile(preview({ name: "file.bin", content: null, is_binary: true }))
  assert.equal(file.status, "ready")
  assert.equal(file.previewError, undefined)
  assert.equal(canShowFileSource(file), false)
  assert.equal(canRenderFile(file), false)
})

test("oversized files still exist for message file links", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json(preview({ content: null, preview_error: "too-large" })))
  assert.equal(await checkFileExists("/workspace/oversized-existing.txt"), true)
})

test("the preview error renders the oversized-content message in both languages", async () => {
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: zhCN }, en: { translation: en } },
  })
  for (const [language, message] of [["zh-CN", "内容过大，无法预览"], ["en", "Content is too large to preview"]]) {
    await i18n.changeLanguage(language)
    const html = renderToStaticMarkup(
      createElement(I18nextProvider, { i18n },
        createElement(PreviewRequestState, { reason: "too-large" })
      )
    )
    assert.ok(html.includes(message))
    assert.ok(html.includes("3 MiB"))
    assert.ok(html.includes('role="alert"'))
  }
})
