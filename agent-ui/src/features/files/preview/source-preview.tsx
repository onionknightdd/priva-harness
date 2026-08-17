import { useTheme } from "next-themes"
import { Highlight, themes } from "prism-react-renderer"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

import { Prism } from "./prism"
import { getSourceLanguage } from "./source-language"

const sourceFrameClassName =
  "min-h-full min-w-max bg-muted/20 py-3 font-mono text-[13px] leading-6"
const sourceLineClassName =
  "grid grid-cols-[3.5rem_minmax(max-content,1fr)] px-3"

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
  const label = t("filePreview.sourceLabel", { fileName })
  const isDark = resolvedTheme === "dark"
  const theme =
    language === "markdown"
      ? isDark
        ? themes.duotoneDark
        : themes.duotoneLight
      : isDark
        ? themes.vsDark
        : themes.github

  if (!language) {
    return (
      <div
        role="region"
        aria-label={label}
        className={sourceFrameClassName}
      >
        {content.split("\n").map((line, index) => (
          <div key={index} className={sourceLineClassName}>
            <LineNumber value={index + 1} />
            <code className="whitespace-pre pl-4">
              {line || "\u200b"}
            </code>
          </div>
        ))}
      </div>
    )
  }

  return (
    <Highlight
      prism={Prism}
      theme={theme}
      code={content}
      language={language}
    >
      {({
        getLineProps,
        getTokenProps,
        style,
        tokens,
      }) => (
        <div
          role="region"
          aria-label={label}
          className={sourceFrameClassName}
          style={{ color: style.color }}
        >
          {tokens.map((line, lineIndex) => {
            const {
              className: lineClassName,
              ...lineProps
            } = getLineProps({ line })

            return (
              <div
                key={lineIndex}
                {...lineProps}
                className={cn(sourceLineClassName, lineClassName)}
              >
                <LineNumber value={lineIndex + 1} />
                <code className="whitespace-pre pl-4">
                  {line.map((token, tokenIndex) => (
                    <span
                      key={tokenIndex}
                      {...getTokenProps({ token })}
                    />
                  ))}
                </code>
              </div>
            )
          })}
        </div>
      )}
    </Highlight>
  )
}
