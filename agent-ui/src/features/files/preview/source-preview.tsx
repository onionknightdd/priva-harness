import { useTranslation } from "react-i18next"

export function SourcePreview({
  content,
  fileName,
}: {
  content: string
  fileName: string
}) {
  const { t } = useTranslation()
  const lines = content.split("\n")

  return (
    <div
      role="region"
      aria-label={t("filePreview.sourceLabel", { fileName })}
      className="min-h-full min-w-max bg-muted/20 py-3 font-mono text-[13px] leading-6"
    >
      {lines.map((line, index) => (
        <div
          key={`${index}-${line}`}
          className="grid grid-cols-[3.5rem_minmax(max-content,1fr)] px-3"
        >
          <span
            aria-hidden="true"
            className="sticky left-0 select-none border-r bg-muted/20 pr-3 text-right text-muted-foreground/70"
          >
            {index + 1}
          </span>
          <code className="whitespace-pre pl-4">{line || "\u200b"}</code>
        </div>
      ))}
    </div>
  )
}
