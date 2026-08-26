"use client"

import {
  type CSSProperties,
  Fragment,
  useEffect,
  useState,
} from "react"

import {
  resolveAgentCodeLanguage,
  tokenizeAgentCode,
} from "@/components/agents/agent-shiki"
import { cn } from "@/lib/utils"

export type { AgentCodeLanguage } from "@/components/agents/agent-shiki"
export { resolveAgentCodeLanguage } from "@/components/agents/agent-shiki"

export interface AgentCodeToken {
  content: string
  offset: number
  light?: string
  dark?: string
}

export type AgentCodeTokenLines = AgentCodeToken[][]

export interface AgentCodeProps {
  code: string
  language?: string
  className?: string
}

export interface AgentCodeLineProps {
  code: string
  tokens?: AgentCodeToken[]
  className?: string
}

const tokenCache = new Map<string, AgentCodeTokenLines>()

function tokenCacheKey(code: string, language: string) {
  return `${language}\u0000${code}`
}

export function useAgentCodeTokens(code: string, language: string) {
  const resolvedLanguage = resolveAgentCodeLanguage(language)
  const key = tokenCacheKey(code, resolvedLanguage ?? "")
  const cached = resolvedLanguage ? tokenCache.get(key) : undefined
  const [result, setResult] = useState<{
    key: string
    code: string
    language: string
    lines: AgentCodeTokenLines
  } | null>(
    cached
      ? { key, code, language: resolvedLanguage ?? "", lines: cached }
      : null
  )

  useEffect(() => {
    if (!resolvedLanguage) {
      setResult(null)
      return
    }

    const current = tokenCache.get(key)

    if (current) {
      setResult({
        key,
        code,
        language: resolvedLanguage,
        lines: current,
      })
      return
    }

    let cancelled = false

    tokenizeAgentCode(code, resolvedLanguage)
      .then((tokens) => {
        if (cancelled || tokens === null) {
          if (!cancelled) {
            setResult(null)
          }
          return
        }

        const lines = tokens.map((line) =>
          line.map((token) => ({
            content: token.content,
            offset: token.offset,
            light: token.variants.light?.color,
            dark: token.variants.dark?.color,
          }))
        )

        tokenCache.set(key, lines)
        setResult({
          key,
          code,
          language: resolvedLanguage,
          lines,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setResult(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [code, key, resolvedLanguage])

  if (!resolvedLanguage) {
    return null
  }

  if (result?.key === key) {
    return result.lines
  }

  if (result?.language === resolvedLanguage && code.startsWith(result.code)) {
    return result.lines
  }

  return null
}

export function AgentCodeLine({
  code,
  tokens,
  className,
}: AgentCodeLineProps) {
  return (
    <span className={className}>
      {tokens
        ? tokens.map((token) => (
            <span
              key={`${token.offset}-${token.content}`}
              style={
                {
                  "--agent-code-light": token.light ?? "currentColor",
                  "--agent-code-dark":
                    token.dark ?? token.light ?? "currentColor",
                } as CSSProperties
              }
              className="text-[var(--agent-code-light)] dark:text-[var(--agent-code-dark)]"
            >
              {token.content}
            </span>
          ))
        : code}
    </span>
  )
}

export function AgentCode({
  code,
  language = "bash",
  className,
}: AgentCodeProps) {
  const tokens = useAgentCodeTokens(code, language)
  let offset = 0
  const lines = code.split("\n").map((content) => {
    const line = { content, offset }
    offset += content.length + 1
    return line
  })

  return (
    <pre
      className={cn(
        "m-0 overflow-x-auto whitespace-pre font-mono text-sm leading-5 text-foreground/85",
        className
      )}
    >
      <code>
        {lines.map((line, index) => (
          <Fragment key={line.offset}>
            <AgentCodeLine code={line.content} tokens={tokens?.[index]} />
            {index < lines.length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </code>
    </pre>
  )
}
