import * as React from "react"
import {
  CircleQuestionMarkIcon,
  Code2Icon,
  MessageSquareShareIcon,
  type LucideIcon,
} from "lucide-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/assistant-ui/tabs"
import { Button } from "@/components/ui/button"

type SidebarMode = "agent" | "code"

const TAB_LIST_WIDTH = 224
const TAB_ROW_WITH_HELP_WIDTH = 270

function ModeTabContent({
  active,
  icon: Icon,
  label,
  reduceMotion,
}: {
  active: boolean
  icon: LucideIcon
  label: string
  reduceMotion: boolean
}) {
  if (!active) {
    return <span>{label}</span>
  }

  if (reduceMotion) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Icon />
        <span>{label}</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <motion.span
        className="inline-flex"
        initial={{ opacity: 0.45, y: 2, scale: 0.72, rotate: -12 }}
        animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 24 }}
      >
        <Icon />
      </motion.span>
      <motion.span
        initial={{ opacity: 0.45, x: -3, y: 2 }}
        animate={{ opacity: 1, x: 0, y: 0 }}
        transition={{
          type: "spring",
          stiffness: 360,
          damping: 28,
          delay: 0.04,
        }}
      >
        {label}
      </motion.span>
    </span>
  )
}

export function SidebarModeTabs() {
  const rowRef = React.useRef<HTMLDivElement>(null)
  const [mode, setMode] = React.useState<SidebarMode>("agent")
  const [availableWidth, setAvailableWidth] = React.useState<number | null>(
    null
  )
  const shouldReduceMotion = useReducedMotion()
  const { t } = useTranslation()

  React.useLayoutEffect(() => {
    const row = rowRef.current

    if (!row) {
      return
    }

    const updateWidth = () => {
      setAvailableWidth(row.getBoundingClientRect().width)
    }
    const resizeObserver = new ResizeObserver(updateWidth)

    updateWidth()
    resizeObserver.observe(row)

    return () => resizeObserver.disconnect()
  }, [])

  const showTabs =
    availableWidth === null || availableWidth >= TAB_LIST_WIDTH
  const showHelp =
    availableWidth === null || availableWidth >= TAB_ROW_WITH_HELP_WIDTH
  const activeModeLabel =
    mode === "agent" ? t("sidebar.modes.agent") : t("sidebar.modes.code")
  const helpLabel = t("sidebar.modes.help", { mode: activeModeLabel })

  return (
    <div
      ref={rowRef}
      className="w-full min-w-0 group-data-[collapsible=icon]:hidden"
    >
      {showTabs && (
        <div className="flex items-center gap-1.5 overflow-hidden">
          <Tabs
            value={mode}
            onValueChange={(value) => {
              if (value === "agent" || value === "code") {
                setMode(value)
              }
            }}
            className="w-56 min-w-56 shrink-0"
          >
            <TabsList
              variant="default"
              size="lg"
              className="w-56 min-w-56 overflow-hidden"
              aria-label={t("sidebar.modes.label")}
            >
              <TabsTrigger
                value="agent"
                className="group-data-[size=lg]/tabs-list:text-base dark:data-active:text-white"
              >
                <ModeTabContent
                  active={mode === "agent"}
                  icon={MessageSquareShareIcon}
                  label={t("sidebar.modes.agent")}
                  reduceMotion={Boolean(shouldReduceMotion)}
                />
              </TabsTrigger>
              <TabsTrigger
                value="code"
                className="group-data-[size=lg]/tabs-list:text-base dark:data-active:text-white"
              >
                <ModeTabContent
                  active={mode === "code"}
                  icon={Code2Icon}
                  label={t("sidebar.modes.code")}
                  reduceMotion={Boolean(shouldReduceMotion)}
                />
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <AnimatePresence initial={false}>
            {showHelp && (
              <motion.div
                initial={
                  shouldReduceMotion
                    ? false
                    : { opacity: 0, x: -4, scale: 0.88 }
                }
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={
                  shouldReduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, x: -4, scale: 0.88 }
                }
                transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  data-mode={mode}
                  aria-label={helpLabel}
                  title={helpLabel}
                >
                  <CircleQuestionMarkIcon />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
