import type { RunHarnessId } from "@/features/sidebar/header/harness-options"

export type SessionView = "chat" | "terminal"

// Harnesses whose runner provider exposes a terminal-hosted TUI. Mirrors the
// providers that implement `terminalLaunch` on the backend.
const TERMINAL_HARNESSES: ReadonlySet<RunHarnessId> = new Set(["claude"])

export function harnessSupportsTerminal(harness: RunHarnessId | null): boolean {
  return harness !== null && TERMINAL_HARNESSES.has(harness)
}

export type SessionViewState = {
  view: SessionView
  /** True once the terminal was shown for this conversation; it then stays mounted while hidden. */
  terminalOpened: boolean
}

export const initialSessionViewState: SessionViewState = { view: "chat", terminalOpened: false }

export function selectSessionView(state: SessionViewState, view: SessionView): SessionViewState {
  return { view, terminalOpened: state.terminalOpened || view === "terminal" }
}

export type SessionViewIdentity = {
  /** Bumps whenever a new chat is started from the sidebar. */
  chatKey: string
  /** Session shown on screen, or null for a conversation that has not started. */
  sessionId: string | null
}

/**
 * Whether a change of the conversation identity should reset the view.
 * A fresh conversation acquiring its first session id (null → id) is the
 * same conversation, so the terminal that created it must survive; any
 * other id change means the user opened a different session.
 */
export function shouldResetSessionView(previous: SessionViewIdentity, next: SessionViewIdentity): boolean {
  if (previous.chatKey !== next.chatKey) return true
  if (previous.sessionId === next.sessionId) return false
  return previous.sessionId !== null
}
