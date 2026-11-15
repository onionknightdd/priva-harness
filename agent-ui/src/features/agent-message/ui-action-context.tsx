import { createContext, useContext, type ReactNode } from "react"

type ContinueTurn = (message: string) => void | Promise<void>
const UiActionContext = createContext<ContinueTurn | undefined>(undefined)

export function UiActionProvider({ onContinue, children }: { onContinue?: ContinueTurn; children: ReactNode }) {
  return <UiActionContext.Provider value={onContinue}>{children}</UiActionContext.Provider>
}

// oxlint-disable-next-line react/only-export-components -- provider and consumer form one context
export function useUiActionContinue() {
  return useContext(UiActionContext)
}
