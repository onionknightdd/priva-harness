import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  createHtmlPreviewDocument,
  HTML_PREVIEW_IFRAME,
} from "./html-preview-sandbox"

export function HtmlRenderer({
  content,
  fileName,
}: {
  content: string
  fileName: string
}) {
  const { t } = useTranslation()
  const previewDocument = React.useMemo(
    () => createHtmlPreviewDocument(content),
    [content]
  )

  return (
    <iframe
      className="block size-full border-0 bg-white"
      referrerPolicy={HTML_PREVIEW_IFRAME.referrerPolicy}
      sandbox={HTML_PREVIEW_IFRAME.sandbox}
      srcDoc={previewDocument}
      title={t("filePreview.htmlFrameTitle", { fileName })}
    />
  )
}
