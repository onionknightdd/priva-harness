"use client"

import {
  CheckCircle2Icon,
  CircleXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

import type { ModelCapability } from "./model-profile-api"
import { ModelSelector } from "./model-selector"
import type {
  ModelCapabilityProbeStatus,
  ModelSettingsBusyAction,
  ProfileDraft,
} from "./model-settings.types"
import { useModelCapabilityProbe } from "./use-model-capability-probe"

type MultimodalDraftKey =
  | "imageUnderstandingModel"
  | "imageGenerationModel"
  | "imageEditModel"

const fields: readonly {
  capability: ModelCapability
  key: MultimodalDraftKey
  labelKey:
    | "settings.models.imageUnderstanding"
    | "settings.models.imageGeneration"
    | "settings.models.imageEdit"
}[] = [
  {
    capability: "image_understanding",
    key: "imageUnderstandingModel",
    labelKey: "settings.models.imageUnderstanding",
  },
  {
    capability: "image_generation",
    key: "imageGenerationModel",
    labelKey: "settings.models.imageGeneration",
  },
  {
    capability: "image_edit",
    key: "imageEditModel",
    labelKey: "settings.models.imageEdit",
  },
]

export function MultimodalModelFields({
  busyAction,
  draft,
  isCreating,
  isConnectionVerified,
  modelIds,
  selectedProfileId,
  onDraftChange,
}: {
  busyAction: ModelSettingsBusyAction
  draft: ProfileDraft
  isCreating: boolean
  isConnectionVerified: boolean
  modelIds: readonly string[]
  selectedProfileId: string | null
  onDraftChange: (key: MultimodalDraftKey, value: string | null) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h3 className="text-sm font-medium">{t("settings.models.multimodal")}</h3>
      <div className="flex min-w-0 flex-col gap-3">
        {fields.map((field) => (
          <CapabilityModelField
            key={field.capability}
            busyAction={busyAction}
            capability={field.capability}
            draft={draft}
            fieldKey={field.key}
            isCreating={isCreating}
            isConnectionVerified={isConnectionVerified}
            label={t(field.labelKey)}
            modelIds={modelIds}
            selectedProfileId={selectedProfileId}
            onValueChange={(value) => onDraftChange(field.key, value)}
          />
        ))}
      </div>
    </div>
  )
}

function CapabilityModelField({
  busyAction,
  capability,
  draft,
  fieldKey,
  isCreating,
  isConnectionVerified,
  label,
  modelIds,
  selectedProfileId,
  onValueChange,
}: {
  busyAction: ModelSettingsBusyAction
  capability: ModelCapability
  draft: ProfileDraft
  fieldKey: MultimodalDraftKey
  isCreating: boolean
  isConnectionVerified: boolean
  label: string
  modelIds: readonly string[]
  selectedProfileId: string | null
  onValueChange: (value: string | null) => void
}) {
  const { t } = useTranslation()
  const modelId = draft[fieldKey]
  const probe = useModelCapabilityProbe({
    capability,
    draft,
    enabled: isConnectionVerified,
    isCreating,
    selectedProfileId,
  })
  const inputId = `model-profile-${capability.replaceAll("_", "-")}`

  return (
    <div className="grid min-w-0 grid-cols-[8.75rem_6.5rem_minmax(0,1fr)] items-center gap-3 max-sm:grid-cols-1 max-sm:gap-1.5">
      <label
        htmlFor={inputId}
        className="whitespace-nowrap text-sm text-foreground"
      >
        {label}
      </label>
      <CapabilityProbeResult
        errorMessage={probe.errorMessage}
        status={probe.status}
      />
      <ModelSelector
        id={inputId}
        className="min-w-0"
        disabled={!isConnectionVerified || busyAction !== null}
        emptyText={t("settings.models.noModels")}
        modelIds={modelIds}
        placeholder={t("settings.models.selectCapabilityModel")}
        value={modelId}
        onValueChange={(value) => {
          onValueChange(value)
          probe.probe(value)
        }}
      />
    </div>
  )
}

function CapabilityProbeResult({
  errorMessage,
  status,
}: {
  errorMessage: string | null
  status: ModelCapabilityProbeStatus
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const content = probeStatusContent(status, t)

  return (
    <span
      role="status"
      aria-live="polite"
      title={status === "error" ? errorMessage ?? undefined : undefined}
      className="flex min-h-5 min-w-0 items-center text-xs"
    >
      <AnimatePresence initial={false} mode="wait">
        {content && (
          <motion.span
            key={status}
            className={cn(
              "inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap",
              status === "supported" &&
                "text-emerald-600 dark:text-emerald-400",
              status === "unsupported" && "text-muted-foreground",
              status === "error" && "text-destructive"
            )}
            initial={shouldReduceMotion ? false : { opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: 3 }}
            transition={
              shouldReduceMotion
                ? { duration: 0 }
                : { duration: 0.16, ease: [0.22, 1, 0.36, 1] }
            }
          >
            {content.icon}
            <span className="truncate">{content.label}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

function probeStatusContent(
  status: ModelCapabilityProbeStatus,
  t: ReturnType<typeof useTranslation>["t"]
) {
  switch (status) {
    case "idle":
      return null
    case "probing":
      return {
        icon: <Spinner className="size-3.5" aria-hidden="true" />,
        label: t("settings.models.probing"),
      }
    case "supported":
      return {
        icon: <CheckCircle2Icon className="size-3.5" aria-hidden="true" />,
        label: t("settings.models.supported"),
      }
    case "unsupported":
      return {
        icon: <CircleXIcon className="size-3.5" aria-hidden="true" />,
        label: t("settings.models.unsupported"),
      }
    case "error":
      return {
        icon: <TriangleAlertIcon className="size-3.5" aria-hidden="true" />,
        label: t("settings.models.probeFailed"),
      }
  }
}
