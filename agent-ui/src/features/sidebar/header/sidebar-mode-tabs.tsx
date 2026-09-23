import { CircleQuestionMarkIcon, Code2Icon, MessageSquareShareIcon } from "lucide-react"
import { useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { Tabs, TabsList, TabsTrigger } from "@/components/assistant-ui/tabs"
import { TabsTriggerContent } from "@/components/assistant-ui/tabs-trigger-content"
import { Button } from "@/components/ui/button"
import { Dialog, DialogTrigger } from "@/components/ui/dialog"
import { TooltipHint } from "@/components/ui/tooltip"
import { useActiveSession, useChatSessionActions } from "@/features/chat-session"
import { useHarness } from "./harness-context"
import { ModeComparisonDialog } from "./mode-comparison-dialog"

export function SidebarModeTabs() {
  const { runHarnessId } = useHarness()
  return runHarnessId === "claude" ? <ClaudeModeTabs /> : null
}

function ClaudeModeTabs() {
  const { runMode, runModeLocked } = useActiveSession()
  const { setDraftRunMode } = useChatSessionActions()
  const reduceMotion = Boolean(useReducedMotion())
  const { t } = useTranslation()

  return (
    <div className="@container w-full min-w-0 group-data-[collapsible=icon]:hidden">
      <div className="flex min-w-0 items-center gap-1">
        <Tabs value={runMode} onValueChange={(value) => {
          if (!runModeLocked && (value === "agent" || value === "code")) setDraftRunMode(value)
        }} className="min-w-0 max-w-56 flex-1">
          <TabsList variant="default" size="lg" className="w-full min-w-0 overflow-hidden" aria-label={t("sidebar.modes.label")}
            title={runModeLocked ? t("sidebar.modes.locked") : undefined}>
            {([ ["agent", MessageSquareShareIcon], ["code", Code2Icon] ] as const).map(([mode, icon]) => (
              <TabsTrigger key={mode} value={mode} disabled={runModeLocked}
                className="min-w-0 flex-1 group-data-[size=lg]/tabs-list:px-1 group-data-[size=lg]/tabs-list:text-sm dark:data-active:text-white @[240px]:group-data-[size=lg]/tabs-list:text-base [&_svg]:hidden @[240px]:[&_svg]:block">
                <TabsTriggerContent active={runMode === mode} icon={icon} label={t(`sidebar.modes.${mode}`)} reduceMotion={reduceMotion} />
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Dialog>
          <TooltipHint content={t("sidebar.modes.help")}>
            <DialogTrigger render={<Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={t("sidebar.modes.help")} />}>
              <CircleQuestionMarkIcon />
            </DialogTrigger>
          </TooltipHint>
          <ModeComparisonDialog />
        </Dialog>
      </div>
    </div>
  )
}
