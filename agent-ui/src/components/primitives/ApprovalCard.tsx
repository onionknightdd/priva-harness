"use client"
// Adapted from https://www.beautifului.dev/r/approval-card.json.
// Keep the sequential questions, step navigation and sliding hover layer;
// submission and dismissal are owned by the server-backed interaction.
import { useCallback, useEffect, useId, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EASE_OUT } from "@/lib/ease"
import GlideMenu from "./GlideMenu"

export interface ApprovalQuestion {
  id: string
  q: string
  type: "radio" | "check"
  allowCustom?: boolean
  initialText?: string
  multiline?: boolean
  options: { label: string; description?: string }[]
}
export interface ApprovalAnswer { selected: string[]; text: string }
export interface ApprovalLabels {
  skip: string; continue: string; send: string; customPlaceholder: string
  previous: string; next: string; submitting: string
}

export default function ApprovalCard({ questions, labels, disabled = false, submitting = false, onSubmitted, onSkip }: {
  questions: ApprovalQuestion[]
  labels: ApprovalLabels
  disabled?: boolean
  submitting?: boolean
  onSubmitted: (answers: Record<string, ApprovalAnswer>) => void
  onSkip: () => void
}) {
  const [qi, setQi] = useState(0)
  const [answers, setAnswers] = useState<Record<string, ApprovalAnswer>>(() => Object.fromEntries(questions.map((question) => [question.id, { selected: [], text: question.initialText ?? "" }])))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reduce = Boolean(useReducedMotion())
  const keyboard = useRef(false)
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => { node?.focus({ preventScroll: true }) }, [])
  const headingId = useId()
  const question = questions[qi]
  const selected = question ? answers[question.id] ?? { selected: [], text: "" } : { selected: [], text: "" }
  const hasAnswer = (answer?: ApprovalAnswer) => Boolean(answer && (answer.selected.length || answer.text.trim()))
  const last = qi === questions.length - 1
  const locked = disabled || submitting
  const clearAdvance = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  useEffect(() => { if (disabled || submitting) clearAdvance() }, [disabled, submitting])

  const goTo = (next: number) => {
    clearAdvance()
    setQi(Math.max(0, Math.min(questions.length - 1, next)))
  }
  const send = () => {
    clearAdvance()
    const missing = questions.findIndex((item) => !hasAnswer(answers[item.id]))
    if (missing >= 0) { goTo(missing); return }
    onSubmitted(answers)
  }
  const toggle = (index: number, viaKeyboard: boolean) => {
    if (locked || !question) return
    clearAdvance()
    keyboard.current = viaKeyboard
    const label = question.options[index].label
    const next = question.type === "radio" ? { selected: [label], text: "" } : {
      ...selected, selected: selected.selected.includes(label) ? selected.selected.filter((value) => value !== label) : [...selected.selected, label],
    }
    setAnswers((current) => ({ ...current, [question.id]: next }))
    // Auto-advance between questions; the final answer always has an explicit Send.
    if (question.type === "radio" && !last && !viaKeyboard) timer.current = setTimeout(() => goTo(qi + 1), 260)
  }
  if (!question) return null
  const AnswerInput = question.multiline ? Textarea : Input

  return (
    <section aria-labelledby={headingId} aria-busy={submitting} className="w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground">
      <div className="max-h-[min(50dvh,28rem)] overflow-y-auto overscroll-contain p-4 sm:p-5">
        <AnimatePresence initial={false} mode="wait">
          <motion.div key={question.id}
            initial={reduce || keyboard.current ? false : { opacity: 0, transform: "translateY(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }} exit={{ opacity: 0 }}
            transition={{ duration: reduce || keyboard.current ? 0 : 0.16, ease: EASE_OUT }}>
            <h3 ref={focusHeading} id={headingId} tabIndex={-1} className="pr-2 text-sm leading-6 font-medium break-words outline-none">{question.q}</h3>
            <GlideMenu className="mt-2.5 flex flex-col gap-1" highlightClassName="inset-x-0 rounded-lg bg-muted">
              {question.options.map((option, index) => {
                const on = selected.selected.includes(option.label)
                return <button key={option.label} type="button" data-menu-row aria-pressed={on} disabled={locked}
                  onClick={(event) => toggle(index, event.detail === 0)}
                  className="relative z-10 flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-60">
                  <span aria-hidden="true" className={`mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-colors duration-150 motion-reduce:transition-none ${question.type === "radio" ? "rounded-full" : "rounded"} ${on ? "border-primary bg-primary text-primary-foreground" : "border-input text-transparent"}`}>
                    {question.type === "radio" ? <span className={`size-1.5 rounded-full ${on ? "bg-primary-foreground" : "bg-transparent"}`} /> : <CheckIcon className="size-3" />}
                  </span>
                  <span className="min-w-0 text-sm leading-5 break-words">{option.label}{option.description ? <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.description}</span> : null}</span>
                </button>
              })}
              {question.allowCustom !== false ? <div className="relative z-10 mt-1 px-1">
                <AnswerInput value={selected.text} disabled={locked} aria-label={labels.customPlaceholder} placeholder={labels.customPlaceholder}
                  onChange={(event) => {
                    clearAdvance()
                    setAnswers((current) => ({ ...current, [question.id]: { selected: question.type === "radio" ? [] : selected.selected, text: event.target.value } }))
                  }}
                  onKeyDown={(event) => {
                    keyboard.current = true
                    if (!question.multiline && event.key === "Enter" && !event.nativeEvent.isComposing && hasAnswer(selected) && !locked) {
                      event.preventDefault(); if (last) send(); else goTo(qi + 1)
                    }
                  }} />
              </div> : null}
            </GlideMenu>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Button size="icon-xs" variant="ghost" aria-label={labels.previous} disabled={locked || qi === 0} onClick={(event) => { keyboard.current = event.detail === 0; goTo(qi - 1) }}><ChevronUpIcon /></Button>
          <span aria-live="polite" className="min-w-10 text-center text-xs tabular-nums">{qi + 1} / {questions.length}</span>
          <Button size="icon-xs" variant="ghost" aria-label={labels.next} disabled={locked || last || !hasAnswer(selected)} onClick={(event) => { keyboard.current = event.detail === 0; goTo(qi + 1) }}><ChevronDownIcon /></Button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" disabled={locked} onClick={() => { clearAdvance(); onSkip() }}>{labels.skip}</Button>
          <Button size="sm" className="rounded-full" disabled={locked || !hasAnswer(selected)} onClick={(event) => { keyboard.current = event.detail === 0; if (last) send(); else goTo(qi + 1) }}>
            {submitting ? labels.submitting : last ? labels.send : labels.continue}
          </Button>
        </div>
      </div>
    </section>
  )
}
