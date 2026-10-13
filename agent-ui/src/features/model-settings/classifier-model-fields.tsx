"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  CLASSIFIER_APIS,
  probeDraftModelCapability,
  probeSavedModelCapability,
  withProbedCapability,
  type ModelCapabilityCatalog,
  type ModelProfileSummary,
} from "./model-profile-api"
import { ModelSelector } from "./model-selector"
import { CapabilityProbeResult } from "./multimodal-model-fields"
import type { ModelCapabilityProbeStatus, ProfileDraft } from "./model-settings.types"

export function ClassifierModelFields({ draft, profile, profiles, disabled, onDraftChange, onCatalogChange }: {
  draft: ProfileDraft
  profile: ModelProfileSummary | null
  profiles: readonly ModelProfileSummary[]
  disabled: boolean
  onDraftChange: <Key extends keyof ProfileDraft>(key: Key, value: ProfileDraft[Key]) => void
  onCatalogChange: (catalog: ModelCapabilityCatalog) => void
}) {
  const { t } = useTranslation()
  const controller = React.useRef<AbortController | null>(null)
  const identity = JSON.stringify([profile?.id, draft.classifierApi, draft.classifierProfileId, draft.classifierModel, draft.baseUrl, draft.authToken])
  const [probe, setProbe] = React.useState<{ identity: string; status: ModelCapabilityProbeStatus; error: string | null } | null>(null)
  React.useEffect(() => () => controller.current?.abort(), [identity])
  const connection = draft.classifierProfileId ? profiles.find((item) => item.id === draft.classifierProfileId) : profile
  const hasCredentials = draft.classifierProfileId ? connection?.authTokenSet : draft.authToken.trim() || profile?.authTokenSet
  const canTest = Boolean(draft.classifierApi && draft.classifierModel?.trim() && hasCredentials && (draft.classifierProfileId ? connection?.baseUrl : draft.baseUrl.trim()))
  const status = probe?.identity === identity ? probe.status : "idle"
  const modelIds = [...new Set([...(connection?.modelCapabilities.classification ?? []), ...draft.modelCapabilities.classification])]
  const protocolItems = [{ value: "none", label: t("settings.models.classifierDisabled") }, ...CLASSIFIER_APIS.map((value) => ({ value, label: value }))]
  const connectionItems = [{ value: "current", label: t("settings.models.classifierCurrentProfile") }, ...profiles.filter((item) => item.id !== profile?.id).map((item) => ({ value: item.id, label: item.label }))]

  const test = async () => {
    if (!canTest || disabled) return
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setProbe({ identity, status: "probing", error: null })
    try {
      const modelId = draft.classifierModel?.trim() ?? ""
      const connectionInput = { baseUrl: draft.baseUrl.trim(), ...(draft.authToken.trim() ? { authToken: draft.authToken.trim() } : {}), classifierApi: draft.classifierApi, classifierProfileId: draft.classifierProfileId }
      const result = profile
        ? await probeSavedModelCapability(profile.id, connectionInput, modelId, "classification", request.signal)
        : await probeDraftModelCapability({ ...draft, label: draft.label.trim() || "Classifier probe", baseUrl: draft.baseUrl.trim(), authToken: draft.authToken.trim() }, modelId, "classification", request.signal)
      if (request.signal.aborted) return
      setProbe({ identity, status: result.supported ? "supported" : "unsupported", error: null })
      onCatalogChange(withProbedCapability(draft.modelCapabilities, "classification", modelId, result.supported))
    } catch (error) {
      if (!request.signal.aborted) setProbe({ identity, status: "error", error: error instanceof Error ? error.message : t("settings.models.requestFailed") })
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t("settings.models.classifier")}</h3>
        <p className="text-xs text-muted-foreground">{t("settings.models.classifierDescription")}</p>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field>
          <FieldLabel id="classifier-protocol-label">{t("settings.models.classifierProtocol")}</FieldLabel>
          <Select items={protocolItems} value={draft.classifierApi ?? "none"} disabled={disabled} onValueChange={(value) => {
            onDraftChange("classifierApi", CLASSIFIER_APIS.find((api) => api === value) ?? null)
            if (value === "none") {
              onDraftChange("classifierModel", null)
              onDraftChange("classifierProfileId", null)
            }
          }}>
            <SelectTrigger className="w-full" aria-labelledby="classifier-protocol-label"><SelectValue /></SelectTrigger>
            <SelectContent>{protocolItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel id="classifier-connection-label">{t("settings.models.classifierConnection")}</FieldLabel>
          <Select items={connectionItems} value={draft.classifierProfileId ?? "current"} disabled={disabled || !draft.classifierApi} onValueChange={(value) => onDraftChange("classifierProfileId", value === "current" ? null : value)}>
            <SelectTrigger className="w-full" aria-labelledby="classifier-connection-label"><SelectValue /></SelectTrigger>
            <SelectContent>{connectionItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="classifier-model">{t("settings.models.classifierModel")}</FieldLabel>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <ModelSelector allowCustom id="classifier-model" disabled={disabled || !draft.classifierApi} modelIds={modelIds} value={draft.classifierModel} emptyText={t("settings.models.classifierModelPlaceholder")} placeholder={t("settings.models.classifierModelPlaceholder")} onValueChange={(value) => onDraftChange("classifierModel", value)} />
          </div>
          <Button type="button" size="sm" variant="outline" disabled={disabled || !canTest || status === "probing"} onClick={() => void test()}>{t("settings.models.classifierTest")}</Button>
        </div>
        <CapabilityProbeResult status={status} errorMessage={probe?.identity === identity ? probe.error : null} />
      </Field>
    </div>
  )
}
