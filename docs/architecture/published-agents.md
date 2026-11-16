# Agent 发布与隔离调用设计

状态：设计草案，尚未实现。日期：2026-09-28。

> 2026-10-22 更新：调用接口（`/api/v1`、`runs + input.text/fileIds`、按 run 的公开事件流）和
> 逐项挑选资源的发布模型已被 [Agent API v1](agent-api-v1.md) 取代：调用路径改为
> `/api/agent/v1/published/{agt}/…`，发布单元改为整个隔离目录，实现移到 agent-workshop 的 agent-studio。
> 本文的隔离、凭证、网络与沙箱分析仍可作为 agent-studio 的参考。

本文基于当前前后端代码，配套契约见 [OpenAPI 3.1](../api/published-agents.openapi.yaml)。路径、类型和错误码均为拟新增接口，不能当作当前已经可用的能力。

## 1. 产品边界与待确认决策

目标：发布者选择自己的指令、上下文、文件、Skills 和 MCP，生成可通过 HTTP 调用的 Agent；每个调用方只获得该发布版本授权的数据与能力。调用者不能通过修改请求、提示注入、执行命令或调用工具，进入发布者的私人工作区。

建议采用以下基线，三项仍待产品确认。本方案按该基线展开，不代表已经批准实施：

| 决策 | 建议 | 对结果的影响 |
| --- | --- | --- |
| 文件更新方式 | 发布时固定快照，修改后重新发布 | 运行不挂载发布者的实时目录；授权内容和执行配置可追溯 |
| 访问方式 | 支持 `api_key` 与 `public`，首次启用默认为 `api_key` | `public` 允许匿名创建会话，仍发放会话专属令牌 |
| 部署边界 | 每个用户有自己的私人 Runner；公开执行使用另外的 Worker Pod | 现有代码没有多租户边界，不能直接把多用户放进同一个私人 Runner |

如果选择实时目录，需要额外设计目录同步、一致性和撤权机制；如果选择多用户共用私人 Runner，需要先改造其文件、配置、会话和资源存储。两者都不是本方案中的配置开关。

```text
配置资源 -> 发布草稿 -> 构建固定版本 -> 沙箱预览 -> 启用版本
                                              |
HTTP 调用者 -> 独立会话 -> 隔离执行 -> 回复 / 授权产物
```

这里的“固定路径”是限制可见的业务数据范围，不是禁止进程读取运行所需的系统库。Agent 可读最小运行时、发布包和授权快照；可写本次会话的工作目录。`cwd` 只决定工作目录，不能充当权限边界。

上下文、提示词和 Skill 内容一旦交给模型，就应视为可能出现在回答中。不能同时承诺“让 Agent 使用某份秘密”与“任何调用者都无法通过回答获知它”。凭证不属于上下文；必须留在沙箱外。Shell 命令可以在隔离范围内执行，但不承诺所有命令都能运行。

## 2. 当前代码与可复用范围

| 位置 | 当前行为 | 本方案处理 |
| --- | --- | --- |
| `services/agent-runner/ts/src/main.ts` | 单一 runtimeHome、工作目录、原生 Claude/Pi 用户目录，组装私人 Runner | 保留私人用途；增加发布资源导出适配器，不让公开调用复用这套运行实例 |
| `src/core/contract/agent-provider.ts` | `ProviderRunSpec` 含 cwd、model、authToken；无发布实体或隔离策略 | 私人契约保持职责；新增内部 `PublishedExecutionSpec`，只能由可信服务生成 |
| `src/provider/claude/claude-runtime.ts` | SDK 使用 bypassPermissions，读取 user/project/local settings，合并进程环境 | 共享 Worker 只读取生成的发布配置；去掉私人配置自动发现和环境继承 |
| `src/provider/pi/pi-session-factory.ts`、`pi-resource-loader.ts` | Pi SDK、扩展及资源加载在 Runner 进程中执行 | 必须先进入隔离进程，再加载 Pi、扩展、Skill、MCP；只改 Bash 不够 |
| `src/provider/claude/tools/compile-custom-tools.ts` | 部分产品工具直接在宿主 Node 进程中执行 | 使用发布专用工具注册表，处理函数也运行在 Worker 内 |
| `src/infrastructure/resources/mcp-probe.ts` | 可启动 stdio MCP，默认可继承宿主环境 | 发布检查进入构建沙箱；选择资源时不自动启动宿主 MCP |
| `src/transport/http/route/resources.ts` | Skills/MCP/Memory/Subagent 来源发现、编辑和检查 | 复用来源元数据与内容解析；新增快照导出，不直接复制整份原生配置 |
| `src/transport/http/route/user-files.ts` | 私人绝对路径文件接口 | 只供发布者挑选资料；公开 API 仅接受不透明 fileId |
| `src/transport/http/route/model-profiles.ts` | 详情含凭证；列表复用 `toProfileResponse`，同样包含 auth_token | 新增发布专用的无秘密模型来源投影；服务端建立凭证绑定，不整份复用原响应 |
| `src/transport/http/server.ts` | 未发现内置租户 principal 或统一鉴权前置层 | 新增可信身份接入，分别注册管理、公开、内部路由；不把整个私人端口暴露出去 |
| `src/transport/http/route/subagent-test.ts` | POST SSE，连接关闭会中止，没有持久重放 | 参考编码方式；预览必须走共享执行路径，不复用私人测试执行逻辑 |
| `src/harness/agent-harness.ts` | 私人 warm runtime、内存事件缓冲 | 可复用运行编排抽象；共享实例、持久事件与私人池分开 |
| `agent-ui/src/features/resources/` | 来源分组、列表详情布局、Skill/MCP 编辑器 | 复用展示组件与来源类型；发布选择器只读，不触发原有 MCP 自动探测 |
| `agent-ui/src/lib/app-view.ts`、`src/App.tsx`、`src/app/agent-layout.tsx` | 状态驱动页面切换，没有发布实体页面 | 新增已发布 Agent 视图；公开调用页使用独立应用入口 |

