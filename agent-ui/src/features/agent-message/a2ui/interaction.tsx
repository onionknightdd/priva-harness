import { createContext, useContext } from "react"

export const A2uiInteractionContext = createContext(false)
export const useA2uiInteraction = () => useContext(A2uiInteractionContext)
