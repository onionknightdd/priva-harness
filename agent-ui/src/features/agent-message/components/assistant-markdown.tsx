import { useMemo, type ReactNode } from "react"
import { defaultRemarkPlugins } from "streamdown"

import { MessageResponse, type MessageResponseProps } from "@/components/ai-elements/message"
import { fileNameFromPath } from "@/lib/file-path"

import { remarkSandboxFileLinks, sandboxFilePath } from "../sandbox-markdown-links"
import { AssistantFileReference } from "./assistant-file-reference"
import { AssistantMarkdownCode } from "./assistant-markdown-code"
import { parseDashboardMarkdown, remarkDashboardImages } from "../a2ui-markdown"
import { DashboardMarkdownProvider, MarkdownA2ui } from "../markdown-a2ui"

function AssistantSandboxFile({ url, label, children }: Record<string, unknown>) {
  // allowedTags also permits raw HTML, so validate at the renderer boundary.
  const path = sandboxFilePath(url)
  if (!path || typeof label !== "string") return <>{children as ReactNode}</>
  return <AssistantFileReference path={path} label={label || fileNameFromPath(path)} wrap />
}

const assistantMarkdownProps = {
  remarkPlugins: [...Object.values(defaultRemarkPlugins), remarkSandboxFileLinks, remarkDashboardImages],
  allowedTags: { "sandbox-file": ["url", "label"], "agent-dashboard": ["embed", "label"] },
  components: { code: AssistantMarkdownCode, "sandbox-file": AssistantSandboxFile, "agent-dashboard": MarkdownA2ui },
} satisfies Pick<MessageResponseProps, "remarkPlugins" | "allowedTags" | "components">

export function AssistantMarkdown({ messageId, children, ...props }: Omit<MessageResponseProps, "remarkPlugins" | "allowedTags" | "components"> & { messageId: string }) {
  const parsed = useMemo(() => parseDashboardMarkdown(children ?? "", Boolean(props.isAnimating)), [children, props.isAnimating])
  return <DashboardMarkdownProvider messageId={messageId} definitions={parsed.definitions}>
    <MessageResponse {...props} {...assistantMarkdownProps}>{parsed.markdown}</MessageResponse>
  </DashboardMarkdownProvider>
}
