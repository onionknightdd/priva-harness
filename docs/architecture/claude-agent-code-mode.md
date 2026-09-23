# Claude Agent / Code 模式

状态：已实施。仅包含 Claude SDK 和原生 TUI。用户已确认模式语义、侧栏对比表、
Agent 额外禁用的 5 个工具，以及将已有 Claude 会话统一修正为 Code。

## 范围与语义

- Claude 的 Agent 模式使用平台通用任务提示，Code 模式保留原生 Claude Code
  提示并追加平台提示。
- 两种模式继续支持文件、命令、Skills、项目指令、Memory、MCP 和产品工具。
  工具裁剪通过明确的工具策略生效。
- Pi 保持现有执行行为，侧栏隐藏 Agent / Code 控件及其问号。
- 模式在创建会话时确定，之后不可切换。新会话默认 Agent，恢复时继承原模式，
  fork 继承父会话模式。
- Chat / Terminal 是同一会话的展示方式，切换视图不改变模式。
- 平台提示按当前主机的原生目录语义编写，不复制 legacy 容器中以
  `$CLAUDE_CONFIG_DIR` 替代用户主目录的规则。

```text
Claude 请求：runMode 可省略
        |
        v
harness：解析模式 -> 校验锁定 -> 原子绑定
        |
        v
确定的模式 + 平台提示
        |
        v
Claude provider：共用 prompt builder + tool policy
        +-- SDK：systemPrompt / disallowedTools
        `-- TUI：system-prompt 参数 / disallowedTools 参数

Pi 请求 -> 现有 Pi 执行链路
```

## 会话与持久化

`SessionRunModes` 统一决定默认值、恢复校验与 fork 继承。正式服务通过
`SessionService` 使用 metadata repository；不带 SessionService 的程序化 harness
仅保存其自身生命周期内的模式绑定。Claude 新建与 fork 在打开驱动前分配 UUID。
`AgentHarness.launch` 现在返回 `Promise<LiveRun>`，调用者需要 await。

metadata 的 `upsert` 在现有文件事务锁内检查模式不可改变，返回
`run-mode-conflict`；HTTP 映射为 409，WebSocket 通过请求错误返回具体原因。
首次绑定不依赖模型回复成功，故失败、取消、重启和并发请求也不会改变已创建会话的模式。
未被本系统追踪的原生 Claude 会话按 Code 处理。Pi 的请求、提示、工具与原有标签行为保持不变。

用户已批准的一次性历史修正：`session-metadata.json` 版本由 1 升为 2，第一次读取
旧文件时在锁内把所有 `claude:*` 的模式写为 Code，再原子替换文件。其他元数据和
Pi 记录保留。修正无需扫描或更改原生转录，之后创建的 Agent 记录不会再次被覆盖。

```text
metadata v1 --事务锁--> Claude 标签 = Code --原子写--> metadata v2
                                                |
                         新会话绑定 Agent / Code +--恢复只读取和校验
```

## 代码组织

`+` 为本次新增模块，其余为既有模块的接入点。

```text
services/agent-runner/ts/src/
|-- core/
|   |-- resource/session.ts                  模式类型、不可变校验和冲突错误
|   |-- contract/agent-provider.ts           传递已确定的 Claude 模式
|   |-- contract/session-metadata-repository.ts  upsert 原子绑定约束
|   `-- event/agent-event.ts                 配置与快照回传模式
|-- harness/
|   |-- session/session-run-mode.ts       +  默认值、恢复校验、继承
|   |-- session/session-service.ts          移除硬编码，统一回传
|   |-- prompt/platform-instructions.ts   +  平台提示内容
|   |-- agent-harness.ts                    执行前解析与绑定
|   |-- run/warm-runtime-pool.ts            复用条件包含模式和提示
|   `-- terminal/terminal-chat-sessions.ts  原生会话重绑定与恢复
|-- provider/claude/
|   |-- claude-system-prompt.ts           +  SDK 与 TUI 提示词适配
|   |-- claude-tool-policy.ts             +  基础禁用项、Agent 精简项
|   |-- claude-runtime.ts                   使用共享策略
|   |-- claude-terminal-launch.ts           使用共享策略
|   `-- claude-terminal-model.ts            启动配置与复用校验
|-- infrastructure/session/json-session-metadata-store.ts
|                                           事务内首次绑定与冲突检查
`-- transport/websocket/                     校验、传递、错误映射

