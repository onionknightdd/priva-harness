"use client"

import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"

import {
  DEFAULT_HARNESS_PREFERENCES,
  QUEUE_BEHAVIORS,
  SESSION_MODEL_PREFERENCES,
  isDefaultHarnessPreference,
  isQueueBehavior,
  isSessionModelPreference,
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

export function AgentSettingsView() {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const {
    defaultHarness,
    sessionModel,
    queueBehavior,
    inputSuggestions,
    setDefaultHarness,
    setSessionModel,
    setQueueBehavior,
    setInputSuggestions,
  } = useAgentPreferences()

  return (
    <motion.div
      className="max-w-lg py-1"
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
            <ToggleGroup
              aria-labelledby="agent-default-harness-label"
              value={[defaultHarness]}
              onValueChange={(values) => {
                const next = values[0]
                if (isDefaultHarnessPreference(next)) {
                  setDefaultHarness(next)
                }
              }}
              variant="outline"
              size="sm"
              spacing={0}
              className="max-w-full flex-wrap"
            >
              {DEFAULT_HARNESS_PREFERENCES.map((value) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className="px-2.5 text-xs font-normal"
                >
                  {t(defaultHarnessLabelKeys[value])}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
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
            <ToggleGroup
              aria-labelledby="agent-session-model-label"
              value={[sessionModel]}
              onValueChange={(values) => {
                const next = values[0]
                if (isSessionModelPreference(next)) {
                  setSessionModel(next)
                }
              }}
              variant="outline"
              size="sm"
              spacing={0}
              className="max-w-full flex-wrap"
            >
              {SESSION_MODEL_PREFERENCES.map((value) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className="px-2.5 text-xs font-normal"
                >
                  {t(sessionModelLabelKeys[value])}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <FieldContent>
              <FieldTitle id="agent-queue-behavior-label">
                {t("settings.agent.queueBehavior")}
              </FieldTitle>
              <FieldDescription>
                {t("settings.agent.queueBehaviorDescription")}
              </FieldDescription>
            </FieldContent>
            <ToggleGroup
              aria-labelledby="agent-queue-behavior-label"
              value={[queueBehavior]}
              onValueChange={(values) => {
                const next = values[0]
                if (isQueueBehavior(next)) {
                  setQueueBehavior(next)
                }
              }}
              variant="outline"
              size="sm"
              spacing={2}
              orientation="vertical"
              className="w-full max-w-md flex-col items-stretch"
            >
              {QUEUE_BEHAVIORS.map((value) => (
                <ToggleGroupItem
                  key={value}
                  value={value}
                  className="h-auto min-h-8 justify-start whitespace-normal px-3 py-2 text-left text-xs font-normal"
                >
                  {t(queueBehaviorLabelKeys[value])}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
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
