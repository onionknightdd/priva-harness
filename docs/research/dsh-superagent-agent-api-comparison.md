我的判断是：**它不是新的模型推理范式，但也不只是给现有 Agent API 换个入口。它把完整 Agent 运行时组织成了一个持续接单、跟进反馈、交付结果的团队工作系统。**

对我们最有价值的部分，是 **Agent API 之上的任务管理与事件编排**，而不是替换现有 Claude / Pi 执行层。

我看了公开仓库 `6337fc8` 的文档和核心实现，并对照了我们当前代码。以下以实际实现为准；它的 README 也明确说明：公开原型不等同于内部版本和设计文章，部分设想尚未实现。[项目说明](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/README.md)

它描述的使用场景，是“给团队配一个持续工作的开发成员”。

例如，团队在飞书里提出一个问题，Agent 判断是否有权接单，为这件事创建任务，在独立目录中调查、修改代码、打开 PR。随后发生的 CI 失败、Review 意见和补充要求，会继续进入原来的任务。人不需要重新打开聊天窗口、找 session、解释“刚才那个 PR 是你做的”。

它还支持按团队规则主动处理事情。例如，允许它从群内问题反馈中寻找可以修复的缺陷。不过，**默认 `observe` 模式只记录“本来会接什么任务”，不会执行这些推断出来的工作**；明确授权的请求则可以正常执行。[授权机制](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)

架构上的区别可以这样理解：

```text
我们当前的调用方式
==================
业务程序 / 外部 Agent
        |
        | 决定何时调用、调用哪个 session、如何处理结果
        v
Agent API: Session / Run / Events
        |
        v
Claude / Pi Runtime
        |
        +--> 工具 / MCP / 子 Agent / 文件与代码


DSH Superagent
==============
GitHub / 飞书 / CI / Review
        |
        v
Trigger --> 去重、归入 Thread
                    |
          +---------+------------------+
          | 已归属某个任务              | 新请求
          v                            v
     Subscription               Gate + Router / Eval
          |                     代码准入 + 模型判断
          |                            |
          |                      Ticket + Mandate
          |                      任务 + 授权依据
          +-------------+--------------+
                        v
                    Assignment
                        |
                        v
              Worker Session + 工作目录
                        |
                 Report / Channel
                        |
                        v
                  原 GitHub / 飞书对话

SQLite 保存任务、事件、授权、待执行操作与回复记录
```

这里最关键的对象是 **Ticket，而不是 Session**。Ticket 表示“这件事情”，Session 是执行它的载体；一次模型运行结束，不代表这件事情结束。PR 等待审核、收到新的评论、执行器重启，都可以仍然属于同一件工作。[领域模型](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md)

具体对比起来：

| 维度 | 我们当前 Agent API | DSH Superagent |
|---|---|---|
| 核心定位 | 提供可编程的 Agent 执行服务 | 提供持续在线的团队协作 Agent |
| 谁决定开始工作 | 调用方发起请求 | 外部事件进入后，由准入规则和模型判断 |
| 对外主要对象 | Session、Run、消息、事件 | Thread、Ticket、授权、执行派工 |
| 后续反馈归属 | 调用方选择 session 并发送上下文 | 通过订阅把评论、CI 等送回已有任务 |
| 工具与子 Agent | 已有，底层是完整 Claude / Pi runtime | 已有，底层使用 DSH runtime |
| 并发方式 | 多会话可以运行，业务方组织任务关系 | 每个 Ticket 独立执行，有调度槽位和人类跟进优先级 |
| 持续性 | 会话历史、运行记录、事件续传 | 另有任务归属、待投递消息、重试与重启恢复 |
| 人的工作 | 由调用方设计交互和监督方式 | 主要查看需要回答、审核或处理异常的任务 |

我们并不是“只能向模型发一个 prompt”。当前 API 实际调用 `AgentHarness.launch`，由 Claude Agent SDK / Pi 驱动完整工具循环，已有 MCP、子 Agent、后台工作等能力。Pi 也已经集成工作流执行。因此，**“会调用工具”“会拆分子任务”“可以并行”都不是这次对比的决定性差异**。[API 执行入口](/Users/derekdeng/Workspace/project/priva-harness/services/agent-runner/ts/src/harness/agent-api/agent-api-service.ts:263)、[Pi 工作流实现](/Users/derekdeng/Workspace/project/priva-harness/services/agent-runner/ts/src/provider/pi/pi-workflows.ts:35)

