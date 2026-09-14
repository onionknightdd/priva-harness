import mcpIcon from "@lobehub/icons-static-svg/icons/mcp.svg"
import { useTranslation } from "react-i18next"

import { ToolResult } from "@/components/agents/tool-result"
import { cn } from "@/lib/utils"

import type { StreamBlock } from "../agent-message-data"
import { mcpToolInputText, type McpToolName } from "../mcp-tool-data"
import { isToolRunning } from "../tool-activity"

export function McpToolItem({
  block,
  name,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
  name: McpToolName
}) {
  const { t } = useTranslation()
  const tool = block.tool
  const status = tool?.backgroundTask?.status === "failed" ? "error"
    : isToolRunning(tool) ? "running" : tool?.ok === false ? "error" : "success"
  const input = mcpToolInputText(block)
  const output = tool?.output
  const copyText = [input, output].filter((text) => text !== undefined && text !== "").join("\n\n")

  return (
    <ToolResult
      tool={null}
      title={`${name.serverName}:${name.toolName}`}
      icon={
        <span
          data-slot="mcp-tool-icon"
          aria-hidden="true"
          className="block size-[1em] bg-current"
          style={{ maskImage: `url("${mcpIcon}")`, maskPosition: "center", maskRepeat: "no-repeat", maskSize: "contain" }}
        />
      }
      status={status}
      defaultOpen={status === "running"}
      copyText={copyText || undefined}
    >
      {input !== undefined || output ? (
        <dl className="flex min-w-0 flex-col gap-3">
          {input !== undefined ? (
            <div>
              <dt className="mb-1 text-xs text-muted-foreground">{t("toolCard.input")}</dt>
              <dd><pre className="whitespace-pre-wrap break-words font-mono text-sm text-muted-foreground [overflow-wrap:anywhere]">{input}</pre></dd>
            </div>
          ) : null}
          {output ? (
            <div>
              <dt className="mb-1 text-xs text-muted-foreground">{t("toolCard.output")}</dt>
              <dd><pre className={cn(
                "whitespace-pre-wrap break-words font-mono text-sm [overflow-wrap:anywhere]",
                status === "error" ? "text-destructive" : "text-muted-foreground"
              )} role={status === "error" ? "alert" : undefined}>{output}</pre></dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </ToolResult>
  )
}
