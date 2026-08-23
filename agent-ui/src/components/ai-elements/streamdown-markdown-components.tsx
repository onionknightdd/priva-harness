import type { Components } from "streamdown"

import { StreamdownMarkdownCode } from "./streamdown-markdown-code"

export const streamdownMarkdownComponents = {
  code: StreamdownMarkdownCode,
} satisfies Components