上表后端 `src/` 均相对 `services/agent-runner/ts/`。当前 Subagent 是资源定义，`agent/profile` 是运行偏好，都不能直接充当 PublishedAgent。当前侧栏的 Subagent/Memory 页面尚未开放，发布选择器不能假定已有可复用完整页面。

现行私人流协议是 v2。已有 [v3 草案](../design/harness-stream/architecture/harness-stream-protocol-v3-draft.md) 尚未实现。本文不修改该草案，也不要求私人 Claude TUI 改为 SDK；共享 Worker 建议使用当前已有的程序化 provider 接口。公开事件是单独定义的最小投影，不能直接转发私人原始事件、thinking、绝对路径或原生 transcript。

## 3. 系统与信任边界

```text
Owner Browser                         External HTTP Client / Public UI
     | OIDC identity                               | API key / anonymous
     v                                             v
Authenticated Owner Gateway                Public Invocation API
     |                                             |
     +-------------- Publishing Service -----------+
                         |       |          |
                         |       |          +-- PostgreSQL: state, jobs, events
                         |       +------------- Object store: bundles, artifacts
                         |
             +-----------+---------------------+
             |                                 |
      Private Runner exporter             Worker coordinator
      owner files / resources              Kubernetes API identity
      selected credentials                       |
             |                            Session Worker Pod
             +--> Credential vault          +-----------------------------+
                    |                       | trusted supervisor           |
                    v                       |   | private pipes            |
              Model / MCP Broker <----------|   v                          |
              scope + quota checks          | bubblewrap                   |
                    |                       |   provider + file tools      |
                    v                       |   Skills + local MCP         |
              Approved upstream             |   readonly published bundle |
                                            |   private session workspace |
                                            +-----------------------------+
```

分工：

1. **私人 Runner** 提供已鉴权的资源选择和固定快照导出。控制面不能接受公开调用者传入的私人路径。每个 Runner 的 owner 绑定由部署身份决定，不能由 `X-Owner-Id` 请求头声明。
2. **Publishing Service** 管理草稿、版本、激活、访问凭证、会话、任务和额度。管理路由与公开路由可以复用业务模块，但部署入口、鉴权策略和路由注册必须分开。
3. **Worker coordinator/supervisor** 是可信执行设施：调度 Pod、下载固定包、准备 mount、启动 bwrap、监督进程、回传事件、销毁会话。Kubernetes 创建 Pod 的权限只属于 coordinator。supervisor 无需 ServiceAccount token。
4. **沙箱内 Worker** 包含整个 provider、工具、扩展、子 Agent 和 stdio MCP。不能把不可信插件加载到 supervisor。与 supervisor 的通道只接受有上限的结构化消息，不提供任意宿主读文件、spawn 或挂载 RPC。
5. **Broker** 持有真正的上游凭证；沙箱仅得到绑定 execution/session 的短期凭证。模型地址、模型名、MCP 工具/资源范围由 release 固定，不能从调用输入覆盖。

管理接口经 owner gateway 路由到发布服务；需要读取本地原生配置的凭证绑定操作由该 owner 的私人 Runner 适配器完成，秘密直接写入服务端 vault。导出包只含引用。内部出口地址由部署配置固定，不接受客户端传入上传地址。具体 vault 和对象存储产品的管理 API 不属于本文业务接口。

共享发布控制面按多副本部署考虑，建议新增 PostgreSQL，用事务完成所有权检查、配额预留、幂等、任务租约和事件追加；初期直接使用数据库任务表，不必再引入 Redis。对象存储保存按 digest 寻址的发布包、上传和产物。现有 SQLite 使用统计是 best effort，不能承担上述安全或恢复语义，详见 [usage-data-store.md](usage-data-store.md)。私人统计的 retention 不随这项功能改变。

主要持久化约束：`agents/drafts/releases/activations` 记录所有权与版本，`credential_bindings/api_keys` 记录授权引用与 epoch，`sessions/runs/executions` 记录运行与租约，`run_events/interactions/files/artifacts` 记录调用数据，`idempotency_records/quota_reservations/audit_events` 记录事务证据。数据库保证 `(agent_id, release_number)`、`(run_id, seq)`、`(principal_scope, route, idempotency_key)` 唯一，并对每个 session 的非终态 run 建部分唯一索引。作业入队与 quota 预留同事务提交；SSE 广播与 Pod 调度从已提交状态驱动，不能先执行再补记录。

## 4. 发布实体与版本

```text
PublishedAgent (ownerId, name, description, activation, revision)
  +-- Draft (revision, instructions, references, limits)
  +-- Release N (frozen draft, manifestDigest, bundleDigest, runtime digest)
  |     +-- model credential binding
  |     +-- selected context / files / Skills / MCP
  +-- API keys (hashed secret, expiry, revocation)
  +-- Sessions (caller capability, pinned release)
        +-- Runs -> Events / Messages / Interactions / Artifacts
        +-- Private workspace, uploaded files, provider session state
```

`ownerId` 来自验证后的身份。所有 SQL 查询同时限定 owner 或 session capability；知道 UUID/ULID 不是访问许可。公开 sessionId 不等于 provider sessionId。版本使用服务端 ID 和递增序号，不让调用者指定任意版本。

草稿内容：

- `harness`：Claude 或 Pi；`resourceCwd` 仅用于发布者解析当前项目来源。
- `instructions`：明确对外授权的指令/上下文；`contextRefs` 显式选择 Memory 资源。私人会话历史不自动复制，选中文本可以手动放入草稿。
- `modelBindingId`：已建立的模型凭证绑定；创建时明确选择已有 profile 和 modelId，冻结模型与上游配置，禁止在公开请求中填写 authToken/baseUrl。
- `snapshotRoots`：授权的来源路径、include/exclude 规则、沙箱别名与用途。`read_only` 挂在 `/data/<alias>`；最多一个 `workspace_template` 用来初始化每个会话的 `/workspace`。
- `skillRefs`：精确选择的来源资源；构建时固定所有文件 digest。
- `mcpBindings`：来源资源、允许工具名、可选凭证绑定和服务端已注册的资源策略。未声明工具默认拒绝。
- `execution`：已验证 runtimeProfile、runMode/effort、是否向 Agent 开放 shell 工具、仅 broker 网络出口。复用现有模式值，但以发布权限交集为准，不支持的 provider/模式组合在构建时拒绝。
- `limits`：时长、token、并发、会话次数、上传额度等。服务端统一平台上限优先于草稿设置。

