重新对照后，**我会收窄上一轮对 DSH“新意”的判断：Multica 已经实现了“长期工作项 + 事件驱动 + 多 Agent 协作”这条产品路线。DSH 的特点主要集中在环境消息的接单判断、授权范围和后续消息归属；Multica 则更完整地覆盖团队组织、工作流程与多机执行管理。**

因此，**Multica 更适合参考我们 Agent Studio 的产品结构，DSH 更适合参考持续协作的具体运行规则。**

我重读了[之前的 Multica 调研](/Users/derekdeng/Workspace/project/priva-harness/docs/research/multica-agent-studio-fit.md)，并重新检查了 Multica 当前提交 `37c8fb5`；DSH 仍以 `6337fc8` 为基准。下面是源码和官方文档层面的比较，未运行实际部署测试。

三者的主要区别，可以放在这张图里：

```text
Multica                         DSH Superagent
=======                         ==============
Issue / Chat / 自动化            GitHub / 飞书中的环境事件
          |                               |
          v                               v
Agent / Squad                   Gate + Router / Eval
具名成员与团队                   判断授权、意图与任务归属
          |                               |
          v                               v
Issue 工作流                    Ticket + Mandate
阶段、负责人、审阅               工作项 + 授权依据
          |                               |
          v                               v
Run -> Runtime -> Daemon        Assignment -> Worker Session
          |                               |
    多台机器、多种引擎                 DSH + 独立工作目录
          |                               |
          +---------------+---------------+
                          |
                 工具、模型、文件与代码

我们的 Agent API 主要提供下层的：
Session / Run / Events -> Claude / Pi Runtime
```

| 比较维度 | Multica | DSH Superagent | 我们当前 Agent API |
|---|---|---|---|
| 产品中心 | 人与多个 Agent 组成的工作空间 | 融入 GitHub、飞书的持续工作 Agent | 可编程的 Agent 执行服务 |
| 长期工作对象 | Issue / Project | Ticket | 主要是 Session / Run |
| Agent 身份 | 长期具名成员，可加入不同团队 | 对外一个 Agent，内部按任务创建 Worker | 当前自用 API 尚无具名 Agent 对象 |
| 协调方式 | Squad leader、工作流阶段、评论路由 | Router、Eval、Thread 订阅 |
| 自动化 | Autopilot、Webhook、Issue Wakeups | 环境事件准入、规则研判、主动接单 |
| 执行位置 | 多电脑 Daemon，Agent 绑定 Runtime | 当前原型主要在一个 DSH profile 内执行 | 在指定 Runner / Sandbox 内执行 |
| 人工监督 | 看板、负责人、审阅、Inbox、执行记录 | 优先展示需要回答、审核或处理的问题 | 由调用方组织监督体验 |

