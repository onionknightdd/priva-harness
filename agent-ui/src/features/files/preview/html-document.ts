export type SplitHtmlDocument = {
  css: string
  html: string
}

export function splitHtmlDocument(content: string): SplitHtmlDocument {
  const trimmed = content.trim()

  if (!trimmed) {
    return { css: "", html: "" }
  }

  const parsed = new DOMParser().parseFromString(trimmed, "text/html")
  const css = Array.from(parsed.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n")
    .trim()
  const body = parsed.body.cloneNode(true) as HTMLElement
  body.querySelectorAll("style").forEach((style) => style.remove())

  return {
    css,
    html: body.innerHTML.trim(),
  }
}

export function serializeHtmlDocument(html: string, css: string) {
  const styleBlock = css.trim()
    ? `  <style>\n${css.trim()}\n  </style>\n`
    : ""

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
${styleBlock}</head>
<body>
${html}
</body>
</html>
`
}
