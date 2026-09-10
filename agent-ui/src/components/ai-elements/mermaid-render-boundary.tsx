import { Component, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { CodeBlock } from "@/components/agents/code-block"

type MermaidRenderBoundaryProps = {
  code: string
  children: ReactNode
}

export class MermaidRenderBoundary extends Component<MermaidRenderBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <MermaidSourceFallback code={this.props.code} /> : this.props.children
  }
}

function MermaidSourceFallback({ code }: { code: string }) {
  const { t } = useTranslation()
  return (
    <div data-slot="mermaid-render-error" className="my-4 space-y-2">
      <p role="status" className="text-sm text-muted-foreground">{t("common.mermaidLoadFailed")}</p>
      <CodeBlock language="mermaid" code={code} />
    </div>
  )
}
