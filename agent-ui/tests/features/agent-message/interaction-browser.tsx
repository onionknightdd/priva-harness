import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"
import { MotionConfig } from "motion/react"
import App from "../../../src/App"
import i18n from "../../../src/i18n"
import "../../../src/index.css"
import { installProjectDirectoryFixtures } from "../project-directory/project-directory-fixtures"
import type { InteractionRequest } from "../../../src/features/agent-message/interaction-data"

const options = new URLSearchParams(location.search)
await i18n.changeLanguage(options.has("zh") ? "zh-CN" : "en")
const t = (key: string) => String(i18n.t(key))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const fixtures = installProjectDirectoryFixtures()
const host = document.getElementById("root")!
const results = document.getElementById("results")!
Object.assign(document.getElementById("checks")!.style, { position: "fixed", top: "0", left: "0", right: "0", zIndex: "9999", background: "var(--background)", padding: "6px 12px", fontSize: "12px", maxHeight: "110px", overflow: "auto", borderBottom: "1px solid var(--border)" })
Object.assign(host.style, { position: "fixed", inset: "0", overflow: "hidden" })
const root = createRoot(host)
await act(async () => root.render(<React.StrictMode><MotionConfig reducedMotion={options.has("reduced-motion") ? "always" : "user"}><ThemeProvider attribute="class" forcedTheme={options.has("dark") ? "dark" : "light"}><App /></ThemeProvider></MotionConfig></React.StrictMode>))
let sessionId = ""
let runId = ""
let seq = 1
let currentRequests: InteractionRequest[] = []
const socket = () => fixtures.sockets.at(-1)!
const settle = async (ms = 220) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
const frame = async (value: Record<string, unknown>) => {
  await act(async () => socket().reply({ v: 2, streamId: "interaction-stream", harness: "claude", sessionId, runId, seq: ++seq, ts: Date.now(), ...value }))
  await settle()
}
const button = (text: string) => {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text || node.getAttribute("aria-label") === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}
const click = async (element: HTMLElement) => { await act(async () => element.click()); await settle() }
const fill = async (element: HTMLInputElement | HTMLTextAreaElement, text: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, text)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await settle(30)
}
const question = (): InteractionRequest => ({ kind: "question", requestId: `ask-${seq}`, toolUseId: `question-tool-${seq}`, tool: "AskUserQuestion", expiresAt: Date.now() + 600000,
  questions: [
    { id: "q0", question: "这次功能优先服务**哪个地区**？", multiSelect: false, options: [{ label: "亚洲", description: "先支持中国、日本和新加坡。" }, { label: "欧洲", description: "先覆盖欧洲市场。" }] },
    { id: "q1", question: "需要支持哪些能力？", multiSelect: true, options: [{ label: "权限审批" }, { label: "交互式问答" }] },
    { id: "q2", question: "还有哪些需要注意的细节？\n\n请说明 `上线顺序`。", multiSelect: false, options: [] },
  ] })
const tool = (): InteractionRequest => ({ kind: "tool", requestId: `tool-${seq}`, tool: "Bash", title: "运行项目测试", reason: "此命令会运行当前工作目录下的测试脚本。", input: { command: "npm test -- --run tests/unit/core/run/interaction-coordinator.test.ts", cwd: "/workspace/work/existing" }, expiresAt: Date.now() + 600000 })
const show = async (request: InteractionRequest) => {
  currentRequests.push(request)
  if (request.toolUseId) await frame({ type: "tool.started", id: request.toolUseId, name: request.tool, input: request.kind === "question" ? { questions: request.questions } : request.input })
  await frame({ type: "permission.requested", request })
}
const resolve = async (request: InteractionRequest, decision: "allow" | "deny", answers?: unknown) => {
  currentRequests = currentRequests.filter((item) => item.requestId !== request.requestId)
  await frame({ type: "permission.resolved", resolution: { request, decision, reason: decision === "allow" ? "answered" : "skipped", ...(answers ? { answers } : {}) } })
}
async function start() {
  if (sessionId) return
  await settle(600)
  const textarea = host.querySelector<HTMLTextAreaElement>("textarea")!
  if (!textarea) throw new Error("Composer did not load")
  await fill(textarea, "验证权限审批和回答问题")
  await click(host.querySelector<HTMLButtonElement>('button[type="submit"]')!)
  if (!socket()) throw new Error("Run was not sent")
  runId = String(socket().sent[0].runId)
  await act(async () => { sessionId = socket().bindSession() })
  await settle()
}

