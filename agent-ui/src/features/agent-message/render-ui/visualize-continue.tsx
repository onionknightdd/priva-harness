import { createContext, useContext } from "react"

const VisualizeContinueContext = createContext<(message: string) => void>(() => {})

export function VisualizeContinueProvider({
  onContinue,
  children,
}: {
  onContinue: (message: string) => void
  children: React.ReactNode
}) {
  return (
    <VisualizeContinueContext.Provider value={onContinue}>
      {children}
    </VisualizeContinueContext.Provider>
  )
}

// oxlint-disable-next-line react/only-export-components -- the provider and its reader live together
export function useVisualizeContinue(): (message: string) => void {
  return useContext(VisualizeContinueContext)
}
