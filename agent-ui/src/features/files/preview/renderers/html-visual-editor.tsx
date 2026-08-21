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
  htmlDocumentCanvasCss,
  mergeExportedCss,
  readHtmlDocument,
  serializeEditedHtmlDocument,
  type HtmlDocumentParts,
} from "../html-document"
import { grapesjsI18n, type GrapesjsI18nConfig } from "./grapesjs-i18n"

const SOURCE_STYLE_ATTR = "data-priva-source-css"

// GrapesJS renders the page wrapper as a DIV inside the iframe body. Page
// CSS targeting html/body must paint the iframe body, and the wrapper should
// inherit that paint. Keep the rest of the default frame chrome.
const CANVAS_FRAME_STYLE = `
  body { background-color: transparent; margin: 0; }
  [data-gjs-type="wrapper"] {
    background: inherit;
    color: inherit;
    min-height: 100vh;
  }
  * ::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.1) }
  * ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2) }
  * ::-webkit-scrollbar { width: 10px }
`

const HTML_COLOR_PALETTE = [
  ["#000000", "#444444", "#666666", "#999999", "#cccccc", "#ffffff"],
  ["#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#0000ff"],
  ["#f44336", "#e91e63", "#9c27b0", "#3f51b5", "#2196f3", "#4caf50"],
  ["#ffc107", "#ff9800", "#795548", "#607d8b", "#d278c9", "#3b97e3"],
]

const TRANSPARENT_COLORS = new Set([
  "",
  "transparent",
  "rgba(0, 0, 0, 0)",
  "rgba(0,0,0,0)",
])

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

function isPaintedBackground(style: CSSStyleDeclaration) {
  const image = style.backgroundImage
  const color = style.backgroundColor
  return (
    (Boolean(image) && image !== "none") ||
    (Boolean(color) && !TRANSPARENT_COLORS.has(color))
  )
}

function collectMirroredRootCss(rules: CSSRuleList): string {
  const chunks: string[] = []

  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      const mirrored = rule.selectorText
        .split(",")
        .map((selector) => selector.trim())
        .filter(
          (selector) =>
            /^(?:html|body)(?:$|[\s.#[:>+~])/.test(selector) ||
            /(?:^|[\s>+~])(?:html|body)(?:$|[\s.#[:>+~])/.test(selector)
        )
        .map((selector) =>
          selector
            .replace(
              /(^|[\s>+~])html(?=$|[\s.#[:>+~])/g,
              '$1[data-gjs-type="wrapper"]'
            )
            .replace(
              /(^|[\s>+~])body(?=$|[\s.#[:>+~])/g,
              '$1[data-gjs-type="wrapper"]'
            )
        )

      if (mirrored.length > 0) {
        chunks.push(`${mirrored.join(", ")} { ${rule.style.cssText} }`)
      }
      continue
    }

    if (rule instanceof CSSMediaRule) {
      const inner = collectMirroredRootCss(rule.cssRules)

      if (inner) {
        chunks.push(`@media ${rule.conditionText} {\n${inner}\n}`)
      }
    }
  }

  return chunks.join("\n")
}

function mirrorRootSelectorsOntoWrapper(css: string) {
  if (!css.trim()) {
    return ""
  }

  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(css)
    return collectMirroredRootCss(sheet.cssRules)
  } catch {
    return ""
  }
}

function canvasCssForDocument(document: HtmlDocumentParts) {
  const cssText = htmlDocumentCanvasCss(document)
  return [cssText, mirrorRootSelectorsOntoWrapper(cssText)]
    .filter(Boolean)
    .join("\n")
}

function copyRootPaintToWrapper(canvasDocument: Document) {
  const wrapper = canvasDocument.querySelector<HTMLElement>(
    '[data-gjs-type="wrapper"]'
  )
  const view = canvasDocument.defaultView

  if (!wrapper || !view) {
    return
  }

  const painted = [canvasDocument.body, canvasDocument.documentElement]
    .map((element) => view.getComputedStyle(element))
    .find(isPaintedBackground)

  if (!painted) {
    return
  }

  wrapper.style.background = painted.background
  wrapper.style.backgroundColor = painted.backgroundColor
  wrapper.style.backgroundImage = painted.backgroundImage
  wrapper.style.backgroundSize = painted.backgroundSize
  wrapper.style.backgroundPosition = painted.backgroundPosition
  wrapper.style.backgroundRepeat = painted.backgroundRepeat
  wrapper.style.backgroundAttachment = painted.backgroundAttachment
  wrapper.style.color = painted.color
}

function paintCanvasIframe(editor: Editor, document: HtmlDocumentParts) {
  const canvasDocument = editor.Canvas.getDocument()

  if (!canvasDocument) {
    return
  }

  canvasDocument
    .querySelectorAll(`style[${SOURCE_STYLE_ATTR}]`)
    .forEach((node) => node.remove())

  const cssText = canvasCssForDocument(document)

  if (cssText) {
    const style = canvasDocument.createElement("style")
    style.setAttribute(SOURCE_STYLE_ATTR, "")
    style.textContent = cssText
    canvasDocument.body.append(style)
  }

  applyElementAttributes(
    canvasDocument.documentElement,
    document.htmlAttributes
  )
  applyElementAttributes(canvasDocument.body, document.bodyAttributes)
  copyRootPaintToWrapper(canvasDocument)
}

function syncWrapperFromDocument(editor: Editor, document: HtmlDocumentParts) {
  const wrapper = editor.getWrapper()

  if (!wrapper) {
    return
  }

  const { class: bodyClass, ...bodyAttributes } = document.bodyAttributes

  if (Object.keys(bodyAttributes).length > 0) {
    wrapper.addAttributes(bodyAttributes)
  }

  if (bodyClass) {
    wrapper.addClass(bodyClass)
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
      canvasCss: canvasCssForDocument(initialDocument),
      colorPicker: {
        appendTo: document.body,
        palette: HTML_COLOR_PALETTE,
        showPalette: true,
        showAlpha: true,
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

  const handleEditor = React.useCallback(
    (editor: Editor) => {
      editor.on("canvas:frame:load:body", () => {
        paintCanvasIframe(editor, initialDocument)
      })
    },
    [initialDocument]
  )

  const handleReady = React.useCallback(
    (editor: Editor) => {
      syncWrapperFromDocument(editor, initialDocument)
      paintCanvasIframe(editor, initialDocument)
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
        editor.getHtml({ asDocument: true }),
        mergeExportedCss(
          htmlDocumentCanvasCss(initialDocument),
          editor.getCss({ keepUnusedStyles: true, avoidProtected: true }) ??
            ""
        ),
        initialDocument
      )
    )
  }, [initialDocument])

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
        onEditor={handleEditor}
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
