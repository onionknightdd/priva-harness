import { jsonRequest, resourceUrl, type ResourceList, type ResourceQuery, type ResourceSource } from "./resource-api"

export type AgentResourceKind = "subagents" | "memory"
export type Subagent = {
  id: string; sourceId: string; name: string; description: string; path: string
  model: string | null; enabled: boolean; effective: boolean | null
}
export type SubagentDetail = Subagent & {
  source: ResourceSource; definition: Record<string, unknown>; prompt: string; revision: string
}
export type SubagentCatalog = { tools: string[]; fields: string[]; memoryScopes: string[]; modelHint: string }
export type MemoryFile = {
  id: string; sourceId: string; name: string; path: string; kind: "instruction" | "auto" | "agent"
  exists: boolean; canDelete: boolean; size: number; enabled: boolean
}
export type MemoryDetail = MemoryFile & { source: ResourceSource; content: string; revision: string }
export type AutoMemoryProject = {
  sourceId: string; cwd: string; path: string; enabled: boolean; canToggle: boolean; settingsPath: string; reason: string | null
}
export type MemoryList = ResourceList<MemoryFile> & { autoMemory: AutoMemoryProject[] }
export type TestFrame = { type: string; text?: string; message?: string; name?: string; toolName?: string; output?: string; [key: string]: unknown }

/** Incremental SSE parsing keeps UTF-8 and event boundaries intact across network chunks. */
export async function consumeAgentTestStream(stream: ReadableStream<Uint8Array>, onFrame: (frame: TestFrame) => void): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const consume = (flush = false) => {
    buffer = buffer.replace(/\r\n/g, "\n")
    let boundary: number
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const event = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")
      if (data) onFrame(JSON.parse(data) as TestFrame)
    }
    if (flush && buffer.trim()) throw new Error("The test stream ended with an incomplete event")
  }
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) { buffer += decoder.decode(); consume(true); break }
      buffer += decoder.decode(value, { stream: true })
      consume()
    }
  } catch (error) {
    await reader.cancel(error)
    throw error
  } finally { reader.releaseLock() }
}

export async function runSubagentTest(query: ResourceQuery, id: string, prompt: string, signal: AbortSignal, onFrame: (frame: TestFrame) => void): Promise<void> {
  const response = await fetch(resourceUrl(`subagents/${id}/test/stream`, query), { ...jsonRequest("POST", { prompt }), signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail || `Request failed (${response.status})`)
  }
  if (!response.body) throw new Error("The server did not return a test stream")
  let completed = false
  await consumeAgentTestStream(response.body, (frame) => {
    if (["run.completed", "run.failed", "run.aborted"].includes(frame.type) && !frame.parentToolUseId) completed = true
    onFrame(frame)
  })
  if (!completed) throw new Error("The test stream ended before the run finished")
}