async function runChecks() {
  const passed: string[] = []
  const check = (name: string, condition: boolean) => {
    if (!condition) throw new Error(name)
    passed.push(name); results.textContent = passed.map((item) => `PASS ${item}`).join("\n")
  }
  try {
    await start()
    const composer = host.querySelector<HTMLElement>("[data-composer-line]")!
    const width = composer.getBoundingClientRect().width
    const prompt = host.querySelector<HTMLTextAreaElement>('textarea')!
    for (const draft of ["Short draft", "A draft\nwith multiple lines"]) {
      await fill(prompt, draft)
      await act(async () => prompt.blur()); await settle()
      const unfocused = { border: getComputedStyle(composer).borderColor, shadow: getComputedStyle(composer).boxShadow }
      await act(async () => prompt.focus()); await settle()
      check(`composer focus keeps its border and shadow (${draft.includes("\n") ? "multi" : "single"})`, getComputedStyle(composer).borderColor === unfocused.border && getComputedStyle(composer).boxShadow === unfocused.shadow)
    }
    await fill(host.querySelector<HTMLTextAreaElement>("textarea")!, "保留这段未发送草稿")
    const ask = question(); await show(ask)
    const card = () => host.querySelector<HTMLElement>("[data-interaction-card]")!
    check("card replaces composer at exactly the same width", !host.querySelector("[data-composer-line]") && Math.abs(card().getBoundingClientRect().width - width) < 1)
    await click([...card().querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.includes("亚洲"))!)
    await click(button(t("interaction.continue")))
    check("changing questions focuses the new heading", document.activeElement?.textContent === "需要支持哪些能力？")
    await click(button("权限审批")); await click(button("交互式问答"))
    await fill(card().querySelector<HTMLInputElement>("input")!, "保留自定义选项")
    await click(button(t("interaction.continue")))
    await fill(card().querySelector<HTMLInputElement>("input")!, '中文 -> 东京，含 "引号"')
    await click(button(t("interaction.send")))
    const sent = socket().sent.at(-1)!
    const answers = sent.answers as Record<string, { selected: string[]; text: string }>
    check("all selected and custom answers reach the response frame", sent.type === "permission.respond" && answers.q0.selected[0] === "亚洲" && answers.q1.selected.length === 2 && answers.q1.text === "保留自定义选项" && answers.q2.text.includes('"引号"'))
    check("sending does not clear the card before acknowledgment", Boolean(card()) && button(t("interaction.submitting")).disabled)
    await frame({ type: "error", code: "permission.respond", requestId: ask.requestId, message: "Temporary response failure" })
    check("failure keeps answers and enables retry", Boolean(card().querySelector('[role="alert"]')) && card().querySelector<HTMLInputElement>("input")?.value === answers.q2.text && !button(t("interaction.send")).disabled)
    await click(button(t("interaction.send")))
    await resolve(ask, "allow", answers)
    check("acknowledgment restores the draft and composer width", host.querySelector<HTMLTextAreaElement>("textarea")?.value === "保留这段未发送草稿" && Math.abs(host.querySelector<HTMLElement>("[data-composer-line]")!.getBoundingClientRect().width - width) < 1)
    const answered = host.querySelector<HTMLElement>('[data-question-summary="answered"]')!
    const userBubble = host.querySelector<HTMLElement>(".is-user > div")!
    check("answered summary aligns with the user bubble and fits its content", Math.abs(answered.getBoundingClientRect().right - userBubble.getBoundingClientRect().right) < 1 && answered.getBoundingClientRect().width < width)
    await click(answered.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!)
    check("every question is rendered as a Markdown blockquote", answered.querySelectorAll("blockquote").length === 3 && answered.querySelector('blockquote [data-streamdown="strong"]')?.textContent === "哪个地区" && answered.querySelector("blockquote code")?.textContent === "上线顺序")
    const answerRows = [...answered.querySelectorAll<HTMLElement>("[data-question-answer]")]
    check("answer prefixes come from CSS and do not alter the answer text", answerRows[0].textContent === "亚洲" && answerRows.every((row) => getComputedStyle(row.firstElementChild!, "::before").content === '">"'))
    check("multiple questions use spacing without dividers", answered.querySelectorAll('[data-question-pair]').length === 3 && answered.querySelectorAll('[data-slot="separator"]').length === 0)
    check("expanded answered content keeps the right edge and does not overflow", Math.abs(answered.getBoundingClientRect().right - userBubble.getBoundingClientRect().right) < 1 && answered.scrollWidth <= answered.clientWidth)
    const one = tool(); await show(one)
    const two = { ...tool(), requestId: `second-${seq}` }; await show(two)
    await click(button(t("interaction.skip")))
    check("tool skip sends deny and waits for acknowledgment", socket().sent.at(-1)?.decision === "deny" && Boolean(card()))
    await resolve(one, "deny")
    check("the next queued tool request becomes active", Boolean(card()) && card().dataset.interactionCard === "tool")
    await act(async () => socket().close()); await settle(450)
    await frame({ type: "session.snapshot", tasks: [], messages: [], activeRunId: runId, interactions: [two] })
    check("reconnect restores requests and does not replay uncertain approvals", socket().sent.every((item) => item.type === "session.subscribe") && Boolean(card()))
    await click(button(t("interaction.allow")))
    check("allow is sent only after an explicit click", socket().sent.at(-1)?.decision === "allow")
    await resolve(two, "allow")
    const skipped = question(); await show(skipped)
    await click(button(t("interaction.skip")))
    check("question skip sends deny without fabricated answers", socket().sent.at(-1)?.decision === "deny" && socket().sent.at(-1)?.answers === undefined)
    await resolve(skipped, "deny")
    check("skipping questions restores composer", Boolean(host.querySelector("[data-composer-line]")))
    const editor: InteractionRequest = { kind: "question", requestId: `editor-${seq}`, tool: "Pi extension", expiresAt: Date.now() + 600000,
      questions: [{ id: "q0", question: "编辑补充说明", options: [], multiSelect: false, initialText: "  第一行\n第二行\n", multiline: true }] }
    await show(editor)
    const editorInput = card().querySelector<HTMLTextAreaElement>("textarea")!
    check("Pi editor prefill is editable inside the question card", editorInput?.value === "  第一行\n第二行\n")
    await fill(editorInput, "  修改后的说明\n保持换行\n")
    await click(button(t("interaction.send")))
    const edited = socket().sent.at(-1)?.answers as Record<string, { text: string }>
    check("Pi editor submissions preserve whitespace and line breaks", edited.q0.text === "  修改后的说明\n保持换行\n")
    await resolve(editor, "allow", edited)
    const restoredAnswers = Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, { selected: [], text: [...answer.selected, ...(answer.text ? [answer.text] : [])].join(", ") }]))
    await frame({ type: "session.snapshot", activeRunId: runId, tasks: [], interactions: [], messages: [
      { id: "history-user", role: "user", content: "查看已保存的问答", createdAt: new Date(0).toISOString(), status: "complete" },
      { id: "history-assistant", role: "assistant", content: "收到这些答案。", createdAt: new Date(0).toISOString(), status: "complete",
        blocks: [{ type: "tool_use", blockId: ask.toolUseId, index: 0, id: ask.toolUseId, name: "AskUserQuestion", tool: { id: ask.toolUseId, name: "AskUserQuestion", status: "completed", ok: true, input: { questions: ask.questions }, output: "Your questions have been answered: provider receipt. You can now continue with the answers in mind." } }],
        interactions: [{ request: { ...ask, requestId: `history:${ask.toolUseId}`, expiresAt: 0 }, decision: "allow", reason: "answered", answers: restoredAnswers }],
      },
    ] })
    const historyProcess = [...host.querySelectorAll<HTMLButtonElement>('button.group\\/process-trigger')].at(-1)!
    await click(historyProcess)
    const restored = host.querySelector<HTMLElement>('[data-question-summary="answered"]')!
    await click(restored.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!)
    check("restored history shows separate questions and answers, not the provider receipt", restored.querySelectorAll('[data-question-pair]').length === 3 && restored.textContent!.includes('中文 -> 东京，含 "引号"') && !restored.textContent!.includes("Your questions have been answered"))
    check("restored question summaries stay within the message column", restored.scrollWidth <= restored.clientWidth && document.documentElement.scrollWidth <= innerWidth)
    await show(question())
    check("the page does not overflow horizontally", document.documentElement.scrollWidth <= innerWidth)
    check("card footer stays inside the viewport", card().getBoundingClientRect().bottom <= innerHeight)
    document.getElementById("run")!.setAttribute("data-result", "passed")
  } catch (error) { results.textContent += `\nFAIL ${error instanceof Error ? error.stack : String(error)}`; document.getElementById("run")!.setAttribute("data-result", "failed") }
}
document.getElementById("run")!.onclick = () => { void runChecks() }
document.getElementById("question")!.onclick = () => { void (async () => { await start(); for (const request of [...currentRequests]) await resolve(request, "deny"); await show(question()) })() }
document.getElementById("tool")!.onclick = () => { void (async () => { await start(); for (const request of [...currentRequests]) await resolve(request, "deny"); await show(tool()) })() }
document.getElementById("answered")!.onclick = () => { void (async () => {
  await start()
  for (const request of [...currentRequests]) await resolve(request, "deny")
  const existing = new Set(host.querySelectorAll('[data-question-summary="answered"]'))
  const request = question()
  await show(request)
  await resolve(request, "allow", { q0: { selected: ["亚洲"], text: "" }, q1: { selected: ["权限审批", "交互式问答"], text: "" }, q2: { selected: [], text: "先在测试环境验证，再部署到生产环境。\n保留监控和回滚入口。" } })
  const summary = [...host.querySelectorAll<HTMLElement>('[data-question-summary="answered"]')].find((item) => !existing.has(item))!
  await click(summary.querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!)
  summary.scrollIntoView({ block: "end" })
})() }
