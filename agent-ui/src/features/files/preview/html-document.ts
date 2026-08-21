export type HtmlDocumentParts = {
  bodyAttributes: Record<string, string>
  css: string
  html: string
  htmlAttributes: Record<string, string>
}

const DOCUMENT_ROOT_PATTERN = /<!doctype|<html[\s>]|<body[\s>]/i

export function readHtmlDocument(content: string): HtmlDocumentParts {
  const parsed = new DOMParser().parseFromString(content.trim(), "text/html")
  const css = Array.from(parsed.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n")
    .trim()

  return {
    bodyAttributes: namedElementAttributes(parsed.body),
    css,
    html: serializeDocument(parsed),
    htmlAttributes: namedElementAttributes(parsed.documentElement),
  }
}

export function htmlDocumentRootCss(document: HtmlDocumentParts) {
  const rules: string[] = []
  const htmlStyle = document.htmlAttributes.style

  if (htmlStyle) {
    rules.push(`html { ${htmlStyle} }`)
  }

  const bodyDeclarations = bodyStyleDeclarations(document.bodyAttributes)

  if (bodyDeclarations.length > 0) {
    rules.push(`body { ${bodyDeclarations.join("; ")} }`)
  }

  return rules.join("\n")
}

export function htmlDocumentCanvasCss(document: HtmlDocumentParts) {
  return [document.css, htmlDocumentRootCss(document)]
    .filter(Boolean)
    .join("\n")
}

export function serializeEditedHtmlDocument(html: string, css: string) {
  const parsed = new DOMParser().parseFromString(
    toParsableHtmlDocument(html),
    "text/html"
  )
  const trimmedCss = css.trim()

  parsed.querySelectorAll("style").forEach((style) => style.remove())

  if (trimmedCss) {
    const style = parsed.createElement("style")
    style.textContent = `\n${trimmedCss}\n`
    parsed.head.append(style)
  }

  if (!parsed.querySelector("meta[charset]")) {
    const charset = parsed.createElement("meta")
    charset.setAttribute("charset", "utf-8")
    parsed.head.prepend(charset)
  }

  return serializeDocument(parsed)
}

function toParsableHtmlDocument(html: string) {
  const trimmed = html.trim()

  if (!trimmed) {
    return "<!DOCTYPE html><html><head></head><body></body></html>"
  }

  if (DOCUMENT_ROOT_PATTERN.test(trimmed)) {
    return trimmed
  }

  return `<!DOCTYPE html><html><head></head><body>${trimmed}</body></html>`
}

function serializeDocument(doc: Document) {
  const name = doc.doctype?.name ?? "html"
  return `<!DOCTYPE ${name}>\n${doc.documentElement.outerHTML}\n`
}

function namedElementAttributes(element: Element) {
  const attributes: Record<string, string> = {}

  for (const attribute of element.attributes) {
    if (attribute.name.startsWith("data-gjs-")) {
      continue
    }

    attributes[attribute.name] = attribute.value
  }

  return attributes
}

function bodyStyleDeclarations(attributes: Record<string, string>) {
  const declarations: string[] = []
  const inlineStyle = attributes.style ?? ""

  if (inlineStyle) {
    declarations.push(inlineStyle)
  }

  if (
    attributes.bgcolor &&
    !/background(?:-color)?\s*:/i.test(inlineStyle)
  ) {
    declarations.push(`background-color: ${attributes.bgcolor}`)
  }

  if (
    attributes.background &&
    !/background(?:-image)?\s*:/i.test(inlineStyle)
  ) {
    const backgroundUrl = attributes.background.replaceAll('"', "%22")
    declarations.push(`background-image: url("${backgroundUrl}")`)
  }

  return declarations
}