这里需要强调：**Multica 不是一个只能手工派单的看板。** 它已有事件驱动的协作、持续任务和自动唤醒。[Multica 项目说明](https://github.com/multica-ai/multica)、[DSH 领域模型](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/001-domain.md)

我认为最值得展开的是下面四个区别。

**第一，Multica 管理“一个团队”，DSH 更像“一个成员背后的工作系统”。**

Multica 中，前端 Agent、后端 Agent、Reviewer 和人都可以是长期成员。Squad leader 读任务和成员能力，派工后结束当前轮次；成员反馈、子任务完成，再唤醒 leader 协调后续工作。

这和 DSH 的 Router / Worker 已经非常接近。区别是：

- Multica leader 在一组长期成员之间分配工作。
- DSH Router 主要决定是否接单、归到哪个任务，再为任务配置 Worker。

所以，“上层协调、下层执行”“派完任务不阻塞等待”“结果回来再继续协调”，都不能算 DSH 独有的新架构。[Squad 官方说明](https://multica.ai/docs/squads)

两者的任务都可以跨越多次模型运行。**Multica 的 Issue 和 DSH 的 Ticket 是同一层次的业务对象；它们都不应该与一个 Run 或一个子 Agent 画等号。**

**第二，DSH 对“尚未成为任务的信息”处理得更明确。**

用同一个场景最容易看出差别：

> 飞书群里有人说：“升级后导出功能坏了。”没有 @ Agent。

Multica 的普通群聊入口通常不会因此启动执行。它要求消息明确指向 Bot，并校验账号绑定、工作空间成员身份和 Agent 调用权限。非点名消息可以作为上下文，但不自动变成一次运行。用户也可以用 `/issue` 建立工作项。[聊天入口说明](https://github.com/multica-ai/multica/blob/main/apps/docs/content/docs/channels.mdx)

DSH 在配置了接收全部消息、允许的来源和相应规则后，可以把这条消息送入评估：

```text
“导出功能坏了”
       |
       v
来源和发送者是否准入？
       |
       v
是否命中团队允许的主动工作规则？
       |
       +--> observe：记录“会接单”，不执行
       |
       +--> auto：创建 Ticket，记录授权范围，再执行
```

它把“明确请求”和“从环境中推断出的工作机会”建成了不同路径，并记录为什么有权做、允许做到什么程度。[DSH 授权设计](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/002-authorization.md)

**这是内置抽象和默认流程的区别，不是 Multica 在能力上做不到。** Multica 完全可以通过 Autopilot 启动一个 Agent 去分析反馈、决定是否建 Issue；只是 DSH 把这部分做成了专门的接单机制。

授权也不能简单说成“DSH 有，Multica 没有”。Multica 的 Wakeup 已记录创建者、来源任务和触发依据，并在执行前重新校验权限。DSH 更突出的是“这项工作获得了什么范围的授权”，Multica 更围绕“谁有权调用哪个 Agent，以及这次委派源自谁”。[Multica Wakeup 实现](https://github.com/multica-ai/multica/blob/37c8fb5a172ac3f2108b8f6e175a603f6fa3a7bf/server/internal/service/issue_wakeup.go)

**第三，持续跟进和安静等待，Multica 也已经做得相当具体。**

这次补查中，最值得补充到之前认知里的，是 Multica 的 **Issue Wakeups**。

它可以让 Agent 等待：

- 某个人回复，或某个字段发生变化；
- 某次运行结束、子任务或一个阶段完成；
- 关联 PR 的 CI 结束、合并或出现冲突；
- 指定时间到来，或定期回来检查。

Agent 可以自己创建 Wakeup，然后结束当前运行；等待期间不持续运行模型。它还有已有任务合并、重复触发限制、循环保护，以及检查后无事可做就不发评论的 silent check。[Issue Wakeups](https://multica.ai/docs/issue-wakeups)

因此，上一轮提到的“持续工作、事件唤醒、减少人工盯守、保持安静”，**Multica 已经有同类实现**。

DSH 更有特色的是外部 Thread 与任务之间的订阅关系：任务订阅后，后续反馈直接进入原 Worker，不要求每次重新点名；Worker 发现超出当前范围，再交回 Router。

这里也要区分入口：Multica 普通外部群聊跟进通常仍需点名，但 **Multica 自己的 Issue 评论已经有负责人、回复线程和 Squad 的自动路由**。不能把群聊入口的限制说成整个系统都不会自动跟进。

**第四，多机执行和正式工作流程，Multica 的覆盖明显更广。**

Multica 已经有服务端队列、机器身份、Runtime 注册、心跳、容量管理、任务领取和恢复机制；项目工作流还能把“开发 → Review → QA”等阶段绑定到不同 Agent 或人。一次 Run 完成与业务阶段完成明确分开。[Runtime 说明](https://multica.ai/docs/daemon-runtimes)、[工作流说明](https://multica.ai/docs/workflows)

DSH 当前公开原型主要是单个 DSH profile、本地 SQLite、多个 Worker 和工作目录。它没有展示与 Multica 对等的多机控制层。

但之前对 Multica 的两个限制仍成立：

- 主要按绑定的 Runtime 执行，离线任务不会自动转到另一台空闲机器。
- 业务上下文留在服务端，不代表原生会话和工作目录可以跨机器无缝迁移。

对我们之前关心的“多台电脑接入与执行”，Multica 仍然是更直接的参考。

还有一个很能说明层次关系的发现：**Multica 已经有 DeepSeek Harness 执行适配器。**

```text
Multica 工作平台 ------> DeepSeek Harness
DSH Superagent -------> DeepSeek Harness
```

适配器通过 `dsh --profile multica --stdio` 驱动 Harness，由 DSH 自己负责 Agent loop、会话、工具和 MCP，Multica 转换事件并管理上层工作。

这说明二者可以使用同一个执行基础；但 **支持 DeepSeek Harness，不等于已经集成 dsh-superagent 的接单与授权系统**。[DSH 适配器源码](https://github.com/multica-ai/multica/blob/37c8fb5a172ac3f2108b8f6e175a603f6fa3a7bf/server/pkg/agent/dsh.go)

对我们，我会维持“保留 Runner、吸收上层设计”的判断，并把参考对象分得更明确：

| 我们要建设的能力 | 优先参考 |
|---|---|
| 具名 Agent、成员权限、Builder、团队与项目 | Multica |
| 多电脑注册、执行位置、容量、任务队列与恢复 | Multica |
| 工作项、阶段交接、审阅、条件唤醒 | Multica |
| 从自由消息中判断是否接单 | DSH |
| 明确请求与推断请求、授权范围、观察模式 | DSH |
| 外部对话与工作项的归属、订阅和越界交回 | DSH |
| 会话、工具、模型、执行事件与 Sandbox | 保留我们的 Runner / Agent API |

组合后的方向可以是：

```text
人工创建任务 / 外部消息 / 定时事件
                  |
          接单与消息归属规则
           参考 DSH 的语义
                  |
       Studio 的 Agent / 工作项 / 审阅
          参考 Multica 的产品结构
                  |
        Runtime 选择 / 队列 / 恢复
                  |
          我们的 Agent API
                  |
           Claude / Pi / Sandbox
```

这属于研究建议，不是已经确定的实施方案。当前 API 的运行中投递、取消和交互回答仍需补齐，才能支撑完整的持续协作。

**如果只选一个作为 Agent Studio 的主要参考，我选 Multica；如果研究如何让 Agent 自然参与已有 GitHub、飞书讨论，我会重点读 DSH。** 两者都属于现有 Agent 能力之上的实质系统工程。把 Multica 放进比较之后，更没有理由把 DSH 称为全新的技术范式；它的价值是把一部分长期协作问题定义得更清楚，而不是首次提出“让 Agent 持续工作”。
