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
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"

import { useAgentPreferences } from "./agent-preferences-context"

const panelItemTransition = {
  duration: 0.2,
  ease: [0.22, 1, 0.36, 1],
} as const

export function AdvancedSettingsView() {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const { onlineOfficePreview, setOnlineOfficePreview } = useAgentPreferences()

  return (
    <motion.div
      className="w-full min-w-0 py-1"
      initial={shouldReduceMotion ? false : { opacity: 0.7, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldReduceMotion ? { duration: 0 } : panelItemTransition}
    >
      <FieldSet>
        <FieldLegend>{t("settings.advanced.previewGroup")}</FieldLegend>
        <FieldGroup className="gap-6">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="advanced-online-office">
                {t("settings.advanced.onlineOffice")}
              </FieldLabel>
              <FieldDescription>
                {t("settings.advanced.onlineOfficeDescription")}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="advanced-online-office"
              checked={onlineOfficePreview}
              onCheckedChange={setOnlineOfficePreview}
            />
          </Field>
        </FieldGroup>
      </FieldSet>
    </motion.div>
  )
}