每个 Release 冻结草稿 revision，并记录资源内容 digest、runtime image digest、工具/schema digest、沙箱策略版本和模型绑定配置 revision。原生 Skill 当前没有 revision，不能只保存其 id；必须对实际导出内容做 hash。

构建先安全导出实际字节，再由用户审阅最终 manifest；导出时源文件若变化导致无法形成一致文件，构建失败重试。不同文件未必来自源目录同一瞬时快照，页面必须说明“发布的是这份导出包”；需要原子多文件一致性时，应使用固定 Git commit 或存储快照作为源。

符号链接、硬链接、设备、socket、`..`、绝对归档条目和逃出根目录的路径均拒绝；按目录 fd 打开并检查文件，防止先检查路径再跟随链接的竞态。仅用字符串前缀、realpath 一次或 glob 不能构成边界。默认过滤 `.git`、原生会话目录与常见凭证文件，阻止选取已知私人运行目录；扫描只能辅助发现，最终授权对象是用户看到并确认 digest 的完整 manifest。

```text
Release: queued -> building -> ready -> revoked
                     |
                     +-----> failed

Draft revision 8 -> Build release 3 -> Review digest -> Preview session
                                                         |
                                   Activate release 3 <---+
                                          |
                      new sessions use 3; old sessions stay on 2
```

构建中的探测、包解析和 MCP 启动也属于不可信代码执行，使用独立构建 Worker，不能在私人 Runner 或控制面执行 `npx`/安装脚本。V1 仅支持 runtimeProfile 中已包含的依赖和被批准的扩展组合，不在调用时临时下载安装工具。构建检查生成目录、命令可用性、MCP schema、资源范围与平台隔离能力；ready 不代表第三方 MCP 的语义安全已自动证明。

激活必须提交 `releaseId + manifestDigest + If-Match`，且版本已 ready、检查通过。更改草稿不影响已启用版本。更改模型端点、权限、资源范围需要新版本；只轮换同范围秘密可以更新 binding。收缩或撤销 binding 立即生效，扩大范围不能通过轮换偷偷影响旧版本。

## 5. bubblewrap、网络与 Kubernetes

建议的可见目录：

| 路径 | 权限 | 来源 |
| --- | --- | --- |
| 最小系统库、Node、provider 二进制 | 只读 | 固定 runtime image |
| `/agent` | 只读 | 当前 release 的指令、Skills、生成配置、工具定义 |
| `/data/<alias>` | 只读 | 用户确认的资料快照 |
| `/workspace` | 当前会话可写 | 私有目录，可从固定模板初始化 |
| `/home/agent`、`/tmp` | 当前会话可写 | 干净目录，容量受限 |
| `/proc`、`/dev` | 最小可用视图 | 独立 PID namespace 的 proc 和必要设备 |

不挂载发布者 home、原生配置、私人 PVC、Docker/containerd socket、ServiceAccount token，也不 `--ro-bind / /`。只读根目录同样会泄露可读秘密。清空继承环境，仅注入固定 PATH/HOME、区域设置和短期 broker 凭证；关闭不需要的文件描述符。发布工作目录中的原生自动发现配置不得扩张发布清单；Skill 对其他文件的隐式依赖必须在 manifest 中解决，否则构建失败。

```text
Worker Pod: NetworkPolicy + cgroups + runtime security profile
  |
  +-- supervisor (no local HTTP admin port; identity outside sandbox mount)
  |
  +-- bwrap: mount/user/PID/IPC/UTS isolation, clean env, seccomp
        +-- provider
        +-- tools / subagents / local MCP (same or narrower boundary)
        +-- network -> approved Model/MCP Broker only
```

需要网络的 V1 Worker 可保留 Pod 网络 namespace，由支持 NetworkPolicy 的 CNI 默认拒绝出口，只放行 broker 和受控 DNS；不能宣称此时 bwrap 自己隔离了网络。允许 supervisor 访问协调服务的网络规则还必须配合 mTLS 和不可见的身份材料，防止沙箱进程冒充 supervisor。同一 Pod 内不部署持有秘密的 HTTP sidecar，NetworkPolicy 不负责隔离 Pod 内 loopback。完全离线的 Worker 才使用独立空网络 namespace。

MCP 分两类：

- **stdio MCP**：进程和依赖放在发布沙箱，继承相同文件/网络边界；MCP 的 HTTP 连接也必须经过 broker。任意用户 MCP 不在控制面探测或执行。
- **远程 MCP**：由 broker 调用，凭证以发布用途单独授权。仅允许 `tools/call` 的名称不足以限制数据范围，必须同时约束工具参数、资源 ID、分页、resources/prompts 方法和重定向。若上游只能拿到发布者整个账户且无法验证资源级限制，该 MCP 不允许发布；不能只靠 system prompt 或工具描述约束它。

shellToolEnabled=false 只关闭 Agent 的 shell 工具，不表示 Skills/扩展/MCP 不会执行代码；这些仍必须隔离。工具确认只能确认当前已授权操作，不能让公开调用者增加 mount、网络域名或权限。子 Agent 不得继承私人跨会话访问能力；run 结束前必须结束或回收全部子任务，不开放脱离 run 生命周期的后台任务。

