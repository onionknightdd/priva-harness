import * as React from "react"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import gsap from "gsap"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { OverflowMarquee } from "@/components/motion/overflow-marquee"
import { Input } from "@/components/ui/input"
import { InputGroupButton } from "@/components/ui/input-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
import { ModelCapabilityIcons } from "@/features/model-settings/model-capability-icons"
import { useAgentPreferences } from "@/features/settings/agent-preferences-context"
import {
  knownProfileModelIds,
  resolveComposerSelection,
  type ComposerModelSelection,
} from "@/features/agent-message/composer-model-selection"
import {
  displayModelName,
  getModelProviderId,
  groupModelIds,
  type ModelIdGroup,
} from "@/features/model-settings/model-provider"
import { ProviderIcon } from "@/features/model-settings/provider-icon"
import {
  useWorkspaceTakesMajority,
  workspaceDensityTransition,
} from "@/features/workspace"

const COMPOSER_MENU_WIDTH_CLASS = "w-56 min-w-56 max-w-56 text-sm"
const COMPOSER_TEXT_CLASS = "text-sm font-normal"
export const COMPOSER_MODEL_TRIGGER_MAX_CLASS = "max-w-[calc(8rem*5/3)]"
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const

export type ComposerEffort = (typeof EFFORT_LEVELS)[number]

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

function defaultProfileFromCollection(collection: ModelProfileCollection) {
  return (
    collection.profiles.find(
      (profile) => profile.id === collection.defaultProfileId
    ) ?? collection.profiles[0]
  )
}

function stopComposerFocus(event: React.SyntheticEvent) {
  event.stopPropagation()
}

function filterModelGroups(
  groups: ModelIdGroup[],
  query: string
): ModelIdGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()

  if (!normalizedQuery) {
    return groups
  }

  return groups.flatMap((group) => {
    const groupMatches = group.label
      .toLocaleLowerCase()
      .includes(normalizedQuery)
    const items = groupMatches
      ? group.items
      : group.items.filter((modelId) =>
          modelId.toLocaleLowerCase().includes(normalizedQuery)
        )

    return items.length > 0 ? [{ ...group, items }] : []
  })
}

function CollapsingInline({
  open,
  children,
}: {
  open: boolean
  children: React.ReactNode
}) {
  const shouldReduceMotion = Boolean(useReducedMotion())

  return (
    <motion.span
      aria-hidden={!open}
      className="inline-grid min-w-0 max-w-full overflow-hidden align-middle"
      initial={false}
      animate={{
        gridTemplateColumns: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
      }}
      transition={
        shouldReduceMotion ? { duration: 0 } : workspaceDensityTransition
      }
    >
      <span className="flex min-w-0 overflow-hidden">
        <span className="flex w-max max-w-full items-center gap-1 pl-1">
          {children}
        </span>
      </span>
    </motion.span>
  )
}

function OverflowFadeText({
  children,
  className,
}: {
  children: string
  className?: string
}) {
  const viewportRef = React.useRef<HTMLSpanElement>(null)
  const [overflowing, setOverflowing] = React.useState(false)

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    const updateOverflowing = () => {
      setOverflowing(viewport.scrollWidth > viewport.clientWidth + 1)
    }

    updateOverflowing()
    const observer = new ResizeObserver(updateOverflowing)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [children])

  return (
    <span
      ref={viewportRef}
      data-overflowing={overflowing || undefined}
      className={cn(
        "min-w-0 overflow-hidden whitespace-nowrap",
        overflowing &&
          "[mask-image:linear-gradient(to_right,black_calc(100%-1.25rem),transparent)]",
        className
      )}
    >
      {children}
    </span>
  )
}

