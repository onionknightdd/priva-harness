import { createContext } from "react"

export const WhiteboardDrawingContext = createContext<{
  drawingStarted(id: string, revision: number): void
  drawingFinished(id: string, revision: number): void
}>({ drawingStarted() {}, drawingFinished() {} })
