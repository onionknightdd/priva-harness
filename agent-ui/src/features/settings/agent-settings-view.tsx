"use client"

import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

import {
  DEFAULT_HARNESS_PREFERENCES,
  QUEUE_BEHAVIORS,
  SESSION_MODEL_PREFERENCES,
} from "./agent-preferences"
import { useAgentPreferences } from "./agent-preferences-context"

const panelItemTransition = {
  duration: 0.2,
  ease: [0.22, 1, 0.36, 1],
} as const

const defaultHarnessLabelKeys = {
  pi: "settings.agent.defaultHarnessPi",
  claude: "settings.agent.defaultHarnessClaude",
  "last-used": "settings.agent.defaultHarnessLastUsed",
} as const

const sessionModelLabelKeys = {
  "profile-default": "settings.agent.sessionModelProfileDefault",
  "last-used": "settings.agent.sessionModelLastUsed",
} as const

const queueBehaviorLabelKeys = {
  "follow-up": "settings.agent.queueBehaviorFollowUp",
  steer: "settings.agent.queueBehaviorSteer",
  interrupt: "settings.agent.queueBehaviorInterrupt",
} as const

function SettingsSelect<Value extends string>({
  labelledBy,
  invalid,
  disabled,
  items,
  value,
  triggerClassName,
  onValueChange,
}: {
  labelledBy: string
  invalid?: boolean
  disabled?: boolean
  items: readonly { value: Value; label: string }[]
  value: Value
  triggerClassName?: string
  onValueChange: (value: Value) => void
}) {
  return (
    <Select
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === null) {
          return
        }

        onValueChange(next)
      }}
    >
      <SelectTrigger
        size="sm"
        aria-labelledby={labelledBy}
        aria-invalid={invalid}
        disabled={disabled}
        className={triggerClassName}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        align="end"
        alignItemWithTrigger={false}
        className="w-max min-w-(--anchor-width)"
      >
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function AgentSettingsView() {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const {
    defaultHarness,
    sessionModel,
    queueBehavior,
    queueBehaviorBusy,
    queueBehaviorError,
    inputSuggestions,
    setDefaultHarness,
    setSessionModel,
    setQueueBehavior,
    setInputSuggestions,
  } = useAgentPreferences()

  const queueBehaviorErrorMessage =
    queueBehaviorError === "load"
      ? t("settings.agent.queueBehaviorLoadFailed")
      : queueBehaviorError === "save"
        ? t("settings.agent.queueBehaviorSaveFailed")
        : null

  const defaultHarnessItems = DEFAULT_HARNESS_PREFERENCES.map((value) => ({
    value,
    label: t(defaultHarnessLabelKeys[value]),
  }))
  const sessionModelItems = SESSION_MODEL_PREFERENCES.map((value) => ({
    value,
    label: t(sessionModelLabelKeys[value]),
  }))
  const queueBehaviorItems = QUEUE_BEHAVIORS.map((value) => ({
    value,
    label: t(queueBehaviorLabelKeys[value]),
  }))

  return (
    <motion.div
      className="w-full min-w-0 py-1"
      initial={shouldReduceMotion ? false : { opacity: 0.7, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : panelItemTransition}
    >
      <FieldSet>
        <FieldLegend>{t("settings.agent.sessionGroup")}</FieldLegend>
        <FieldGroup className="gap-6">
          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle id="agent-default-harness-label">
                {t("settings.agent.defaultHarness")}
              </FieldTitle>
              <FieldDescription>
                {t("settings.agent.defaultHarnessDescription")}
              </FieldDescription>
            </FieldContent>
            <SettingsSelect
              labelledBy="agent-default-harness-label"
              items={defaultHarnessItems}
              value={defaultHarness}
              triggerClassName="w-full min-w-0 @md/field-group:w-44"
              onValueChange={setDefaultHarness}
            />
          </Field>

          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle id="agent-session-model-label">
                {t("settings.agent.sessionModel")}
              </FieldTitle>
              <FieldDescription>
                {t("settings.agent.sessionModelDescription")}
              </FieldDescription>
            </FieldContent>
            <SettingsSelect
              labelledBy="agent-session-model-label"
              items={sessionModelItems}
              value={sessionModel}
              triggerClassName="w-full min-w-0 @md/field-group:w-44"
              onValueChange={setSessionModel}
            />
          </Field>

          <Field
            orientation="responsive"
            data-invalid={queueBehaviorErrorMessage ? true : undefined}
            data-disabled={queueBehaviorBusy ? true : undefined}
          >
            <FieldContent>
              <FieldTitle id="agent-queue-behavior-label">
                {t("settings.agent.queueBehavior")}
              </FieldTitle>
              <FieldDescription>
                {t("settings.agent.queueBehaviorDescription")}
              </FieldDescription>
              {queueBehaviorErrorMessage ? (
                <motion.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    shouldReduceMotion ? { duration: 0 } : panelItemTransition
                  }
                >
                  <FieldError>{queueBehaviorErrorMessage}</FieldError>
                </motion.div>
              ) : null}
            </FieldContent>
            <SettingsSelect
              labelledBy="agent-queue-behavior-label"
              invalid={Boolean(queueBehaviorErrorMessage)}
              disabled={queueBehaviorBusy}
              items={queueBehaviorItems}
              value={queueBehavior}
              triggerClassName="w-full min-w-0 @md/field-group:w-44"
              onValueChange={setQueueBehavior}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="agent-input-suggestions">
                {t("settings.agent.inputSuggestions")}
              </FieldLabel>
              <FieldDescription>
                {t("settings.agent.inputSuggestionsDescription")}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-input-suggestions"
              checked={inputSuggestions}
              onCheckedChange={setInputSuggestions}
            />
          </Field>
        </FieldGroup>
      </FieldSet>
    </motion.div>
  )
}
