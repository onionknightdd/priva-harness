export type ProfileDraft = {
  id: string
  label: string
  baseUrl: string
  authToken: string
  defaultModel: string | null
}

export type ModelSettingsFeedback = {
  tone: "error" | "success"
  message: string
}

export type ModelConnectionTestStatus =
  | "idle"
  | "testing"
  | "success"
  | "error"

export type ModelSettingsBusyAction =
  | "delete"
  | "default"
  | "save"
  | null
