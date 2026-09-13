import { createContext } from "react"
import type { MessageSelection } from "./message-select-action"

export type QuoteInChat =
  | { type: "selection"; selection: MessageSelection }
  | { type: "file"; path: string }
export type OnQuoteInChat = (quote: QuoteInChat) => void

export const QuoteInChatContext = createContext<OnQuoteInChat | null>(null)
