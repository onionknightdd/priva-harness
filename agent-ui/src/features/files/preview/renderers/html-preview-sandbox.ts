export const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
].join("; ")

export const HTML_PREVIEW_IFRAME = {
  sandbox: "allow-scripts",
  referrerPolicy: "no-referrer" as const,
}

const SECURITY_META = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`

export function createHtmlPreviewDocument(content: string, runtime?: { code: string; nonce: string }) {
  if (runtime && !/^[a-zA-Z0-9-]{16,128}$/.test(runtime.nonce)) throw new Error("Invalid HTML assist channel")
  const headContent = SECURITY_META + (runtime
    ? `<script data-html-assist-nonce="${runtime.nonce}">${runtime.code.replace(/<\/script/gi, "<\\/script")}</script>`
    : "")
  if (/<head(?:\s[^>]*)?>/i.test(content)) {
    return content.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${headContent}`)
  }

  if (/<html(?:\s[^>]*)?>/i.test(content)) {
    return content.replace(
      /<html(?:\s[^>]*)?>/i,
      (html) => `${html}<head>${headContent}</head>`
    )
  }

  return `<!doctype html><html><head>${headContent}</head><body>${content}</body></html>`
}
