import type { Language } from "prism-react-renderer"

const sourceLanguageByExtension: Record<string, Language> = {
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cmake: "cmake",
  coffee: "coffeescript",
  cpp: "cpp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  hxx: "cpp",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  m: "objectivec",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  mdown: "markdown",
  mkd: "markdown",
  mjs: "javascript",
  mm: "objectivec",
  mts: "typescript",
  n4js: "n4js",
  py: "python",
  pyw: "python",
  re: "reason",
  regex: "regex",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  svg: "svg",
  swift: "swift",
  ts: "typescript",
  tsx: "tsx",
  webmanifest: "json",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
}

const specialSourceLanguageRules: Array<{
  language: Language
  pattern: RegExp
}> = [
  { pattern: /^dockerfile(?:\..+)?$/i, language: "docker" },
  { pattern: /^(?:gnu)?makefile(?:\..+)?$/i, language: "makefile" },
  { pattern: /^cmakelists\.txt$/i, language: "cmake" },
  { pattern: /^\.env(?:\..+)?$/i, language: "properties" },
  { pattern: /^\.(?:docker|git|npm)ignore$/i, language: "ignore" },
  { pattern: /^\.npmrc$/i, language: "ini" },
  { pattern: /^\.editorconfig$/i, language: "editorconfig" },
]

export function getSourceLanguage(fileName: string): Language | null {
  const name = fileName.split(/[\\/]/).at(-1) ?? ""
  const specialFileLanguage = specialSourceLanguageRules.find(({ pattern }) =>
    pattern.test(name)
  )?.language

  if (specialFileLanguage) {
    return specialFileLanguage
  }

  const extensionSeparatorIndex = name.lastIndexOf(".")

  if (
    extensionSeparatorIndex <= 0 ||
    extensionSeparatorIndex === name.length - 1
  ) {
    return null
  }

  const extension = name
    .slice(extensionSeparatorIndex + 1)
    .toLocaleLowerCase()

  return sourceLanguageByExtension[extension] ?? null
}
