"use client"

import * as React from "react"
import gsap from "gsap"
import {
  CheckCircle2Icon,
  KeyRoundIcon,
  SaveIcon,
  StarIcon,
  Trash2Icon,
  UnplugIcon,
} from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

import type { ModelProfileSummary } from "./model-profile-api"
import type {
  ModelSettingsBusyAction,
  ModelSettingsFeedback,
  ProfileDraft,
} from "./model-settings.types"

export function ModelProfileEditor({
  busyAction,
  draft,
  feedback,
  isCreating,
  isDefault,
  modelIds,
  profile,
  profilesExist,
  onCancel,
  onDelete,
  onDraftChange,
  onSave,
  onSetDefault,
  onTest,
}: {
  busyAction: ModelSettingsBusyAction
  draft: ProfileDraft
  feedback: ModelSettingsFeedback | null
  isCreating: boolean
  isDefault: boolean
  modelIds: string[]
  profile: ModelProfileSummary | null
  profilesExist: boolean
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
  const editorRef = React.useRef<HTMLDivElement>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const canSubmit = Boolean(
    draft.id.trim() &&
      draft.label.trim() &&
      draft.baseUrl.trim() &&
      (!isCreating || draft.authToken.trim())
  )
  const canTest = isCreating ? canSubmit : Boolean(profile)
  const formTitle = isCreating
    ? t("settings.models.newProfile")
    : profile?.label ?? t("settings.models.profileEditorLabel")

  React.useLayoutEffect(() => {
    const editor = editorRef.current

    if (
      !editor ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return
    }

    const context = gsap.context(() => {
      gsap.fromTo(
        editor,
        { autoAlpha: 0.72, x: 8 },
        {
          autoAlpha: 1,
          x: 0,
          duration: 0.2,
          ease: "power2.out",
          clearProps: "opacity,transform,visibility",
        }
      )
    }, editor)

    return () => context.revert()
  }, [isCreating, profile?.id])

  return (
    <div ref={editorRef} className="max-w-2xl pb-2">
      <div className="mb-5 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-base font-medium">{formTitle}</h2>
            {!isCreating && isDefault && (
              <Badge variant="secondary">
                {t("settings.models.defaultBadge")}
              </Badge>
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
              <FieldLabel htmlFor="model-profile-id">
                {t("settings.models.profileId")}
              </FieldLabel>
              <Input
                id="model-profile-id"
                value={draft.id}
                placeholder={t("settings.models.profileIdPlaceholder")}
                pattern="[a-z0-9][a-z0-9._-]{0,62}"
                maxLength={63}
                required
                disabled={!isCreating}
                onChange={(event) =>
                  onDraftChange(
                    "id",
                    event.currentTarget.value.toLocaleLowerCase()
                  )
                }
              />
              <FieldDescription className="text-xs">
                {t("settings.models.profileIdDescription")}
              </FieldDescription>
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
                  disabled={!canTest || busyAction !== null}
                  onClick={onTest}
                >
                  {busyAction === "test" ? (
                    <Spinner />
                  ) : (
                    <UnplugIcon data-icon="inline-start" />
                  )}
                  {t("settings.models.testConnection")}
                </Button>
                {!isCreating && (
                  <FieldDescription className="text-xs">
                    {t("settings.models.testSavedDescription")}
                  </FieldDescription>
                )}
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="model-profile-default-model">
                {t("settings.models.defaultModel")}
              </FieldLabel>
              <Combobox
                items={modelIds}
                value={draft.defaultModel}
                onValueChange={(value) =>
                  onDraftChange("defaultModel", value)
                }
              >
                <ComboboxInput
                  id="model-profile-default-model"
                  className="w-full"
                  disabled={modelIds.length === 0}
                  placeholder={t("settings.models.defaultModelPlaceholder")}
                  showClear
                />
                <ComboboxContent>
                  <ComboboxEmpty>
                    {t("settings.models.modelCountUnknown")}
                  </ComboboxEmpty>
                  <ComboboxList>
                    {(modelId) => (
                      <ComboboxItem key={modelId} value={modelId}>
                        {modelId}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <FieldDescription className="text-xs">
                {t("settings.models.defaultModelDescription")}
              </FieldDescription>
            </Field>
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
                <>
                  {!isDefault && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busyAction !== null}
                      onClick={onSetDefault}
                    >
                      {busyAction === "default" ? (
                        <Spinner />
                      ) : (
                        <StarIcon data-icon="inline-start" />
                      )}
                      {t("settings.models.setDefault")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={busyAction !== null}
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2Icon data-icon="inline-start" />
                    {t("settings.models.delete")}
                  </Button>
                </>
              )}
            </div>

            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit || busyAction !== null}
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
    </div>
  )
}
