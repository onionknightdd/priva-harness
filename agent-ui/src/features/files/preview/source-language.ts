import type { SourceLanguage } from "./shiki-highlighter"

const sourceLanguageByExtension: Record<string, SourceLanguage> = {
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cmake: "cmake",
  coffee: "coffee",
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
  ini: "ini",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  m: "objective-c",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  mdown: "markdown",
  mkd: "markdown",
  mjs: "javascript",
  mm: "objective-cpp",
  mts: "typescript",
  n4js: "javascript",
  properties: "properties",
  py: "python",
  pyw: "python",
  re: "ocaml",
  regex: "regexp",
  rs: "rust",
  sh: "shellscript",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  ts: "typescript",
  tsx: "tsx",
  webmanifest: "json",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shellscript",
}

const specialSourceLanguageRules: Array<{
  language: SourceLanguage
  pattern: RegExp
}> = [
  { pattern: /^dockerfile(?:\..+)?$/i, language: "docker" },
  { pattern: /^(?:gnu)?makefile(?:\..+)?$/i, language: "make" },
  { pattern: /^cmakelists\.txt$/i, language: "cmake" },
  { pattern: /^\.env(?:\..+)?$/i, language: "dotenv" },
  {
    pattern: /^\.(?:docker|git|npm)ignore$/i,
    language: "properties",
  },
  { pattern: /^\.npmrc$/i, language: "ini" },
  { pattern: /^\.editorconfig$/i, language: "ini" },
]

export function getSourceLanguage(
  fileName: string
): SourceLanguage | null {
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
