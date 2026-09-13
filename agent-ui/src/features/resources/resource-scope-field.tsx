import { useCallback, useId, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { Combobox, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList } from "@/components/ui/combobox"
import { Label } from "@/components/ui/label"
import { OverflowMarquee } from "@/components/motion/overflow-marquee"
import { TooltipHint } from "@/components/ui/tooltip"
import { resourceProjectName } from "./resource-api"
import { ResourceCombobox } from "./resource-combobox"

const projectPath = (value: string) => value !== "global" && value !== "custom-project" ? value : undefined

export function ResourceScopeField({ target, customDirectory, projects, onTargetChange, onDirectoryChange, disabled }: {
  target: string
  customDirectory: string
  projects: string[]
  onTargetChange: (target: string) => void
  onDirectoryChange: (cwd: string) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [open, setOpen] = useState(false)
  const selectedPath = projectPath(target)
  const paths = useMemo(() => [...new Set([...projects, ...(selectedPath ? [selectedPath] : [])])], [projects, selectedPath])
  const directoryOptions = useMemo(() => paths.map((path) => ({ value: path, label: resourceProjectName(path), description: path })), [paths])
  const label = useCallback((value: string) => value === "global" ? t("resources.allProjects") : value === "custom-project" ? t("resources.otherProject") : resourceProjectName(value), [t])
  // Base UI resyncs the input when items change. Keep searches intact during form updates.
  const groups = useMemo(() => [
    { value: "global", label: t("resources.globalEffect"), items: ["global"] },
    { value: "project", label: t("resources.projectEffect"), items: [...paths, "custom-project"] },
  ], [paths, t])

  return <>
    <div className="space-y-2">
      <Label htmlFor={id}>{t("resources.effectiveScope")}</Label>
      <Combobox items={groups} value={target} itemToStringLabel={label} disabled={disabled} onOpenChange={setOpen}
        filter={(value, query) => `${label(value)} ${projectPath(value) ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())}
        onValueChange={(value) => { if (value !== null) onTargetChange(value) }}>
        <ComboboxInput id={id} aria-label={t("resources.effectiveScope")} aria-describedby={!open && selectedPath ? `${id}-path` : undefined} className="w-full" disabled={disabled} required>
          {!open && selectedPath && <TooltipHint content={selectedPath}><span id={`${id}-path`} className="max-w-[60%] min-w-0 text-xs text-muted-foreground/60"><OverflowMarquee>{selectedPath}</OverflowMarquee></span></TooltipHint>}
        </ComboboxInput>
        <ComboboxContent>
          <ComboboxEmpty>{t("resources.noOptions")}</ComboboxEmpty>
          <ComboboxList>{(group: typeof groups[number]) => <ComboboxGroup key={group.value} items={group.items}>
            <ComboboxLabel>{group.label}</ComboboxLabel>
            <ComboboxCollection>{(value: string) => <ComboboxItem key={value} value={value} aria-label={projectPath(value) ? `${label(value)} ${value}` : label(value)}>
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className={projectPath(value) ? "max-w-[45%] shrink-0 truncate" : "min-w-0 truncate"}>{label(value)}</span>
                {projectPath(value) && <OverflowMarquee className="flex-1 text-xs text-muted-foreground/60">{value}</OverflowMarquee>}
              </span>
            </ComboboxItem>}</ComboboxCollection>
          </ComboboxGroup>}</ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
    {target === "custom-project" && <div className="space-y-2">
      <Label htmlFor={`${id}-directory`}>{t("resources.directory")}</Label>
      <ResourceCombobox id={`${id}-directory`} aria-label={t("resources.directory")} value={customDirectory} onValueChange={onDirectoryChange} disabled={disabled} allowCustomValue
        options={directoryOptions} placeholder="/path/to/project" />
    </div>}
  </>
}
