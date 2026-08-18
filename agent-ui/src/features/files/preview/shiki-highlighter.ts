import type { TokensResult } from "shiki"
import {
  createBundledHighlighter,
  createSingletonShorthands,
} from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

const sourceLanguageLoaders = {
  c: () => import("@shikijs/langs/c"),
  cmake: () => import("@shikijs/langs/cmake"),
  coffee: () => import("@shikijs/langs/coffee"),
  cpp: () => import("@shikijs/langs/cpp"),
  css: () => import("@shikijs/langs/css"),
  docker: () => import("@shikijs/langs/docker"),
  dotenv: () => import("@shikijs/langs/dotenv"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  make: () => import("@shikijs/langs/make"),
  markdown: () => import("@shikijs/langs/markdown"),
  mdx: () => import("@shikijs/langs/mdx"),
  "objective-c": () => import("@shikijs/langs/objective-c"),
  "objective-cpp": () => import("@shikijs/langs/objective-cpp"),
  ocaml: () => import("@shikijs/langs/ocaml"),
  properties: () => import("@shikijs/langs/properties"),
  python: () => import("@shikijs/langs/python"),
  regexp: () => import("@shikijs/langs/regexp"),
  rust: () => import("@shikijs/langs/rust"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
} as const

const sourceThemeLoaders = {
  "github-dark": () => import("@shikijs/themes/github-dark"),
  "github-light": () => import("@shikijs/themes/github-light"),
} as const

export type SourceLanguage = keyof typeof sourceLanguageLoaders
export type SourceHighlightTheme = keyof typeof sourceThemeLoaders

const createSourceHighlighter = createBundledHighlighter({
  langs: sourceLanguageLoaders,
  themes: sourceThemeLoaders,
  engine: () => createJavaScriptRegexEngine(),
})

const { codeToTokens } = createSingletonShorthands(
  createSourceHighlighter
)

export function highlightSource(
  code: string,
  language: SourceLanguage,
  theme: SourceHighlightTheme
): Promise<TokensResult> {
  return codeToTokens(code, { lang: language, theme })
}
