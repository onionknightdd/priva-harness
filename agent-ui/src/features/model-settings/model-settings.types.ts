import type { ModelCapabilityCatalog } from "./model-profile-api"

export type ProfileDraft = {
  label: string
  baseUrl: string
  authToken: string
  defaultModel: string | null
  imageUnderstandingModel: string | null
  imageGenerationModel: string | null
  imageEditModel: string | null
  modelCapabilities: ModelCapabilityCatalog
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

export type ModelCapabilityProbeStatus =
  | "idle"
  | "probing"
  | "supported"
  | "unsupported"
  | "error"
