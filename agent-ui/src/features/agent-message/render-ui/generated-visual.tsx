import "./disable-devtools"
import "@openuidev/react-ui/styles/button.css"
import "@openuidev/react-ui/styles/card.css"
import "@openuidev/react-ui/styles/cardHeader.css"
import "@openuidev/react-ui/styles/tag.css"

import { BuiltinActionType, Renderer, type ActionEvent } from "@openuidev/react-lang"
import { ThemeProvider, type ThemeMode } from "@openuidev/react-ui/ThemeProvider"
import { useTheme } from "next-themes"

import { Skeleton } from "@/components/ui/skeleton"

import type { StreamBlock } from "../agent-message-data"
import { isToolRunning } from "../tool-activity"
import { interactiveVisualizeLibrary, staticVisualizeLibrary } from "./library"
import { generatedVisualKind, isHiddenGeneratedVisual, renderUiLangFromTool } from "./lang"
import { useVisualizeContinue } from "./visualize-continue"

const openUiScope = "[data-slot='generated-visual']"

export function GeneratedVisual({
  block,
}: {
  block: Extract<StreamBlock, { type: "tool_use" }>
}) {
  const continueTurn = useVisualizeContinue()
  const { resolvedTheme } = useTheme()
  const mode: ThemeMode = resolvedTheme === "dark" || resolvedTheme === "light"
    ? resolvedTheme
    : document.documentElement.classList.contains("dark")
      ? "dark"
      : "light"
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
  if (isHiddenGeneratedVisual(block)) return null

  return (
    <div data-slot="generated-visual" className="min-w-0 px-1">
      <ThemeProvider cssSelector={openUiScope} mode={mode}>
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
      </ThemeProvider>
    </div>
  )
}
