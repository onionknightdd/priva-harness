import * as React from "react"
import GjsEditor from "@grapesjs/react"
import grapesjs, {
  type Editor,
  type EditorConfig,
  type Plugin,
  type PluginOptions,
} from "grapesjs"
import blocksBasicModule from "grapesjs-blocks-basic"
import { useTranslation } from "react-i18next"

import "grapesjs/dist/css/grapes.min.css"

import { cn } from "@/lib/utils"

import {
  serializeHtmlDocument,
  splitHtmlDocument,
} from "../html-document"
import { grapesjsI18n, type GrapesjsI18nConfig } from "./grapesjs-i18n"

function grapesPluginFromCjs<Options extends PluginOptions>(
  module: unknown
): Plugin<Options> {
  let current = module

  // grapesjs-blocks-basic ships a UMD CJS build whose `module.exports` is
  // `{ default: plugin }`, so Vite's default import is an object, not a function.
  while (current && typeof current === "object" && "default" in current) {
    current = (current as { default: unknown }).default
  }

  if (typeof current !== "function") {
    throw new Error("grapesjs-blocks-basic did not export a plugin function")
  }

  return current as Plugin<Options>
}

const blocksBasic = grapesPluginFromCjs<{ flexGrid?: boolean }>(
  blocksBasicModule
)

function htmlBlocksPlugin(editor: Editor) {
  blocksBasic(editor, { flexGrid: true })
}

function HtmlVisualEditorSession({
  content,
  fileName,
  locale,
  onChange,
}: {
  content: string
  fileName: string
  locale: GrapesjsI18nConfig
  onChange: (content: string) => void
}) {
  const { t } = useTranslation()
  const acceptUpdatesRef = React.useRef(false)
  const onChangeRef = React.useRef(onChange)
  const initialDocument = React.useRef(splitHtmlDocument(content)).current

  onChangeRef.current = onChange

  const options = React.useMemo<EditorConfig>(
    () => ({
      assetManager: {
        embedAsBase64: true,
        upload: false,
      },
      components: initialDocument.html,
      height: "100%",
      i18n: locale,
      noticeOnUnload: false,
      storageManager: false,
      style: initialDocument.css,
      width: "100%",
    }),
    [initialDocument, locale]
  )

  const handleReady = React.useCallback((editor: Editor) => {
    editor.UndoManager.clear()
    editor.clearDirtyCount()
    acceptUpdatesRef.current = true
  }, [])

  const handleUpdate = React.useCallback((_: unknown, editor: Editor) => {
    if (!acceptUpdatesRef.current || editor.getDirtyCount() === 0) {
      return
    }

    onChangeRef.current(
      serializeHtmlDocument(editor.getHtml(), editor.getCss() ?? "")
    )
  }, [])

  return (
    <div
      className={cn(
        "file-html-visual-editor h-full min-h-0 overflow-hidden"
      )}
    >
      <GjsEditor
        className="h-full min-h-0"
        grapesjs={grapesjs}
        options={options}
        plugins={[htmlBlocksPlugin]}
        onReady={handleReady}
        onUpdate={handleUpdate}
        aria-label={t("filePreview.htmlEditorTitle", { fileName })}
      />
    </div>
  )
}

export function HtmlVisualEditor({
  content,
  fileName,
  onChange,
}: {
  content: string
  fileName: string
  onChange: (content: string) => void
}) {
  const { i18n } = useTranslation()
  const locale = React.useMemo(
    () => grapesjsI18n(i18n.resolvedLanguage),
    [i18n.resolvedLanguage]
  )

  return (
    <HtmlVisualEditorSession
      key={locale.locale}
      content={content}
      fileName={fileName}
      locale={locale}
      onChange={onChange}
    />
  )
}
