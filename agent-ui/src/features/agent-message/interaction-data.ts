export interface InteractionQuestion {
  id: string
  question: string
  header?: string
  options: { label: string; description?: string }[]
  multiSelect: boolean
  allowCustom?: boolean
  initialText?: string
  multiline?: boolean
}
export interface QuestionAnswer { selected: string[]; text: string }
interface RequestBase {
  requestId: string
  tool: string
  toolUseId?: string
  input?: unknown
  title?: string
  reason?: string
  expiresAt: number
}
export type InteractionRequest = RequestBase & (
  | { kind: "tool" }
  | { kind: "question"; questions: InteractionQuestion[] }
)
export type InteractionResponse = { requestId: string } & (
  | { decision: "allow"; answers?: Record<string, QuestionAnswer> }
  | { decision: "deny" }
)
export interface InteractionResolution {
  request: InteractionRequest
  decision: "allow" | "deny"
  reason: "answered" | "skipped" | "timeout" | "cancelled"
  answers?: Record<string, QuestionAnswer>
}

export function updateInteractions(pending: InteractionRequest[], frame: {
  type?: string; interactions?: InteractionRequest[]; request?: InteractionRequest; resolution?: InteractionResolution
}): InteractionRequest[] {
  if (frame.type === "session.snapshot") return frame.interactions ?? []
  if (frame.type === "permission.requested" && frame.request) {
    return pending.some((item) => item.requestId === frame.request!.requestId) ? pending : [...pending, frame.request]
  }
  if (frame.type === "permission.resolved" && frame.resolution) return pending.filter((item) => item.requestId !== frame.resolution!.request.requestId)
  return pending
}

export function isQuestionTool(name: string): boolean {
  return ["askuserquestion", "ask_user_question"].includes(name.toLowerCase())
}
