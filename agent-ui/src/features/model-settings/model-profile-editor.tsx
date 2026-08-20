"use client"

import * as React from "react"
import {
  CheckCircle2Icon,
  KeyRoundIcon,
  SaveIcon,
  Trash2Icon,
  UnplugIcon,
} from "lucide-react"
import { motion, useReducedMotion, type Transition } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

import type { ModelProfileSummary } from "./model-profile-api"
import { ModelSelector } from "./model-selector"
import { MultimodalModelFields } from "./multimodal-model-fields"
import type {
  ModelConnectionTestStatus,
  ModelSettingsBusyAction,
  ModelSettingsFeedback,
  ProfileDraft,
} from "./model-settings.types"

const editorTransition: Transition = {
  duration: 0.2,
  ease: [0.22, 1, 0.36, 1],
}

const feedbackTransition: Transition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1],
}

export function ModelProfileEditor({
  busyAction,
  canTest,
  draft,
  feedback,
  isCreating,
  isConnectionVerified,
  isDefault,
  modelIds,
  profile,
  profilesExist,
  testFeedback,
  testStatus,
  onCancel,
  onDelete,
  onDraftChange,
  onSave,
  onSetDefault,
  onTest,
}: {
  busyAction: ModelSettingsBusyAction
  canTest: boolean
  draft: ProfileDraft
  feedback: ModelSettingsFeedback | null
  isCreating: boolean
  isConnectionVerified: boolean
  isDefault: boolean
  modelIds: string[]
  profile: ModelProfileSummary | null
  profilesExist: boolean
  testFeedback: ModelSettingsFeedback | null
  testStatus: ModelConnectionTestStatus
  onCancel: () => void
  onDelete: () => void
  onDraftChange: <Key extends keyof ProfileDraft>(
    key: Key,
    value: ProfileDraft[Key]
  ) => void
  onSave: () => void
  onSetDefault: () => void
  onTest: () => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const isTesting = testStatus === "testing"
  const canSubmit = Boolean(
    draft.label.trim() &&
      draft.baseUrl.trim() &&
      (!isCreating || draft.authToken.trim())
  )
  const canSetDefault = Boolean(
    profile?.defaultModel &&
      profile.defaultModel === draft.defaultModel &&
      profile.baseUrl === draft.baseUrl.trim() &&
      !draft.authToken.trim()
  )
  const formTitle = isCreating
    ? t("settings.models.newProfile")
    : profile?.label ?? t("settings.models.profileEditorLabel")

  return (
    <motion.div
      key={isCreating ? "new-profile" : profile?.id ?? "empty-profile"}
      className="w-full min-w-0 max-w-2xl pb-2"
      initial={
        shouldReduceMotion ? false : { opacity: 0.72, x: 8 }
      }
      animate={{ opacity: 1, x: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : editorTransition}
    >
      <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-medium">{formTitle}</h2>
            {!isCreating && (
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {t("settings.models.defaultBadge")}
                </span>
                <Switch
                  size="sm"
                  checked={isDefault}
                  disabled={
                    isDefault ||
                    !isConnectionVerified ||
                    !canSetDefault ||
                    busyAction !== null ||
                    isTesting
                  }
                  aria-label={t("settings.models.setDefault")}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      onSetDefault()
                    }
                  }}
                />
                {busyAction === "default" && (
                  <Spinner className="size-3" aria-hidden="true" />
                )}
              </div>
            )}
          </div>
          {!isCreating && profile?.authTokenSet && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRoundIcon className="size-3" aria-hidden="true" />
              {t("settings.models.credentialSaved")}
            </p>
          )}
        </div>
      </div>
      <Separator className="mb-5" />

      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <FieldSet disabled={busyAction !== null}>
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="model-profile-label">
                {t("settings.models.profileName")}
              </FieldLabel>
              <Input
                id="model-profile-label"
                value={draft.label}
                placeholder={t("settings.models.profileNamePlaceholder")}
                maxLength={120}
                required
                onChange={(event) =>
                  onDraftChange("label", event.currentTarget.value)
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="model-profile-base-url">
                {t("settings.models.baseUrl")}
              </FieldLabel>
              <Input
                id="model-profile-base-url"
                type="url"
                value={draft.baseUrl}
                placeholder={t("settings.models.baseUrlPlaceholder")}
                required
                onChange={(event) =>
                  onDraftChange("baseUrl", event.currentTarget.value)
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="model-profile-auth-token">
                {t("settings.models.authToken")}
              </FieldLabel>
              <Input
                id="model-profile-auth-token"
                type="password"
                value={draft.authToken}
                autoComplete="new-password"
                placeholder={t(
                  isCreating
                    ? "settings.models.authTokenPlaceholder"
                    : "settings.models.authTokenSavedPlaceholder"
                )}
                required={isCreating}
                onChange={(event) =>
                  onDraftChange("authToken", event.currentTarget.value)
                }
              />
              <FieldDescription className="text-xs">
                {t("settings.models.authTokenDescription")}
              </FieldDescription>
            </Field>

            <Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canTest || busyAction !== null || isTesting}
                  onClick={onTest}
                >
                  {isTesting ? (
                    <Spinner />
                  ) : (
                    <UnplugIcon data-icon="inline-start" />
                  )}
                  {t("settings.models.testConnection")}
                </Button>
                <motion.span
                  key={[
                    testStatus,
                    testFeedback?.tone ?? "none",
                    testFeedback?.message ?? "",
                  ].join(":")}
                  role="status"
                  aria-live="polite"
                  className={cn(
                    "inline-flex min-w-0 items-center gap-1.5 text-xs",
                    testFeedback?.tone === "error" && "text-destructive",
                    testFeedback?.tone === "success" &&
                      "text-emerald-600 dark:text-emerald-400"
                  )}
                  initial={
                    testFeedback && !shouldReduceMotion
                      ? { opacity: 0, x: -4 }
                      : false
                  }
                  animate={{ opacity: 1, x: 0 }}
                  transition={
                    shouldReduceMotion
                      ? { duration: 0 }
                      : feedbackTransition
                  }
                >
                  {testFeedback?.tone === "success" && (
                    <CheckCircle2Icon
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {testFeedback?.message}
                </motion.span>
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="model-profile-default-model">
                {t("settings.models.defaultModel")}
              </FieldLabel>
              <ModelSelector
                id="model-profile-default-model"
                value={draft.defaultModel}
                disabled={!isConnectionVerified}
                emptyText={t("settings.models.noModels")}
                modelIds={modelIds}
                placeholder={t("settings.models.defaultModelPlaceholder")}
                onValueChange={(value) => onDraftChange("defaultModel", value)}
              />
              <FieldDescription className="text-xs">
                {t("settings.models.defaultModelDescription")}
              </FieldDescription>
            </Field>

            <Separator />

            <MultimodalModelFields
              busyAction={busyAction}
              draft={draft}
              isCreating={isCreating}
              isConnectionVerified={isConnectionVerified}
              modelIds={modelIds}
              profile={profile}
              onDraftChange={(key, value) => onDraftChange(key, value)}
            />
          </FieldGroup>

          <div
            role="status"
            aria-live="polite"
            className={cn(
              "min-h-5 text-xs",
              feedback?.tone === "error" && "text-destructive",
              feedback?.tone === "success" &&
                "text-emerald-600 dark:text-emerald-400"
            )}
          >
            {feedback && (
              <span className="inline-flex items-center gap-1.5">
                {feedback.tone === "success" && (
                  <CheckCircle2Icon
                    className="size-3.5"
                    aria-hidden="true"
                  />
                )}
                {feedback.message}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {isCreating ? (
                profilesExist && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onCancel}
                  >
                    {t("settings.models.cancel")}
                  </Button>
                )
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  disabled={busyAction !== null || isTesting}
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  {t("settings.models.delete")}
                </Button>
              )}
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit || busyAction !== null || isTesting}
            >
              {busyAction === "save" ? (
                <Spinner />
              ) : (
                <SaveIcon data-icon="inline-start" />
              )}
              {t(
                isCreating ? "settings.models.create" : "settings.models.save"
              )}
            </Button>
          </div>
        </FieldSet>
      </form>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.models.deleteDialogTitle", {
                name: profile?.label ?? "",
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.models.deleteDialogDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyAction === "delete"}>
              {t("settings.models.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busyAction === "delete"}
              onClick={() => {
                setDeleteDialogOpen(false)
                onDelete()
              }}
            >
              {busyAction === "delete" && <Spinner />}
              {t("settings.models.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
