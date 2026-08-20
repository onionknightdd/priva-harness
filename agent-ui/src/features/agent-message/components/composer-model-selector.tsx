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
  type ModelProfileCollection,
  type ModelProfileSummary,
} from "@/features/model-settings/model-profile-api"

const COMPOSER_MODEL_STORAGE_KEY = "agent-ui-composer-model"

type ComposerModelSelection = {
  profileId: string
  profileLabel: string
  modelId: string
}

type StoredComposerModel = {
  profileId: string
  modelId: string
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

function readStoredComposerModel(): StoredComposerModel | null {
  try {
    const raw = window.localStorage.getItem(COMPOSER_MODEL_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<StoredComposerModel>
    if (
      typeof parsed.profileId !== "string" ||
      typeof parsed.modelId !== "string"
    ) {
      return null
    }

    const profileId = parsed.profileId.trim()
    const modelId = parsed.modelId.trim()
    if (!profileId || !modelId) {
      return null
    }

    return { profileId, modelId }
  } catch {
    return null
  }
}

function storeComposerModel(selection: StoredComposerModel) {
  try {
    window.localStorage.setItem(
      COMPOSER_MODEL_STORAGE_KEY,
      JSON.stringify(selection)
    )
  } catch (error) {
    if (
      !(error instanceof DOMException) ||
      (error.name !== "SecurityError" && error.name !== "QuotaExceededError")
    ) {
      throw error
    }
  }
}

function resolveComposerModelSelection(
  collection: ModelProfileCollection,
  stored: StoredComposerModel | null
): ComposerModelSelection | null {
  if (collection.profiles.length === 0) {
    return null
  }

  const storedProfile = stored
    ? collection.profiles.find((profile) => profile.id === stored.profileId)
    : undefined

  if (storedProfile && stored) {
    return {
      profileId: storedProfile.id,
      profileLabel: storedProfile.label,
      modelId: stored.modelId,
    }
  }

  const profile =
    collection.profiles.find(
      (item) => item.id === collection.defaultProfileId
    ) ?? collection.profiles[0]

  if (!profile) {
    return null
  }

  const modelId =
    profile.defaultModel?.trim() || knownProfileModelIds(profile)[0] || ""

  return {
    profileId: profile.id,
    profileLabel: profile.label,
    modelId,
  }
}

function ProfileModelSubmenu({
  profile,
  selectedProfileId,
  selectedModelId,
  onSelect,
}: {
  profile: ModelProfileSummary
  selectedProfileId: string | null
  selectedModelId: string | null
  onSelect: (selection: ComposerModelSelection) => void
}) {
  const { t } = useTranslation()
  const [models, setModels] = React.useState(() => knownProfileModelIds(profile))
  const [status, setStatus] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle")
  const statusRef = React.useRef(status)
  statusRef.current = status

  const visibleModels = React.useMemo(() => {
    if (
      selectedProfileId === profile.id &&
      selectedModelId &&
      !models.includes(selectedModelId)
    ) {
      return [selectedModelId, ...models]
    }

    return models
  }, [models, profile.id, selectedModelId, selectedProfileId])

  const loadModels = React.useCallback(async () => {
    if (statusRef.current === "ready" || statusRef.current === "loading") {
      return
    }

    setStatus("loading")

    try {
      const listed = await listProfileModels(profile.id)
      setModels(listed)
      setStatus("ready")
    } catch {
      setModels(knownProfileModelIds(profile))
      setStatus("error")
    }
  }, [profile])

  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open) {
          void loadModels()
        }
      }}
    >
      <DropdownMenuSubTrigger className="gap-2">
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
  const [selection, setSelection] =
    React.useState<ComposerModelSelection | null>(null)
  const [profilesStatus, setProfilesStatus] = React.useState<
    "loading" | "ready" | "error"
  >("loading")

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const collection = await listModelProfiles()
        if (cancelled) {
          return
        }

        const nextSelection = resolveComposerModelSelection(
          collection,
          readStoredComposerModel()
        )
        setProfiles(collection.profiles)
        setSelection(nextSelection)
        setProfilesStatus("ready")

        if (nextSelection?.modelId) {
          storeComposerModel(nextSelection)
          return
        }

        if (!nextSelection) {
          return
        }

        try {
          const models = await listProfileModels(nextSelection.profileId)
          if (cancelled || models.length === 0) {
            return
          }

          const resolved = {
            ...nextSelection,
            modelId: models[0],
          }
          setSelection(resolved)
          storeComposerModel(resolved)
        } catch {
          // Keep the profile name visible when the model list is unavailable.
        }
      } catch {
        if (!cancelled) {
          setProfiles([])
          setSelection(null)
          setProfilesStatus("error")
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const selectModel = React.useCallback((next: ComposerModelSelection) => {
    setSelection(next)
    storeComposerModel(next)
  }, [])

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
        title={triggerLabel}
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
                selectedProfileId={selection?.profileId ?? null}
                selectedModelId={selection?.modelId || null}
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
