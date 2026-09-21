import * as React from "react"

import { getStrictContext } from "@/lib/get-strict-context"
import {
  initialSessionViewState,
  selectSessionView,
  shouldResetSessionView,
  type SessionView,
  type SessionViewIdentity,
  type SessionViewState,
} from "./session-view"

type SessionViewContextValue = SessionViewState & {
  setView: (view: SessionView) => void
}

const [SessionViewContextProvider, useSessionViewContext] =
  getStrictContext<SessionViewContextValue>("SessionView")

export function SessionViewProvider({
  chatKey,
  sessionId,
  children,
}: SessionViewIdentity & { children: React.ReactNode }) {
  const [state, setState] = React.useState<SessionViewState>(initialSessionViewState)
  // Derived-from-props reset during render (React's "information from previous
  // renders" pattern) so the view never flashes the stale state for a frame.
  const [identity, setIdentity] = React.useState<SessionViewIdentity>({ chatKey, sessionId })
  if (identity.chatKey !== chatKey || identity.sessionId !== sessionId) {
    if (shouldResetSessionView(identity, { chatKey, sessionId })) setState(initialSessionViewState)
    setIdentity({ chatKey, sessionId })
  }
  const setView = React.useCallback((view: SessionView) => {
    setState((previous) => selectSessionView(previous, view))
  }, [])
  const value = React.useMemo<SessionViewContextValue>(
    () => ({ view: state.view, terminalOpened: state.terminalOpened, setView }),
    [state.view, state.terminalOpened, setView]
  )
  return <SessionViewContextProvider value={value}>{children}</SessionViewContextProvider>
}

export function useSessionView(): SessionViewContextValue {
  return useSessionViewContext()
}
