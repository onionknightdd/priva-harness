import * as React from "react"

import { PreviewRequestState } from "./preview-request-state"

type PreviewRendererBoundaryState = {
  error: string | null
}

export class PreviewRendererBoundary extends React.Component<
  React.PropsWithChildren,
  PreviewRendererBoundaryState
> {
  state: PreviewRendererBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.message : String(error),
    }
  }

  render() {
    if (this.state.error) {
      return <PreviewRequestState error={this.state.error} />
    }

    return this.props.children
  }
}
