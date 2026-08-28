import type { AgentThreadMessage, StreamBlock } from "./agent-message-data"

export type TaskBoardStatus = "pending" | "in_progress" | "completed"

export type TaskBoardItem = {
  id: string
  subject: string
  description?: string
  status: TaskBoardStatus
  activeForm?: string
  blockedBy: string[]
  blocks: string[]
  owner?: string
}

export type TaskPlan = {
  tasks: TaskBoardItem[]
  steps: string[]
  activeIndex: number
  completedCount: number
}

const BOARD_TOOLS = new Set([
  "taskcreate",
  "taskget",
  "taskupdate",
  "tasklist",
])

export function isTaskBoardTool(name: string): boolean {
  return BOARD_TOOLS.has(normalizeToolName(name))
}

export function foldTaskPlan(blocks: readonly StreamBlock[]): TaskPlan | null {
  return foldTaskPlanInOrder(
    [...blocks].sort((left, right) => left.index - right.index)
  )
}

export function foldThreadTaskPlan(
  messages: readonly AgentThreadMessage[]
): TaskPlan | null {
  const blocks: StreamBlock[] = []
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue
    }
    blocks.push(
      ...[...(message.blocks ?? [])].sort(
        (left, right) => left.index - right.index
      )
    )
  }
  return foldTaskPlanInOrder(blocks)
}

function foldTaskPlanInOrder(blocks: readonly StreamBlock[]): TaskPlan | null {
  const tasks = new Map<string, TaskBoardItem>()
  const aliases = new Map<string, string>()

  const ordered = blocks.filter(
    (block): block is Extract<StreamBlock, { type: "tool_use" }> =>
      block.type === "tool_use" && isTaskBoardTool(block.name)
  )

  for (const block of ordered) {
    applyTaskTool(tasks, aliases, block)
  }

  const visible = [...tasks.values()]
  if (visible.length === 0) {
    return null
  }

  const display = sortForPlan(visible)
  const completedCount = display.filter(
    (task) => task.status === "completed"
  ).length

  return {
    tasks: display,
    steps: display.map((task) =>
      task.status === "in_progress" && task.activeForm
        ? task.activeForm
        : task.subject
    ),
    activeIndex: completedCount,
    completedCount,
  }
}

function applyTaskTool(
  tasks: Map<string, TaskBoardItem>,
  aliases: Map<string, string>,
  block: Extract<StreamBlock, { type: "tool_use" }>
) {
  const kind = normalizeToolName(block.name)
  const input = asRecord(useful(block.tool?.input) ?? useful(block.input))
  const output = parseJson(block.tool?.output)

  if (kind === "taskcreate") {
    applyCreate(tasks, aliases, block.id, input, output)
    return
  }
  if (kind === "taskupdate") {
    applyUpdate(tasks, aliases, input, output)
    return
  }
  if (kind === "taskget") {
    applyGet(tasks, aliases, input, output)
    return
  }
  if (kind === "tasklist") {
    applyList(tasks, aliases, output)
  }
}

function applyCreate(
  tasks: Map<string, TaskBoardItem>,
  aliases: Map<string, string>,
  toolUseId: string,
  input: Record<string, unknown> | undefined,
  output: unknown
) {
  const created = asRecord(asRecord(output)?.task)
  const pendingId = `pending:${toolUseId}`
  const id =
    stringValue(created, "id") ??
    stringValueAny(input, "id") ??
    pendingId
  const subject =
    stringValue(created, "subject") ??
    stringValueAny(input, "subject") ??
    ""
  if (subject === "" && created === undefined && input === undefined) {
    return
  }
  const next = mergeTask(tasks.get(resolveId(aliases, id)), {
    id,
    subject: subject || id,
    description: stringValueAny(input, "description"),
    activeForm: stringValueAny(input, "activeForm", "active_form"),
    status: "pending",
    blockedBy: [],
    blocks: [],
  })
  remember(tasks, aliases, pendingId, next)
}

