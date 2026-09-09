import * as React from "react"
import { LockKeyholeIcon, ScrollTextIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { FileBrowserTree } from "@/features/file-browser/components/file-browser-tree"
import { emptyFileBrowserModel, FILE_BROWSER_ROOT_ID, type FileBrowserModel } from "@/features/file-browser/file-browser-data"
import { buildSkillTree, resourceSourceLabel, type ResourceDetail, type ResourceQuery, type ResourceSource, type Skill, type SkillDetail, type SkillTreeNode } from "./resource-api"
import { useResource, type ResourceCache } from "./resource-hooks"
import { ResourceErrorState } from "./resource-shared"

function skillFileModel(skill: Skill, files: SkillDetail["files"]): FileBrowserModel {
  const model: FileBrowserModel = {
    items: {
      ...emptyFileBrowserModel.items,
      [skill.path]: { path: skill.path, name: skill.name, type: "folder", size: null, modifiedAt: null, permissions: null, parentPath: null },
    },
    childrenByPath: { [FILE_BROWSER_ROOT_ID]: [skill.path] },
  }
  const sizes = new Map(files.map((file) => [file.path, file.size]))
  const addChildren = (nodes: SkillTreeNode[], parentPath: string) => {
    model.childrenByPath[parentPath] = nodes.map((node) => {
      const path = `${skill.path}/${node.path}`
      model.items[path] = { path, name: node.name, type: node.file ? "file" : "folder", size: sizes.get(node.path) ?? null, modifiedAt: null, permissions: null, parentPath }
      if (!node.file) addChildren(node.children, path)
      return path
    })
  }
  addChildren(buildSkillTree(files), skill.path)
  return model
}

const noFiles: SkillDetail["files"] = []

export const SkillResourceTree = React.memo(function SkillResourceTree({ skill, source, query, revision, cache, selected, file, mobile, onSelect, onRetry }: {
  skill: Skill
  source: ResourceSource
  query: ResourceQuery
  revision: number
  cache: ResourceCache<ResourceDetail>
  selected: boolean
  file: string | null
  mobile: boolean
  onSelect: (id: string, file: string | null) => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const [requested, setRequested] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const detail = useResource(requested || selected ? `skills/${skill.id}` : null, query, revision, cache)
  const files = detail.data && "files" in detail.data ? detail.data.files : noFiles
  const model = React.useMemo(() => skillFileModel(skill, files), [skill, files])
  const loadingDirectories = React.useMemo(() => new Set(detail.loading ? [skill.path] : []), [detail.loading, skill.path])
  const selectedPath = file ? `${skill.path}/${file}` : skill.path
  const onFolderExpand = React.useCallback((path: string) => {
    if (path === skill.path) setRequested(true)
  }, [skill.path])
  const onItemSelect = React.useCallback(async (path: string, expanding: boolean) => {
    if (path === skill.path) {
      if (expanding) setRequested(true)
      if (!mobile && (expanding || !selected)) onSelect(skill.id, null)
    } else if (model.items[path]?.type === "file") {
      onSelect(skill.id, path.slice(skill.path.length + 1))
    }
  }, [skill.id, skill.path, mobile, selected, model, onSelect])

  return <div title={`${skill.name}\n${resourceSourceLabel(source)}\n${source.path}`}>
    <FileBrowserTree
      compact
      hideRootToggle
      defaultExpanded={false}
      model={model}
      query=""
      rootPath={skill.path}
      selectedItemPath={selected ? (model.items[selectedPath] ? selectedPath : skill.path) : null}
      loadingDirectories={loadingDirectories}
      onFolderExpand={onFolderExpand}
      onItemSelect={onItemSelect}
      onActionFeedback={setActionError}
      rootIcon={<ScrollTextIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      rootMetadata={!source.writable || !skill.enabled ? <span className="flex shrink-0 items-center gap-2">
        {!source.writable && <LockKeyholeIcon className="size-3 text-muted-foreground" aria-label={t("resources.readOnly")} />}
        {!skill.enabled && <span className="size-1.5 rounded-full bg-muted-foreground" title={t("resources.disabled")} />}
      </span> : null}
    />
    {(detail.error || actionError) && <ResourceErrorState message={detail.error || actionError!} retry={onRetry} />}
  </div>
})
