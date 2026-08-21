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
  htmlDocumentRootCss,
  readHtmlDocument,
  serializeEditedHtmlDocument,
  type HtmlDocumentParts,
} from "../html-document"
import { grapesjsI18n, type GrapesjsI18nConfig } from "./grapesjs-i18n"

// GrapesJS paints a white iframe body before user CSS. That hides page
// backgrounds from the loaded HTML. Keep the rest of the default frame chrome.
const CANVAS_FRAME_STYLE = `
  body { background-color: transparent }
  * ::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.1) }
  * ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2) }
  * ::-webkit-scrollbar { width: 10px }
`

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

function applyElementAttributes(
  element: Element,
  attributes: Record<string, string>
) {
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "class") {
      for (const className of value.split(/\s+/).filter(Boolean)) {
        element.classList.add(className)
      }
      continue
    }

    if (name === "style") {
      const currentStyle = element.getAttribute("style")
      element.setAttribute(
        "style",
        currentStyle ? `${currentStyle};${value}` : value
      )
      continue
    }

    if (!element.hasAttribute(name)) {
      element.setAttribute(name, value)
    }
  }
}

function applyHtmlDocumentRoot(editor: Editor, document: HtmlDocumentParts) {
  const wrapper = editor.getWrapper()

  if (wrapper) {
    const { class: bodyClass, ...bodyAttributes } = document.bodyAttributes

    if (Object.keys(bodyAttributes).length > 0) {
      wrapper.addAttributes(bodyAttributes)
    }

    if (bodyClass) {
      wrapper.addClass(bodyClass)
    }
  }

  if (document.css) {
    editor.Css.addRules(document.css)
  }

  const rootCss = htmlDocumentRootCss(document)

  if (rootCss) {
    editor.Css.addRules(rootCss)
  }

  const canvasDocument = editor.Canvas.getDocument()
  const canvasBody = editor.Canvas.getBody()

  if (canvasDocument) {
    applyElementAttributes(
      canvasDocument.documentElement,
      document.htmlAttributes
    )
  }

  if (canvasBody) {
    applyElementAttributes(canvasBody, document.bodyAttributes)
  }
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
  const initialDocument = React.useRef(readHtmlDocument(content)).current

  onChangeRef.current = onChange

  const options = React.useMemo<EditorConfig>(
    () => ({
      assetManager: {
        embedAsBase64: true,
        upload: false,
      },
      canvas: {
        frameStyle: CANVAS_FRAME_STYLE,
      },
      colorPicker: {
        appendTo: document.body,
      },
      components: initialDocument.html,
      height: "100%",
      i18n: locale,
      keepUnusedStyles: true,
      noticeOnUnload: false,
      parser: {
        optionsHtml: {
          allowScripts: false,
          detectDocument: true,
        },
      },
      storageManager: false,
      width: "100%",
    }),
    [initialDocument, locale]
  )

  const handleReady = React.useCallback(
    (editor: Editor) => {
      applyHtmlDocumentRoot(editor, initialDocument)
      editor.UndoManager.clear()
      editor.clearDirtyCount()
      acceptUpdatesRef.current = true
    },
    [initialDocument]
  )

  const handleUpdate = React.useCallback((_: unknown, editor: Editor) => {
    if (!acceptUpdatesRef.current || editor.getDirtyCount() === 0) {
      return
    }

    onChangeRef.current(
      serializeEditedHtmlDocument(
        editor.getHtml(),
        editor.getCss({ keepUnusedStyles: true }) ?? ""
      )
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
