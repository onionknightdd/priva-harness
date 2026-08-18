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
  capability,
  draft,
  enabled,
  isCreating,
  selectedProfileId,
}: {
  capability: ModelCapability
  draft: ProfileDraft
  enabled: boolean
  isCreating: boolean
  selectedProfileId: string | null
}) {
  const [status, setStatus] =
    React.useState<ModelCapabilityProbeStatus>("idle")
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const baseUrl = draft.baseUrl.trim()
  const authToken = draft.authToken.trim()
  const controllerRef = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setStatus("idle")
    setErrorMessage(null)

    return () => controllerRef.current?.abort()
  }, [
    authToken,
    baseUrl,
    enabled,
    isCreating,
    selectedProfileId,
  ])

  const probe = React.useCallback(
    (modelId: string | null) => {
      const normalizedModelId = modelId?.trim() ?? ""
      controllerRef.current?.abort()
      controllerRef.current = null

      if (
        !enabled ||
        normalizedModelId === "" ||
        (!isCreating && !selectedProfileId)
      ) {
        setStatus("idle")
        setErrorMessage(null)
        return
      }

      const controller = new AbortController()
      controllerRef.current = controller
      setStatus("probing")
      setErrorMessage(null)

      const request = isCreating
        ? probeDraftModelCapability(
            {
              id: "capability-probe",
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
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) {
            return
          }

          setStatus("error")
          setErrorMessage(
            error instanceof Error && error.message ? error.message : null
          )
        })
    }, [
      authToken,
      baseUrl,
      capability,
      enabled,
      isCreating,
      selectedProfileId,
    ]
  )

  return { errorMessage, probe, status }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError"
}
