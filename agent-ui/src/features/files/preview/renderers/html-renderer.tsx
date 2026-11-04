import * as React from "react"
import { useTranslation } from "react-i18next"
import runtimeCode from "virtual:html-assist-runtime"

import { HtmlAssistOverlay } from "../../html-assist/html-assist-overlay"
import { useHtmlAssist } from "../../html-assist/use-html-assist"
import { createHtmlPreviewDocument, HTML_PREVIEW_IFRAME } from "./html-preview-sandbox"

export function HtmlRenderer({ fileId, content, fileName }: { fileId: string; content: string; fileName: string }) {
  const { t } = useTranslation()
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const document = React.useMemo(() => {
    const nonce = "html-" + crypto.randomUUID()
    return { fileId, nonce, source: createHtmlPreviewDocument(content, { code: runtimeCode, nonce }) }
  }, [content, fileId])
  const assist = useHtmlAssist({ fileId, content, nonce: document.nonce, iframeRef, menuRef })

  return (
    <div className="relative h-full min-h-0 overflow-hidden" data-html-assist-ready={assist.ready}>
      <iframe key={document.fileId} ref={iframeRef} className="block size-full border-0 bg-white"
        referrerPolicy={HTML_PREVIEW_IFRAME.referrerPolicy} sandbox={HTML_PREVIEW_IFRAME.sandbox}
        srcDoc={document.source} title={t("filePreview.htmlFrameTitle", { fileName })} data-html-assist-frame />
      <HtmlAssistOverlay state={assist} iframeRef={iframeRef} menuRef={menuRef} />
    </div>
  )
}