现有 MCP 的 command/env/headers/URL 由服务端解析，秘密从生成配置中移除并改为 broker 绑定；依赖直接读取上游长期密钥、又不能改成代理调用的 MCP 不支持发布。broker 在注册上游时检查允许的地址与解析后的目标，限制重定向并防止 DNS 变化绕过出口策略，不能变成访问任意内网地址的 HTTP 代理。

K8s 基线：每个 session 独立 Pod，不同调用者不复用进程、HOME 或工作目录；非 root、capabilities drop ALL、禁止提权、只读镜像根、独立临时卷、CPU/内存/ephemeral-storage/PID 限额。`automountServiceAccountToken: false`；需要的 supervisor 身份用窄作用域凭证注入且不暴露给沙箱。会话 idle/总 TTL 到期删除整个 Pod 和工作卷，不只 kill shell。

嵌套 bwrap 是否可用取决于节点 user namespace、容器运行时、seccomp、AppArmor/SELinux 与 `/proc` 限制；`hostUsers: false` 不能替代验证。不提供 privileged、SYS_ADMIN、全面 unconfined 或“失败后本机执行”的降级。平台只公布通过实际探测的 runtimeProfile，失败返回 `SANDBOX_UNAVAILABLE`。共享内核仍是风险边界；公开运行任意不可信扩展时建议选择经过兼容性验证的更强 RuntimeClass，不能在未实测前声称 gVisor/Kata 与嵌套 bwrap 一定兼容。