function applyUpdate(
  tasks: Map<string, TaskBoardItem>,
  aliases: Map<string, string>,
  input: Record<string, unknown> | undefined,
  output: unknown
) {
  const result = asRecord(output)
  const taskId =
    stringValueAny(result, "taskId", "task_id") ??
    stringValueAny(input, "taskId", "task_id", "id")
  if (taskId === undefined) {
    return
  }
  const statusChange = asRecord(result?.statusChange)
  const status =
    parseStatus(input?.status) ??
    parseStatus(statusChange?.to) ??
    parseStatus(statusChange?.from)
  if (status === "deleted") {
    tasks.delete(resolveId(aliases, taskId))
    return
  }
  const addBlockedBy = stringArray(input?.addBlockedBy)
  const addBlocks = stringArray(input?.addBlocks)
  const current = tasks.get(resolveId(aliases, taskId))
  const next = mergeTask(current, {
    id: taskId,
    subject: stringValueAny(input, "subject") ?? current?.subject ?? taskId,
    description: stringValueAny(input, "description"),
    activeForm: stringValueAny(input, "activeForm", "active_form"),
    status: status ?? current?.status ?? "pending",
    owner: stringValueAny(input, "owner"),
    blockedBy: unique([...(current?.blockedBy ?? []), ...addBlockedBy]),
    blocks: unique([...(current?.blocks ?? []), ...addBlocks]),
  })
  remember(tasks, aliases, taskId, next)
  linkEdges(tasks, aliases, next.id, addBlocks, addBlockedBy)
}

function applyGet(
  tasks: Map<string, TaskBoardItem>,
  aliases: Map<string, string>,
  input: Record<string, unknown> | undefined,
  output: unknown
) {
  const task = asRecord(asRecord(output)?.task)
  if (task === undefined) {
    return
  }
  const id =
    stringValue(task, "id") ??
    stringValueAny(input, "taskId", "task_id", "id")
  if (id === undefined) {
    return
  }
  const status = parseStatus(task.status)
  if (status === "deleted") {
    tasks.delete(resolveId(aliases, id))
    return
  }
  remember(
    tasks,
    aliases,
    id,
    mergeTask(tasks.get(resolveId(aliases, id)), {
      id,
      subject: stringValue(task, "subject") ?? id,
      description: stringValue(task, "description"),
      status: status ?? "pending",
      blockedBy: stringArray(task.blockedBy),
      blocks: stringArray(task.blocks),
      owner: stringValue(task, "owner"),
    })
  )
}

function applyList(
  tasks: Map<string, TaskBoardItem>,
  aliases: Map<string, string>,
  output: unknown
) {
  const listed = asRecord(output)?.tasks
  if (!Array.isArray(listed)) {
    return
  }
  const seen = new Set<string>()
  for (const item of listed) {
    const task = asRecord(item)
    const id = task === undefined ? undefined : stringValue(task, "id")
    if (id === undefined) {
      continue
    }
    const status = parseStatus(task?.status)
    if (status === "deleted") {
      tasks.delete(resolveId(aliases, id))
      continue
    }
    remember(
      tasks,
      aliases,
      id,
      mergeTask(tasks.get(resolveId(aliases, id)), {
        id,
        subject: stringValue(task, "subject") ?? id,
        status: status ?? "pending",
        owner: stringValue(task, "owner"),
        blockedBy: stringArray(task?.blockedBy),
        blocks: stringArray(task?.blocks),
      })
    )
    seen.add(id)
  }
  for (const id of [...tasks.keys()]) {
    if (!seen.has(id) && !id.startsWith("pending:")) {
      tasks.delete(id)
    }
  }
}

