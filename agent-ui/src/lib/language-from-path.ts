import { bundledLanguages } from "shiki"

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  astro: "astro",
  bash: "bash",
  bat: "bat",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  cmake: "cmake",
  coffee: "coffee",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  dart: "dart",
  diff: "diff",
  dockerfile: "docker",
  env: "dotenv",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  fs: "fsharp",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  groovy: "groovy",
  h: "c",
  hpp: "cpp",
  htm: "html",
  html: "html",
  hxx: "cpp",
  ini: "ini",
  ipynb: "json",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  m: "objective-c",
  markdown: "markdown",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  mm: "objective-cpp",
  mts: "typescript",
  php: "php",
  pl: "perl",
  prisma: "prisma",
  proto: "proto",
  ps1: "powershell",
  py: "python",
  pyw: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  sass: "sass",
  scala: "scala",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svelte: "svelte",
  svg: "xml",
  swift: "swift",
  tf: "terraform",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
  zsh: "bash",
}

const SPECIAL_FILE_LANGUAGES: Array<{ pattern: RegExp; language: string }> = [
  { pattern: /^dockerfile(?:\..+)?$/i, language: "docker" },
  { pattern: /^(?:gnu)?makefile$/i, language: "make" },
  { pattern: /^cmakelists\.txt$/i, language: "cmake" },
  { pattern: /^\.env(?:\..+)?$/i, language: "dotenv" },
  { pattern: /^\.(?:docker|git|npm)ignore$/i, language: "properties" },
  { pattern: /^\.npmrc$/i, language: "ini" },
  { pattern: /^\.editorconfig$/i, language: "ini" },
]

function fileNameFromPath(path: string): string {
  const trimmed = path.trim().replaceAll("\\", "/")
  return trimmed.split("/").at(-1) || trimmed
}

export function languageFromPath(path: string | undefined): string {
  if (path === undefined || path.trim() === "") {
    return "text"
  }

  const name = fileNameFromPath(path)
  const special = SPECIAL_FILE_LANGUAGES.find(({ pattern }) =>
    pattern.test(name)
  )?.language

  if (special !== undefined) {
    return special
  }

  const separator = name.lastIndexOf(".")
  if (separator <= 0 || separator === name.length - 1) {
    return "text"
  }

  const extension = name.slice(separator + 1).toLowerCase()
  const mapped = LANGUAGE_BY_EXTENSION[extension] ?? extension

  if (mapped === "text" || mapped === "plain" || mapped === "ansi") {
    return mapped
  }

  if (mapped in bundledLanguages) {
    return mapped
  }

  return "text"
}
