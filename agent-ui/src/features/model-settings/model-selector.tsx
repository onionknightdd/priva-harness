"use client"

import * as React from "react"

import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
} from "@/components/ui/combobox"
import { cn } from "@/lib/utils"

import {
  displayModelName,
  groupModelIds,
  type ModelIdGroup,
} from "./model-provider"
import { ProviderIcon } from "./provider-icon"

export function ModelSelector({
  className,
  disabled = false,
  emptyText,
  id,
  modelIds,
  placeholder,
  value,
  onValueChange,
}: {
  className?: string
  disabled?: boolean
  emptyText: string
  id: string
  modelIds: readonly string[]
  placeholder: string
  value: string | null
  onValueChange: (value: string | null) => void
}) {
  const groups = React.useMemo(() => groupModelIds(modelIds), [modelIds])

  return (
    <Combobox
      items={groups}
      value={value}
      disabled={disabled}
      itemToStringLabel={displayModelName}
      onValueChange={onValueChange}
    >
      <ComboboxInput
        id={id}
        className={cn("w-full", className)}
        disabled={disabled}
        placeholder={placeholder}
        showClear
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(group: ModelIdGroup) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxLabel className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ProviderIcon providerId={group.providerId} />
                <span className="truncate">{group.label}</span>
              </ComboboxLabel>
              <ComboboxCollection>
                {(modelId: string) => (
                  <ComboboxItem key={modelId} value={modelId}>
                    <span className="truncate">{displayModelName(modelId)}</span>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
              <ComboboxSeparator />
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
