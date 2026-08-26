"use client"

import * as React from "react"
import { ListFilterIcon } from "lucide-react"
import { motion } from "motion/react"
import { useTranslation } from "react-i18next"

import { buttonVariants } from "@/components/ui/button"
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import {
  fallbackTagColorIndex,
  type KnownSessionTag,
} from "./session-projects"
import { TagChip } from "./session-tag-chip"

const actionTransition = {
  type: "spring" as const,
  stiffness: 480,
  damping: 28,
}

export function SessionTagFilter({
  knownTags,
  selectedTags,
  onSelectedTagsChange,
  open,
  onOpenChange,
  reduceMotion,
}: {
  knownTags: KnownSessionTag[]
  selectedTags: string[]
  onSelectedTagsChange: (tags: string[]) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  reduceMotion: boolean
}) {
  const { t } = useTranslation()
  const tagged = selectedTags.length > 0
  const filterLabel = tagged
    ? t("sidebar.projects.filterTagsActive", { count: selectedTags.length })
    : t("sidebar.projects.filterTags")

  const selectedItems = React.useMemo(
    () =>
      selectedTags.map(
        (name) =>
          knownTags.find(
            (tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase()
          ) ?? {
            name,
            color: fallbackTagColorIndex(name),
          }
      ),
    [knownTags, selectedTags]
  )

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <motion.button
                  type="button"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "icon-xs" }),
                    "absolute top-1/2 right-7 z-10 size-5 -translate-y-1/2 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    tagged &&
                      "bg-background/70 text-sidebar-foreground opacity-100"
                  )}
                  aria-label={filterLabel}
                  aria-pressed={tagged}
                  whileTap={reduceMotion ? undefined : { scale: 0.8 }}
                  transition={actionTransition}
                >
                  <ListFilterIcon className="size-3.5" aria-hidden="true" />
                </motion.button>
              }
            />
          }
        />
        <TooltipContent side="bottom" sideOffset={6}>
          {filterLabel}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-64 gap-2 p-2.5 text-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <PopoverHeader className="gap-0.5">
          <PopoverTitle className="text-sm font-bold">
            {t("sidebar.projects.filterTagsTitle")}
          </PopoverTitle>
          <PopoverDescription className="text-xs">
            {t("sidebar.projects.filterTagsDescription")}
          </PopoverDescription>
        </PopoverHeader>
        <Combobox
          autoHighlight
          inline
          items={knownTags}
          itemToStringLabel={(tag) => tag.name}
          isItemEqualToValue={(left, right) =>
            left.name.toLocaleLowerCase() === right.name.toLocaleLowerCase()
          }
          multiple
          open
          value={selectedItems}
          onValueChange={(next) => {
            onSelectedTagsChange((next ?? []).map((tag) => tag.name))
          }}
        >
          <ComboboxChips className="min-h-8 w-full gap-1 rounded-md px-1.5 py-1 text-sm shadow-xs focus-within:border-input focus-within:ring-0 dark:bg-input/30">
            <ComboboxValue>
              {(value: KnownSessionTag[]) => (
                <>
                  {value.map((tag) => (
                    <ComboboxChip
                      key={tag.name}
                      showRemove={false}
                      className="h-auto rounded-none bg-transparent p-0 font-normal text-inherit shadow-none"
                    >
                      <TagChip
                        tag={tag.name}
                        color={tag.color}
                        compact
                        removable
                        reduceMotion={reduceMotion}
                        onRemove={() => {
                          onSelectedTagsChange(
                            selectedTags.filter(
                              (name) =>
                                name.toLocaleLowerCase() !==
                                tag.name.toLocaleLowerCase()
                            )
                          )
                        }}
                      />
                    </ComboboxChip>
                  ))}
                  <ComboboxChipsInput
                    aria-label={t("sidebar.projects.filterTags")}
                    className="h-4 min-w-12 flex-1 text-[11px] placeholder:text-muted-foreground"
                    placeholder={
                      value.length === 0
                        ? t("sidebar.projects.filterTagsPlaceholder")
                        : undefined
                    }
                  />
                </>
              )}
            </ComboboxValue>
          </ComboboxChips>
          <ComboboxEmpty className="hidden py-2 text-sm has-[*]:flex">
            {knownTags.length === 0
              ? t("sidebar.projects.filterTagsEmpty")
              : t("sidebar.projects.filterTagsNoResults")}
          </ComboboxEmpty>
          <ComboboxList className="flex max-h-40 flex-wrap gap-1 p-0.5">
            {(item: KnownSessionTag) => (
              <ComboboxItem
                key={item.name}
                className="w-fit p-0 pr-0 data-highlighted:bg-transparent data-highlighted:text-inherit [&>span.absolute]:hidden"
                value={item}
              >
                <TagChip
                  tag={item.name}
                  color={item.color}
                  reduceMotion={reduceMotion}
                />
              </ComboboxItem>
            )}
          </ComboboxList>
        </Combobox>
        {tagged ? (
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: "ghost", size: "xs" }),
              "h-6 self-start px-1.5 text-xs text-muted-foreground"
            )}
            onClick={() => onSelectedTagsChange([])}
          >
            {t("sidebar.projects.clearTagFilters")}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
