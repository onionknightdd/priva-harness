**值得吸收，而且与我们规划中的 Agent Studio 有很强的互补性。** 我建议保留现有 Agent Runner，吸收 Multica 的具名 Agent、任务协作、运行环境管理和调度设计。

你最关心的多电脑问题，答案也明确：**Multica 已经能够同时连接多台电脑，并在这些电脑上并发执行 Agent 任务；但它没有提供完整的多电脑远程桌面控制，也没有现成的运行中会话跨机热迁移。**

这次研究以 Multica 的固定提交 [`90a8851`](https://github.com/multica-ai/multica/tree/90a88519df5300545434d66689fd61c7b2eee705) 为准，追踪了运行注册、任务领取、并发、恢复、Squad、Agent Builder、工作流和相关测试，也对照了我们的 `priva-harness` 及本地 `agent-workshop`。下面区分源码已实现能力与我的融合建议。

**它的核心价值，是把 Agent 执行放进了一个持久的团队工作系统。**

Multica 的主要对象分工很清楚：

| 对象 | 负责什么 |
|---|---|
| Agent | 长期身份、指令、模型、Skills、MCP、调用权限 |
| Runtime | 在哪台电脑、使用哪个执行引擎运行 |
| Issue / Project | 要完成什么工作、谁负责、处于哪个阶段 |
| Run | 某一次实际执行的过程、结果、错误、用量 |
| Squad | 由 leader 协调的一组 Agent 和人 |
| Autopilot | 定时或外部事件触发的工作 |

这些都有对应的数据结构和执行路径。例如 `Agent` 持有 `RuntimeID`，任务另外保存自己的 `runtime_id`、尝试次数、父任务、会话和工作目录。[数据模型源码](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/pkg/db/generated/models.go#L25-L141)

```text
用户 / 自动化
      |
      v
Issue / Project ----> Agent / Squad
      |                     |
      +--------> Run <------+
                  |
           指定 Runtime
                  |
         对应电脑上的 Daemon
                  |
       Claude / Codex / Pi / ...
```

我们已经做了大量“执行过程中发生了什么”的能力；Multica 补充的是“这项工作为什么发生、交给谁、在哪执行、何时需要人介入”。

**多电脑连接和调度是实际实现，但需要准确理解它的范围。**

| 你可能需要的能力 | Multica 当前情况 |
|---|---|
| 同时接入多台电脑 | **支持**，每台电脑运行 Daemon |
| 不同电脑同时执行不同任务 | **支持** |
| 一台电脑运行多个 Agent / 引擎 | **支持**，共享本机并发容量 |
| 明确指定某个 Agent 在哪台电脑工作 | **支持**，通过 Runtime 绑定 |
| 团队成员分别在不同电脑执行 | **可以组合实现**，成员分别绑定各自 Runtime |
| 自动选择最空闲电脑执行 | **未发现通用实现**，主路径是固定绑定 |
| 运行中的会话无缝迁移到另一台电脑 | **未发现实现** |
| 统一观看、点击、输入多台电脑桌面 | **未发现内置通用 VNC/RDP/CUA 实现** |

它的实际运行结构是：

```text
                 Multica 服务端 + PostgreSQL
                    持久任务队列 / 状态
                     ^             ^
            出站 HTTP/WS       出站 HTTP/WS
                     |             |
              电脑 A Daemon    电脑 B Daemon
                本机并发池       本机并发池
                /      \         /      \
             Claude   Codex    Claude    Pi
```

源码里几个值得学习的细节：

- **机器身份与 Runtime 分开。** 一台电脑有稳定的 `daemon_id`；同一电脑上的不同 provider/profile 可以注册成多个 Runtime。[身份与注册](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/internal/daemon/identity.go#L14-L35)、[注册唯一键](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/pkg/db/queries/runtime.sql#L68-L150)
- **电脑主动连接服务端。** Daemon 发起携带认证的 WebSocket，通常不需要给每台电脑开放入站端口；前提是电脑能够访问服务端。[连接实现](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/internal/daemon/wakeup.go#L99-L145)
- **先预留本机空闲槽，再领取任务。** 有机器级并发池，也有 Agent 级并发限制；SQL 使用锁和 `SKIP LOCKED` 处理并发领取。[本机调度](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/internal/daemon/daemon.go#L5291-L5464)、[任务领取 SQL](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/pkg/db/queries/agent.sql#L729-L790)
- **任务队列与连接状态分离。** WebSocket 用于及时通知和领取，另有轮询、准备阶段租约、断线宽限与故障恢复。不能把“显示离线”理解成“本地进程已经停止”。[租约恢复](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/pkg/db/queries/agent.sql#L853-L955)

默认本机并发上限是 20、心跳间隔 15 秒，但这只是配置默认值，不能当作机器实际承载能力或压测结论。[配置源码](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/internal/daemon/config.go#L25-L72)

还有两个实用限制：跨电脑不会自动共享工作目录；会话恢复会检查 Runtime 是否一致。因此，“电脑 A 开发、电脑 B 测试”可以组织出来，但代码和产物需要通过 Git 或显式交接传递。[本地目录归属](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/internal/daemon/local_directory.go#L168-L211)、[会话恢复检查](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/internal/handler/daemon.go#L3635-L3650)

**与我们项目的契合度：产品设计高，直接源码融合较低。**

先说明一个重要现状：本地 `agent-workshop` 中的 Agent Studio 目前只有骨架，架构文档将它定义为未来服务。最新的 `priva-harness` 契约进一步规定：**Studio 提供 API，UI 入口加入现有 `agent-ui`，执行复用我们的 Agent API、Harness 和 SDK。** 因此，这次评估主要针对 Studio 的建设方向；不能说已有一个完整 Studio 等待插入 Multica。[Studio 规划]( /Users/derekdeng/Workspace/project/agent-workshop/docs/ARCHITECTURE.md:277)、[最新接口分工](/Users/derekdeng/Workspace/project/priva-harness/docs/architecture/agent-api-v1.md:1062)

| 方向 | 我们当前的基础 | Multica 能带来的价值 | 契合度 |
|---|---|---|---|
| Agent 执行 | Claude/Pi、SDK/TUI、会话、工具、子 Agent | 更多引擎适配经验 | 中，已有较多重叠 |
| 具名 Agent | 当前自用 API 尚没有此对象 | 身份、能力配置、权限、执行位置分离 | **高** |
| 团队任务 | 当前 Tasks 是会话内后台任务 | 长期工作项、负责人、审阅、交接 | **高** |
| 多电脑 | 单 Runner、本地会话、单桌面配置 | 机器注册、心跳、并发、任务领取 | **高，但需要建设控制层** |
| Agent 发布 | 已有快照与隔离调用设计 | 配置创建、共享和管理体验 | 高，但隔离模型不同 |
| 桌面操作 | 已有 noVNC 与 computer MCP | 未发现可直接补齐的桌面控制层 | 低 |
| 整套代码移植 | TypeScript Runner 与现有前端 | Go 服务、PostgreSQL、独立客户端体系 | 较低 |

例如，我们现有 `Tasks & Activity` 按会话读取后台任务，没有团队工作项的负责人和审阅生命周期；Computer 路由也只连接一组固定 VNC 地址。[后台任务视图](/Users/derekdeng/Workspace/project/priva-harness/agent-ui/src/features/workspace/views/workspace-tasks-view.tsx:7)、[桌面配置](/Users/derekdeng/Workspace/project/priva-harness/services/agent-runner/ts/src/computer-config.ts:3)

**我最建议吸收以下六项，优先级并不相同。**

| 优先级 | 设计 / 功能 | 在我们这里的落点 |
|---|---|---|
| P0 | Agent 身份、Release、Runtime、Run 分离 | Studio 的基本对象模型 |
| P0 | 机器注册、能力上报、心跳、容量、任务租约 | 平台控制层与节点代理 |
| P1 | 对话式 Agent Builder + 可编辑配置草稿 | Studio 创建 Agent 的入口 |
| P1 | 工作项关联运行、产物、审阅和阻塞状态 | Studio 协作功能 |
| P2 | 事件驱动的 Squad 协作 | 跨会话、跨机器的团队任务 |
| P2 | Autopilot、Skill 包校验与分发 | 自动化与资源发布 |

其中三个点尤其适合我们。

**第一，具名 Agent 应该是长期对象，发布版本和执行机器分别关联。** 我们的 API 文档已经明确把“将目录和配置保存为可调用 Agent”留到 Studio 设计，Multica 正好提供了成熟的参考。但我们还需要自己的不可变 Release，不能把可随时编辑的 Agent 配置直接当发布快照。[我们预留的设计位置](/Users/derekdeng/Workspace/project/priva-harness/docs/architecture/agent-api-v1.md:1099)

```text
Agent：长期身份与用途
  |
  +--> Draft：正在调整的目录与配置
  +--> Release：已发布的固定版本
  +--> Runtime binding：允许在哪执行
  +--> Sessions / Runs：执行历史
```

**第二，对话式 Builder 很适合 Studio。** Multica 已有实现：用户通过聊天描述需求，模型产出结构化草稿，配置面板同步更新，用户检查后再创建。它限制模型只能选择现有模型、Skill 和成员 ID，默认私有，并要求不要把秘密写入草稿。这比单纯提供一张很长的表单更值得参考。[Builder 后端](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/internal/handler/agent_builder.go#L20-L55)、[草稿协议](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/packages/core/agents/builder-protocol.ts#L9-L35)

```text
用户描述 -> AI 生成草稿 -> 表单编辑 -> 预览执行 -> 确认发布
                ^             |
                +-------------+
```

**第三，业务工作与执行状态必须分开。** 一次 Run 成功，只说明这次执行结束，不代表用户要求已经验收。Multica 的 Issue 工作流可以在阶段变化时交给另一个 Agent 或人，并保留同一项工作的讨论和结果。这很适合扩展我们现有的运行过程展示。[工作流交接实现](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/internal/handler/issue_workflow_entry.go#L18-L101)

```text
工作项 -> 执行 Run 1 -> 待审阅 -> 补充要求 -> 执行 Run 2 -> 验收
             |                                |
        工具 / 子 Agent                  工具 / 子 Agent
```

Squad 则适合后续补充：leader 被唤醒后分派工作、结束当前轮次，成员反馈再唤醒 leader。源码同时包含提示词协议和服务端触发规则，所以应把它理解为事件驱动协作，不能直接当作严格、确定性的 DAG 工作流引擎。[Squad 协议实现](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/internal/handler/squad_briefing.go#L33-L94)

**融合到 Agent Studio 时，我建议沿用我们已有的服务分工。**

下面是研究建议，还不是已批准的实施方案：

```text
agent-ui
  +-- 现有 Chat / Files / Computer
  +-- Studio：Agents / Releases / 工作项 / Runs / 审阅
                         |
                    Studio API
               业务对象、发布、权限
                         |
          +--------------+---------------+
          |              |               |
     Control Plane    Scheduler     Runtime Access
     机器与资源登记    队列/租约/重试   鉴权/路由/连接
          |              |               |
          +--------------+---------------+
                         |
              节点代理 / 执行适配层
                 /       |        \
                v        v         v
             Runner A  Runner B   发布 Worker
             私人电脑   团队服务器  隔离快照环境
                |        |         |
              现有 Agent API / Harness / Claude / Pi
```

这样 Studio 管“谁做什么、发布什么、谁能调用”；机器连接和执行调度由平台层承担；Runner 继续负责本机执行。

当前 HTTP/SSE Agent API 已能支持创建会话、发送任务、等待或订阅结果，足够做第一版闭环。但 API 的取消、运行中投递、交互回答、任务停止和 WebSocket 等能力尚未全部实现，完整调度集成需要补齐这些控制能力。[实际能力声明](/Users/derekdeng/Workspace/project/priva-harness/services/agent-runner/ts/src/harness/agent-api/agent-api-service.ts:87)

如果“多电脑”还包括远程桌面操作，需要另外增加**桌面资源锁**：同一机器可以并发跑多个代码任务，同一桌面上的鼠标键盘操作却需要协调。现有 Computer 面板也要增加 Runtime 归属、授权和路由，单加一个电脑下拉框不够。

**如果希望直接使用 Multica，也存在可行的桥接路线。**

它没有通用的“填一个 Agent API 地址即可接入”配置，但已有 `qoder_cloud` 远程 Bridge：注册 Runtime、领取任务、调用远端会话 API、回传事件与结果，并保存恢复状态。可以参考这个模式开发 Priva Bridge。[现有 Bridge](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/server/internal/qoderruntime/bridge.go#L111-L155)

```text
Multica 工作项 / 队列
          |
   Priva Bridge（需开发）
          |
   我们的 Agent API
          |
   现有 Runner / 工具 / 桌面
```

这条路适合内部验证协作体验。不过作为我们产品的长期核心，会同时引入两套 Agent、权限、任务和运行状态模型，维护成本明显高于吸收设计后接入自己的控制层。

直接搬用源码还受到两个实际边界影响：

- **许可证。** 当前是带附加条件的 Multica License，不能按普通 Apache 2.0 处理。文本明确限制对第三方提供托管服务及商业产品嵌入，并有品牌、署名要求；单一组织内部使用有不同待遇。商业整合前需要确认授权，不能默认“公开源码就能直接嵌入”。[当前 LICENSE](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/LICENSE)
- **执行隔离。** Multica 默认让任务拥有 Daemon 所属系统用户的权限，不提供完整文件系统沙箱保证。我们的公开 Agent 发布要求快照、会话隔离和凭证代理，因此发布执行边界必须继续遵守自己的设计。[Multica 隔离说明](https://github.com/multica-ai/multica/blob/90a88519df5300545434d66689fd61c7b2eee705/apps/docs/content/docs/security-model.mdx#L8-L47)、[我们的发布执行要求](/Users/derekdeng/Workspace/project/priva-harness/docs/architecture/agent-api-v1.md:1068)

**我会按三个可验收的阶段推进，而不是一次引入整个协作平台：**

```text
具名 Agent + 单 Runtime 执行闭环
                 |
                 v
两台电脑注册 + 指定机器执行 + 断线与重试验证
                 |
                 v
工作项 / 审阅 + Squad / 自动化
```

第一阶段验证 Studio 能创建、预览和调用 Agent；第二阶段用两台电脑验证并行执行、容量限制、重连、重复领取防护和会话归属；第三阶段再建立长期工作项与跨 Agent 交接。

本次完成的是源码、SQL、文档及测试用例审阅，未修改我们的仓库，也未运行 Multica 测试或真实多机部署。因此，多机功能属于**源码层面确认**，实际部署稳定性、性能和桌面协同效果仍需上述验证。
