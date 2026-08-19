import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import type { ChatMessage } from "../chat-data"
import { ChatComposer } from "./chat-composer"
import { ChatEmptyState } from "./chat-empty-state"
import { ChatThread } from "./chat-thread"

const composerTransition = {
  type: "spring",
  stiffness: 420,
  damping: 34,
  mass: 0.75,
} as const

export function ChatWorkspace({
  draft,
  messages,
  onDraftChange,
  onSubmit,
}: {
  draft: string
  messages: ChatMessage[]
  onDraftChange: (draft: string) => void
  onSubmit: () => void
}) {
  const { t } = useTranslation()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const isEmpty = messages.length === 0
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : composerTransition

  const composer = (
    <motion.div
      layoutId={shouldReduceMotion ? undefined : "chat-composer"}
      className="w-full max-w-3xl"
      transition={transition}
    >
      <ChatComposer
        draft={draft}
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
      />
    </motion.div>
  )

  return (
    <section
      aria-label={t("chat.contentLabel")}
      className="flex min-h-0 flex-1 flex-col overflow-hidden p-4 pt-0"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {isEmpty ? (
          <motion.div
            key="chat-empty"
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6"
            initial={
              shouldReduceMotion ? false : { opacity: 0, y: 8 }
            }
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0 }}
            transition={transition}
          >
            <ChatEmptyState />
            {composer}
          </motion.div>
        ) : (
          <motion.div
            key="chat-thread"
            className="flex min-h-0 flex-1 flex-col"
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0 }}
            transition={transition}
          >
            <div className="min-h-0 flex-1">
              <ChatThread messages={messages} />
            </div>
            <div className="mx-auto flex w-full max-w-3xl justify-center pt-3">
              {composer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
