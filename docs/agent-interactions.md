# 权限审批与问答

Claude 与 Pi 共用会话 WebSocket v2 的交互协议。请求由运行中的 provider 持有，
前端在当前 Chat composer 的同一容器中依次显示卡片；处理完队列后恢复草稿和附件。

```text
Claude canUseTool / Pi extension UI / Pi ask_user_question
                         |
                         v
               InteractionCoordinator (await)
                         |
                  permission.requested
                         v
SessionStream -> WebSocket -> composer slot (same max-w-3xl)
                                  |
                    question card / tool approval
                                  |
                   answer / allow once / skip
                                  v
                 permission.respond + requestId
                                  |
                   validate session and answers
                                  v
                 permission.resolved -> resume provider
                                  |
                      next card / restore composer
```

## Provider 接入

- Claude：使用 SDK `canUseTool`。`AskUserQuestion` 转成问题列表；回答由后端按
  原问题文字构造 `updatedInput.answers`，支持单选、多选和自定义文本。其他回调转成工具
  审批。保留项目现有 `bypassPermissions` 模式：仅 SDK 实际要求询问的调用显示卡片，
  包括显式 ask 规则；不根据工具名称自行推测风险或改变权限策略。
- Pi：注册 `ask_user_question` 工具；使用 `bindExtensions({ mode: 'rpc', uiContext })`
  接入扩展的 `ui.select`、`ui.input`、`ui.editor`、`ui.confirm`。原生 select 只允许原始
  选项，input/editor 和问答工具支持文本；editor 使用可编辑的多行预填内容，并保留
  原始空白及换行。confirm 使用工具审批卡，取消返回 false。
  扩展初始化在流订阅建立后执行，因此 `session_start` 的提问也能等待回答，重载扩展
  保留 UI 绑定。Pi 没有额外添加工具风险匹配规则；审批来自扩展实际调用的 confirm。
- Pi 的终端专用 `ui.custom` 无法在 WebUI 渲染，会返回明确错误；扩展应使用上述
  通用交互 API。此实现不提供终端组件的浏览器渲染器。

## 协议与状态

`permission.requested` 携带 `request`，包括 `requestId`、`kind`、`tool`、可选
`toolUseId/input/title/reason`、`expiresAt`；问答还包含带稳定 ID 的 `questions`。

客户端命令：

```json
{
  "type": "permission.respond",
  "harness": "claude",
  "sessionId": "session-id",
  "requestId": "request-id",
  "decision": "allow",
  "answers": {
    "q0": { "selected": ["Asia"], "text": "" },
    "q1": { "selected": [], "text": "保留引号、换行和自定义内容" }
  }
}
```

工具允许仅发 `decision: "allow"`；两类卡片的跳过均发 `decision: "deny"`，不生成
虚构回答、不发送新的用户聊天消息。审批不能修改原始工具输入，也没有“始终允许”策略。
答题卡最后一题必须明确提交；单选鼠标选择可在题目间自动前进，键盘操作立即反馈。

`permission.resolved` 包含 `resolution.request`、`decision`、`reason` 和可选 `answers`。
reason 为 `answered/skipped/timeout/cancelled`。服务器先记录结果并广播，再解除 provider
等待；客户端收到该事件后才移除卡片。提交错误使用带 `requestId` 的 `error` 帧，保留
答案并允许重试，不将它当作整轮运行失败。每个 request 的首次决定生效，重复响应返回
原决定；不同请求互不覆盖。

断开 WebSocket 不取消等待。重连的 `session.snapshot.interactions` 是待处理队列的
权威状态，独立于有界事件重放缓冲；已经发出但尚未确认的审批不会自动重发。多标签页
收到同一确认后同步移除请求。请求默认十分钟超时，扩展可指定更短超时；停止运行、
provider 退出或销毁会拒绝等待中的请求。运行取消/失败还会清除对应流里未送达最终
确认的请求。后台工作不会仅因主回复 `run.completed` 而失去交互。

待处理 Promise 不写入磁盘，服务重启后不恢复失效请求。问题结果在实时消息及会话
快照中显示摘要；持久历史沿用 provider 原生工具输入/输出记录。

## 迁移审查

旧 Python 项目的协调器等待与事件通知机制适用于当前架构，但以下细节未照搬：

- 不通过拼接后的聊天文本反向解析答案，直接提交结构化选项与自定义文本。
- 不在收到确认前乐观显示已批准；失败、断线和重复提交有独立处理。
- 跳过真正解除后端等待；卡片关闭或切换题号本身不等于提交。
- 无 requestId 的消息不作为审批响应，新会话也不能回答其他会话的请求。

Beautiful UI 问答示例的默认演示状态、自定义答案遗漏、末题计时提交和仅本地关闭
行为已替换为上述协议。BE UI 工具审批保留组件结构，状态由服务端确认驱动。

## 验证

后端遵循根 AGENTS.md 的 lint、typecheck、test、build 和编译后 Pi MCP 探针命令。
相关回归包括协调器、Claude SDK 回调、Pi 原生 UI/提问工具/启动取消，以及真实
WebSocket 的会话归属、多标签页、重复决策、重连和停止运行。
前端命令和浏览器入口见 [前端规范](front-end-desgin.md#development-and-verification)。
