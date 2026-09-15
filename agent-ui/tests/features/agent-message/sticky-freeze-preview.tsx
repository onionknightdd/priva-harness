import { createRoot } from "react-dom/client"

import { StickyFreeze } from "../../../src/features/agent-message/components/sticky-freeze"
import "../../../src/index.css"

const host = document.querySelector("#preview")
if (!host) {
  throw new Error("Missing #preview")
}

createRoot(host).render(
  <div className="mx-auto max-w-3xl p-4 text-foreground">
    <h2 className="mb-2 text-sm font-medium">Stuck user message glass</h2>
    <p className="mb-3 text-xs text-muted-foreground">
      Scroll the transcript. The blank width around the frozen user bubble should frost; the bubble stays opaque.
    </p>
    <div
      data-slot="message-scroller-viewport"
      className="h-[420px] overflow-y-auto overscroll-contain contain-content rounded-lg border border-border bg-background"
    >
      <div className="flex flex-col gap-6 p-6">
        {Array.from({ length: 6 }, (_, index) => (
          <p key={`before-${index}`} className="text-ui leading-relaxed">
            Assistant reply {index + 1}. The frozen user bar should blur this text as it passes underneath the empty width.
            {" "}
            助手回复会从吸附气泡左侧的空白区下方滚过。
          </p>
        ))}
        <StickyFreeze className="z-20" surface="glass">
          <div className="flex w-full justify-end">
            <div
              data-user-message-bubble
              className="w-fit max-w-[80%] rounded-lg bg-user-message px-4 py-3 text-ui"
            >
              Freeze this user message against the header.
            </div>
          </div>
        </StickyFreeze>
        {Array.from({ length: 18 }, (_, index) => (
          <p
            key={`after-${index}`}
            className="rounded-md px-2 py-3 text-ui leading-relaxed"
            style={{ background: index % 2 === 0 ? "var(--muted)" : "transparent" }}
          >
            Streaming content {index + 1}: tool output, markdown, and code that should remain readable through the frosted blank area.
            {" "}
            条纹底能看出毛玻璃是否生效。
          </p>
        ))}
      </div>
    </div>
  </div>
)