bubblewrap 官方明确指出它是构造沙箱的工具，策略由调用方承担；Kubernetes 也区分不同强度的多租户隔离。本设计的文件边界基于正确策略和运行时，不声称能够抵御所有内核漏洞。[bubblewrap](https://github.com/containers/bubblewrap#sandbox-security)、[Kubernetes 多租户](https://kubernetes.io/docs/concepts/security/multi-tenancy/)、[用户 namespace](https://kubernetes.io/docs/concepts/workloads/pods/user-namespaces/)、[NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)。

## 6. 身份、密钥与会话授权

| 身份 | 获取方式 | 权限 |
| --- | --- | --- |
| OwnerIdentity | OIDC/可信身份网关，服务端验证 issuer/audience/有效期 | 管理自己的发布实体；不接受请求体 ownerId |
| AgentApiKey | 发布者创建，明文只在创建/幂等重放时返回 | 读取该 Agent 描述、创建独立会话；不能列出别人会话 |
| SessionToken | 创建会话返回的随机 capability | 访问这一会话的运行、事件、输入文件和产物 |
| WorkerIdentity | mTLS + execution 租约/fencing token | 上报该执行的事件与结果，不具备 owner API 权限 |

API key 和 session token 至少 256-bit 随机熵，服务端存 hash；请求日志屏蔽 Authorization，秘密不能出现在 URL、事件和错误中。session token 的过期时间不超过数据读取期限和父 key 有效期，执行权限另外检查会话 TTL。API key 撤销立即禁止新会话，已有派生会话停止接受操作，broker 拒绝后续调用，运行任务进入取消流程。

匿名 public 模式也先创建独立会话并返回 SessionToken；公开的是 Agent，不是该 Agent 下所有人的对话。只凭 agentId/sessionId 不能获取记录。共用一个 API key 的不同客户端，也必须各自保管 SessionToken。V1 不提供匿名会话枚举或丢失 token 后仅凭 ID 找回。

公网页面无登录也能使用 public Agent；key 模式提示输入 key 或由可信调用方后端转发，不能在静态网页源码中嵌入发布者 key。CORS 仅放行配置的 origin；CORS 不是 API 鉴权。Owner 若采用 cookie BFF，需要 SameSite 和 CSRF 校验。

## 7. 调用、状态与恢复

```text
Client             Public API / DB             Worker / Broker
  | POST sessions         |                           |
  |<-- session + token ---|                           |
  | POST runs + idem key  |                           |
  |                       |-- reserve quota / queue ->|
  |<-- 202 run -----------|                           |
  | GET events (Bearer)   |<-- durable public events --|
  |<-- SSE id: 1,2,... ---|                           |
  | disconnect            |         run continues     |
  | GET events after N -->|                           |
  |<-- replay N+1... -----|                           |
  | GET run --------------|                           |
  |<-- final output ------|                           |
```

每个 session 同时最多一个非终态 run；不同 session 受 Agent/owner 并发额度约束。创建会话仅创建授权记录，第一个 run 通过并发和额度检查后才分配专属 Pod；`maxActiveSessions` 同时限制未运行和空闲会话，防止匿名创建占满资源。会话固定 release，调用不能带 harness、cwd、system prompt、模型凭证、MCP 列表、原生 sessionId 或任意 URL。请求只包含 `input.text` 和属于本会话的 `fileIds`。run 的 deadline 从接受请求开始计算，包含排队和交互等待，并且不超过 session 执行期限。

```text
Run: queued -> running -> waiting_for_input -> running -> completed
        |         |              |
        +---------+--------------+--> cancelling -> cancelled
                  +-------------------------------> failed

Session: active -> closing -> closed
                  ^
             delete / idle / expiry / revocation
```

`waiting_for_input` 仅用于有限时间的业务问题，interaction 固定字段/schema、截止时间；超时失败 `INTERACTION_TIMEOUT`。权限扩张类问题直接拒绝，不显示“允许访问更多文件”。`cancel` 幂等，202 仅代表接收取消请求；直到 Worker 退出确认才到 cancelled。终态以数据库 compare-and-set 决定，完成和取消竞态只产生一个终态。

Worker 故障返回 `WORKER_LOST`；V1 不自动重跑已经开始的任务，因为 MCP 可能已产生外部副作用。尚未开始的排队任务可重新派发，通过租约与 fencing token 拒绝旧 Worker 继续上报。健康心跳无法延长服务端设定的最终执行期限。run 完成不等于允许后台工具继续运行。

会话正常期间保留独立 provider 上下文。Worker 丢失时关闭该 session，已持久化输出在授权与保留期内仍可读，客户端新建会话；不伪装成恢复了未持久化的原生进程状态。

### 流协议

公开流使用 SSE，不直接开放私人 WebSocket。`GET /runs/{id}/events` 支持 `Last-Event-ID` 或 `after`，两者同时给出且不一致返回 400。每个 run 的事件 seq 从 1 严格递增，写入数据库成功后再广播；重连至少一次交付，客户端按 `(runId, seq)` 去重。

```text
id: 12
event: message.delta
data: {"v":1,"runId":"run_...","seq":12,"createdAt":"...","type":"message.delta","data":{"messageId":"msg_...","text":"你好"}}

```

事件：`run.status`、`message.delta`、`message.completed`、`tool.status`、`interaction.requested`、`interaction.resolved`、`artifact.ready`、`usage.updated`、`run.finished`。message.completed 含完整可公开内容，run.finished 含最终快照；GET run 同样返回权威 output 与 lastEventSeq。tool.status 只展示允许公开的名称和状态，V1 不发布工具完整输入/输出或 thinking。

心跳使用 SSE 注释，约 15 秒一次。反向代理关闭缓冲，空闲超时大于心跳间隔；浏览器使用 fetch 读取流以发送 Bearer header。游标超过已知 seq 返回 400；游标已过保留窗口返回 410 `EVENT_CURSOR_EXPIRED`，客户端改用 GET run 获取快照，不能再次提交运行来“重连”。终态重放完毕后关闭连接。已有标准可参考 [SSE](https://html.spec.whatwg.org/multipage/server-sent-events.html)。

### 幂等、撤销与额度

- 创建 Agent/release/session/run/preview/key/credential binding，以及刷新 binding，要求 `Idempotency-Key`，作用域为身份 + route + key，保存 24 小时。相同 key/相同请求返回首次结果，不重复执行；body 不同返回 409 `IDEMPOTENCY_CONFLICT`。每次重放先重新鉴权，撤销的身份不能借幂等缓存绕过检查。匿名创建会话没有已有身份，此时使用 `agentId + 随机幂等键` 定位重放，要求客户端生成至少 128-bit 随机熵的键并将其当临时秘密保管，日志也必须屏蔽；不能使用时间戳、序号或 IP 充当身份。
- 对首次返回秘密的请求，幂等响应在服务端加密存储并按期删除；正常 GET 只返回秘密前缀和元数据。不能用仅存 hash 的说法掩盖重复请求拿不到 token 的问题。
- 版本/草稿更新使用强 ETag + If-Match；缺失返回 428，revision 不匹配返回 412。每个资源独立 revision，activation 使用其独立 ETag。
- 对 public 创建会话做 IP/Agent/owner 多维速率限制，平台配置全局上限；IP 只能取可信 ingress 提供的地址。数据库事务预留每次运行最大 token 额度，broker 对整次 run 的所有模型调用累计强制约束，结束后结算未使用额度。上游计量缺失时保留或按预留上限结算，不能按零消耗放回预算。现有异步 usage recorder 不能作为计费限额的裁决者。
- 默认建议：会话总 TTL 1 小时、idle 15 分钟、每会话最多 20 次运行、单次 120 秒、单文件 10 MiB、会话输入文件合计 50 MiB。具体上下界由 capabilities 返回；公开模式启用前必须设置每日 token 预算。
- 停用 Agent、撤销 release/key/binding：事务中提高授权 epoch，立即拒绝新运行和 broker 新请求，并关闭受影响会话/取消任务。已经发往外部服务的请求无法保证撤回；返回值明确为 cancelling/closing，不能承诺瞬间消除所有副作用。仅切换激活版本不撤销旧版本会话；从 public 改为 api_key 会撤销原有匿名会话。停用只影响 invoke 会话，owner 可继续对 ready 版本预览；归档 Agent 或撤销版本同时影响预览。

## 8. API 约定与完整路由

规范文件包含所有下表操作的请求/响应、鉴权、枚举与公共 schema。管理接口沿用当前 `/api/sandbox` 命名，公开接口新建 `/api/v1`；路径里的 sandbox 不表示已有安全保证。

新接口统一错误结构：

```json
{"error":{"code":"RELEASE_NOT_READY","message":"版本仍在构建","requestId":"req_...","retryable":false,"details":{"field":"releaseId"}}}
```

`requestId` 与 X-Request-Id 一致。列表使用不透明 cursor 和 limit（1–100，默认 20），返回 `{items,nextCursor}`。跨 owner/session 的资源统一 404，避免 ID 探测；缺少或无效认证 401；已验证身份但策略拒绝 403；资源冲突 409；过期 410；超限 429 + Retry-After。422 表示输入结构或发布校验失败，503 表示暂不可用。事件流建立后出错用终态事件表达，不在 SSE 中拼接普通 HTTP 错误体。

### 管理 API：OwnerIdentity

| 方法 | 路径（前缀 `/api/sandbox`） | 语义 |
| --- | --- | --- |
| GET | `/publishing/capabilities` | 可用 harness/runtimeProfile、已验证隔离能力、资源策略、平台上限 |
| GET | `/publishing/model-sources` | 发布专用模型来源列表，仅 profileId、label、defaultModel、authConfigured；没有 auth_token |
| GET / POST | `/publishing/credential-bindings` | 列出/建立发布专用模型或 MCP 凭证绑定；引用已有资源，由服务端导入 vault |
| GET | `/publishing/credential-bindings/{bindingId}` | 查询绑定状态及授权元数据，不返回秘密 |
| POST | `/publishing/credential-bindings/{bindingId}/refresh` | 从原来源刷新同权限秘密；模型、端点或资源范围改变则拒绝，要求新绑定/版本 |
| DELETE | `/publishing/credential-bindings/{bindingId}` | 撤销绑定并取消依赖它的运行 |
| GET / POST | `/published-agents` | 分页列表/新建草稿实体 |
| GET / PATCH / DELETE | `/published-agents/{agentId}` | 详情/改名称描述/归档并停用，异步清理 |
| GET / PUT | `/published-agents/{agentId}/draft` | 读取/完整替换草稿，ETag 防覆盖 |
| GET / POST | `/published-agents/{agentId}/releases` | 版本列表/按指定 draftRevision 异步构建，202 |
| GET | `/published-agents/{agentId}/releases/{releaseId}` | 构建状态、校验项、错误、digest |
| GET | `/published-agents/{agentId}/releases/{releaseId}/manifest` | 授权内容、依赖及目录清单；分页，包含完整清单 digest |
| POST | `/published-agents/{agentId}/releases/{releaseId}/preview-sessions` | 未激活版本的真实隔离预览，返回 SessionGrant |
| POST | `/published-agents/{agentId}/releases/{releaseId}/revoke` | 撤销版本；如果当前激活则同时停用 |
| GET / PUT / DELETE | `/published-agents/{agentId}/activation` | 查看/原子启用或切换版本/停用，PUT 必须确认 manifestDigest |
| GET / POST | `/published-agents/{agentId}/keys` | key 元数据列表/创建 key，秘密只返回一次 |
| DELETE | `/published-agents/{agentId}/keys/{keyId}` | 撤销 key 及其派生会话 |
| GET | `/published-agents/{agentId}/runs` | 运行元数据列表，支持 status/releaseId；V1 不给 owner 默认读取调用者全文 |
| GET | `/published-agents/{agentId}/usage` | 时间范围调用/token/失败/排队统计，UTC 日预算 |
| GET | `/published-agents/{agentId}/audit` | 发布、激活、密钥、撤销、额度等安全元数据 |

原有 `resource/skills`、`resource/mcp`、`resource/memory` 列表和文件树继续用于 owner 选择；模型来源使用新的安全投影，模型 ID 可复用现有已鉴权的 profile models 接口。现有 profiles 列表和详情都会返回秘密，发布页面不请求这些原始响应。不另建另一套原生资源编辑 API。导入选项取 `resourceId + sourceId`；`resourceCwd` 只存在于 owner 草稿。敏感字段不会通过公开 descriptor 或 manifest 对外暴露。

### 公开 API

| 方法 | 路径（前缀 `/api/v1`） | 鉴权与行为 |
| --- | --- | --- |
| GET | `/agents/{agentId}` | public 匿名可读；api_key 模式需要该 Agent key；未授权不公开存在性 |
| POST | `/agents/{agentId}/sessions` | key 或 public 匿名，201 返回 session + SessionToken |
| GET / DELETE | `/sessions/{sessionId}` | SessionToken；状态/关闭会话并取消运行 |
| GET | `/sessions/{sessionId}/messages` | 该会话已提交消息，分页 |
| POST | `/sessions/{sessionId}/runs` | SessionToken + 幂等键，202 返回 run；不接受执行配置 |
| GET | `/runs/{runId}` | SessionToken；状态、累计 output、lastEventSeq、usage、interaction |
| GET | `/runs/{runId}/events` | SessionToken；SSE 重放及实时流 |
| POST | `/runs/{runId}/cancel` | SessionToken；幂等取消 |
| POST | `/runs/{runId}/interactions/{interactionId}/responses` | SessionToken；按问题 schema 回答，重复相同回答幂等 |
| POST | `/sessions/{sessionId}/files` | SessionToken；multipart 上传输入文件，201 返回 fileId |
| GET / DELETE | `/files/{fileId}` | SessionToken；文件元数据/删除未被非终态 run 占用的输入文件 |
| GET | `/runs/{runId}/artifacts` | SessionToken；本 run 的公开产物列表 |
| GET | `/artifacts/{artifactId}/content` | SessionToken；流式下载，不返回宿主路径或永久存储 URL |

上传文件使用服务端生成文件名，路径由系统固定；filename 只用于展示。V1 不自动解压压缩包，不按客户端路径写文件。产物必须从本会话允许的输出区域安全打开，验证 regular file、归属和大小后复制进对象存储，拒绝 symlink/path traversal；Content-Disposition 使用安全编码，默认 attachment，不能把上传 HTML 当本站页面执行。

公开接口不提供任意路径 read/write/list、终端、resource CRUD、设置覆盖、provider resume/fork、私人会话查询。HTTP 分享本身不要求兼容 OpenAI `/chat/completions`；V1 只保留这一套调用语义，避免两套权限与状态实现。

### 内部 API：仅 mTLS 服务身份

| 方法 | 路径（前缀 `/internal/v1`） | 调用方与约束 |
| --- | --- | --- |
| POST | `/source-exports` | 控制面 -> 绑定 owner 的私人 Runner；校验签名 exportGrant（owner/audience、release、draft digest、有效期），冻结选择，返回 export job，幂等 |
| GET | `/source-exports/{exportId}` | 查询固定导出状态，校验 release 与 owner |
| GET | `/source-exports/{exportId}/content` | 下载无秘密的固定导出包；流式返回，校验 digest |
| POST | `/worker-sessions/{sessionId}/next-run` | 该会话专属 supervisor 获取下一次执行；最多等待 25 秒，无工作返回 204；重复领取返回相同 assignment |
| POST | `/executions/{executionId}/heartbeat` | supervisor -> 控制面；租约、最后确认 seq，返回 continue/cancel 与租约截止 |
| POST | `/executions/{executionId}/events` | supervisor -> 控制面；有界事件批次，按 fencing token 和连续 seq 幂等追加 |
| POST | `/executions/{executionId}/complete` | supervisor -> 控制面；追加终态快照并结算额度，CAS 防止双终态 |

Pod 启动配置只发放绑定该 session/supervisor generation 的身份。supervisor 通过 next-run 领取固定 release、输入文件对象引用、租约、短期 broker token 和签名策略，验证后经私有 pipe 向沙箱内 provider 提交 turn；重复 assignment 不重复执行。heartbeat 下发取消意图和按 seq 去重的 interaction 回答；执行完成后继续领取该会话下一轮，保持相同沙箱内的上下文。

对象下载/上传走窄权限存储适配器，不能接受客户端自选 URL，不暴露通用 shell/文件 RPC。内部操作也不能信任沙箱内声称的 usage：额度裁决取 broker 计量，Worker usage 仅用于输出统计。模型代理使用所选 provider 的兼容请求格式，MCP broker 使用其支持的 MCP transport；它们是协议代理，不在业务 API 中再创造一套模型/MCP 协议。

### HTTP 调用示例

```bash
# key 模式；public 模式省略此请求中的 Authorization。
curl -X POST 'https://agents.example.com/api/v1/agents/agt_example/sessions' \
  -H 'Authorization: Bearer <agent-api-key>' \
  -H 'Idempotency-Key: <fresh-random-value-at-least-128-bits>' \
  -H 'Content-Type: application/json' -d '{}'
# 201: {"session": {"id":"ses_example", ...}, "token":"...", "tokenExpiresAt":"..."}

curl -X POST 'https://agents.example.com/api/v1/sessions/ses_example/runs' \
  -H 'Authorization: Bearer <session-token>' \
  -H 'Idempotency-Key: run-request-001' \
  -H 'Content-Type: application/json' \
  -d '{"input":{"text":"根据授权资料解释这个项目","fileIds":[]}}'
# 202: {"id":"run_example", "status":"queued", ...}

curl -N 'https://agents.example.com/api/v1/runs/run_example/events' \
  -H 'Authorization: Bearer <session-token>' -H 'Last-Event-ID: 0'

curl 'https://agents.example.com/api/v1/runs/run_example' \
  -H 'Authorization: Bearer <session-token>'
```

## 9. 前端交互设计

遵循 [前端设计规范](../front-end-desgin.md)。以下是等待确认的布局，尚未实现。新增侧栏“已发布 Agent”，独立于私人 Subagent 资源。桌面复用资源页的约 1:2 列表/详情结构；窄屏进入详情后列表收起，提供返回入口。

```text
+----------------+-----------------------+---------------------------------------+
| Sidebar        | 已发布 Agent   [+新建] | 项目助手                 [预览][发布] |
|                | [搜索_____________]  | 草稿已修改 / 当前版本 v3              |
| New chat       |                       | [配置] [版本] [API] [用量]            |
| ...            | 项目助手    已启用    |---------------------------------------|
| 已发布 Agent * | 文档问答    未启用    | 名称 / 描述                           |
| Skills         |                       | Harness / 模型绑定                    |
| MCP            |                       | 指令与授权上下文                      |
| Files          |                       | 文件快照  来源 -> 沙箱路径  [选择]    |
| Usage          |                       | Skills / MCP 工具与资源范围           |
|                |                       | Shell 开关 / 运行限额                 |
+----------------+-----------------------+---------------------------------------+

Mobile: Agent list -> Configuration -> Release review -> API details
                     [Back]             [Back]
```

“发布”分成构建与启用两个明确动作。构建完成后展示本次最终授权清单、目录映射、文件数量/体积、Skill 名单、MCP 工具/账户范围、shell 和网络能力。清单加载失败不能启用，构建后草稿改变需显示“此版本来自草稿 revision N”。

```text
+----------------------- 发布版本 v4 -------------------------+
| 构建: ready       内容摘要: sha256:...                       |
| 授权资料  /repo/docs -> /data/docs   42 files / 3.2 MiB       |
| Skills    explain-project                                  |
| MCP       docs.search: 仅 knowledge-base-17                 |
| 命令      开启；可写 /workspace；网络仅模型/MCP 代理          |
| 上下文    选中内容可被调用者通过回答获得                    |
|                                                            |
| [查看完整清单]       [在隔离环境预览]       [启用此版本]     |
+------------------------------------------------------------+
```

预览创建 purpose=preview 的真实共享会话，使用相同 bundle、mount、网络和 broker；唯一差异是只有 owner 能创建，且无需 active release。不能直接调用现有私人 Subagent SSE 测试作为安全预览。预览成功仅说明这一轮可用，不替代隔离验证。

API 页展示访问模式、当前版本、复制调用示例、API key 创建/撤销和停用操作。key 明文只在创建时显示；不要用 localStorage 持久保存它。停用和撤销显示实际 cancelling/closed 进度。用量页默认展示运行时间、状态、token 和错误，不默认展示调用者的完整问题和回答。

```text
Owner app
  AppView += published-agents
  +-- PublishedAgentPage
      +-- AgentList / DraftEditor
      +-- SnapshotPicker / SkillPicker / McpScopePicker
      +-- ReleaseManifest / PreviewPanel
      +-- ApiAccessPanel / UsagePanel
      +-- publishing-api.ts / hooks

Public entry: /a/{agentId}
  +-- PublicAgentApp (independent providers)
      +-- PublicAgentHeader / AccessKeyForm
      +-- PublicConversation / Input / Upload / ArtifactDownload
      +-- invocation-api.ts / session state / SSE reducer
```

公开页复用纯消息展示组件；不挂载私人 ChatSession/Harness/Workspace Provider，不展示终端、全盘文件树、模型配置、资源编辑或私人历史。现有 agent-message-page 与这些私人状态紧耦合，不能整页挪用。SSE 客户端可从现有解析器提取基础能力，但需补齐 id/event、断线游标、UTF-8 边界、终态和去重处理。

状态必须覆盖：草稿未保存、构建排队/失败/成功、无可用 sandbox、凭证失效、源 Runner 离线、MCP 无法限制资源范围、公开预算耗尽、上传超限、预览过期、SSE 断线与游标过期。使用现有组件、主题与 reduced-motion 规范，不引入新的组件库或全局状态框架。

## 10. 代码落点与实现顺序

以下为拟新增模块，不要求为了目录形式拆成额外 npm package；进程与权限边界必须真实存在。

```text
services/agent-runner/ts/src/
  main.ts                             existing private Runner
  publishing-main.ts                  separate control/public service startup
  shared-worker-main.ts               starts INSIDE bubblewrap
  core/contract/
    publishing.ts                     entities, policies, execution contract
    publishing-store.ts               transactional state/events/leases
    published-bundle-store.ts         immutable bytes and artifacts
  harness/publishing/
    publishing-service.ts             draft/build/activation/authorization
    invocation-service.ts             session/run/cancel/idempotency
    public-event-projector.ts          provider event -> public event
  infrastructure/publishing/
    source-exporter.ts                safe owner-side snapshot export
    postgres-publishing-store.ts
    object-bundle-store.ts
    worker-coordinator.ts             Kubernetes scheduling and supervision
    sandbox-launcher.ts               verified bwrap profile, no fallback
    credential-broker.ts              model/MCP policy enforcement
  transport/http/route/
    published-agents.ts               owner APIs only
    invocations.ts                    public APIs only
    publishing-internal.ts            service identity only

agent-ui/src/features/published-agents/
  ...                                 owner UI and API client
agent-ui/src/features/public-agent/
  ...                                 standalone public entry and client

services/agent-runner/ts/tests/publishing/
agent-ui/tests/published-agents/
```

实施按可验收层推进：

1. **身份与隔离执行底座**：验证 owner 接入、部署身份、Linux/K8s runtimeProfile；实现整进程隔离和拒绝越界探针。CLI/测试可执行固定发布包，尚不开放公网。
2. **端到端发布与 key 调用**：草稿、快照、release、预览、激活、key、session/run/SSE/cancel、模型 broker；首个支持的 provider 完整通过隔离测试后，再开放第二个。UI 明确展示实际支持矩阵，不能假装两个 provider 已等价。
3. **Skills/MCP 与文件交互**：只增加经过验证的 runtimeProfile 和可执行资源策略；文件上传与产物闭环。不能为了赶进度先在主 Runner 执行 MCP。
4. **匿名公开与运营**：限流、额度预留、撤销闭环、审计、保留策略与滥用控制完成后启用 public。前面各层已有可用产品，但“公开分享”验收必须覆盖这一层。

本文 API 描述最终 V1 合同；每层通过 capabilities 显式声明尚未支持的功能，未支持时返回 `FEATURE_UNAVAILABLE`，不静默忽略字段。

## 11. 验收与保留策略

必须验证的安全与行为断言：

| 测试 | 必须结果 |
| --- | --- |
| Bash、Read、Pi 扩展、产品工具、stdio MCP 读取发布者凭证/私人目录 | 均不可见或拒绝，不能只有 Bash 被限制 |
| `../`、symlink/hardlink、路径替换竞态、归档逃逸、产物符号链接 | 导出/导入/下载阶段拒绝，不能越过授权根 |
| 读取宿主 `/proc/*/environ`、继承 fd、控制 socket、K8s token | 不获得宿主秘密或控制能力 |
| 网络访问私人 Runner、云 metadata、K8s API、任意公网 | 拒绝；批准模型与限定 MCP 可用 |
| A/B 两个调用者使用同一个 API key | 会话、工作目录、事件、文件与产物互不可见 |
| 修改 cwd/model/MCP/native sessionId，或跨 session fileId | 422/404，不能影响实际执行配置 |
| 发布目录更新、切换 active release | 已有会话不变化；新会话按新的已确认版本创建 |
| key/release/binding 撤销与排队/运行/重连竞态 | 不再启动运行；broker 停止授权；取消进度可观察 |
| SDK 初始化失败、嵌套 userns/proc/seccomp 不兼容 | 失败关闭；无 privileged 或宿主执行降级 |
| HTTP 断线、SSE 重连、API 重试、Worker 重复上报 | 不重复运行；按 seq 重放；单一终态 |
| OOM/超时/进程爆炸/磁盘超限/无限工具调用 | 限额生效；整个会话边界可回收，无遗留任务 |
| 远程 MCP 修改参数、翻页、访问其他资源 | broker 或上游资源授权拒绝，不依赖提示词 |

推荐独立保留策略：输入文件与原生 Worker 状态随会话关闭清理；已完成消息、输出、产物和 SSE 保存至 session 创建后 24 小时，token 的数据读取期限同为此上限，但执行权限在 session TTL 到期时结束。主动删除、父凭证撤销或 Agent 撤权提前失效；过期删除按异步任务清理，有明确最大清理延迟。SessionGrant 分别给出 `executionExpiresAt` 与 `dataExpiresAt`，避免把“可继续执行”和“仍可下载结果”混为一个 TTL。

会话创建时发放 token 的有效期是 dataExpiresAt 与父 key 到期时间的较早值。系统还单独检查 session 执行期限、父 key/版本的撤销 epoch；token 尚未过期不代表还能启动运行。运行元数据和不含内容的安全审计建议保留 30 天，预算日桶按 UTC；发布包在仍被版本引用期间保留，归档并失去引用后清理。owner 默认看不到调用者正文；将来若需要正文留存，应作为显式披露的产品权限重新设计。

实现时运行现有后端 lint/typecheck/test/build，macOS 测试使用 `TMPDIR=/tmp npm test`；前端遵循规范中 lint/build 与独立测试命令。隔离安全测试必须在目标 Linux/K8s runtimeProfile 上运行，macOS 静态检查和 OpenAPI 校验不能证明 bwrap 可用。本次只产出设计及契约，未实现或验证这些运行时保证。

本次文档验证结果：39 个路径、51 个操作通过官方 OpenAPI 3.1 文档 schema 校验；103 个数据 schema 可编译，255 处内部引用可解析；operationId、路径参数和分层鉴权声明检查通过。24 个输入/事件正反例覆盖正常请求、额外配置字段拒绝、manifest 确认字段、事件类型和终态约束；本地文档链接与空白检查通过。未运行前后端业务测试或 Linux/K8s 隔离测试。
