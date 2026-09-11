import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import ApprovalCard from "@/components/primitives/ApprovalCard"
import { ToolApproval, ToolApprovalCode, type ToolApprovalStatus } from "@/components/agents/tool-approval"
import type { InteractionRequest, InteractionResolution, InteractionResponse } from "../interaction-data"

export function InteractionCard({ request, count, connected, onRespond }: {
  request: InteractionRequest
  count: number
  connected: boolean
  onRespond: (response: InteractionResponse) => Promise<void>
}) {
  const { t } = useTranslation()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)
  const respond = async (response: InteractionResponse) => {
    if (sending.current || !connected) return
    sending.current = true
    setSubmitting(true)
    setError(null)
    try { await onRespond(response) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { sending.current = false; setSubmitting(false) }
  }
  const skip = () => { void respond({ requestId: request.requestId, decision: "deny" }) }
  return <div data-interaction-card={request.kind} className="w-full min-w-0">
    {count > 1 ? <p className="mb-2 text-xs text-muted-foreground">{t("interaction.pendingCount", { count })}</p> : null}
    {request.kind === "question" ? <ApprovalCard
      questions={request.questions.map((question) => ({ id: question.id, q: question.question, type: question.multiSelect ? "check" : "radio", options: question.options, allowCustom: question.allowCustom, initialText: question.initialText, multiline: question.multiline }))}
      labels={{ skip: t("interaction.skip"), continue: t("interaction.continue"), send: t("interaction.send"),
        customPlaceholder: t("interaction.custom"), previous: t("interaction.previous"), next: t("interaction.next"), submitting: t("interaction.submitting") }}
      disabled={!connected} submitting={submitting} onSkip={skip}
      onSubmitted={(answers) => { void respond({ requestId: request.requestId, decision: "allow", answers }) }}
    /> : <ToolApproval
      tool={request.tool} title={request.title ?? t("interaction.toolTitle")} description={request.reason}
      defaultOpen status={submitting ? "approving" : "pending"} disabled={!connected}
      parameters={Object.entries(request.input && typeof request.input === "object" ? request.input : {}).map(([key, value]) => ({
        id: key, label: key, value: <ToolApprovalCode code={typeof value === "string" ? value : JSON.stringify(value, null, 2)} language={key === "command" ? "bash" : typeof value === "string" ? "text" : "json"} />,
      }))}
      onApprove={() => { void respond({ requestId: request.requestId, decision: "allow" }) }} onDeny={skip}
      labels={{ title: request.title ?? t("interaction.toolTitle"), details: t("interaction.details"), allow: t("interaction.allow"), deny: t("interaction.skip"), alwaysAllow: "",
        statuses: Object.fromEntries(["pending", "approving", "approved", "denied", "running", "complete", "error"].map((status) => [status, t(`interaction.status.${status}`)])) as Record<ToolApprovalStatus, string> }}
    />}
    {!connected ? <p role="status" className="mt-2 text-xs text-muted-foreground">{t("interaction.disconnected")}</p> : null}
    {error ? <p role="alert" className="mt-2 text-xs text-destructive">{t("interaction.failed")} {error}</p> : null}
  </div>
}

export function QuestionSummary({ resolution, output, skipped }: { resolution?: InteractionResolution; output?: string; skipped?: boolean }) {
  const { t } = useTranslation()
  const request = resolution?.request
  const denied = resolution ? resolution.decision === "deny" : skipped
  return <details className="my-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
    <summary className="cursor-pointer text-muted-foreground">{t(denied ? "interaction.skipped" : "interaction.answered")}</summary>
    {request?.kind === "question" ? <dl className="mt-2 space-y-2">
      {request.questions.map((question) => {
        const answer = resolution?.answers?.[question.id]
        return <div key={question.id}><dt className="break-words font-medium">{question.question}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">{answer ? [...answer.selected, answer.text.trim()].filter(Boolean).join("; ") : t("interaction.skipped")}</dd></div>
      })}
    </dl> : output ? <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{output}</p> : null}
  </details>
}
