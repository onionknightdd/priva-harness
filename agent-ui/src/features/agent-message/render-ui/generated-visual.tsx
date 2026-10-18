import "./disable-devtools"

import { BuiltinActionType, Renderer, type ActionEvent } from "@openuidev/react-lang"

import { Skeleton } from "@/components/ui/skeleton"

import type { StreamBlock } from "../agent-message-data"
import { isToolRunning } from "../tool-activity"
import { interactiveVisualizeLibrary, staticVisualizeLibrary } from "./library"
import { generatedVisualKind, renderUiLangFromTool } from "./lang"
import { useVisualizeContinue } from "./visualize-continue"

export function GeneratedVisual({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  const continueTurn = useVisualizeContinue()
  const tool = block.tool
  const running = isToolRunning(tool)
  const lang = renderUiLangFromTool(tool?.output, tool?.input ?? block.input, tool?.ok)
  const errorText = tool?.ok === false && !running ? (tool.output ?? "") : ""
  const library = generatedVisualKind(block.name) === "interactive"
    ? interactiveVisualizeLibrary
    : staticVisualizeLibrary
  const onAction = (event: ActionEvent) => {
    if (event.type !== BuiltinActionType.ContinueConversation) return
    const message = event.humanFriendlyMessage.trim()
    if (message !== "") continueTurn(message)
  }

  return (
    <div data-slot="generated-visual" className="min-w-0 px-1">
      {lang === "" && errorText !== "" ? (
        <p role="alert" className="text-sm text-destructive">{errorText}</p>
      ) : null}
      {lang === "" && errorText === "" ? <Skeleton className="h-32 w-full rounded-lg" /> : null}
      {lang !== "" ? (
        <>
          <Renderer
            response={lang}
            library={library}
            isStreaming={running}
            onAction={onAction}
          />
          {errorText !== "" ? (
            <p role="alert" className="mt-2 text-sm text-destructive">{errorText}</p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
