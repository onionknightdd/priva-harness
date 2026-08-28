import * as React from "react"
import { PaperclipIcon, PlusIcon, PlugIcon } from "lucide-react"
import { useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import {
  Menu,
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
}: {
  onFilesSelected: (files: File[]) => void
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
