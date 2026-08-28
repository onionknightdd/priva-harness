"use client"

import * as React from "react"

import {
  probeDraftModelCapability,
  probeSavedModelCapability,
  type ModelCapability,
} from "./model-profile-api"
import type {
  ModelCapabilityProbeStatus,
  ProfileDraft,
} from "./model-settings.types"

export function useModelCapabilityProbe({
  cachedSupported,
  cacheValid,
  capability,
  draft,
  enabled,
  isCreating,
  modelId,
  onResolved,
  selectedProfileId,
}: {
  cachedSupported: boolean | null
  cacheValid: boolean
  capability: ModelCapability
  draft: ProfileDraft
  enabled: boolean
  isCreating: boolean
  modelId: string | null
  onResolved?: (supported: boolean) => void
  selectedProfileId: string | null
}) {
  const [status, setStatus] =
    React.useState<ModelCapabilityProbeStatus>("idle")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const baseUrl = draft.baseUrl.trim()
  const authToken = draft.authToken.trim()

  React.useEffect(() => {
    const controller = new AbortController()
    const normalizedModelId = modelId?.trim() ?? ""

    if (
      !enabled ||
      normalizedModelId === "" ||
      (!isCreating && !selectedProfileId)
    ) {
      setStatus("idle")
      setErrorMessage(null)
      return () => controller.abort()
    }

    if (cacheValid && cachedSupported !== null) {
      setStatus(cachedSupported ? "supported" : "unsupported")
      setErrorMessage(null)
      return () => controller.abort()
    }

    setStatus("probing")
    setErrorMessage(null)

    const request = isCreating
      ? probeDraftModelCapability(
          {
            label: "Capability probe",
            baseUrl,
            authToken,
            defaultModel: null,
            imageUnderstandingModel: null,
            imageGenerationModel: null,
            imageEditModel: null,
          },
          normalizedModelId,
          capability,
          controller.signal
        )
      : probeSavedModelCapability(
          selectedProfileId ?? "",
          {
            baseUrl,
            ...(authToken ? { authToken } : {}),
          },
          normalizedModelId,
          capability,
          controller.signal
        )

    void request
      .then((result) => {
        if (controller.signal.aborted) {
          return
        }

        setStatus(result.supported ? "supported" : "unsupported")
        onResolved?.(result.supported)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) {
          return
        }

        setStatus("error")
        setErrorMessage(
          error instanceof Error && error.message ? error.message : null
        )
        onResolved?.(false)
      })

    return () => controller.abort()
  }, [
    authToken,
    baseUrl,
    cacheValid,
    cachedSupported,
    capability,
    enabled,
    isCreating,
    modelId,
    onResolved,
    selectedProfileId,
  ])

  return { errorMessage, status }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError"
}
