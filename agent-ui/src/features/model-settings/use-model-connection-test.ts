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

function getDraftConnectionKey(baseUrl: string, authToken: string) {
  if (!baseUrl || !authToken) {
    return null
  }

  try {
    const parsedUrl = new URL(baseUrl)

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null
    }
  } catch {
    return null
  }

  return JSON.stringify([baseUrl, authToken])
}

export function useModelConnectionTest({
  busyAction,
  draft,
  isCreating,
  selectedProfileId,
  setDraft,
}: {
  busyAction: ModelSettingsBusyAction
  draft: ProfileDraft
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
                id: "connection-test",
                label: "Connection test",
                baseUrl: request.baseUrl,
                authToken: request.authToken,
                defaultModel: null,
              })
            : await testSavedModelProfile(request.profileId)

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
  const draftConnectionKey = getDraftConnectionKey(
    normalizedBaseUrl,
    normalizedAuthToken
  )
  const canTest = normalizedAuthToken
    ? draftConnectionKey !== null
    : !isCreating && selectedProfileId !== null

  React.useEffect(() => {
    if (!draftConnectionKey || busyAction !== null) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (lastRequestedConnectionKeyRef.current === draftConnectionKey) {
        return
      }

      void runConnectionTest({
        type: "draft",
        baseUrl: normalizedBaseUrl,
        authToken: normalizedAuthToken,
        connectionKey: draftConnectionKey,
      })
    }, AUTO_TEST_DELAY_MS)

    return () => window.clearTimeout(timeoutId)
  }, [
    busyAction,
    draftConnectionKey,
    normalizedAuthToken,
    normalizedBaseUrl,
    runConnectionTest,
  ])

  React.useEffect(
    () => () => {
      testRequestIdRef.current += 1
    },
    []
  )

  const handleTest = React.useCallback(() => {
    if (normalizedAuthToken) {
      if (!draftConnectionKey) {
        return
      }

      void runConnectionTest({
        type: "draft",
        baseUrl: normalizedBaseUrl,
        authToken: normalizedAuthToken,
        connectionKey: draftConnectionKey,
      })
      return
    }

    if (!isCreating && selectedProfileId) {
      void runConnectionTest({
        type: "saved",
        profileId: selectedProfileId,
        connectionKey: `saved:${selectedProfileId}`,
      })
    }
  }, [
    draftConnectionKey,
    isCreating,
    normalizedAuthToken,
    normalizedBaseUrl,
    runConnectionTest,
    selectedProfileId,
  ])

  return {
    canTest,
    handleTest,
    invalidateConnectionTest,
    isConnectionVerified: testStatus === "success" && modelIds.length > 0,
    modelIds,
    resetConnectionTest,
    testFeedback,
    testStatus,
  }
}
