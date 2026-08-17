import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import { en } from "./locales/en"
import { zhCN } from "./locales/zh-CN"

export type AppLanguage = "en" | "zh-CN"

const LANGUAGE_STORAGE_KEY = "agent-ui-language"
const UNAVAILABLE_STORAGE_ERRORS = new Set([
  "SecurityError",
  "QuotaExceededError",
])

function normalizeLanguage(language?: string | null): AppLanguage {
  return language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en"
}

function isUnavailableStorageError(error: unknown) {
  return (
    error instanceof DOMException &&
    UNAVAILABLE_STORAGE_ERRORS.has(error.name)
  )
}

function readStoredLanguage() {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  } catch (error) {
    if (isUnavailableStorageError(error)) {
      return null
    }

    throw error
  }
}

function storeLanguage(language: AppLanguage) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch (error) {
    if (!isUnavailableStorageError(error)) {
      throw error
    }
  }
}

function getInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") {
    return "en"
  }

  const storedLanguage = readStoredLanguage()
  return storedLanguage === "en" || storedLanguage === "zh-CN"
    ? storedLanguage
    : normalizeLanguage(window.navigator.language)
}

function syncDocumentLanguage(language: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = normalizeLanguage(language)
  }

  if (typeof window !== "undefined") {
    storeLanguage(normalizeLanguage(language))
  }
}

const initialLanguage = getInitialLanguage()

i18n.on("languageChanged", syncDocumentLanguage)

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: initialLanguage,
  fallbackLng: "en",
  supportedLngs: ["en", "zh-CN"],
  initAsync: false,
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
})

syncDocumentLanguage(initialLanguage)

export { normalizeLanguage }
export default i18n
