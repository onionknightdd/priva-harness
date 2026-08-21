import zh from "grapesjs/locale/zh.mjs"

export type GrapesjsI18nConfig = {
  detectLocale: false
  locale: string
  localeFallback: string
  messages?: Record<string, unknown>
}

export function grapesjsI18n(language?: string): GrapesjsI18nConfig {
  if (language?.toLowerCase().startsWith("zh")) {
    return {
      detectLocale: false,
      locale: "zh",
      localeFallback: "en",
      messages: { zh },
    }
  }

  return {
    detectLocale: false,
    locale: "en",
    localeFallback: "en",
  }
}
