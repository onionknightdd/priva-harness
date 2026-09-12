import { createContext } from "react"

export type AssistantSelectionAction = "quote" | "explain" | "improve"
export type OnAssistantSelectionAction = (action: AssistantSelectionAction, text: string) => void

export const AssistantSelectionActionContext = createContext<OnAssistantSelectionAction | null>(null)
