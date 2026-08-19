export const harnessIds = ["bambuddy", "claude", "deepseek"] as const

export type HarnessId = (typeof harnessIds)[number]

export type HarnessOption = {
  id: HarnessId
  nameKey: string
  descriptionKey: string
  disabled: boolean
}

export const DEFAULT_HARNESS_ID: HarnessId = "bambuddy"

export const harnessOptions = [
  {
    id: "bambuddy",
    nameKey: "sidebar.harness.bambuddy.name",
    descriptionKey: "sidebar.harness.bambuddy.description",
    disabled: false,
  },
  {
    id: "claude",
    nameKey: "sidebar.harness.claude.name",
    descriptionKey: "sidebar.harness.claude.description",
    disabled: false,
  },
  {
    id: "deepseek",
    nameKey: "sidebar.harness.deepseek.name",
    descriptionKey: "sidebar.harness.deepseek.description",
    disabled: true,
  },
] as const satisfies readonly HarnessOption[]

export function getHarnessOption(id: HarnessId): HarnessOption {
  return harnessOptions.find((option) => option.id === id) ?? harnessOptions[0]
}

export function isSelectableHarnessId(value: string): value is HarnessId {
  return harnessOptions.some(
    (option) => option.id === value && !option.disabled
  )
}
