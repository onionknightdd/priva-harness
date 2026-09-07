import { CodeBlock } from "../src/components/agents/code-block"
import { createRoot } from "react-dom/client"
import { useState } from "react"
import { I18nextProvider, initReactI18next } from "react-i18next"
import i18next from "i18next"
import { zhCN } from "../src/i18n/locales/zh-CN"
import { AgentToolSummary } from "../src/features/agent-message/components/agent-tool-item"
import { WorkspaceAgentView } from "../src/features/workspace/views/workspace-agent-view"
import type { AgentToolView } from "../src/features/agent-message/agent-tool-data"
import "../src/index.css"
const i18n = i18next.createInstance()
void i18n.use(initReactI18next).init({ lng: "zh-CN", resources: { "zh-CN": { translation: zhCN } } })
const agents: AgentToolView[] = [{ id: "one", label: "检查认证模块", state: "completed", type: "Explore", model: "test-model", toolCount: 1, tokens: 15142, durationMs: 3357,
  prompt: "# 检查认证模块\n\n检查会话验证、过期处理和权限检查。", output: "# 检查结果\n\n- 会话过期处理正确\n- 建议补充取消测试", inbox: [{ body: "请关注取消流程。", senderName: "验证 Agent", afterBlockCount: 1 }],
  blocks: [{ type: "thinking", blockId: "t", index: 0, text: "先确认会话入口，然后检查取消流程。" },
    { type: "tool_use", blockId: "bash", index: 1, id: "bash", name: "bash", tool: { id: "bash", name: "bash", status: "completed", ok: true, input: { command: "npm test", description: "验证会话测试" }, output: "All tests passed" } },
    ...Array.from({ length: 12 }, (_, index) => ({ type: "text" as const, blockId: `text-${index}`, index: index + 2, text: `检查记录 ${index + 1}：会话验证已通过。` }))] },
 { id: "two", label: "验证测试结果", state: "failed", toolCount: 0, blocks: [], inbox: [], prompt: "检查测试结果", output: "测试进程退出，未完成验证。" }]
function Preview() {
 const [selected, setSelected] = useState("one")
 const [navigationId, setNavigationId] = useState(0)
 const [narrow, setNarrow] = useState(false)
 return <I18nextProvider i18n={i18n}><main className="min-h-screen bg-background p-4 text-foreground"><button onClick={() => setNarrow(!narrow)}>切换宽度</button><CodeBlock language="typescript" code={'const count = 123; // 中文 English !@#\nconsole.log("所有内容", count);'} showLineNumbers /><div className="mb-4 max-w-xl">{agents.map((agent) => <AgentToolSummary key={agent.id} agent={agent} onOpen={() => { setSelected(agent.id); setNavigationId((value) => value + 1) }} />)}</div><div style={{ width: narrow ? 360 : 980, maxWidth: "100%" }}><WorkspaceAgentView key={navigationId} target={{ sourceKey: "fixture", agents, selectedId: selected, navigationId }} /></div></main></I18nextProvider>
}
createRoot(document.getElementById("root")!).render(<Preview />)