function HoverMarquee({
  active,
  children,
  className,
}: {
  active: boolean
  children: string
  className?: string
}) {
  return (
    <OverflowMarquee
      active={active}
      playback="once"
      className={cn("min-w-0", className)}
    >
      {children}
    </OverflowMarquee>
  )
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
  const inputRef = React.useRef<HTMLInputElement>(null)
  const resultsRef = React.useRef<HTMLDivElement>(null)
  const [query, setQuery] = React.useState("")
  const [submenuOpen, setSubmenuOpen] = React.useState(false)
  const [profileMarquee, setProfileMarquee] = React.useState(false)
  const [modelMarqueeId, setModelMarqueeId] = React.useState<string | null>(
    null
  )
  const isSelected = selectedProfileId === profile.id
  const models = modelsEntry?.models ?? knownProfileModelIds(profile)
  const status = modelsEntry?.status ?? "idle"
  const visibleModels =
    isSelected &&
    selectedModelId &&
    !models.includes(selectedModelId)
      ? [selectedModelId, ...models]
      : models
  const groups = filterModelGroups(groupModelIds(visibleModels), query)
  const normalizedQuery = query.trim()
  const resultsKey = groups
    .map((group) => `${group.value}:${group.items.join("\0")}`)
    .join("|")

  React.useEffect(() => {
    if (!submenuOpen) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [submenuOpen])

  React.useLayoutEffect(() => {
    const results = resultsRef.current

    if (
      !results ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const items = results.querySelectorAll<HTMLElement>(
      "[data-model-menu-result]"
    )

    if (items.length === 0) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        items,
        { opacity: 0, y: 3 },
        {
          opacity: 1,
          y: 0,
          duration: 0.16,
          stagger: 0.015,
          ease: "power1.out",
          clearProps: "opacity,transform",
        }
      )
    }, results)

    return () => context.revert()
  }, [resultsKey])

  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        setSubmenuOpen(open)
        if (open) {
          onOpen()
          return
        }
        setQuery("")
        setModelMarqueeId(null)
      }}
    >
      <DropdownMenuSubTrigger
        className={cn(
          "min-w-0 gap-2 [&_svg:not([class*='size-'])]:size-3.5",
          COMPOSER_TEXT_CLASS
        )}
        closeDelay={120}
        disabled={disabled}
        label={profile.label}
        aria-current={isSelected ? "true" : undefined}
        openOnHover
        onPointerEnter={() => setProfileMarquee(true)}
        onPointerLeave={() => setProfileMarquee(false)}
        onFocus={() => setProfileMarquee(true)}
        onBlur={() => setProfileMarquee(false)}
      >
        <HoverMarquee active={profileMarquee} className="min-w-0 flex-1">
          {profile.label}
        </HoverMarquee>
        {isSelected ? (
          <CheckIcon className="size-4 shrink-0" aria-hidden="true" />
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        align="start"
        side="right"
        className={cn(
          COMPOSER_MENU_WIDTH_CLASS,
          "flex max-h-72 flex-col overflow-hidden p-0!"
        )}
        onClick={stopComposerFocus}
        onPointerDown={stopComposerFocus}
      >
        {visibleModels.length > 0 ? (
          <>
            <div className="shrink-0 border-b p-1.5">
              <div className="relative">
                <SearchIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  ref={inputRef}
                  value={query}
                  aria-label={t("agentMessage.modelSearchLabel")}
                  placeholder={t("agentMessage.modelSearchPlaceholder")}
                  className="h-8 border-0 bg-muted/60 pl-8 text-sm shadow-none md:text-sm focus-visible:ring-0"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") {
                      event.stopPropagation()
                    }
                  }}
                />
              </div>
            </div>
            <div
              ref={resultsRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 [scrollbar-gutter:stable]"
            >
              {groups.length > 0 ? (
                groups.map((group, index) => (
                  <DropdownMenuGroup key={group.value}>
                    {index > 0 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuLabel
                      className={cn(
                        "flex items-center gap-2 text-foreground",
                        COMPOSER_TEXT_CLASS
                      )}
                    >
                      <ProviderIcon providerId={group.providerId} />
                      <span className="truncate">{group.label}</span>
                    </DropdownMenuLabel>
                    {group.items.map((modelId) => {
                      const isSelected =
                        selectedProfileId === profile.id &&
                        selectedModelId === modelId

                      return (
                        <DropdownMenuItem
                          key={modelId}
                          data-model-menu-result
                          className={cn(
                            "min-w-0 pr-8",
                            COMPOSER_TEXT_CLASS
                          )}
                          closeOnClick
                          disabled={disabled}
                          onPointerEnter={() => setModelMarqueeId(modelId)}
                          onPointerLeave={() => setModelMarqueeId(null)}
                          onFocus={() => setModelMarqueeId(modelId)}
                          onBlur={() => setModelMarqueeId(null)}
                          onClick={() =>
                            onSelect({
                              profileId: profile.id,
                              profileLabel: profile.label,
                              modelId,
                            })
                          }
                        >
                          <HoverMarquee
                            active={modelMarqueeId === modelId}
                            className="flex-1"
                          >
                            {displayModelName(modelId)}
                          </HoverMarquee>
                          <ModelCapabilityIcons
                            className="ml-0"
                            catalog={profile.modelCapabilities}
                            modelId={modelId}
                          />
                          {isSelected ? (
                            <CheckIcon className="absolute right-2 size-4" />
                          ) : null}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuGroup>
                ))
              ) : (
                <div
                  role="status"
                  className="flex min-h-24 items-center justify-center px-4 text-center text-sm text-muted-foreground"
                >
                  {t("agentMessage.noModelResults", {
                    query: normalizedQuery,
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <DropdownMenuItem disabled className={COMPOSER_TEXT_CLASS}>
            {status === "loading"
              ? t("common.loading")
              : t("agentMessage.noModels")}
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function EffortSubmenu({
  effort,
  onEffortChange,
}: {
  effort: ComposerEffort
  onEffortChange: (effort: ComposerEffort) => void
}) {
  const { t } = useTranslation()
  const [effortMarquee, setEffortMarquee] = React.useState(false)

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        className={cn(
          "min-w-0 gap-2 [&_svg:not([class*='size-'])]:size-3.5",
          COMPOSER_TEXT_CLASS
        )}
        closeDelay={120}
        label={t("agentMessage.effortAria", { level: effort })}
        openOnHover
        onPointerEnter={() => setEffortMarquee(true)}
        onPointerLeave={() => setEffortMarquee(false)}
        onFocus={() => setEffortMarquee(true)}
        onBlur={() => setEffortMarquee(false)}
      >
        <HoverMarquee active={effortMarquee} className="min-w-0 flex-1">
          {t("agentMessage.effortMenuLabel")}
        </HoverMarquee>
        <span
          className={cn(
            "shrink-0 text-muted-foreground",
            COMPOSER_TEXT_CLASS
          )}
        >
          {effort}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        align="start"
        side="right"
        className={COMPOSER_MENU_WIDTH_CLASS}
        onClick={stopComposerFocus}
        onPointerDown={stopComposerFocus}
      >
        <DropdownMenuRadioGroup
          value={effort}
          onValueChange={(value) => {
            if (
              typeof value === "string" &&
              EFFORT_LEVELS.includes(value as ComposerEffort)
            ) {
              onEffortChange(value as ComposerEffort)
            }
          }}
        >
          {EFFORT_LEVELS.map((level) => (
            <DropdownMenuRadioItem
              key={level}
              className={cn(
                COMPOSER_TEXT_CLASS,
                "[&_svg:not([class*='size-'])]:size-4"
              )}
              value={level}
            >
              {level}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function ComposerModelSelector({
  onModelReferenceChange,
  onEffortChange,
}: {
  onModelReferenceChange?: (model: string | null) => void
  onEffortChange?: (effort: ComposerEffort) => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const iconOnly = useWorkspaceTakesMajority()
  const { sessionModel, lastModelReference, setLastModelReference } =
    useAgentPreferences()
  const lastModelReferenceRef = React.useRef(lastModelReference)
  lastModelReferenceRef.current = lastModelReference
  const [profiles, setProfiles] = React.useState<ModelProfileSummary[]>([])
  const [defaultProfileId, setDefaultProfileId] = React.useState<string | null>(
    null
  )
  const [selection, setSelection] =
    React.useState<ComposerModelSelection | null>(null)
  const [effort, setEffort] = React.useState<ComposerEffort>("medium")
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

  React.useEffect(() => {
    if (profilesStatus !== "ready") {
      return
    }

    setSelection((current) =>
      resolveComposerSelection({
        sessionModel,
        profiles,
        defaultProfileId,
        lastModelReference: lastModelReferenceRef.current,
        current,
      })
    )
  }, [defaultProfileId, profiles, profilesStatus, sessionModel])

  React.useEffect(() => {
    const profile = profiles.find((item) => item.id === selection?.profileId)
    if (profile) {
      void ensureProfileModels(profile)
    }
  }, [ensureProfileModels, profiles, selection?.profileId])

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
      setLastModelReference(`${next.profileId}:${next.modelId}`)

      if (sessionModel === "last-used") {
        setSelection(next)
        setSaveError(null)
        return
      }

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
    [defaultProfileId, profiles, selection, sessionModel, setLastModelReference, t]
  )

  React.useEffect(() => {
    if (!selection || selection.modelId.trim() !== "") {
      return
    }

    const firstModel = modelsByProfileId[selection.profileId]?.models.find(
      (modelId) => modelId.trim() !== ""
    )
    if (!firstModel) {
      return
    }

    setSelection({ ...selection, modelId: firstModel })
  }, [modelsByProfileId, selection])

  React.useEffect(() => {
    const profileId = selection?.profileId.trim() ?? ""
    const modelId = selection?.modelId.trim() ?? ""
    onModelReferenceChange?.(
      profileId && modelId ? `${profileId}:${modelId}` : null
    )
  }, [onModelReferenceChange, selection])

  React.useEffect(() => {
    onEffortChange?.(effort)
  }, [effort, onEffortChange])

  const selectionKey = selection
    ? `${selection.profileId}:${selection.modelId}`
    : "empty"
  const triggerLabel = selection
    ? selection.modelId
      ? t("agentMessage.modelSelectorAria", {
          profile: selection.profileLabel,
          model: selection.modelId,
          effort,
        })
      : `${selection.profileLabel}, ${t("agentMessage.effortAria", {
          level: effort,
        })}`
    : t("agentMessage.selectModel")

  return (
    <DropdownMenu modal>
      <DropdownMenuTrigger
        aria-label={triggerLabel}
        title={saveError ?? triggerLabel}
        render={
          <InputGroupButton
            type="button"
            variant="ghost"
            size="xs"
            className={cn(
              COMPOSER_MODEL_TRIGGER_MAX_CLASS,
              "w-max min-w-0 max-w-full shrink justify-start cursor-pointer overflow-hidden border-0 bg-transparent px-1.5 shadow-none hover:bg-muted/40 dark:bg-transparent dark:hover:bg-muted/30",
              COMPOSER_TEXT_CLASS
            )}
          />
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={selectionKey}
            className={cn(
              "flex min-w-0 items-center",
              COMPOSER_TEXT_CLASS
            )}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -3 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
          >
            {selection?.modelId ? (
              <ProviderIcon
                className="size-4 shrink-0"
                providerId={getModelProviderId(selection.modelId)}
              />
            ) : iconOnly ? (
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <span className={cn("truncate text-muted-foreground", COMPOSER_TEXT_CLASS)}>
                {t("agentMessage.selectModel")}
              </span>
            )}
            {selection?.modelId ? (
              <CollapsingInline open={!iconOnly}>
                <OverflowFadeText className={COMPOSER_TEXT_CLASS}>
                  {displayModelName(selection.modelId)}
                </OverflowFadeText>
                <ChevronDownIcon
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                    "group-data-[popup-open]/button:rotate-180"
                  )}
                />
              </CollapsingInline>
            ) : iconOnly ? null : (
              <CollapsingInline open>
                <ChevronDownIcon
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                    "group-data-[popup-open]/button:rotate-180"
                  )}
                />
              </CollapsingInline>
            )}
          </motion.span>
        </AnimatePresence>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={6}
        className={COMPOSER_MENU_WIDTH_CLASS}
        onClick={stopComposerFocus}
        onPointerDown={stopComposerFocus}
      >
        {profiles.length > 0 ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel className={COMPOSER_TEXT_CLASS}>
              {t("agentMessage.profileMenuLabel")}
            </DropdownMenuLabel>
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
          <DropdownMenuItem disabled className={COMPOSER_TEXT_CLASS}>
            {profilesStatus === "loading"
              ? t("common.loading")
              : profilesStatus === "error"
                ? t("agentMessage.loadProfilesFailed")
                : t("agentMessage.noProfiles")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <EffortSubmenu effort={effort} onEffortChange={setEffort} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