但我们需要正视一个当前差距：对外 API 目前完成到 A4.5，**运行中 follow-up / steer / interrupt、取消、交互回答、任务停止等尚未开放**，忙碌会话再次发送会返回 `session_busy`。DSH 则已把运行中输入投递和后台任务唤醒接进了持续协作链路。不能用我们设计文档里的最终能力来当作现状比较。[当前能力声明](/Users/derekdeng/Workspace/project/priva-harness/services/agent-runner/ts/src/harness/agent-api/agent-api-service.ts:109)、[实施状态](/Users/derekdeng/Workspace/project/priva-harness/docs/architecture/agent-api-v1.md:1034)、[DSH 执行机制](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/003-execution.md)

我认为，它真正值得借鉴的有四点。

1. **把任务生命周期从模型运行生命周期中独立出来。**  
   一件工作可以经历调查、修改、等审核、再修改，跨越很多次运行。这个抽象更贴近真实开发协作，也让执行器故障和重试不必变成用户重新解释需求。

2. **明确区分“新的工作请求”和“已有工作的反馈”。**  
   已归属任务的人类跟进直接进入 Worker，不需要中央模型每次重新分类、重新派工；超出任务范围时再交回路由。这比“所有 webhook 都丢给一个总 Agent”更具体，也更可控。[事件接收实现](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/src/core/intake.ts)

3. **把接单授权记录下来。**  
   系统保存请求来源、授权强度、规则、范围和策略版本。收到一条消息，和获得开展新工作的授权，是两件事。这对读取群聊、公开评论的常驻 Agent 很重要。

4. **为长期运行补上可靠性机制，并减少人的监督负担。**  
   待执行操作先写入 SQLite，再执行；失败有退避重试，重启后可以继续处理。交互上则强调少发进度消息，把需要人处理的问题结构化呈现。这些都有实际代码或明确的状态设计。[持久任务队列](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/src/app/effects.ts)、[监督面板设计](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/005-panel.md)

因此，对“新范式还是套壳”，我会分三个层次判断：

| 层次 | 我的判断 |
|---|---|
| 模型与推理 | 没有看到新的基础机制，仍然依靠 LLM、工具调用和 Agent runtime |
| 系统架构 | 是有实质内容的工程组合，但事件驱动、多 Agent、持久状态并非新发明 |
| 产品使用方式 | 有明显转变：从管理若干聊天会话，变成授权一个长期存在的工作角色 |

事件驱动 Agent 架构早已有先例，例如 AutoGen 在 2025 年的 v0.4 就明确采用异步、事件驱动设计。所以，仅凭 Router、Worker 和事件系统，很难称为全新的技术范式。[微软原始介绍](https://www.microsoft.com/en-us/research/blog/autogen-v0-4-reimagining-the-foundation-of-agentic-ai-for-scale-extensibility-and-robustness/)

**但“能用现有 API 实现”不等于“只是套壳”。** API 提供执行能力；谁该接单、反馈属于哪件事、什么时候算完成、失败后如何继续，仍然需要一个真正的应用系统来承担。它的价值主要在这里。

同时，也不宜把这个原型理解成已经实现了通用的“自主数字员工”：

- 当前面向一个 GitHub 仓库，配合可选飞书来源。
- 跨渠道关联有明确的引用和订阅规则，并不是自动理解所有渠道、所有人的长期上下文。
- 独立工作目录不等于安全隔离。公开部署中 Worker 使用操作者 OS 身份和 `danger-full-access`，授权对象也不意味着所有越界行为都被硬性阻断。
- 公开实现主要是本地 DSH profile、SQLite 和目录执行；部署文档里的外部检查，也不能直接等同于完善的自治故障修复系统。[提示与关联规则](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/004-prompts.md)、[部署与隔离边界](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/006-deployment.md)

对我们而言，我倾向于把它视为 **Agent API 的一个高价值上层应用参考**。如果要支持这种场景，分层可以是：

```text
GitHub / 飞书等业务入口
          |
          v
长期任务管理层
事件归属、授权、任务状态、重试、通知
          |
          v
我们的 Agent API
会话、执行、事件、运行中控制
          |
          v
Claude / Pi + Sandbox
```

API 层继续保持通用，补齐运行中控制；任务管理层负责业务持续性，不必把 PR、飞书 Thread 等概念塞进底层协议。

**我们目前解决的是“让别人可靠地调用 Agent”；它进一步尝试解决的是“让一个团队不用反复调用、解释和盯着 Agent，也能让事情持续推进”。** 这是值得借鉴的产品方向，但公开原型还不足以证明它写代码更强、成本更低或能够完全无人值守。本次是文档与代码调研，未进行部署和真实模型性能验证。
