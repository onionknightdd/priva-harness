import { Component, useEffect, useEffectEvent, useState, type ErrorInfo, type ReactNode } from "react"
import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react"
import {
  MessageProcessor, STRICT_VALIDATION,
  type ActionPayload, type AgentToRendererMessage, type SurfaceModel,
} from "@a2ui/web_core/v1_0"

import { cn } from "@/lib/utils"
import { a2uiCatalog } from "./catalog"
import { A2uiInteractionContext } from "./interaction"
import "./a2ui.css"

export type A2uiAction = ActionPayload

type SurfaceState = { revision: number; surfaces: SurfaceModel<ReactCatalogComponent>[]; error?: string }

class SurfaceBoundary extends Component<{ children: ReactNode; onError?: (error: string) => void }, { error?: string }> {
  state: { error?: string } = {}
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("A2UI surface failed", error, info.componentStack)
    this.props.onError?.(error.message)
  }
  render() {
    return this.state.error ? <p role="alert" className="text-sm text-destructive">{this.state.error}</p> : this.props.children
  }
}

/** Each compiled Markdown embed owns its data model; replay never re-emits actions. */
export function A2uiVisual({ messages, onAction, onError, className }: {
  messages: readonly AgentToRendererMessage[]
  onAction?: (action: A2uiAction) => void | Promise<void>
  onError?: (error: string) => void
  className?: string
}) {
  const [state, setState] = useState<SurfaceState>({ revision: 0, surfaces: [] })
  const [actionError, setActionError] = useState<string>()
  const reportError = useEffectEvent((error: string) => onError?.(error))
  const handleAction = useEffectEvent(async (action: A2uiAction) => {
    setActionError(undefined)
    try { await onAction?.(action) } catch (error) {
      // The SDK emitter catches listener rejections. Surface the failure here,
      // while its awaited listener keeps the originating button pending.
      setActionError(error instanceof Error ? error.message : String(error))
    }
  })
  useEffect(() => {
    setActionError(undefined)
    const processor = new MessageProcessor<ReactCatalogComponent>([a2uiCatalog], handleAction, {
      version: "v1.0", validationConfig: STRICT_VALIDATION,
    })
    const subscriptions: { unsubscribe(): void }[] = []
    const created = processor.onSurfaceCreated((surface) => {
      subscriptions.push(surface.onError.subscribe((error) => {
        setState((previous) => ({ ...previous, error: error.message }))
        reportError(error.message)
      }))
    })
    try {
      processor.processMessages(messages)
      const surfaces = Array.from(processor.getSurfaces().values())
      setState((previous) => ({ revision: previous.revision + 1, surfaces, ...(surfaces.length === 0 ? { error: "The visualization contains no surface." } : {}) }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setState((previous) => ({ revision: previous.revision + 1, surfaces: [], error: message }))
      reportError(message)
    }
    return () => {
      created.unsubscribe()
      subscriptions.forEach((subscription) => subscription.unsubscribe())
      processor.dispose()
    }
  }, [messages])

  return <div data-slot="a2ui-visual" className={cn("a2ui-answer", className)}>
    {actionError ? <p role="alert" className="mb-3 text-sm text-destructive">{actionError}</p> : null}
    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
    <A2uiInteractionContext value={onAction !== undefined}>
      {state.surfaces.map((surface) => <SurfaceBoundary key={`${state.revision}-${surface.id}`} onError={onError}>
        <div className="a2ui-surface" data-a2ui-surface={surface.id}><A2uiSurface surface={surface} /></div>
      </SurfaceBoundary>)}
    </A2uiInteractionContext>
  </div>
}
