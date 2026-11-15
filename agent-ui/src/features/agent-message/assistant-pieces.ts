import { isProcessBlock, textFromBlocks, type AgentThreadMessage, type StreamBlock } from "./agent-message-data"

export type AssistantPiece =
  | { kind: "process"; blocks: StreamBlock[] }
  | { kind: "answer"; text: string }

/** Keep the assistant's Markdown reply separate from its tool/thinking process. */
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
