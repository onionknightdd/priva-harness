import { isProcessBlock, textFromBlocks, type AgentThreadMessage, type StreamBlock } from "./agent-message-data"
import { isGeneratedVisualTool, isHiddenGeneratedVisual } from "./render-ui/lang"
import { finishedProgramRejected } from "./render-ui/visual-program"

export type AssistantPiece =
  | { kind: "process"; blocks: StreamBlock[] }
  | { kind: "visual"; block: Extract<StreamBlock, { type: "tool_use" }> }
  | { kind: "answer"; text: string }

/** Keep each generated visual above the answer text that follows it. */
export function assistantPieces(message: AgentThreadMessage): AssistantPiece[] {
  const blocks = [...(message.blocks ?? [])].sort((left, right) => left.index - right.index)
  const answer = answerBlock(blocks)
  const pieces: AssistantPiece[] = []
  let process: StreamBlock[] = []
  const flush = () => {
    if (process.length === 0) return
    pieces.push({ kind: "process", blocks: process })
    process = []
  }
  for (const block of blocks) {
    if (block.type === "tool_use" && isGeneratedVisualTool(block.name)) {
      if (isHiddenGeneratedVisual(block) || finishedProgramRejected(block)) continue
      flush()
      pieces.push({ kind: "visual", block })
      continue
    }
    if (answer !== undefined && block.type === "text" && block.blockId === answer.blockId) {
      flush()
      pieces.push({ kind: "answer", text: block.text })
      continue
    }
    if (isProcessBlock(block, blocks)) process.push(block)
  }
  flush()
  const hasAnswer = pieces.some((piece) => piece.kind === "answer")
  if (!hasAnswer && message.content.trim() !== "" && answer === undefined) {
    pieces.push({ kind: "answer", text: message.content })
  }
  return pieces
}

function answerBlock(blocks: readonly StreamBlock[]): Extract<StreamBlock, { type: "text" }> | undefined {
  const text = textFromBlocks(blocks)
  if (text.trim() === "") return undefined
  return [...blocks].reverse().find((block): block is Extract<StreamBlock, { type: "text" }> =>
    block.type === "text" && block.text.trim() === text.trim())
}
