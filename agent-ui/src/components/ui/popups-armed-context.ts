import { createContext } from "react"

/**
 * Whether popup roots (tooltips, context menus and similar Base UI trees)
 * inside a subtree should be mounted. A dense container such as a transcript
 * message provides `false` until the pointer or keyboard focus reaches it, so
 * a long thread does not pay for hundreds of popup roots up front. Elsewhere
 * the default keeps them eager.
 */
export const PopupsArmedContext = createContext(true)
