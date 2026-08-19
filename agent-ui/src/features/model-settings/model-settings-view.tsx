"use client"

import * as React from "react"
import { BotIcon, PlusIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

import {
  createModelProfile,
  deleteModelProfile,
  listModelProfiles,
  setDefaultModelProfile,
  updateModelProfile,
  type ModelProfileCreateInput,
  type ModelProfileSummary,
} from "./model-profile-api"
import { ModelProfileEditor } from "./model-profile-editor"
import { useModelConnectionTest } from "./use-model-connection-test"
import type {
  ModelSettingsBusyAction,
  ModelSettingsFeedback,
  ProfileDraft,
} from "./model-settings.types"

const emptyProfileDraft: ProfileDraft = {
  label: "",
  baseUrl: "",
  authToken: "",
  defaultModel: null,
  imageUnderstandingModel: null,
  imageGenerationModel: null,
  imageEditModel: null,
}

function profileToDraft(profile: ModelProfileSummary): ProfileDraft {
  return {
    label: profile.label,
    baseUrl: profile.baseUrl,
    authToken: "",
    defaultModel: profile.defaultModel,
    imageUnderstandingModel: profile.imageUnderstandingModel,
    imageGenerationModel: profile.imageGenerationModel,
    imageEditModel: profile.imageEditModel,
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function ProfileRailSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex items-center gap-2 px-2.5 py-2">
          <Skeleton className="size-4 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EditorSkeleton() {
  return (
    <div className="flex max-w-2xl flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-3 w-52" />
      </div>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  )
}

export function ModelSettingsView() {
  const { t } = useTranslation()
  const [profiles, setProfiles] = React.useState<ModelProfileSummary[]>([])
  const [defaultProfileId, setDefaultProfileId] = React.useState<string | null>(
    null
  )
  const [selectedProfileId, setSelectedProfileId] = React.useState<
    string | null
  >(null)
  const [isCreating, setIsCreating] = React.useState(false)
  const [draft, setDraft] = React.useState<ProfileDraft>(emptyProfileDraft)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [busyAction, setBusyAction] =
    React.useState<ModelSettingsBusyAction>(null)
  const [feedback, setFeedback] =
    React.useState<ModelSettingsFeedback | null>(null)
  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ?? null
  const {
    canTest,
    handleTest,
    invalidateConnectionTest,
    isConnectionVerified,
    loadSavedProfileModels,
    modelIds,
    resetConnectionTest,
    testFeedback,
    testStatus,
  } = useModelConnectionTest({
    busyAction,
    draft,
    hasSavedAuthToken: selectedProfile?.authTokenSet ?? false,
    isCreating,
    selectedProfileId,
    setDraft,
  })

  const selectProfile = React.useCallback((profile: ModelProfileSummary) => {
    setSelectedProfileId(profile.id)
    setIsCreating(false)
    setDraft(profileToDraft(profile))
    resetConnectionTest([
      profile.defaultModel,
      profile.imageUnderstandingModel,
      profile.imageGenerationModel,
      profile.imageEditModel,
    ])
    loadSavedProfileModels(profile.id, profile.baseUrl)
    setFeedback(null)
  }, [loadSavedProfileModels, resetConnectionTest])

  const startCreating = React.useCallback(() => {
    setSelectedProfileId(null)
    setIsCreating(true)
    setDraft(emptyProfileDraft)
    resetConnectionTest()
    setFeedback(null)
  }, [resetConnectionTest])

  const loadProfiles = React.useCallback(
    async (preferredProfileId?: string, showLoading = false) => {
      if (showLoading) {
        setLoading(true)
      }
      setLoadError(null)

      try {
        const collection = await listModelProfiles()
        setProfiles(collection.profiles)
        setDefaultProfileId(collection.defaultProfileId)

        if (collection.profiles.length === 0) {
          startCreating()
          return
        }

        const nextProfile =
          collection.profiles.find(
            (profile) => profile.id === preferredProfileId
          ) ??
          collection.profiles.find(
            (profile) => profile.id === collection.defaultProfileId
          ) ??
          collection.profiles[0]

        selectProfile(nextProfile)
      } catch (error) {
        setLoadError(
          getErrorMessage(error, t("settings.models.loadFailed"))
        )
      } finally {
        if (showLoading) {
          setLoading(false)
        }
      }
    },
    [selectProfile, startCreating, t]
  )

  React.useEffect(() => {
    void loadProfiles(undefined, true)
  }, [loadProfiles])

  const updateDraft = React.useCallback(
    <Key extends keyof ProfileDraft>(key: Key, value: ProfileDraft[Key]) => {
      if (key === "baseUrl" || key === "authToken") {
        invalidateConnectionTest()
      }

      setDraft((currentDraft) => ({ ...currentDraft, [key]: value }))
      setFeedback(null)
    },
    [invalidateConnectionTest]
  )

  const createInput = React.useCallback(
    (): ModelProfileCreateInput => ({
      label: draft.label.trim(),
      baseUrl: draft.baseUrl.trim(),
      authToken: draft.authToken.trim(),
      defaultModel: draft.defaultModel?.trim() || null,
      imageUnderstandingModel:
        draft.imageUnderstandingModel?.trim() || null,
      imageGenerationModel: draft.imageGenerationModel?.trim() || null,
      imageEditModel: draft.imageEditModel?.trim() || null,
    }),
    [draft]
  )

  const handleSave = React.useCallback(async () => {
    setBusyAction("save")
    setFeedback(null)

    try {
      if (isCreating) {
        const createdProfile = await createModelProfile(createInput())
        await loadProfiles(createdProfile.id)
        setFeedback({
          tone: "success",
          message: t("settings.models.profileCreated"),
        })
      } else if (selectedProfileId) {
        const updatedProfile = await updateModelProfile(selectedProfileId, {
          label: draft.label.trim(),
          baseUrl: draft.baseUrl.trim(),
          defaultModel: draft.defaultModel?.trim() || null,
          imageUnderstandingModel:
            draft.imageUnderstandingModel?.trim() || null,
          imageGenerationModel: draft.imageGenerationModel?.trim() || null,
          imageEditModel: draft.imageEditModel?.trim() || null,
          ...(draft.authToken.trim()
            ? { authToken: draft.authToken.trim() }
            : {}),
        })
        await loadProfiles(updatedProfile.id)
        setFeedback({
          tone: "success",
          message: t("settings.models.profileSaved"),
        })
      }
    } catch (error) {
      setFeedback({
        tone: "error",
        message: getErrorMessage(error, t("settings.models.requestFailed")),
      })
    } finally {
      setBusyAction(null)
    }
  }, [createInput, draft, isCreating, loadProfiles, selectedProfileId, t])

  const handleSetDefault = React.useCallback(async () => {
    if (!selectedProfileId) {
      return
    }

    setBusyAction("default")
    setFeedback(null)

    try {
      const result = await setDefaultModelProfile(selectedProfileId)
      setDefaultProfileId(result.default_profile_id)
      setFeedback({
        tone: "success",
        message: t("settings.models.defaultUpdated"),
      })
    } catch (error) {
      setFeedback({
        tone: "error",
        message: getErrorMessage(error, t("settings.models.requestFailed")),
      })
    } finally {
      setBusyAction(null)
    }
  }, [selectedProfileId, t])

  const handleDelete = React.useCallback(async () => {
    if (!selectedProfileId) {
      return
    }

    setBusyAction("delete")
    setFeedback(null)

    try {
      await deleteModelProfile(selectedProfileId)
      await loadProfiles()
      setFeedback({
        tone: "success",
        message: t("settings.models.profileDeleted"),
      })
    } catch (error) {
      setFeedback({
        tone: "error",
        message: getErrorMessage(error, t("settings.models.requestFailed")),
      })
    } finally {
      setBusyAction(null)
    }
  }, [loadProfiles, selectedProfileId, t])

  const cancelCreating = React.useCallback(() => {
    const fallbackProfile =
      profiles.find((profile) => profile.id === defaultProfileId) ?? profiles[0]

    if (fallbackProfile) {
      selectProfile(fallbackProfile)
    }
  }, [defaultProfileId, profiles, selectProfile])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <aside
        className="flex max-h-36 min-h-0 w-full shrink-0 flex-col overflow-hidden md:max-h-none md:w-[182px] md:pr-4"
        aria-label={t("settings.models.profileListLabel")}
      >
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2 px-1">
          <h2 className="text-sm font-medium">{t("settings.models.profiles")}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("settings.models.addProfile")}
            onClick={startCreating}
          >
            <PlusIcon />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
          {loading ? (
            <ProfileRailSkeleton />
          ) : loadError && profiles.length === 0 ? (
            <div className="flex flex-col items-start gap-2 px-1 py-2">
              <p className="text-xs text-destructive">{loadError}</p>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => void loadProfiles(undefined, true)}
              >
                {t("settings.models.retry")}
              </Button>
            </div>
          ) : profiles.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              {t("settings.models.noProfiles")}
            </p>
          ) : (
            <ItemGroup className="min-w-0 gap-1 overflow-x-hidden" role="listbox">
              {profiles.map((profile) => {
                const isSelected =
                  !isCreating && profile.id === selectedProfileId
                const isDefault = profile.id === defaultProfileId

                return (
                  <Item
                    key={profile.id}
                    render={
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => selectProfile(profile)}
                      />
                    }
                    variant={isSelected ? "muted" : "default"}
                    size="xs"
                    className={cn(
                      "flex-nowrap text-left hover:bg-muted/60",
                      isSelected && "bg-muted"
                    )}
                  >
                    <ItemMedia variant="icon">
                      <BotIcon />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="max-w-full">
                        <span className="truncate">{profile.label}</span>
                        {isDefault && (
                          <span
                            className="size-1.5 shrink-0 rounded-full bg-primary"
                            aria-label={t("settings.models.defaultBadge")}
                          />
                        )}
                      </ItemTitle>
                      <ItemDescription className="truncate">
                        {profile.modelCount === null
                          ? t("settings.models.modelCountUnknown")
                          : t("settings.models.modelCount", {
                              count: profile.modelCount,
                            })}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                )
              })}
            </ItemGroup>
          )}
        </div>
      </aside>

      <Separator className="my-3 md:hidden" />
      <Separator orientation="vertical" className="hidden md:block" />

      <section
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pt-1 md:pr-4 md:pl-5"
        aria-label={t("settings.models.profileEditorLabel")}
      >
        {loading ? (
          <EditorSkeleton />
        ) : loadError && profiles.length === 0 && !isCreating ? null : (
          <ModelProfileEditor
            busyAction={busyAction}
            canTest={canTest}
            draft={draft}
            feedback={feedback}
            isCreating={isCreating}
            isConnectionVerified={isConnectionVerified}
            isDefault={
              selectedProfileId !== null &&
              selectedProfileId === defaultProfileId
            }
            modelIds={modelIds}
            profile={selectedProfile}
            profilesExist={profiles.length > 0}
            testFeedback={testFeedback}
            testStatus={testStatus}
            onCancel={cancelCreating}
            onDelete={() => void handleDelete()}
            onDraftChange={updateDraft}
            onSave={() => void handleSave()}
            onSetDefault={() => void handleSetDefault()}
            onTest={handleTest}
          />
        )}
      </section>
    </div>
  )
}
