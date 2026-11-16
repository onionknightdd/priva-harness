import { createContext } from "react"
import type { BoardOperation } from "./whiteboard-model"

export const WhiteboardEditContext = createContext<{
  disabled: boolean
  write(ops: BoardOperation[]): void
  tableCell(id: string, row: number, column: number, text: string): void
}>({ disabled: true, write() {}, tableCell() {} })