function linkEdges(
  tasks: Map<string, TaskBoardItem>,
  aliases: Map<string, string>,
  taskId: string,
  addBlocks: readonly string[],
  addBlockedBy: readonly string[]
) {
  for (const blockedId of addBlocks) {
    const blocked = tasks.get(resolveId(aliases, blockedId))
    if (blocked === undefined || blocked.id === taskId) {
      continue
    }
    remember(
      tasks,
      aliases,
      blocked.id,
      mergeTask(blocked, {
        id: blocked.id,
        subject: blocked.subject,
        blockedBy: unique([...blocked.blockedBy, taskId]),
      })
    )
  }
  for (const blockerId of addBlockedBy) {
    const blocker = tasks.get(resolveId(aliases, blockerId))
    if (blocker === undefined || blocker.id === taskId) {
      continue
    }
    remember(
      tasks,
      aliases,
      blocker.id,
      mergeTask(blocker, {
        id: blocker.id,
        subject: blocker.subject,
        blocks: unique([...blocker.blocks, taskId]),
      })
    )
  }
}

function sortForPlan(tasks: readonly TaskBoardItem[]): TaskBoardItem[] {
  const completed = tasks.filter((task) => task.status === "completed")
  const running = tasks.filter((task) => task.status === "in_progress")
  const pending = tasks.filter((task) => task.status === "pending")
  const done = new Set(completed.map((task) => task.id))
  const unblocked: TaskBoardItem[] = []
  const blocked: TaskBoardItem[] = []
  for (const task of pending) {
    if (task.blockedBy.every((id) => done.has(id))) {
      unblocked.push(task)
    } else {
      blocked.push(task)
    }
  }
  return [...completed, ...running, ...unblocked, ...blocked]
}

function remember(
  tasks: Map<string, TaskBoardItem>,
  aliases: Map<string, string>,
  id: string,
  task: TaskBoardItem
) {
  const previousId = resolveId(aliases, id)
  if (previousId !== task.id) {
    tasks.delete(previousId)
    aliases.set(previousId, task.id)
  }
  aliases.set(id, task.id)
  tasks.set(task.id, task)
}

function resolveId(aliases: Map<string, string>, id: string): string {
  return aliases.get(id) ?? id
}

function mergeTask(
  current: TaskBoardItem | undefined,
  patch: Partial<TaskBoardItem> & Pick<TaskBoardItem, "id" | "subject">
): TaskBoardItem {
  if (current === undefined) {
    return {
      id: patch.id,
      subject: patch.subject,
      status: patch.status ?? "pending",
      blockedBy: patch.blockedBy ?? [],
      blocks: patch.blocks ?? [],
      description: patch.description,
      activeForm: patch.activeForm,
      owner: patch.owner,
    }
  }
  return {
    id: patch.id,
    subject: patch.subject || current.subject,
    description: patch.description ?? current.description,
    status: patch.status ?? current.status,
    activeForm: patch.activeForm ?? current.activeForm,
    blockedBy: patch.blockedBy ?? current.blockedBy,
    blocks: patch.blocks ?? current.blocks,
    owner: patch.owner ?? current.owner,
  }
}

function parseStatus(value: unknown): TaskBoardStatus | "deleted" | undefined {
  if (value === "pending" || value === "in_progress" || value === "completed") {
    return value
  }
  if (value === "deleted") {
    return "deleted"
  }
  return undefined
}

function parseJson(raw: string | undefined): unknown {
  if (raw === undefined) {
    return undefined
  }
  const trimmed = raw.trim()
  if (trimmed === "") {
    return undefined
  }
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed)
  const body = fenced?.[1]?.trim() ?? trimmed
  if (!body.startsWith("{") && !body.startsWith("[")) {
    return undefined
  }
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function stringValue(
  record: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (record === undefined) {
    return undefined
  }
  const value = record[key]
  if (typeof value !== "string" || value.trim() === "") {
    return undefined
  }
  return value
}

function stringValueAny(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = stringValue(record, key)
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== ""
  )
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function useful(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.length > 0 ? value : undefined
    }
    return Object.keys(value).length > 0 ? value : undefined
  }
  return value
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]/g, "")
}
