"use client"

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useState,
} from "react"
import { transformerNotationDiff } from "@shikijs/transformers"
import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type ThemedTokenWithVariants,
} from "shiki"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

import { cn } from "@/lib/utils"

import "./agent-shiki.css"

export type AgentCodeLanguage = string

export const AGENT_SHIKI_LIGHT_THEME = "github-light-high-contrast"
export const AGENT_SHIKI_DARK_THEME = "github-dark-high-contrast"

const SPECIAL_LANGUAGES = new Set(["text", "plain", "ansi"])

const PRELOAD_LANGUAGE_CANDIDATES = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "jsonc",
  "html",
  "css",
  "scss",
  "markdown",
  "mdx",
  "python",
  "go",
  "rust",
  "java",
  "kotlin",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "swift",
  "sql",
  "yaml",
  "toml",
  "xml",
  "shellscript",
  "docker",
  "graphql",
  "vue",
  "svelte",
  "lua",
  "dart",
  "make",
  "ini",
  "diff",
] as const

const PRELOAD_LANGUAGES = PRELOAD_LANGUAGE_CANDIDATES.filter(
  (id) => id in bundledLanguages
) as BundledLanguage[]

const engine = createJavaScriptRegexEngine({ forgiving: true })
const notationDiffTransformer = transformerNotationDiff({
  matchAlgorithm: "v3",
})

let highlighterPromise: Promise<Highlighter> | undefined
const languageLoads = new Map<string, Promise<void>>()
const highlightCache = new Map<string, AgentShikiHighlight>()

type HastElement = {
  type: "element"
  tagName: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

type HastText = {
  type: "text"
  value: string
}

type HastNode = HastElement | HastText | { type: string }

export interface AgentShikiLine {
  className: string
  isAdd: boolean
  isRemove: boolean
  children: HastNode[]
}

export interface AgentShikiHighlight {
  key: string
  language: string
  code: string
  lines: AgentShikiLine[]
}

function isHastElement(node: unknown): node is HastElement {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as HastElement).type === "element" &&
    typeof (node as HastElement).tagName === "string"
  )
}

function isHastText(node: unknown): node is HastText {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as HastText).type === "text" &&
    typeof (node as HastText).value === "string"
  )
}

function classNameFromProperties(
  properties: Record<string, unknown> | undefined
): string {
  const value = properties?.className ?? properties?.class
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean).join(" ")
  }
  if (value == null || value === false) {
    return ""
  }
  return String(value)
}

function cssTextToStyle(cssText: string): CSSProperties {
  const style: Record<string, string> = {}
  for (const part of cssText.split(";")) {
    const declaration = part.trim()
    if (declaration === "") {
      continue
    }
    const colon = declaration.indexOf(":")
    if (colon === -1) {
      continue
    }
    const property = declaration.slice(0, colon).trim()
    const value = declaration.slice(colon + 1).trim()
    if (property === "" || value === "") {
      continue
    }
    const key = property.startsWith("--")
      ? property
      : property.replace(/-([a-z])/g, (_, letter: string) =>
          letter.toUpperCase()
        )
    style[key] = value
  }
  return style as CSSProperties
}

function hastPropertiesToReact(
  properties: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (properties === undefined) {
    return {}
  }

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (value == null || key === "key" || key === "children") {
      continue
    }
    if (key === "class" || key === "className") {
      result.className = classNameFromProperties(properties)
      continue
    }
    if (key === "style" && typeof value === "string") {
      result.style = cssTextToStyle(value)
      continue
    }
    if (key === "tabIndex" || key === "tabindex") {
      result.tabIndex = Number(value)
      continue
    }
    if (typeof value === "string" || typeof value === "number") {
      result[key] = value
    }
  }
  return result
}

function extractShikiLines(root: { children?: unknown[] }): AgentShikiLine[] {
  const pre = root.children?.find(
    (node): node is HastElement => isHastElement(node) && node.tagName === "pre"
  )
  const code = pre?.children?.find(
    (node): node is HastElement => isHastElement(node) && node.tagName === "code"
  )
  const lines: AgentShikiLine[] = []

  for (const child of code?.children ?? []) {
    if (!isHastElement(child) || child.tagName !== "span") {
      continue
    }
    const className = classNameFromProperties(child.properties)
    const classes = className.split(/\s+/).filter(Boolean)
    if (!classes.includes("line")) {
      continue
    }
    lines.push({
      className,
      isAdd: classes.includes("diff") && classes.includes("add"),
      isRemove: classes.includes("diff") && classes.includes("remove"),
      children: child.children ?? [],
    })
  }

  return lines
}

export function resolveAgentCodeLanguage(
  language: string
): BundledLanguage | "text" | "plain" | "ansi" | null {
  const id = language.trim().toLowerCase()
  if (id === "") {
    return null
  }
  if (id === "text" || id === "plain" || id === "ansi") {
    return id
  }
  if (id in bundledLanguages) {
    return id as BundledLanguage
  }
  return null
}

function getAgentHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      engine,
      langs: PRELOAD_LANGUAGES,
      themes: [AGENT_SHIKI_LIGHT_THEME, AGENT_SHIKI_DARK_THEME],
    })
  }
  return highlighterPromise
}

async function ensureLanguage(
  highlighter: Highlighter,
  language: BundledLanguage
) {
  if (highlighter.getLoadedLanguages().includes(language)) {
    return
  }

  let pending = languageLoads.get(language)
  if (!pending) {
    pending = highlighter.loadLanguage(language).finally(() => {
      languageLoads.delete(language)
    })
    languageLoads.set(language, pending)
  }

  await pending
}

function highlightCacheKey(
  code: string,
  language: string,
  notationDiff: boolean
) {
  return `${notationDiff ? "1" : "0"}\u0000${language}\u0000${code}`
}

export async function highlightAgentCode(
  code: string,
  language: AgentCodeLanguage,
  options?: { notationDiff?: boolean }
): Promise<AgentShikiHighlight | null> {
  const resolvedLanguage = resolveAgentCodeLanguage(language) ?? "text"
  const notationDiff = options?.notationDiff === true
  const key = highlightCacheKey(code, resolvedLanguage, notationDiff)
  const cached = highlightCache.get(key)
  if (cached) {
    return cached
  }

  const highlighter = await getAgentHighlighter()
  let lang: BundledLanguage | "text" | "plain" | "ansi" = resolvedLanguage

  if (!SPECIAL_LANGUAGES.has(lang)) {
    try {
      await ensureLanguage(highlighter, lang as BundledLanguage)
    } catch {
      lang = "text"
    }
  }

  const root = highlighter.codeToHast(code, {
    lang,
    themes: {
      light: AGENT_SHIKI_LIGHT_THEME,
      dark: AGENT_SHIKI_DARK_THEME,
    },
    defaultColor: false,
    transformers: notationDiff ? [notationDiffTransformer] : [],
  }) as { children?: unknown[] }

  const result: AgentShikiHighlight = {
    key,
    language: resolvedLanguage,
    code,
    lines: extractShikiLines(root),
  }
  highlightCache.set(key, result)
  return result
}

export function useAgentShikiHighlight(
  code: string,
  language: AgentCodeLanguage,
  options?: { notationDiff?: boolean }
) {
  const notationDiff = options?.notationDiff === true
  const resolvedLanguage = resolveAgentCodeLanguage(language) ?? "text"
  const key = highlightCacheKey(code, resolvedLanguage, notationDiff)
  const cached = highlightCache.get(key)
  const [result, setResult] = useState<AgentShikiHighlight | null>(
    cached ?? null
  )

  useEffect(() => {
    const current = highlightCache.get(key)
    if (current) {
      setResult(current)
      return
    }

    let cancelled = false

    highlightAgentCode(code, language, { notationDiff })
      .then((next) => {
        if (!cancelled) {
          setResult(next)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, key, language, notationDiff])

  if (result?.key === key) {
    return result
  }

  if (
    result !== null &&
    result.language === resolvedLanguage &&
    code.startsWith(result.code)
  ) {
    return result
  }

  return null
}

export function AgentShikiTokens({
  nodes,
  className,
}: {
  nodes: HastNode[]
  className?: string
}) {
  return (
    <span className={className}>
      {nodes.map((node, index) => (
        <HastNodeView key={index} node={node} />
      ))}
    </span>
  )
}

function HastNodeView({ node }: { node: HastNode }): ReactNode {
  if (isHastText(node)) {
    return node.value
  }
  if (!isHastElement(node)) {
    return null
  }
  return (
    <span {...hastPropertiesToReact(node.properties)}>
      {node.children?.map((child, index) => (
        <HastNodeView key={index} node={child} />
      ))}
    </span>
  )
}

export function AgentShikiLineContent({
  line,
  fallback,
  className,
}: {
  line?: AgentShikiLine
  fallback: string
  className?: string
}) {
  if (line === undefined) {
    return <span className={cn("line", className)}>{fallback}</span>
  }

  return (
    <AgentShikiTokens
      nodes={line.children}
      className={cn("line", line.className, className)}
    />
  )
}

export async function tokenizeAgentCode(
  code: string,
  language: AgentCodeLanguage
): Promise<ThemedTokenWithVariants[][] | null> {
  const resolvedLanguage = resolveAgentCodeLanguage(language)
  if (
    resolvedLanguage === null ||
    resolvedLanguage === "text" ||
    resolvedLanguage === "plain" ||
    resolvedLanguage === "ansi"
  ) {
    return null
  }

  const highlighter = await getAgentHighlighter()
  await ensureLanguage(highlighter, resolvedLanguage)
  return highlighter.codeToTokensWithThemes(code, {
    lang: resolvedLanguage,
    themes: {
      light: AGENT_SHIKI_LIGHT_THEME,
      dark: AGENT_SHIKI_DARK_THEME,
    },
  })
}
