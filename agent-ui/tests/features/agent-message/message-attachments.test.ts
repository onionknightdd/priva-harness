import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { it } from "node:test"
import { promisify } from "node:util"

import { runAgentSession } from "../../../src/features/agent-message/run-agent-session.ts"
import { threadMessagesFromApi } from "../../../src/features/chat-session/session-thread-messages.ts"
import { attachmentMessageSummary, attachmentsFromMessageText, messageTextWithAttachments } from "../../../src/features/agent-message/message-attachment-text.ts"

const attachments = [{ path: "/workspace/.priva-attachments/file-a/销售.csv", name: "销售.csv", size: 12, mimeType: "text/csv" }]

it("places the original user text first and represents attachment attributes as Markdown", () => {
  const text = "  帮我分析\n这份文件  "
  const encoded = messageTextWithAttachments(text, attachments)
  assert.equal(encoded, `${text}\n\n\`\`\`AgentAttachments\n- name: 销售.csv\n  path: /workspace/.priva-attachments/file-a/销售.csv\n  MIME: text/csv\n  size: 12 bytes\n\`\`\``)
  assert.deepEqual(attachmentsFromMessageText(encoded), { content: text, attachments })
  assert.equal(messageTextWithAttachments(text), text)
})

it("round-trips multiple attachments and Markdown, backslashes, and newline characters in file names", () => {
  const unusual = [
    ...attachments,
    { path: "/workspace/a_[b]`*&amp;\n```AgentAttachments\\.txt", name: "a_[b]`*&amp;\n```AgentAttachments\\.txt", size: 0, mimeType: "text/plain" },
  ]
  const text = "Explain `AgentAttachments` in this message."
  const encoded = messageTextWithAttachments(text, unusual)
  assert.deepEqual(attachmentsFromMessageText(encoded), { content: text, attachments: unusual })
})

it("leaves ordinary text and incomplete or invalid attachment blocks visible", () => {
  const valid = messageTextWithAttachments("正文", attachments)
  for (const text of ["ordinary text", valid.slice(0, -1), valid.replace("12 bytes", "-1 bytes"), valid.replace("12 bytes", "9007199254740992 bytes"), "正文\n\n```AgentAttachments\n\n```", valid.replace("AgentAttachments", "text"), `\`\`\`\`text\n${valid}\n\`\`\`\``]) {
    assert.equal(attachmentsFromMessageText(text), undefined)
  }
})

it("supports attachment-only messages without adding synthetic user text", () => {
  const encoded = messageTextWithAttachments("", attachments)
  assert.ok(encoded.startsWith("```AgentAttachments\n"))
  assert.deepEqual(attachmentsFromMessageText(encoded), { content: "", attachments })
  assert.equal(attachmentMessageSummary(encoded), "销售.csv")
  assert.equal(attachmentMessageSummary(encoded.replaceAll("\n", " ").slice(0, 100)), "销售.csv")
})

it("recognizes attachment code blocks while retaining surrounding text and ordinary code", () => {
  const encoded = messageTextWithAttachments("前文\n\n```text\nordinary code\n```", attachments)
  const parsed = attachmentsFromMessageText(`${encoded}\n\n后文`)
  assert.deepEqual(parsed, { content: "前文\n\n```text\nordinary code\n```\n\n后文", attachments })
})

it("reconstructs the UI body and attachments from the raw transcript without parsing assistant text", () => {
  const message = { id: "u2", role: "user" as const, content: messageTextWithAttachments("正文", attachments), createdAt: "2026-09-06T00:00:00Z", status: "complete" as const }
  assert.deepEqual(threadMessagesFromApi([message]), [{ ...message, content: "正文", attachments }])
  const assistant = { ...message, role: "assistant" as const }
  assert.equal(threadMessagesFromApi([assistant])[0].content, message.content)
})

it("removes attachment markup from complete and truncated session summaries", () => {
  const text = messageTextWithAttachments("请分析", attachments)
  assert.equal(attachmentMessageSummary(text), "请分析")
  assert.equal(attachmentMessageSummary(text.replaceAll("\n", " ").slice(0, 100)), "请分析")
  assert.equal(attachmentMessageSummary("普通标题"), "普通标题")
})

it("sends only the formatted text through WebSocket for both providers, including attachment-only messages", async () => {
  class Socket extends EventTarget {
    static OPEN = 1
    static CONNECTING = 0
    static instance: Socket
    readyState = 1
    sent: unknown[] = []
    constructor() { super(); Socket.instance = this }
    send(data: string) { this.sent.push(JSON.parse(data)) }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")) }
  }
  const descriptors = ["window", "WebSocket"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const)
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { protocol: "http:", host: "localhost" } } })
  Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: Socket })
  try {
    for (const harness of ["claude", "pi"] as const) {
      for (const text of ["", "请分析"]) {
        const init = { text, attachments, model: "profile:model", harness, cwd: "/workspace" }
        const run = runAgentSession(init, { onFrame: () => {}, onError: assert.fail })
        Socket.instance.dispatchEvent(new Event("open"))
        assert.deepEqual(Socket.instance.sent, [{ type: "init", text: messageTextWithAttachments(text, attachments), model: init.model, harness, cwd: init.cwd }])
        run.disconnect()
        await run.finished
      }
    }
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})

it("retains the original text and attachment metadata when loading message history", () => {
  const message = { id: "u1", role: "user" as const, content: "", attachments, createdAt: "2026-09-06T00:00:00Z", status: "complete" as const, transcriptUuid: "u1" }
  assert.deepEqual(threadMessagesFromApi([message]), [message])
})

it("indexes an attachment-only code block in the installed Claude SDK without a custom title", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "attachment-code-block-")))
  try {
    const cwd = path.join(root, "workspace")
    const configDir = path.join(root, "claude")
    const projectDir = path.join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"))
    await mkdir(cwd)
    await mkdir(projectDir, { recursive: true })
    const sessionId = randomUUID()
    await writeFile(path.join(projectDir, `${sessionId}.jsonl`), `${JSON.stringify({
      type: "user", uuid: randomUUID(), parentUuid: null, isSidechain: false,
      cwd, sessionId, timestamp: new Date().toISOString(),
      message: { role: "user", content: messageTextWithAttachments("", attachments) },
    })}\n`)
    const sdkUrl = new URL("../../../../services/agent-runner/ts/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs", import.meta.url).href
    const script = `
      import { getSessionInfo, listSessions } from ${JSON.stringify(sdkUrl)}
      const sessionId = ${JSON.stringify(sessionId)}
      const options = { dir: ${JSON.stringify(cwd)} }
      const info = await getSessionInfo(sessionId, options)
      const listed = (await listSessions(options)).some(session => session.sessionId === sessionId)
      process.stdout.write(JSON.stringify({ readable: info !== undefined, listed, summary: info?.summary }))
    `
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    })
    const result = JSON.parse(stdout)
    assert.equal(result.readable, true)
    assert.equal(result.listed, true)
    assert.equal(attachmentMessageSummary(result.summary), "销售.csv")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
