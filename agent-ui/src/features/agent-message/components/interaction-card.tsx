import { useId, useRef, useState, type ReactNode, type Ref } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, MessageCircleQuestionMark, TriangleAlert } from "lucide-react"
import { AnimatePresence, LayoutGroup, motion, useIsPresent, usePresenceData, useReducedMotionConfig } from "motion/react"
import { MessageResponse } from "@/components/ai-elements/message"
import ApprovalCard from "@/components/primitives/ApprovalCard"
import { ToolApproval, ToolApprovalCode, type ToolApprovalStatus } from "@/components/agents/tool-approval"
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible"
import { focusRing } from "@/lib/surfaces"
import { cn } from "@/lib/utils"
import type { InteractionRequest, InteractionResolution, InteractionResponse } from "../interaction-data"
import { questionSummaryMask, questionSummaryTransition } from "../question-summary-motion"

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
  const reduce = Boolean(useReducedMotionConfig())
  const [open, setOpen] = useState(false)
  const [keyboard, setKeyboard] = useState(false)
  const contentId = useId()
  const instant = reduce || keyboard
  const layoutTransition = questionSummaryTransition(open, instant)
  const request = resolution?.request
  const denied = resolution ? resolution.decision === "deny" : skipped
  const statusLabel = t(denied ? (resolution?.reason === "cancelled" ? "toolCard.cancelled" : "interaction.skipped") : "interaction.answered")
  return <LayoutGroup><Collapsible open={open} onOpenChange={(nextOpen, details) => {
    setKeyboard(!("detail" in details.event) || details.event.detail === 0)
    setOpen(nextOpen)
  }} data-question-summary={denied ? "skipped" : "answered"}
    className="relative my-2 ml-auto w-max min-w-0 max-w-full overflow-hidden rounded-lg border border-border px-3 py-2 text-ui text-foreground"
    render={<motion.div layout layoutDependency={open} style={{ originX: 1, originY: 0 }}
      initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }}
      transition={{ opacity: { duration: reduce ? 0 : 0.15 }, layout: layoutTransition }} />}>
    <CollapsibleTrigger aria-controls={open ? contentId : undefined}
      render={<motion.button layout layoutDependency={open} transition={{ layout: layoutTransition }} />}
      className={cn("flex w-full cursor-pointer items-center gap-2 rounded-sm text-left text-muted-foreground", focusRing)}>
      <motion.span layout="position" layoutDependency={open} transition={{ layout: layoutTransition }}
        className="flex items-center gap-2">
        {denied ? <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-status-warning" />
          : <MessageCircleQuestionMark aria-hidden="true" className="size-4 shrink-0 text-background [&>path:first-child]:fill-status-success [&>path:first-child]:stroke-status-success" />}
        <span>{statusLabel}</span>
      </motion.span>
      <motion.span aria-hidden="true" layout="position" layoutDependency={open} layoutAnchor={{ x: 1, y: 0 }}
        transition={{ layout: layoutTransition }} className="ml-auto flex size-3.5 shrink-0">
        <motion.span className="flex size-full" initial={false}
          animate={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }} transition={layoutTransition}>
          <ChevronDown className="size-full" />
        </motion.span>
      </motion.span>
    </CollapsibleTrigger>
    <AnimatePresence initial={false} custom={instant} mode="popLayout" anchorX="right">
    {open ? <QuestionSummaryBody key="answers" id={contentId}>
    {request?.kind === "question" ? <div className="min-w-0 space-y-3 pt-3">
      {request.questions.map((question) => {
        const answer = resolution?.answers?.[question.id]
        const text = answer ? [...answer.selected, ...(answer.text.trim() ? [answer.text] : [])].join("; ") : denied ? statusLabel : t("interaction.skipped")
        const quote = question.question.split(/\r\n?|\n/).map((line) => `> ${line}`).join("\n")
        return <div key={question.id} data-question-pair className="min-w-0">
            <MessageResponse mode="static" animated={false} isAnimating={false}
              className="[overflow-wrap:anywhere] [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:not-italic [&_p]:leading-6">
              {quote}
            </MessageResponse>
            <QuestionAnswerText>{text}</QuestionAnswerText>
        </div>
      })}
    </div> : output ? <QuestionAnswerText>{output}</QuestionAnswerText> : null}
    </QuestionSummaryBody> : null}
    </AnimatePresence>
  </Collapsible></LayoutGroup>
}

const questionBodyMotion = {
  open: (instant: boolean) => ({ maskImage: questionSummaryMask.open, transition: questionSummaryTransition(true, instant) }),
  closed: (instant: boolean) => ({ maskImage: questionSummaryMask.closed, transition: questionSummaryTransition(false, instant) }),
}

function QuestionSummaryBody({ children, id, ref }: { children: ReactNode; id: string; ref?: Ref<HTMLDivElement> }) {
  const present = useIsPresent()
  const instant = Boolean(usePresenceData())
  // Keep the exit out of flow while popLayout removes its stylesheet during unmount.
  return <motion.div ref={ref} id={id} layout="position" layoutDependency={false} custom={instant} variants={questionBodyMotion}
    initial="closed" animate="open" exit="closed" aria-hidden={!present} inert={!present}
    className={cn("min-w-0 text-sm", !present && "absolute pointer-events-none")}
    transition={{ layout: questionSummaryTransition(present, instant) }}>
    {children}
  </motion.div>
}

function QuestionAnswerText({ children }: { children: string }) {
  return <p data-question-answer className="mt-2 flex min-w-0 items-baseline gap-2 [overflow-wrap:anywhere]">
    <span aria-hidden="true" className="shrink-0 text-muted-foreground before:content-['>']" />
    <span className="min-w-0 whitespace-pre-wrap">{children}</span>
  </p>
}
