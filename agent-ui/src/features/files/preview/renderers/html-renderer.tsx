import * as React from "react"
import { useTranslation } from "react-i18next"

const PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "style-src 'unsafe-inline'",
].join("; ")

const SECURITY_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CONTENT_SECURITY_POLICY}">`

function createPreviewDocument(content: string) {
  if (/<head(?:\s[^>]*)?>/i.test(content)) {
    return content.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${SECURITY_META}`)
  }

  if (/<html(?:\s[^>]*)?>/i.test(content)) {
    return content.replace(
      /<html(?:\s[^>]*)?>/i,
      (html) => `${html}<head>${SECURITY_META}</head>`
    )
  }

  return `<!doctype html><html><head>${SECURITY_META}</head><body>${content}</body></html>`
}

export function HtmlRenderer({
  content,
  fileName,
}: {
  content: string
  fileName: string
}) {
  const { t } = useTranslation()
  const previewDocument = React.useMemo(
    () => createPreviewDocument(content),
    [content]
  )

  return (
    <iframe
      className="block size-full border-0 bg-white"
      referrerPolicy="no-referrer"
      sandbox=""
      srcDoc={previewDocument}
      title={t("filePreview.htmlFrameTitle", { fileName })}
    />
  )
}
