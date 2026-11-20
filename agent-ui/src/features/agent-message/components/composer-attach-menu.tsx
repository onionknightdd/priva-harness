import * as React from "react"
import { MonitorIcon, PaperclipIcon, PlusIcon, PlugIcon } from "lucide-react"
import { useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPanel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/animate-ui/components/base/menu"
import { InputGroupButton } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

const COMPOSER_ATTACH_MENU_WIDTH_CLASS = "w-52 min-w-52 text-sm"
const COMPOSER_ATTACH_LABEL_CLASS =
  "px-2 py-1.5 text-xs font-medium text-muted-foreground"

export function ComposerAttachMenu({
  onFilesSelected,
  computerUseEnabled = false,
  pluginChangePending = false,
  onComputerUseEnabledChange,
}: {
  onFilesSelected: (files: File[]) => void
  computerUseEnabled?: boolean
  /** The runner has not confirmed the last plugin change yet. */
  pluginChangePending?: boolean
  onComputerUseEnabledChange?: (active: boolean) => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ""
          if (files.length > 0) {
            onFilesSelected(files)
          }
        }}
      />
      <Menu>
        <MenuTrigger
          aria-label={t("agentMessage.attach")}
          render={
            <InputGroupButton
              type="button"
              size="icon-xs"
              className="rounded-full"
            />
          }
        >
          <PlusIcon
            className={cn(
              "size-5 transition-transform duration-200 motion-reduce:transition-none",
              "group-data-[popup-open]/button:rotate-45"
            )}
          />
        </MenuTrigger>
        <MenuPanel
          side="top"
          align="start"
          sideOffset={6}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
          className={COMPOSER_ATTACH_MENU_WIDTH_CLASS}
        >
          <MenuGroup>
            <MenuGroupLabel className={COMPOSER_ATTACH_LABEL_CLASS}>
              {t("agentMessage.attachFileGroup")}
            </MenuGroupLabel>
            <MenuItem
              onClick={() => {
                fileInputRef.current?.click()
              }}
            >
              <PaperclipIcon />
              {t("agentMessage.attachUpload")}
            </MenuItem>
          </MenuGroup>
          {onComputerUseEnabledChange ? (
            <>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel className={COMPOSER_ATTACH_LABEL_CLASS}>
                  {t("agentMessage.attachPluginGroup")}
                </MenuGroupLabel>
                {/* The check follows the runner's confirmation, not the click. */}
                <MenuCheckboxItem
                  checked={computerUseEnabled}
                  disabled={pluginChangePending}
                  onCheckedChange={(checked) => onComputerUseEnabledChange(checked)}
                >
                  <MonitorIcon />
                  {t("agentMessage.computerUsePlugin")}
                </MenuCheckboxItem>
              </MenuGroup>
            </>
          ) : null}
          <MenuSeparator />
          <MenuGroup>
            <MenuGroupLabel className={COMPOSER_ATTACH_LABEL_CLASS}>
              {t("agentMessage.attachMcpGroup")}
            </MenuGroupLabel>
            <MenuItem disabled>
              <PlugIcon />
              {t("agentMessage.attachMcpUnavailable")}
            </MenuItem>
          </MenuGroup>
        </MenuPanel>
      </Menu>
    </>
  )
}
