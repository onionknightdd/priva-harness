import { useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"

import { InputGroupButton } from "@/components/ui/input-group"
import { TooltipHint } from "@/components/ui/tooltip"
import { EASE_OUT_CSS } from "@/lib/ease"

// Same four marks as QiIconAi. Owned here so the paths stay mounted:
// the icon package rewrites its SVG on each render, which drops transitions.
const SHAPES = [
  { d: "M4 14H10V20H4V14Z", color: "rgb(0 191 162)" },
  { d: "M20.5 17C20.5 18.933 18.933 20.5 17 20.5C15.067 20.5 13.5 18.933 13.5 17C13.5 15.067 15.067 13.5 17 13.5C18.933 13.5 20.5 15.067 20.5 17Z", color: "rgb(75 155 255)" },
  { d: "M7 3L11 7L7 11L3 7L7 3Z", color: "rgb(255 202 58)" },
  { d: "M17.25 3.25L17.7486 4.31836C18.1459 5.16972 18.8303 5.85406 19.6816 6.2514L20.75 6.75L19.6816 7.2486C18.8303 7.64594 18.1459 8.33028 17.7486 9.18164L17.25 10.25L16.7514 9.18164C16.3541 8.33028 15.6697 7.64594 14.8184 7.2486L13.75 6.75L14.8184 6.2514C15.6697 5.85406 16.3541 5.16972 16.7514 4.31836L17.25 3.25Z", color: "rgb(253 47 73)" },
] as const

// Color spreads from the middle of each mark. The outline stays put.
const FILL_TRANSITION = `transform 400ms ${EASE_OUT_CSS}`

export function VisualizeModeButton({
  active,
  onChange,
}: {
  active: boolean
  onChange: (active: boolean) => void
}) {
  const { t } = useTranslation()
  const reduce = Boolean(useReducedMotion())
  const label = t(active ? "agentMessage.visualizeModeOn" : "agentMessage.visualizeModeOff")
  const detail = t("agentMessage.visualizeModeDetail")
  return (
    <TooltipHint content={`${label}\n${detail}`}>
      <InputGroupButton
        type="button"
        size="icon-xs"
        className="rounded-full"
        aria-pressed={active}
        aria-label={label}
        onClick={() => onChange(!active)}
      >
        <svg viewBox="0 0 24 24" className="size-5 text-muted-foreground" aria-hidden="true">
          {SHAPES.map((shape) => (
            <g key={shape.color}>
              <path
                d={shape.d}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={shape.d}
                fill={shape.color}
                stroke={shape.color}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={reduce ? { opacity: active ? 1 : 0 } : {
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  transform: active ? "scale(1)" : "scale(0)",
                  transition: FILL_TRANSITION,
                }}
              />
            </g>
          ))}
        </svg>
      </InputGroupButton>
    </TooltipHint>
  )
}
