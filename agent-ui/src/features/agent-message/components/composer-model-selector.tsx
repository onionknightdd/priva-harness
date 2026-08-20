import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { InputGroupButton } from "@/components/ui/input-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  listModelProfiles,
  listProfileModels,
  setDefaultModelProfile,
  setProfileDefaultModel,
  type ModelProfileCollection,
  type ModelProfileSummary,
} from "@/features/model-settings/model-profile-api"

type ComposerModelSelection = {
  profileId: string
  profileLabel: string
  modelId: string
}

type ProfileModelsEntry = {
  status: "idle" | "loading" | "ready" | "error"
  models: string[]
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function knownProfileModelIds(profile: ModelProfileSummary): string[] {
  const modelIds = new Set<string>()
  const add = (value: string | null | undefined) => {
    const modelId = value?.trim()
    if (modelId) {
      modelIds.add(modelId)
    }
  }

  add(profile.defaultModel)
  add(profile.imageUnderstandingModel)
  add(profile.imageGenerationModel)
  add(profile.imageEditModel)

  for (const modelId of Object.keys(profile.modelCapabilities)) {
    add(modelId)
  }

  return [...modelIds]
}

function defaultProfileFromCollection(collection: ModelProfileCollection) {
  return (
    collection.profiles.find(
      (profile) => profile.id === collection.defaultProfileId
    ) ?? collection.profiles[0]
  )
}

function selectionFromProfile(
  profile: ModelProfileSummary | undefined
): ComposerModelSelection | null {
  if (!profile) {
    return null
  }

  return {
    profileId: profile.id,
    profileLabel: profile.label,
    modelId: profile.defaultModel?.trim() ?? "",
  }
}

function ProfileModelSubmenu({
  profile,
  modelsEntry,
  selectedProfileId,
  selectedModelId,
  disabled,
  onOpen,
  onSelect,
}: {
  profile: ModelProfileSummary
  modelsEntry: ProfileModelsEntry | undefined
  selectedProfileId: string | null
  selectedModelId: string | null
  disabled: boolean
  onOpen: () => void
  onSelect: (selection: ComposerModelSelection) => void
}) {
  const { t } = useTranslation()
  const models = modelsEntry?.models ?? knownProfileModelIds(profile)
  const status = modelsEntry?.status ?? "idle"
  const visibleModels =
    selectedProfileId === profile.id &&
    selectedModelId &&
    !models.includes(selectedModelId)
      ? [selectedModelId, ...models]
      : models

  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open) {
          onOpen()
        }
      }}
    >
      <DropdownMenuSubTrigger className="gap-2" disabled={disabled}>
        <span className="min-w-0 truncate">{profile.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        align="start"
        side="right"
        className="w-auto min-w-44 max-w-72"
      >
        {visibleModels.length > 0 ? (
          visibleModels.map((modelId) => {
            const isSelected =
              selectedProfileId === profile.id && selectedModelId === modelId

            return (
              <DropdownMenuItem
                key={modelId}
                className="pr-8"
                disabled={disabled}
                onClick={() =>
                  onSelect({
                    profileId: profile.id,
                    profileLabel: profile.label,
                    modelId,
                  })
                }
              >
                <span className="min-w-0 truncate">{modelId}</span>
                {isSelected ? (
                  <CheckIcon className="absolute right-2" />
                ) : null}
              </DropdownMenuItem>
            )
          })
        ) : (
          <DropdownMenuItem disabled>
            {status === "loading"
              ? t("common.loading")
              : t("agentMessage.noModels")}
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function ComposerModelSelector() {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [profiles, setProfiles] = React.useState<ModelProfileSummary[]>([])
  const [defaultProfileId, setDefaultProfileId] = React.useState<string | null>(
    null
  )
  const [selection, setSelection] =
    React.useState<ComposerModelSelection | null>(null)
  const [profilesStatus, setProfilesStatus] = React.useState<
    "loading" | "ready" | "error"
  >("loading")
  const [modelsByProfileId, setModelsByProfileId] = React.useState<
    Record<string, ProfileModelsEntry>
  >({})
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const savingRef = React.useRef(false)
  const modelsByProfileIdRef = React.useRef(modelsByProfileId)
  modelsByProfileIdRef.current = modelsByProfileId

  const ensureProfileModels = React.useCallback(
    async (profile: ModelProfileSummary, signal?: AbortSignal) => {
      const current = modelsByProfileIdRef.current[profile.id]
      if (current?.status === "ready" || current?.status === "loading") {
        return
      }

      const loadingEntry: ProfileModelsEntry = {
        status: "loading",
        models: current?.models ?? knownProfileModelIds(profile),
      }
      modelsByProfileIdRef.current = {
        ...modelsByProfileIdRef.current,
        [profile.id]: loadingEntry,
      }
      setModelsByProfileId(modelsByProfileIdRef.current)

      try {
        const models = await listProfileModels(profile.id, signal)
        if (signal?.aborted) {
          return
        }

        const readyEntry: ProfileModelsEntry = { status: "ready", models }
        modelsByProfileIdRef.current = {
          ...modelsByProfileIdRef.current,
          [profile.id]: readyEntry,
        }
        setModelsByProfileId(modelsByProfileIdRef.current)
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          return
        }

        const errorEntry: ProfileModelsEntry = {
          status: "error",
          models: knownProfileModelIds(profile),
        }
        modelsByProfileIdRef.current = {
          ...modelsByProfileIdRef.current,
          [profile.id]: errorEntry,
        }
        setModelsByProfileId(modelsByProfileIdRef.current)
      }
    },
    []
  )

  React.useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        const collection = await listModelProfiles(controller.signal)
        if (controller.signal.aborted) {
          return
        }

        const defaultProfile = defaultProfileFromCollection(collection)
        setProfiles(collection.profiles)
        setDefaultProfileId(collection.defaultProfileId)
        setSelection(selectionFromProfile(defaultProfile))
        setProfilesStatus("ready")

        if (defaultProfile) {
          await ensureProfileModels(defaultProfile, controller.signal)
        }
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return
        }

        setProfiles([])
        setDefaultProfileId(null)
        setSelection(null)
        setProfilesStatus("error")
      }
    })()

    return () => {
      controller.abort()
    }
  }, [ensureProfileModels])

  const selectModel = React.useCallback(
    (next: ComposerModelSelection) => {
      if (savingRef.current) {
        return
      }

      const profile = profiles.find((item) => item.id === next.profileId)
      if (!profile) {
        return
      }

      if (
        selection?.profileId === next.profileId &&
        selection.modelId === next.modelId
      ) {
        return
      }

      const previousSelection = selection
      const previousDefaultProfileId = defaultProfileId
      savingRef.current = true
      setSelection(next)
      setSaveError(null)
      setSaving(true)

      void (async () => {
        try {
          if (profile.defaultModel !== next.modelId) {
            const updated = await setProfileDefaultModel(
              profile.id,
              next.modelId
            )
            setProfiles((current) =>
              current.map((item) =>
                item.id === updated.id ? updated : item
              )
            )
          }

          if (defaultProfileId !== profile.id) {
            const result = await setDefaultModelProfile(profile.id)
            setDefaultProfileId(result.default_profile_id)
          }
        } catch (error) {
          setSelection(previousSelection)
          setDefaultProfileId(previousDefaultProfileId)
          setSaveError(
            getErrorMessage(error, t("agentMessage.saveModelFailed"))
          )
        } finally {
          savingRef.current = false
          setSaving(false)
        }
      })()
    },
    [defaultProfileId, profiles, selection, t]
  )

  const selectionKey = selection
    ? `${selection.profileId}:${selection.modelId}`
    : "empty"
  const triggerLabel = selection
    ? selection.modelId
      ? t("agentMessage.modelSelectorAria", {
          profile: selection.profileLabel,
          model: selection.modelId,
        })
      : selection.profileLabel
    : t("agentMessage.selectModel")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={triggerLabel}
        title={saveError ?? triggerLabel}
        render={
          <InputGroupButton
            type="button"
            variant="ghost"
            size="xs"
            className="max-w-52 cursor-pointer border-0 bg-transparent px-1.5 shadow-none hover:bg-muted/40 dark:bg-transparent dark:hover:bg-muted/30"
          />
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={selectionKey}
            className="flex min-w-0 items-center gap-1.5"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -3 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
          >
            {selection ? (
              <>
                <span className="max-w-20 shrink-0 truncate text-muted-foreground">
                  {selection.profileLabel}
                </span>
                {selection.modelId ? (
                  <span className="min-w-0 truncate">{selection.modelId}</span>
                ) : null}
              </>
            ) : (
              <span className="truncate text-muted-foreground">
                {t("agentMessage.selectModel")}
              </span>
            )}
          </motion.span>
        </AnimatePresence>
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            "group-data-[popup-open]/button:rotate-180"
          )}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={6}
        className="w-auto min-w-44"
      >
        {profiles.length > 0 ? (
          <DropdownMenuGroup>
            {profiles.map((profile) => (
              <ProfileModelSubmenu
                key={profile.id}
                profile={profile}
                modelsEntry={modelsByProfileId[profile.id]}
                selectedProfileId={selection?.profileId ?? null}
                selectedModelId={selection?.modelId || null}
                disabled={saving}
                onOpen={() => {
                  void ensureProfileModels(profile)
                }}
                onSelect={selectModel}
              />
            ))}
          </DropdownMenuGroup>
        ) : (
          <DropdownMenuItem disabled>
            {profilesStatus === "loading"
              ? t("common.loading")
              : profilesStatus === "error"
                ? t("agentMessage.loadProfilesFailed")
                : t("agentMessage.noProfiles")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
