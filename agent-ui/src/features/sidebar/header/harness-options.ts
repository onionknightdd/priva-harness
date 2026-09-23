export const harnessIds = ["pi", "claude"] as const

export type HarnessId = (typeof harnessIds)[number]

export const RUN_HARNESS_IDS = ["pi", "claude"] as const

export type RunHarnessId = (typeof RUN_HARNESS_IDS)[number]

export type HarnessOption = {
  id: HarnessId
  nameKey: string
  packageName: string
}

export const DEFAULT_HARNESS_ID: HarnessId = "claude"

export const harnessOptions = [
  {
    id: "pi",
    nameKey: "sidebar.harness.pi.name",
    packageName: "@earendil-works/pi-coding-agent",
  },
  {
    id: "claude",
    nameKey: "sidebar.harness.claude.name",
    packageName: "@anthropic-ai/claude-agent-sdk",
  },
] as const satisfies readonly HarnessOption[]

export function getHarnessOption(id: HarnessId): HarnessOption {
  return harnessOptions.find((option) => option.id === id) ?? harnessOptions[0]
}

export function isSelectableHarnessId(value: string): value is HarnessId {
  return harnessOptions.some((option) => option.id === value)
}

export function toRunHarnessId(id: HarnessId): RunHarnessId | null {
  if (id === "claude" || id === "pi") {
    return id
  }

  return null
}
