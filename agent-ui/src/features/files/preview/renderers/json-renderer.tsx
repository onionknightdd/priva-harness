import { useTranslation } from "react-i18next"

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

function JsonNode({ name, value }: { name?: string; value: JsonValue }) {
  if (Array.isArray(value)) {
    return (
      <div className="space-y-2">
        {name && <div className="font-medium">{name}</div>}
        <div className="space-y-2 border-l pl-4">
          {value.map((item, index) => (
            <JsonNode key={index} name={String(index)} value={item} />
          ))}
        </div>
      </div>
    )
  }

  if (value !== null && typeof value === "object") {
    return (
      <div className="space-y-2">
        {name && <div className="font-medium">{name}</div>}
        <div className="space-y-2 border-l pl-4">
          {Object.entries(value).map(([key, item]) => (
            <JsonNode key={key} name={key} value={item} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-4">
      <span className="font-medium text-foreground">{name}</span>
      <span className="break-all text-muted-foreground">
        {value === null ? "null" : String(value)}
      </span>
    </div>
  )
}

export function JsonRenderer({ content }: { content: string }) {
  const { t } = useTranslation()

  try {
    const value = JSON.parse(content) as JsonValue

    return (
      <div className="mx-auto w-full max-w-3xl space-y-2 p-5 text-sm sm:p-8">
        <JsonNode value={value} />
      </div>
    )
  } catch {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {t("filePreview.invalidJson")}
      </div>
    )
  }
}
