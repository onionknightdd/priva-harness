export type NotationDiffLineType = "added" | "removed" | "context"

export interface NotationDiffLine {
  type?: NotationDiffLineType
  content: string
}

type CommentStyle =
  | { kind: "line"; prefix: string }
  | { kind: "block"; start: string; end: string }

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "shellscript",
  cs: "csharp",
  dockerfile: "docker",
  htm: "html",
  js: "javascript",
  kt: "kotlin",
  makefile: "make",
  md: "markdown",
  mjs: "javascript",
  objc: "objective-c",
  py: "python",
  rs: "rust",
  sh: "shellscript",
  shell: "shellscript",
  ts: "typescript",
  yml: "yaml",
  zsh: "shellscript",
}

function canonicalLanguage(language: string): string {
  const id = language.trim().toLowerCase()
  return LANGUAGE_ALIASES[id] ?? id
}

function commentStyleForLanguage(language: string): CommentStyle | null {
  const id = canonicalLanguage(language)

  if (
    id === "text" ||
    id === "plain" ||
    id === "ansi" ||
    id === "txt" ||
    id === "diff"
  ) {
    return null
  }

  if (id === "sql" || id === "lua" || id === "haskell") {
    return { kind: "line", prefix: "--" }
  }

  if (
    id === "html" ||
    id === "xml" ||
    id === "vue" ||
    id === "svelte" ||
    id === "astro" ||
    id === "markdown" ||
    id === "svg"
  ) {
    return { kind: "block", start: "<!--", end: "-->" }
  }

  if (id === "css" || id === "scss" || id === "less" || id === "sass") {
    return { kind: "block", start: "/*", end: "*/" }
  }

  if (
    id === "python" ||
    id === "yaml" ||
    id === "toml" ||
    id === "shellscript" ||
    id === "docker" ||
    id === "make" ||
    id === "ini" ||
    id === "r" ||
    id === "ruby" ||
    id === "perl" ||
    id === "elixir" ||
    id === "graphql" ||
    id === "hcl" ||
    id === "terraform" ||
    id === "dotenv" ||
    id === "cmake" ||
    id === "properties" ||
    id === "nginx"
  ) {
    return { kind: "line", prefix: "#" }
  }

  // TSX/JSX also use //: a trailing `{/* [!code ++] */}` can tokenize as a
  // comment-only line and be dropped by transformerNotationDiff.
  return { kind: "line", prefix: "//" }
}

function notationMarker(type: NotationDiffLineType | undefined): string | null {
  if (type === "added") {
    return "[!code ++]"
  }
  if (type === "removed") {
    return "[!code --]"
  }
  return null
}

function renderComment(style: CommentStyle, marker: string): string {
  if (style.kind === "line") {
    return `${style.prefix} ${marker}`
  }
  return `${style.start} ${marker} ${style.end}`
}

function appendComment(content: string, comment: string): string {
  if (/\[!code\s+(?:\+\+|--)]/.test(content)) {
    return content
  }
  if (content.endsWith(" ")) {
    return `${content}${comment}`
  }
  return `${content} ${comment}`
}

function highlightLanguageFor(
  language: string,
  hasMarkers: boolean
): string {
  const id = canonicalLanguage(language)
  if (hasMarkers && id === "json") {
    return "jsonc"
  }
  return language.trim() === "" ? "text" : language
}

export function toNotationDiffSource(
  lines: NotationDiffLine[],
  language: string
): { code: string; language: string; hasMarkers: boolean } {
  const style = commentStyleForLanguage(language)
  if (style === null) {
    return {
      code: lines.map((line) => line.content).join("\n"),
      language: highlightLanguageFor(language, false),
      hasMarkers: false,
    }
  }

  let hasMarkers = false
  const marked = lines.map((line) => {
    const marker = notationMarker(line.type)
    if (marker === null || line.content.trim() === "") {
      return line.content
    }
    hasMarkers = true
    return appendComment(line.content, renderComment(style, marker))
  })

  return {
    code: marked.join("\n"),
    language: highlightLanguageFor(language, hasMarkers),
    hasMarkers,
  }
}
