"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  testDraftModelProfile,
  testSavedModelProfile,
} from "./model-profile-api"
import type {
  ModelConnectionTestStatus,
  ModelSettingsBusyAction,
  ModelSettingsFeedback,
  ProfileDraft,
} from "./model-settings.types"

const AUTO_TEST_DELAY_MS = 600

type ConnectionTestRequest =
  | {
      type: "draft"
      baseUrl: string
      authToken: string
      connectionKey: string
    }
  | {
      type: "saved"
      profileId: string
      baseUrl?: string
      authToken?: string
      connectionKey: string
    }

function uniqueModelIds(modelIds: Array<string | null>) {
  return [
    ...new Set(
      modelIds.filter((modelId): modelId is string => Boolean(modelId))
    ),
  ].sort((left, right) => left.localeCompare(right))
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function isValidBaseUrl(baseUrl: string) {
  try {
    const parsedUrl = new URL(baseUrl)

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return false
    }
  } catch {
    return false
  }

  return true
}

export function useModelConnectionTest({
  busyAction,
  draft,
  hasSavedAuthToken,
  isCreating,
  selectedProfileId,
  setDraft,
}: {
  busyAction: ModelSettingsBusyAction
  draft: ProfileDraft
  hasSavedAuthToken: boolean
  isCreating: boolean
  selectedProfileId: string | null
  setDraft: React.Dispatch<React.SetStateAction<ProfileDraft>>
}) {
  const { t } = useTranslation()
  const [modelIds, setModelIds] = React.useState<string[]>([])
  const [testFeedback, setTestFeedback] =
    React.useState<ModelSettingsFeedback | null>(null)
  const [testStatus, setTestStatus] =
    React.useState<ModelConnectionTestStatus>("idle")
  const testRequestIdRef = React.useRef(0)
  const lastRequestedConnectionKeyRef = React.useRef<string | null>(null)

  const resetConnectionTest = React.useCallback(
    (initialModelIds: Array<string | null> = []) => {
      testRequestIdRef.current += 1
      lastRequestedConnectionKeyRef.current = null
      setModelIds(uniqueModelIds(initialModelIds))
      setTestFeedback(null)
      setTestStatus("idle")
    },
    []
  )

  const invalidateConnectionTest = React.useCallback(() => {
    resetConnectionTest()
  }, [resetConnectionTest])

  const runConnectionTest = React.useCallback(
    async (request: ConnectionTestRequest) => {
      const requestId = ++testRequestIdRef.current
      lastRequestedConnectionKeyRef.current = request.connectionKey
      setTestStatus("testing")
      setTestFeedback(null)

      try {
        const returnedModelIds =
          request.type === "draft"
            ? await testDraftModelProfile({
                label: "Connection test",
                baseUrl: request.baseUrl,
                authToken: request.authToken,
                defaultModel: null,
                imageUnderstandingModel: null,
                imageGenerationModel: null,
                imageEditModel: null,
              })
            : await testSavedModelProfile(request.profileId, {
                baseUrl: request.baseUrl,
                authToken: request.authToken,
              })

        if (requestId !== testRequestIdRef.current) {
          return
        }

        const nextModelIds = uniqueModelIds(returnedModelIds)
        const firstReturnedModelId = returnedModelIds[0] ?? null

        setDraft((currentDraft) => {
          const currentDefaultModel = currentDraft.defaultModel?.trim()
          const nextDefaultModel =
            currentDefaultModel && nextModelIds.includes(currentDefaultModel)
              ? currentDefaultModel
              : firstReturnedModelId

          return {
            ...currentDraft,
            defaultModel: nextDefaultModel,
            imageUnderstandingModel:
              currentDraft.imageUnderstandingModel &&
              nextModelIds.includes(currentDraft.imageUnderstandingModel)
                ? currentDraft.imageUnderstandingModel
                : null,
            imageGenerationModel:
              currentDraft.imageGenerationModel &&
              nextModelIds.includes(currentDraft.imageGenerationModel)
                ? currentDraft.imageGenerationModel
                : null,
            imageEditModel:
              currentDraft.imageEditModel &&
              nextModelIds.includes(currentDraft.imageEditModel)
                ? currentDraft.imageEditModel
                : null,
          }
        })
        setModelIds(nextModelIds)
        setTestStatus("success")
        setTestFeedback({
          tone: "success",
          message: t("settings.models.connectionSucceeded", {
            count: nextModelIds.length,
          }),
        })
      } catch (error) {
        if (requestId !== testRequestIdRef.current) {
          return
        }

        setModelIds([])
        setTestStatus("error")
        setTestFeedback({
          tone: "error",
          message: getErrorMessage(
            error,
            t("settings.models.requestFailed")
          ),
        })
      }
    },
    [setDraft, t]
  )

  const normalizedBaseUrl = draft.baseUrl.trim()
  const normalizedAuthToken = draft.authToken.trim()
  const validBaseUrl = isValidBaseUrl(normalizedBaseUrl)
  const hasUsableAuthToken =
    normalizedAuthToken !== "" || (!isCreating && hasSavedAuthToken)
  const canTest = validBaseUrl && hasUsableAuthToken
  const autoConnectionKey =
    canTest
      ? JSON.stringify([
          isCreating ? "draft" : selectedProfileId,
          normalizedBaseUrl,
          normalizedAuthToken || "stored-auth-token",
        ])
      : null

  React.useEffect(() => {
    if (!autoConnectionKey || busyAction !== null) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (lastRequestedConnectionKeyRef.current === autoConnectionKey) {
        return
      }

      if (isCreating) {
        void runConnectionTest({
          type: "draft",
          baseUrl: normalizedBaseUrl,
          authToken: normalizedAuthToken,
          connectionKey: autoConnectionKey,
        })
      } else if (selectedProfileId) {
        void runConnectionTest({
          type: "saved",
          profileId: selectedProfileId,
          baseUrl: normalizedBaseUrl,
          ...(normalizedAuthToken ? { authToken: normalizedAuthToken } : {}),
          connectionKey: autoConnectionKey,
        })
      }
    }, AUTO_TEST_DELAY_MS)

    return () => window.clearTimeout(timeoutId)
  }, [
    busyAction,
    autoConnectionKey,
    isCreating,
    normalizedAuthToken,
    normalizedBaseUrl,
    runConnectionTest,
    selectedProfileId,
  ])

  React.useEffect(
    () => () => {
      testRequestIdRef.current += 1
    },
    []
  )

  const handleTest = React.useCallback(() => {
    if (!canTest) {
      return
    }

    if (isCreating) {
      const connectionKey = JSON.stringify([
        "draft",
        normalizedBaseUrl,
        normalizedAuthToken,
      ])
      void runConnectionTest({
        type: "draft",
        baseUrl: normalizedBaseUrl,
        authToken: normalizedAuthToken,
        connectionKey,
      })
      return
    }

    if (selectedProfileId) {
      const connectionKey = JSON.stringify([
        selectedProfileId,
        normalizedBaseUrl,
        normalizedAuthToken || "stored-auth-token",
      ])
      void runConnectionTest({
        type: "saved",
        profileId: selectedProfileId,
        baseUrl: normalizedBaseUrl,
        ...(normalizedAuthToken ? { authToken: normalizedAuthToken } : {}),
        connectionKey,
      })
    }
  }, [
    canTest,
    isCreating,
    normalizedAuthToken,
    normalizedBaseUrl,
    runConnectionTest,
    selectedProfileId,
  ])

  const loadSavedProfileModels = React.useCallback(
    (profileId: string, baseUrl: string) => {
      void runConnectionTest({
        type: "saved",
        profileId,
        connectionKey: JSON.stringify([
          profileId,
          baseUrl.trim(),
          "stored-auth-token",
        ]),
      })
    },
    [runConnectionTest]
  )

  return {
    canTest,
    handleTest,
    invalidateConnectionTest,
    isConnectionVerified: testStatus === "success" && modelIds.length > 0,
    loadSavedProfileModels,
    modelIds,
    resetConnectionTest,
    testFeedback,
    testStatus,
  }
}
