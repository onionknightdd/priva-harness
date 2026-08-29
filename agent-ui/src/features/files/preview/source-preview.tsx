import * as React from "react"
import { useTheme } from "next-themes"
import type { ThemedToken, TokensResult } from "shiki"
import { useTranslation } from "react-i18next"

import {
  highlightSource,
  type SourceHighlightTheme,
  type SourceLanguage,
} from "./shiki-highlighter"
import { getSourceLanguage } from "./source-language"

const sourceFrameClassName =
  "min-h-full min-w-0 w-full bg-muted/20 py-3 font-mono text-[13px] leading-6"
const sourceLineClassName =
  "grid grid-cols-[3.5rem_minmax(0,1fr)] px-3"
const SOURCE_LINE_HEIGHT = 24
const SOURCE_VISIBILITY_CHUNK_SIZE = 80

type HighlightedSource = {
  code: string
  language: SourceLanguage
  result: TokensResult
  theme: SourceHighlightTheme
}

function LineNumber({ value }: { value: number }) {
  return (
    <span
      aria-hidden="true"
      className="sticky left-0 z-10 select-none border-r bg-muted/95 pr-3 text-right text-muted-foreground/70"
    >
      {value}
    </span>
  )
}

function getTokenStyle(token: ThemedToken): React.CSSProperties {
  const fontStyle = token.fontStyle ?? 0
  const textDecorations: string[] = []

  if (fontStyle & 4) {
    textDecorations.push("underline")
  }

  if (fontStyle & 8) {
    textDecorations.push("line-through")
  }

  return {
    backgroundColor: token.bgColor,
    color: token.color,
    fontStyle: fontStyle & 1 ? "italic" : undefined,
    fontWeight: fontStyle & 2 ? 700 : undefined,
    textDecorationLine:
      textDecorations.length > 0
        ? textDecorations.join(" ")
        : undefined,
  }
}

function SourceVisibilityChunk({
  children,
  lineCount,
}: {
  children: React.ReactNode
  lineCount: number
}) {
  return (
    <div
      style={
        {
          contentVisibility: "auto",
          containIntrinsicSize: `auto ${lineCount * SOURCE_LINE_HEIGHT}px`,
        } satisfies React.CSSProperties
      }
    >
      {children}
    </div>
  )
}

function PlainSourceLines({ content }: { content: string }) {
  const lines = content.split("\n")

  return Array.from(
    {
      length: Math.ceil(lines.length / SOURCE_VISIBILITY_CHUNK_SIZE),
    },
    (_, chunkIndex) => {
      const start = chunkIndex * SOURCE_VISIBILITY_CHUNK_SIZE
      const chunk = lines.slice(start, start + SOURCE_VISIBILITY_CHUNK_SIZE)

      return (
        <SourceVisibilityChunk
          key={start}
          lineCount={chunk.length}
        >
          {chunk.map((line, index) => (
            <div key={start + index} className={sourceLineClassName}>
              <LineNumber value={start + index + 1} />
              <code className="break-words whitespace-pre-wrap pl-4">
                {line || "\u200b"}
              </code>
            </div>
          ))}
        </SourceVisibilityChunk>
      )
    }
  )
}

function HighlightedSourceLines({
  tokens,
}: {
  tokens: ThemedToken[][]
}) {
  return Array.from(
    {
      length: Math.ceil(tokens.length / SOURCE_VISIBILITY_CHUNK_SIZE),
    },
    (_, chunkIndex) => {
      const start = chunkIndex * SOURCE_VISIBILITY_CHUNK_SIZE
      const chunk = tokens.slice(
        start,
        start + SOURCE_VISIBILITY_CHUNK_SIZE
      )

      return (
        <SourceVisibilityChunk
          key={start}
          lineCount={chunk.length}
        >
          {chunk.map((line, index) => (
            <div key={start + index} className={sourceLineClassName}>
              <LineNumber value={start + index + 1} />
              <code className="break-words whitespace-pre-wrap pl-4">
                {line.length > 0
                  ? line.map((token, tokenIndex) => (
                      <span key={tokenIndex} style={getTokenStyle(token)}>
                        {token.content}
                      </span>
                    ))
                  : "\u200b"}
              </code>
            </div>
          ))}
        </SourceVisibilityChunk>
      )
    }
  )
}

export function SourcePreview({
  content,
  fileName,
}: {
  content: string
  fileName: string
}) {
  const { resolvedTheme } = useTheme()
  const { t } = useTranslation()
  const language = getSourceLanguage(fileName)
  const theme: SourceHighlightTheme =
    resolvedTheme === "dark" ? "github-dark" : "github-light"
  const label = t("filePreview.sourceLabel", { fileName })
  const [highlightedSource, setHighlightedSource] =
    React.useState<HighlightedSource | null>(null)

  React.useEffect(() => {
    if (!language) {
      setHighlightedSource(null)
      return
    }

    let active = true

    void highlightSource(content, language, theme)
      .then((result) => {
        if (!active) {
          return
        }

        React.startTransition(() => {
          setHighlightedSource({
            code: content,
            language,
            result,
            theme,
          })
        })
      })
      .catch((error: unknown) => {
        if (!active) {
          return
        }

        setHighlightedSource(null)
        console.error(
          `Shiki could not highlight ${fileName} as ${language}.`,
          error
        )
      })

    return () => {
      active = false
    }
  }, [content, fileName, language, theme])

  const currentHighlight =
    highlightedSource?.code === content &&
    highlightedSource.language === language &&
    highlightedSource.theme === theme
      ? highlightedSource.result
      : null

  return (
    <div
      role="region"
      aria-label={label}
      className={sourceFrameClassName}
      data-highlighted={currentHighlight ? "true" : undefined}
      data-language={language ?? undefined}
      style={{ color: currentHighlight?.fg }}
    >
      {currentHighlight ? (
        <HighlightedSourceLines tokens={currentHighlight.tokens} />
      ) : (
        <PlainSourceLines content={content} />
      )}
    </div>
  )
}
