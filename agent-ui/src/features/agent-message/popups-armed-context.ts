import { createContext } from "react"

/**
 * Whether popup roots (context menus and similar Base UI trees) inside a
 * message should be mounted. A message provides `false` until the pointer or
 * keyboard focus reaches it, so a long transcript does not pay for hundreds of
 * menu roots up front. Outside a message the default keeps them eager.
 */
export const PopupsArmedContext = createContext(true)