agent-ui/src/features/
|-- sidebar/header/
|   |-- sidebar-mode-tabs.tsx               Claude 可见、接通会话状态
|   `-- mode-comparison-dialog.tsx        +  问号点击后的对比表
|-- chat-session/chat-session-context.tsx    草稿模式、已锁定模式
`-- agent-message/                          发送、快照、重连同步模式
```

请求解析要保留“未指定模式”，避免恢复 Code 会话时被默认 Agent 覆盖。
模式绑定放在发送首条用户输入之前；复用现有 metadata
事务锁，拒绝并发的冲突绑定。模式回传覆盖列表、历史、运行中状态和重连快照。

原生 `/clear` 和新 fork 继承当前模式；`/resume` 到不同模式会话时，必须在下一次
模型执行前恢复匹配的进程配置，不能只更换 session ID。SDK 与 TUI 共用同一份
prompt 和工具策略，重启、认领和热运行时复用均需保持一致。

跨模式原生恢复会重启进程以加载目标模式的提示和工具。若后台任务阻止重启，
会话视图仍跟随原生目标，下一次 UserPromptSubmit 在模式不匹配时阻止模型调用。
完成或停止后台任务后重新打开目标会话即可应用模式。

## 界面

沿用现有侧栏位置。问号点击打开居中 Dialog，桌面宽度约 560px，窄屏限制在
视口内，三列表格内容自动换行；提供关闭按钮、Escape、焦点恢复和减少动态效果。
新会话可选择模式，已有会话显示锁定状态，问号继续可用。展开的窄侧栏需保留
问号入口，收起为图标栏时沿用现有隐藏规则。

```text
Claude 侧栏                    点击 [?]
+----------------------+      +--------------------------------------+
| Powered by: Claude   |      | Agent 与 Code                     [X]|
| [ Agent | Code ] [?] | ---> | 对比项    | Agent       | Code       |
| 新对话               |      | 适用任务  | 通用任务    | 编程开发   |
| 项目与会话           |      | 开发工具  | 精简        | 完整       |
+----------------------+      | 文件/技能 | 支持        | 支持       |
                              | 会话创建后模式固定                  |
Pi：模式控件和问号隐藏。      +--------------------------------------+
```

弹窗文案说明用户可感知的差别，工具清单使用下方已确认的策略；不展示 SDK 参数。
布局已经用户批准，实现与验证说明同步维护于 `docs/front-end-desgin.md`。

## 默认工具盘点

2026-09-23 使用当前仓库配置和 bundled Claude Code 2.1.278，分别启动 SDK
与原生 TUI，连接本地模拟模型端点，在隔离的配置及工作目录中读取实际请求的
工具定义。稳定基线一致：23 个原生工具和 5 个产品工具。用户/项目自行安装的
MCP、插件与额外配置不在这份基线中。

| 类型 | 原生工具 |
|---|---|
| 文件与命令 | Read、Write、Edit、Bash |
| 用户问答与技能 | AskUserQuestion、Skill |
| 任务清单 | TaskCreate、TaskGet、TaskList、TaskUpdate |
| 后台任务停止 | TaskStop |
| 多 Agent 工作 | Agent、Workflow、SendMessage |
| Agent 发现 | ListAgents |
| 定时任务 | CronCreate、CronList、CronDelete |
| 原生规划流程 | EnterPlanMode、ExitPlanMode |
| Git worktree | EnterWorktree、ExitWorktree |
| 结构化代码审查 | ReportFindings |

| 产品工具 | 用途 |
|---|---|
| visualize | 交互式 JSX 可视化 |
| canvas | HTML 文档预览 |
| image_gen | 图片生成 |
| image_read | 图片理解 |
| image_edit | 图片编辑 |

产品工具实际 MCP 名称使用 `mcp__agentWorkshop__` 前缀。图片工具被注册，实际
执行仍需要对应的图片模型配置。TUI 在 MCP 尚未连接完成时可能临时暴露
`WaitForMcpServers`，产品工具在连接完成后出现。

当前代码已配置的 12 个禁用项：NotebookEdit、WebFetch、WebSearch、ScheduleWakeup、
RemoteTrigger、PushNotification、Artifact、Projects、DesignSync、ReadMcpResourceDirTool、
RefreshMcpTools、ShowOnboardingRolePicker。其中部分名称是版本相关的禁用规则，
并不表示当前 CLI 一定提供该工具；当前 TUI 会提示 RefreshMcpTools 无匹配工具。

## Agent 工具精简清单（已确认）

额外禁用 EnterPlanMode、ExitPlanMode、EnterWorktree、ExitWorktree、ReportFindings。
它们分别面向原生编程计划审批、Git 工作树和结构化代码审查；通用任务仍可通过
任务清单、AskUserQuestion 和普通回复进行规划与确认。

保留 Read / Write / Edit / Bash 以完成文件和数据任务；保留多 Agent、Workflow、
TaskStop、任务清单、Cron、Skills、MCP 和五个产品工具。Code 沿用当前基础工具策略。
使用 Claude 的 disallowedTools 去除相应工具定义，SDK 和 TUI 共享同一函数。

## 验证

- 单元测试覆盖默认 Agent、显式 Code、恢复省略、冲突拒绝、fork 继承、Pi 请求不变、
  并发首次绑定、历史修正只执行一次，以及 warm runtime 模式 / 提示变化不可复用。
- 原生集成测试 `claude-run-mode.test.ts` 连接隔离的本地模型端点，检查真实 SDK 和
  TUI 请求里的提示词与工具定义；覆盖跨模式 `/resume` 和 Code `/clear` 后继续执行。
- 原生 prompt hook 在同步失败时阻止该次输入，避免请求在未确认模式时继续执行。
- 前端浏览器回归使用真实 context、侧栏组件和发送逻辑，隔离网络请求，覆盖新建、
  发送、启动失败解锁、绑定、换绑快照、Pi 隐藏且不发送模式、问号对比表与窄侧栏。
- 桌面英文浅色、390px 中文深色和减少动态效果已检查；键盘 Enter / Escape 及焦点恢复已检查。

后端：`npm run lint`、`npm run typecheck`、`TMPDIR=/tmp npm test`、`npm run build`。
前端：`npm run lint`、`npm run build`；数据与浏览器检查命令见前端规范。
