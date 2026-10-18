# Harness 流协议 v3 设计草案

> 2026-10-17 范围更正：该协议只供平台外部客户端使用，当前 Chat UI 不消费它。
> 可复用现有运行驱动和事件来源；下文旧方案中的 Chat WS 直接订阅 v3、共用 reducer、
> Chat UI 协议迁移及删除 v2 的步骤不再适用。最新调用约定见
> [HTTP API 参考](../api/harness-http-api-reference.md)。其 `returnImmediately=true` 路径将提交与可选的消费连接分开。

状态：设计草案，未实施、未替换当前 v2。A2A 与项目现状核对日期：2026-10-17。

后续请求与返回参考见 [Harness HTTP API 参考草案](../api/harness-http-api-reference.md)。
该参考包含文本追加和嵌套数组增量修订；本文保留其之前的完整组件替换方案作为设计对照。

目标：保留所接入运行时接口的原始输出，同时让 Web 和程序消费方按少量统一字段
连续渲染。当前核对范围是 Codex、Claude Code / Agent SDK、Pi SDK / RPC。

已确认的要求：允许将各 harness 字段归一化到共享 schema，但不能省略输出内容；
Claude 继续使用当前 tmux/TUI。当前 Chat / TUI 使用体验已经可用，本轮设计重点是
让非 UI 的 HTTP / WS 调用也能获得完整输出，不要求用户打开浏览器来维持采集。
不要求 JSON 的原始空白、键顺序一致；终端通道仍用字节记录承载其特有输出。
新增确认：对外接口兼容 A2A 1.0，没有指定必须对接的客户端。首个标准 binding
采用 HTTP+JSON / SSE，规范固定到 A2A 发布版 v1.0.1，线上版本号使用 `1.0`。
本轮确认：HTTP 复用 Chat UI 同一条会话事件流，子 agent 与后台任务直接实时推送；
补齐完整共享 schema、思考计时、工具执行、最终回复及断线重连示例。

## 1. 推荐结论

采用「Chat 与 HTTP 共用一条会话事件流 + A2A 标准投影」。
完整 HTTP SSE 与 Chat WS 直接订阅同一个 SessionStream；A2A 标准接口消费其同源投影。
A2A 负责发现、提交、查询、取消、消息和产物；扩展负责完整来源记录、会话回放和
顺序渲染。内部及扩展使用的 v3 帧不是 A2A 标准 SSE 的顶层响应。

完整输出采用「统一输出数组 + 完整来源记录」：每个数据帧保留一条完整来源记录，并附带
零到多个有序数组的局部替换。每个替换携带受影响输出项当前的完整状态，消费方
只执行数组操作，不建立 provider 专用的消息 / block / 工具关联表。

共享的 output 是面向调用方的主要契约。native 保存来源对象，用于承接无法归一化
的额外字段和新事件；普通组件无需解析它。保留完整 native 是本草案为实现“不丢
内容”选择的方案，不表示用户要求重复保留两套字段或要求字节级 JSON 回放。

```text
Claude / Pi / Codex source events
                |
      immutable capture + durable journal
                |
        shared SessionStream v3
         /          |           \
     Chat WS    full HTTP SSE    A2A projection
         \          /           |
          same reducer          standard Task / Artifact SSE
                |
      items + children -> UI / code
```

保留原始事件不依赖映射器理解该事件。新增或未知事件允许没有专用组件，但必须
仍能读取、导出并按原序回放；通用事件查看器可显示 native。组件投影可以重新生成，
原始记录保持不变。不能把“API 返回完整内容”和“每条记录都显示为聊天气泡”混同。

A2A 基础客户端可以流式读取任务结果；要获得本需求定义的全部来源事件，必须使用
已声明并激活的扩展。不能把标准 Task.history 当作完整日志，也不能把私有帧加上
一个 A2A 标签就声称兼容。UHP 可借鉴运行结果查询、能力声明和一致性测试；外部
互操作契约以 A2A 为准，不再要求客户端同时实现另一套运行标准。

## 2. 原生接口对比

原始接口研究基线：2026-09-27 的本机 Codex CLI `0.158.0-alpha.2.1`，其 App Server
类型由本机 `generate-ts` 导出核对；没有启动模型调用。2026-10-17 项目声明的
Claude Agent SDK 为 `^0.3.301`，Pi coding-agent / ai 为 `1.2.0`。
当前 Pi Chat / Terminal 已共享原生 Host，程序化 run/launch 仍使用 SDK，见
[Pi 共享会话](../../../architecture/pi-native-session.md)。不再把 Pi 描述成只有 HTTP 输出。
官方 main 文档可能领先于实际版本；旧 Codex 示例也不代表当前安装版本，适配器
必须记录实际来源、版本和驱动。

| 接入面 | 公开输出形状 | 对本设计的启发 / 限制 |
| --- | --- | --- |
| Codex App Server | JSON-RPC 风格的 notification、server request、response；`item/started`、`item/agentMessage/delta`、`item/completed` 等 | item 的生命周期和最终权威状态很清晰；消费者仍需关联 thread / turn / item。审批是 server request，不能只记录 notifications。 |
| Codex `exec --json` / TypeScript SDK | JSONL / SDK 事件；`thread.started`、`turn.*`、`item.*` | 属于另一种接入面，不能把它和 App Server 的字段、事件覆盖范围混为一谈。 |
| Claude Agent SDK / CLI stream-json | `system`、`assistant`、`user`、`result` 等；启用 partial 后另有 `stream_event.event` | 原始外层字段与内层 API 事件都需要保留；完整 assistant 消息可能只交付一个 block，不能按消息 ID 覆盖整条回答。 |
| 当前 Claude tmux/TUI | hooks、MessageDisplay、原生 transcript JSONL、终端字节 | 是多个有不同语义的观察通道；终端字节适合终端回放，hooks / transcript 适合结构化投影。它们不是 SDK 事件全集。 |
| Pi SDK | `message_update.message` 和 `assistantMessageEvent.partial` 等累计状态，加 message / tool / retry / compaction 事件 | 累计状态对嵌入式 UI 很方便；复制和序列化前必须防止后续对象修改影响已记录内容。 |
| 当前 Pi native Host | tmux 中的原生 AgentSession / InteractiveMode、控制桥、私有事件日志及原生转录 | Chat 与 Terminal 共享会话；当前私有日志是映射后的 AgentEvent，完整捕获必须前移到 mapper 之前。 |
| Pi JSON / RPC | JSONL；message_update 移除累计 message / partial，保留 delta 和 usage；另有 command response / extension UI 协议 | 网络流降低重复数据，但接收方必须组装内容；这项组装应由适配层承担。 |

三项不能忽略的语义：

- Codex 的最终 item 是权威结果；例如 plan 最终文本不保证等于所有 delta 的简单拼接。
- Claude 公开的流式接口并不保证转发子 Agent 的 token 级增量，完整消息与流事件的
  `parent_tool_use_id` 能力也不同。协议不能虚构未收到的输出。
- Pi 的 `agent_end` 只结束一个底层运行；之后可能重试或继续处理队列。
  `agent_settled` 才表示该次会话级处理没有待自动继续的工作。

参考：

- [Codex App Server events](https://developers.openai.com/codex/app-server#events)
- [Codex App Server approvals](https://developers.openai.com/codex/app-server#approvals)
- [Codex non-interactive output](https://developers.openai.com/codex/noninteractive)
- [Claude Agent SDK streaming](https://code.claude.com/docs/en/agent-sdk/streaming-output)
- [Pi JSON events](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)
- [Pi RPC](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)

## 3. 两种顺序，两种完整性

`seq` 是原始记录被捕获后的总顺序，用于事件回放、去重和断点续传。
多个独立通道之间不存在天然全局因果顺序；这里定义的是捕获顺序，不是根据
时间戳猜出的执行顺序。同一来源通道的原始先后顺序必须保留。

`output.edits[].index` 是对当前输出数组应用操作的位置，不是组件身份。
`deleteCount` 表示删除多少项，`items[]` 表示在该位置插入的完整新状态。
语义与 JavaScript 的 `splice` 一致，但不允许越界或负数。组件内部的 `content[]`、
`children[]`、`steps[]` 本身就是显示顺序。

```text
frame seq=40: first text    -> insert(0, [text A])
frame seq=41: another text  -> insert(1, [text B])
frame seq=42: late tool     -> insert(1, [tool])
frame seq=43: B updated     -> replace(2, [updated text B])

native replay: [40, 41, 42, 43]
output items: [text A, tool, updated text B]
```

消费方只需要一个续传游标和顺序执行数组替换，不负责追踪各 provider 的
message ID、block index、tool-call ID 之间的关系。这些关系仍然存在，由后端适配层管理。

使用局部数组替换而不是固定 slot 的原因：当前 Claude 的 MessageDisplay 可先于
transcript 到达，后者可能带来需要插在已显示文本之间的工具或其他内容。固定且
不可重排的 slot 无法表达这种修正；数组替换支持插入、更新、删除和最终纠正。

完整性分为：

- **原始记录完整**：所声明采集通道的每条记录、所有原始字段与原始顺序均保留。
- **显示状态完整**：组件状态是某个游标之前已处理记录的投影。

显示快照不能补回丢失的原始事件。把结构化消息拼成最终文本，也不等于还原原始
事件序列。前者消费 `output`，后者直接读取 `native`。

## 4. 完整共享 schema

完整机器契约见 [JSON Schema](../api/harness-stream-v3.schema.json)，完整可读类型、
字段语义及实例见 [共享会话流契约](../api/harness-stream-v3.md)。这是同一份 SessionStream
返回契约，由 Chat WS 与完整 HTTP SSE 共用；不是独立建立一套 HTTP 采集流。

核心结构：

```text
SharedFrame
  +-- event: v, kind, streamId, seq, ts, context, native, integrity, output
  +-- snapshot: v, kind, streamId, atSeq, ts, sessionId, sources, integrity, items
  +-- reply: v, kind, requestId, command, ok, result/error
  +-- control: v, kind, streamId, code, details

output.edits[] = { index, deleteCount, items: OutputItem[] }
OutputItem = message | thinking | tool | agent | task
           | plan | interaction | notice | usage | run
```

所有产品对象字段受控，任意内容仅放在 native.value、JSON 内容、工具参数、交互
schema/回答、错误或通知 details 等明确位置。每条原始记录捕获后立即复制 / 序列化，
保留完整包装、未知字段、来源版本和原生 ID，再进入 mapper。JSON 保留语义，终端
等字节来源使用 base64；不能静默丢掉非 JSON 值。

一条原始记录对应一条 event；host 自己产生的记录使用 native=null。seq 从 1 连续
递增并持久保存。同一 (streamId,seq) 重放时内容不变；重启不能恢复原日志时切换
streamId 并报告边界。output.status 为 applied / unmapped / failed，后两者不能导致
native 丢失。一次原始记录可以产生多条 edits，按数组顺序原子提交。

integrity 明确标记采集完整性，并在事件和快照中持续保存。未知事件不等于不完整；
真实采集缺口才记录 incomplete 与 issue，不能只发一条断线时可能错过的 control。

## 5. 组件、子 agent 与后台任务

每个组件都包含稳定 id、kind、runId；id 是全树唯一的产品组件 / 执行身份。
逻辑 runId 与 A2A Task.id 对应，provider ID 原样留在 native。runId=null 表示会话级
独立工作，绝不把后台任务 id 自动当作 A2A Task.id。

| kind | 必要语义 |
| --- | --- |
| message | role、phase、status、content[]；phase=final 明确最终答复，可先 streaming 再 complete。 |
| thinking | status、summary、timing；摘要只用来源公开内容，未知为 null。 |
| tool | name、status、input、output[]、children[]、timing、error；保留结构化参数与结果。 |
| agent | name、originRunId、completionPolicy、status、children[]、timing、error。 |
| task | title、taskKind、originRunId、completionPolicy、status、control、children[]、timing、error。 |
| plan | 有序 steps[]，每步有自己的 id、text、status。 |
| interaction | requestId、requestKind、status、prompt、inputSchema、choices[]、response。 |
| notice | severity、code、text、details。 |
| usage | scope、mode、model、values；未知值为 null，累计值不重复相加。 |
| run | status、model、timing、error；消息完成与运行结束分开。 |

```text
session items[]
  +-- run (A2A Task)
  +-- thinking -> tool -> message(final)
  +-- agent (joined, same runId)
  |     +-- children: thinking / tool / message / nested agent
  +-- task (detached, runId=null, originRunId=creator)
        +-- children: tool / progress messages / results
```

joined 工作阻止父 run 成功结束；detached 工作不阻止。后台事件和结果与主回复使用
同一个连续 seq；前台 run 完成后仍推送。已有 TerminalChatSessions 的会话级 observer
覆盖主/子转录及后台 telemetry，HTTP 复用它，不需要浏览器维持观察。

客户端不按 parentId / provider tool ID 拼树：children 本身有序，子项改变时替换
最外层受影响容器的完整状态。同一工作不重复渲染成两份 agent/task；全树 id 唯一，
数组位置不是身份。完整父树更新的带宽取舍仍按第 8 节处理。

工具输入尚不完整时保留 text，value=null；complete 时提供实际 JSON 值（也可能为
null）。文本、公开思考摘要、工具与子 agent 按出现顺序展示；原生最终权威值可纠正
先前流式内容。图片、文件等引用必须能取回原始内容，不能用链接掩盖截断。

思考计时使用 startedAt、endedAt、durationMs、basis。basis 区分 native_reported、
host_observed、unknown；无明确阶段边界时 durationMs=null。不能把首 token 等待或
“总时间减工具时间”假装为思考时长。多个片段分别计时，并行子工作不能直接求和。

## 6. 完整事件实例与消费方式

[基础输出实例](../api/examples/harness-stream-v3/basic-session.sse) 单独展示思考开始 /
计时结束、工具开始 / 结果、流式最终回复及 run 结束，共 8 条事件。

[完整 SSE](../api/examples/harness-stream-v3/session.sse) 与
[同帧 JSONL](../api/examples/harness-stream-v3/session.jsonl) 包含思考开始/结束、
工具开始/结果、嵌套子 agent、后台任务、流式最终回复和 run 完成后的后台结果。
均为明确标识的合成 fixture，不是真实模型调用。下面是其中 seq=5 的完整工具完成帧：

```json
{
  "v": 3,
  "kind": "event",
  "streamId": "stream-1",
  "seq": 5,
  "ts": 1792202401500,
  "context": {
    "sessionId": "session-1",
    "runId": "run-1"
  },
  "native": {
    "source": {
      "harness": "pi",
      "interface": "example.synthetic",
      "version": "fixture-1",
      "instanceId": "example-process",
      "channel": "fixture"
    },
    "format": "json",
    "value": {
      "type": "tool_end",
      "toolCallId": "native-tool-1",
      "result": [
        {
          "kind": "text",
          "text": "# Example project\nSource: src/\nDocs: docs/"
        },
        {
          "kind": "json",
          "value": {
            "path": "README.md",
            "encoding": "utf-8"
          }
        }
      ],
      "extra": {
        "preserved": true
      }
    }
  },
  "integrity": {
    "status": "complete",
    "issues": []
  },
  "output": {
    "status": "applied",
    "edits": [
      {
        "index": 2,
        "deleteCount": 1,
        "items": [
          {
            "id": "tool-1",
            "kind": "tool",
            "runId": "run-1",
            "name": "read_file",
            "status": "complete",
            "input": {
              "status": "complete",
              "text": "{\"path\":\"README.md\"}",
              "value": {
                "path": "README.md"
              }
            },
            "output": [
              {
                "kind": "text",
                "text": "# Example project\nSource: src/\nDocs: docs/"
              },
              {
                "kind": "json",
                "value": {
                  "path": "README.md",
                  "encoding": "utf-8"
                }
              }
            ],
            "children": [],
            "timing": {
              "startedAt": 1792202401200,
              "endedAt": 1792202401500,
              "durationMs": 300,
              "basis": "host_observed"
            },
            "error": null
          }
        ]
      }
    ]
  }
}
```

示例中的 thinking 阶段为 1200 ms，read_file 工具为 300 ms。精确归一化计时在对应
组件中；来源给出的字段仍完整保留在 native 中。不会要求调用方从文字猜测耗时。

```ts
// 示意：schema / 越界 / 全树 id 校验由共享 reducer 完成。
for await (const frame of sessionFrames) {
  if (frame.kind === 'snapshot') {
    state.restoreDisplay(frame) // 不推进原始导出游标
    continue
  }
  if (frame.kind !== 'event') continue
  if (frame.seq <= state.lastAppliedSeq) continue
  if (frame.seq !== state.lastAppliedSeq + 1) throw new Error('需要补齐事件缺口')

  const next = structuredClone(state.items)
  for (const edit of frame.output.edits) {
    assertValidEdit(next, edit)
    next.splice(edit.index, edit.deleteCount, ...edit.items)
  }
  assertUniqueItemIds(next)
  // 事务内幂等保存 native、显示状态、integrity 与游标；成功后才对外确认。
  await store.commitFrame(frame, next)
  state.commit(frame, next)
  render(next)
}
```

页面只按 items / children / content 顺序渲染。原始事件导出直接按 seq 读取 native，
不从气泡逆向恢复。重复投递、原子提交、显示与导出游标的区别见完整契约第 6 节。

## 7. 完整输出扩展与 A2A 传输

本节先定义完整输出扩展的帧，再定义标准 A2A 接口。两者共享数据来源，但线上
响应类型不同。A2A 的任务流不得直接发送以下私有 event / snapshot / reply / control。

```text
event       { streamId, seq, native, output } -> 有序日志记录
snapshot    { streamId, atSeq, items[], integrity, sources } -> 到 atSeq 的显示基线与采集状态
reply       { requestId, ok, result/error } -> 单个命令的处理结果
control     { streamId, code, details }    -> 缺口、采集中断等连接 / 完整性状态
```

snapshot、reply、control 使用独立 kind 的严格联合，不冒充新的原始事件。
reply 供内部 WS 命令使用；标准 A2A HTTP 命令仍返回各操作规定的响应。
它们也有协议版本，但不领取日志 seq。control 的 code 使用受控联合，并由 code
确定 details schema；例如 replay.unavailable、stream.incomplete、stream.closed。
snapshot 的 items 是紧凑的完整有序数组，不能擅自筛选或重排。
快照要在 atSeq 处原子生成，接收后只应用该 stream 中晚于 atSeq 的组件更新。
如果程序还需要全部原始记录，仍按自己的原始游标补齐日志，不能把 atSeq 当成已收到
所有 native。共享客户端负责连接级游标，页面组件无需维护它。

命令接受不代表执行完成；审批请求、自动重试、压缩、后台任务必须独立建模。
从原生 run / turn / result / settled 事件推导产品 run 状态的规则应按入口版本测试。
组件完成、前台 run 完成、后台任务完成、会话断开是不同状态。

完整输出扩展的 WS 一条 text message 发送一条协议帧，扩展 SSE 使用相同 JSON；event 的 SSE id
可以编码 streamId 和 seq，但重放必须由实际日志查询实现，增加 id 字段本身不产生
重连保证。SSE 命令通过独立 HTTP 请求提交；订阅连接不能承担双向交互。

```text
same EventFrame -> WS text message
               -> SSE id: <streamId>:<seq> / data: <JSON>

WS commands    -> reply(requestId)
A2A HTTP       -> standard operation response
```

### 7.1 HTTP 与现有 Chat 共用运行服务

HTTP / WS 是传输选择，tmux / SDK / App Server 是运行驱动选择。二者解耦。
按已确认要求，本方案的 Claude HTTP 调用复用 tmux 驱动与其会话租约、输入队列和
交互处理，从同一来源生成共享帧。

当前 `/ws/session` 的 `run-route.ts` 调用 openTerminal / submitTerminal；
`TerminalChatSessions` 已有共享会话编排与独立轮询，HTTP 应复用它并补齐持久捕获，
无需另建一套执行服务。Pi Chat / Terminal 也已共享原生 Host。
程序化 `AgentHarness.run/launch` 仍存在 SDK 路径，不能通过同名 run 接口就假定
它与 Chat 使用同一驱动。适配器保留驱动身份，并遵守现有会话写入租约。

```text
Chat WS ----+
            +--> shared session commands --> Claude tmux / Pi runtime / Codex
HTTP / A2A -+               |                              |
                            |                       persistent capture
                            |                              |
                            +------------------ durable ordered journal
                                                   /          \
                                            A2A projection   full SSE / WS

Claude tmux -- terminal bytes --> existing terminal WS --> current TUI
```

任务创建、日志起始游标及持久采集必须在注入 prompt 前准备好。客户端收到 Task
后再连接日志流不会漏掉中间事件，因为它从已提交日志读取。新 session 可先分配
宿主身份，原生身份到达后再关联。

没有浏览器连接时也要采集；关闭订阅连接只取消订阅，不隐式取消 run。会话采集的
生命周期跟随运行时，由共享服务持有，不能跟随某个 WebSocket viewer 的开关。
采集订阅也不能被误计成 UI 查看者，从而破坏当前 tmux 空闲回收行为。

完整订阅发送会话内连续 seq，调用方通过 context.runId 区分运行。初版不提供会制造
seq 缺口的服务端 runId 过滤；客户端可以在共享 reducer 处理完整序列之后筛选显示。
订阅必须明确起始游标，并以该位置的 snapshot 为显示基线；如果要求原始历史，
则从可用日志起点重放。HTTP 和 WS 使用同一日志范围时，原始记录及最终 output
必须一致。

run 完成不会代表会话或后台任务结束。持续会话订阅仍发送晚到的转录、usage 和后台
事件；调用方可以在达到自己的结束条件后断开。历史不可用应报告明确范围，不能
自动用 snapshot 冒充完整回放。

这里的“对外”指有权访问该会话的 API 调用者。扩展激活不授予额外数据权限；
本草案不改变 [Agent 发布设计](../../../architecture/published-agents.md) 对私人运行与发布实例的区分。

### 7.2 标准 A2A 1.0 对象、操作与流

规范版本固定为 [v1.0.1](https://github.com/a2aproject/A2A/releases/tag/v1.0.1)，
字段以该版 [a2a.proto](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto)
为准。HTTP 使用 `A2A-Version: 1.0`，JSON 媒体类型优先 `application/a2a+json`，
流响应为 `text/event-stream`。WS 仍是本产品传输，不宣称为 A2A 标准 binding。

除 origin 根目录下的 well-known 发现路径外，下列操作路径相对 AgentCard 中的
接口根地址，均为拟实现接口：

| 操作 | HTTP | 本产品语义 |
| --- | --- | --- |
| 发现 Agent | `GET /.well-known/agent-card.json` | 声明 HTTP+JSON、协议版本、流能力及扩展。 |
| SendMessage | `POST /message:send` | 新建或继续任务；返回 `{task: Task}`。本产品的执行请求统一使用 Task。 |
| SendStreamingMessage | `POST /message:stream` | 首帧 Task，随后标准状态 / 产物更新。 |
| GetTask | `GET /tasks/{id}` | 返回 Task 本体，包含状态与可用产物；不是原始日志查询。 |
| ListTasks | `GET /tasks` | 实现授权范围过滤、标准查询参数与游标分页。 |
| CancelTask | `POST /tasks/{id}:cancel` | 显式请求取消，返回标准 Task；拒绝取消时返回规定错误。 |
| SubscribeToTask | `GET` / `POST /tasks/{id}:subscribe` | 订阅未终结任务，首帧为当前 Task；双动词原因见 7.5。 |

`SendMessage.configuration.returnImmediately=true` 请求尽快返回当前 Task；默认
false 等到终态或中断态。连接结束与任务取消分开。Push 与 extended card 初版不启用，
按实际能力声明并对相关调用返回标准不支持错误。标准接口错误使用 A2A HTTP
binding 的错误格式；执行失败进入 Task 状态，保留已生成产物，不套用私有 reply。

对象对应关系：

| 本产品概念 | A2A 表达 | 约束 |
| --- | --- | --- |
| session | `contextId` | 同一上下文可包含多个 Task。 |
| 逻辑 run | `Task.id` | 使用同一产品 ID；审批后继续、内部重试不重新建 Task。单次 provider attempt 的原生 ID 保留在 native 中，由服务端关联。 |
| 输入、提问、回复 | `Message` | `messageId` 稳定；role 使用 `ROLE_USER` / `ROLE_AGENT`。 |
| 持久结果 | `Artifact` | 以 `artifactId` 关联；正文、文件、结构化结果放有序 `parts[]`。 |
| 工具、计划、子 Agent、来源事件 | 完整输出扩展 | 不强行定义为 A2A 新角色或新任务状态。 |

Part 使用 `{"text":"..."}`、`{"data":{...}}`、`{"raw":"base64","mediaType":"..."}`
或 `{"url":"...","mediaType":"..."}`，四种内容互斥；data 可以是数组或其它 JSON 值。
标准 Part 不带私有 `kind`，也不使用旧版 file 包装。结果不能只藏在 metadata：
通用客户端仍须拿到可读的标准 Artifact。结构化工具细节由扩展保留。

流使用 `StreamResponse`，每帧只选择 `task / message / statusUpdate / artifactUpdate`
之一。首版产物更新选择 `append:false`，发送该 Artifact 的完整当前 parts；它支持
最终修正，也避免将 JSON 或文本增量误认为原生数组 splice。

以下是合成的标准 SSE 序列，第一条 Artifact 更新后即可显示文字：

```text
data: {"task":{"id":"task-1","contextId":"session-1","status":{"state":"TASK_STATE_WORKING"}}}

data: {"artifactUpdate":{"taskId":"task-1","contextId":"session-1","artifact":{"artifactId":"answer-1","parts":[{"text":"Hello"}]},"append":false,"lastChunk":false}}

data: {"artifactUpdate":{"taskId":"task-1","contextId":"session-1","artifact":{"artifactId":"answer-1","parts":[{"text":"Hello world"}]},"append":false,"lastChunk":true}}

data: {"statusUpdate":{"taskId":"task-1","contextId":"session-1","status":{"state":"TASK_STATE_COMPLETED"}}}
```

`append:true` 是产物内容追加，不会执行 output.edits 或合并 Part.data JSON；
官方 JS SDK 将其作为 parts 数组拼接处理。`lastChunk` 只结束该产物，Task 仍靠
status.state 结束。1.0 的 TaskStatusUpdateEvent 没有旧版 `final` 字段。
依据：[官方 SDK 归并实现](https://github.com/a2aproject/a2a-js/blob/f91670ea8d6110009b90a1d4379b6304f2d605b8/src/server/result_manager.ts#L300-L326)。

### 7.3 完整输出扩展：声明、激活与 HTTP 使用

首版定义一个可选的 data + method extension：标准 Task 的 namespaced metadata
提供同一个 SessionStream 的订阅入口，扩展方法返回第 4 节的完整帧。无需把每条原始通知伪装成状态变化，
也不向标准 StreamResponse 添加第五种事件。普通 A2A 客户端不必理解扩展。

以下 URI 与域名为文档占位符，实施时换成项目控制的稳定地址。URI `/v1` 标识扩展
契约版本，`frameVersion:3` 标识内部帧版本，二者与 A2A `1.0` 分别管理。
以下是 AgentCard 的扩展相关片段，不是完整发现响应：

```json
{
  "supportedInterfaces": [{
    "url": "https://agent.example.com/a2a",
    "protocolBinding": "HTTP+JSON",
    "protocolVersion": "1.0"
  }],
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "extendedAgentCard": false,
    "extensions": [{
      "uri": "https://agent.example.com/extensions/harness-stream/v1",
      "description": "Complete, ordered and replayable harness session output",
      "required": false,
      "params": { "frameVersion": 3 }
    }]
  }
}
```

完整 AgentCard 还须提供 name、description、version、默认输入 / 输出模式、skills
及部署实际使用的认证声明；skills 描述产品能力，不把内部工具列表当作必需暴露的 API。

调用者先核对 Card，再以 `A2A-Extensions: https://agent.example.com/extensions/harness-stream/v1`
激活扩展。本扩展约定响应必须确认相同 header；缺少确认、URI 不支持或日志采集
不可用时，完整输出客户端不得静默降级为“完整成功”。服务端在提交 prompt 前校验
本扩展前置条件。响应丢失不代表任务未执行，客户端不能无条件重试创建新 Task。

完整 HTTP 调用采用一次标准提交加一个可续传的会话 SSE；它与 Chat 使用相同的
事件发布源，直接实时推送子 agent 和后台结果，无需轮询，也无需同时维护标准任务 SSE。
SDK 可将这两步封装成一个异步迭代器。程序只处理共享 schema，不维护 provider 索引。

```text
API client                  shared runtime                 journal
    | SendMessage + extension      |                          |
    | returnImmediately:true       |-- persist start cursor ->|
    |                              |-- submit prompt          |
    |<-- { task + stream pointer } |-- capture records ------->|
    | GET eventsUrl?afterSeq=N -------------------------------->|
    |<-- snapshot(atSeq=N), event(N+1), event(N+2), ... ----------|
    |         apply ordered edits -> render / save native      |
```

标准提交请求体示例：

```json
{
  "message": {
    "messageId": "input-1",
    "role": "ROLE_USER",
    "parts": [{ "text": "说明项目结构" }]
  },
  "configuration": { "returnImmediately": true }
}
```

响应体示例；metadata 位于内层 Task，不能放在 SendMessageResponse 顶层：

```json
{
  "task": {
    "id": "task-1",
    "contextId": "session-1",
    "status": { "state": "TASK_STATE_SUBMITTED" },
    "metadata": {
      "https://agent.example.com/extensions/harness-stream/v1": {
        "streamId": "stream-1",
        "startAfterSeq": 120,
        "eventsUrl": "https://agent.example.com/harness/streams/stream-1/events"
      }
    }
  }
}
```

扩展的严格读取契约：

- `startAfterSeq` 是任务创建时固定保存的排他游标；GetTask、重试及同任务的审批
  续答不重置它。`eventsUrl` 不含凭证，读取时仍验证会话权限和扩展版本。
- `GET eventsUrl?afterSeq=N` 返回 snapshot(atSeq=N)，随后连续发送 seq=N+1 起的帧。
  必须能还原 N 处快照；不能用最新快照顶替而跳过期间的 native。范围不可用时
  明确失败。连接建立时的“最新状态”订阅与历史回放须显式区分。
- 任务起点只保证从 startAfterSeq 之后的日志完整；整个会话历史应从 afterSeq=0
  读取。snapshot 只恢复显示状态，不交付其之前的原始记录。
- 重连可用 SSE Last-Event-ID；若同时提供 afterSeq，两者必须一致。控制帧不推进
  事件游标。SDK 使用“已成功处理”的 seq 续传，不能把浏览器已接收的 ID 等同于
  应用已保存原始记录；完整消费 SDK 用可控制游标的流客户端。
- 同一个扩展 URI 定义有界历史导出：`GET eventsUrl?afterSeq=N&throughSeq=M`
  返回同一格式，到 M 后发送 stream.closed 控制帧并关闭；只有不带 throughSeq 的
  订阅才持续等待。这样任务终态之后仍可读取已保存的全部来源事件。
- 标准 `SubscribeToTask` 继续使用标准 A2A 响应；它不冒充这个扩展日志方法。
  首版不在标准 SSE 内重复夹带完整帧，避免两个流共同驱动同一 reducer。
- 普通消息与交互回答走 SendMessage。结构化审批通过新 Message 的
  metadata[扩展 URI].interactionId 关联 InteractionItem.requestId，Part.data 承载请求 schema 规定的回答；
  服务端校验并交给同一交互协调器。messageId 用于消息身份；本产品另外约定按
  授权主体与 messageId 去重提交，相同 ID、相同内容复用结果，不同内容明确冲突。
  这项幂等承诺属于产品契约，不能归因于 A2A 自动保证。

扩展遵循 [A2A 扩展规则](https://github.com/a2aproject/A2A/blob/v1.0.1/docs/topics/extensions.md)：
新增数据放 namespaced metadata 或 Part.data，扩展方法与标准方法明确区分，破坏性
升级更换扩展 URI。这里允许完整日志通过扩展 HTTP 获取，不要求打开 Chat/TUI 页面。

### 7.4 任务状态、后台输出与完整性

```text
SUBMITTED -> WORKING -> INPUT_REQUIRED / AUTH_REQUIRED
                ^                 |
                +---- same taskId + new Message
                |
                +-> COMPLETED / FAILED / CANCELED / REJECTED
                                |
                    later request -> new Task, same contextId

session journal ------------------------------------------->
                 capture continues independently of Task SSE
```

图中省略了 `TASK_STATE_` 前缀；线上枚举必须保留前缀。等待用户输入 / 确认是
INPUT_REQUIRED；执行中等待凭据 / 授权是 AUTH_REQUIRED，与 HTTP 401/403 分开。
它们是中断态，继续时带同一 taskId / contextId。终态后不能复活旧任务，应创建新
Task，必要时用 referenceTaskIds 关联。失败或取消也保留已产生的结果。

joined 子 agent / 后台工作尚未完成时，父 A2A Task 保持 WORKING；这些进度与结果
可在标准任务流中投影为状态消息与产物。不把每个子 agent 自动拆为新 A2A Task。
终态发布前，适配器必须完成已知的在途转录读取、产物修正与持久提交。A2A Task
结束后不再发送该任务的状态 / 产物更新，不为了晚到记录重新打开它；后台事件与
之后才到达的来源记录仍进入会话日志。完整日志客户端不在看到 Task 终态时自动
停止采集。若 SDK 提供“等待任务完成”，它与“持续读取会话”必须有不同结束语义。

HTTP 请求/连接关闭、Artifact.lastChunk、provider 回合结束、Task 结束和会话日志
结束是五种不同边界。标准订阅首先发送当前 Task，但 A2A 不保证重播每条瞬时
状态消息，history 也不保证保存全部原始交互；持久 seq、补齐缺口和原始记录完整性
由本扩展承担。依据：[任务生命周期](https://a2a-protocol.org/latest/topics/life-of-a-task/)、
[流式与异步](https://a2a-protocol.org/latest/topics/streaming-and-async/)。

### 7.5 已发现的上游差异与实施基线

v1.0.1 的 proto 将 SubscribeToTask 标为 GET，规范正文写 POST。官方 JS SDK
服务器明确支持两种动词，客户端使用 POST。首版跟随该行为，让两个入口共用
同一处理器；这是同一版本的规范歧义，不是保留旧协议兼容分支。互操作测试须固定
SDK 版本与提交，不能只凭手写 JSON 自称通过 A2A 验证。

- [官方服务器处理](https://github.com/a2aproject/a2a-js/blob/f91670ea8d6110009b90a1d4379b6304f2d605b8/src/server/express/rest_handler.ts#L370-L397)
- [官方客户端请求](https://github.com/a2aproject/a2a-js/blob/f91670ea8d6110009b90a1d4379b6304f2d605b8/src/client/transports/rest_transport.ts#L363-L375)

规范对中断态是否结束当前 SSE 的表述也不完全一致；不能把 INPUT_REQUIRED 当成
终态。客户端须支持流在中断时结束后继续同一 Task；终态必须结束标准任务流。
实现时固定 binding / SDK 行为，完整会话日志不依赖这条连接维持采集。

## 8. 流式效率与「直接使用」的取舍

组件状态仍可在生成途中持续更新，因此全量的单组件状态也支持流式显示。
它的收益是消费方替换数组片段即可渲染，代价是重复传输累计内容。

| 形式 | 消费方复杂度 | 数据成本 |
| --- | --- | --- |
| 原生 delta 直接给页面 | 需要 provider 专用关联和合并规则 | 通常较低 |
| 每次发送整个 session | 简单 | 随整个历史增长，成本最高 |
| 本草案：只发变动组件的完整状态 | 统一 splice 操作，数组顺序渲染 | 取决于活动组件大小；有明确边界 |

不能把「累计状态」宣传为线性带宽：一个文本组件长度持续增长时，反复发送完整
内容仍可能累计到平方级。Pi SDK 自身的原始 partial 也有这个成本，完整保留它就
必须承担或无损压缩这部分数据。

建议初版选择组件状态作为默认消费接口，测量事件大小、序列化时间和慢客户端积压。
可以合并 transport 写入、启用无损压缩；若按时间窗口合并显示更新，必须仍保存和
传送每条 native，且窗口结束、等待交互、取消、失败、完成时立即发送最后状态。
原始事件不能因为 UI 合帧而被丢弃。

后续只有数据支持时才增加受控的 text append 优化，并由共享 reducer 对外继续暴露
同一个有序 items[]。该优化不是本草案核心契约的实施前提。

## 9. 「不能漏事件」必须落实的采集和存储约束

```text
source callback / wire read
          |
      immutable capture
          |
    durable ordered journal --- failure ---> explicit incomplete / stop
          |
        projector ---------- failure ------> retain native + projection error
          |
       WS / SSE ------------ disconnect ---> replay from last committed seq
```

- 在 source 层开始接收之后才启动任务，在真正结束订阅之前持续捕获，包括 retry、
  compaction、usage、后台通知、错误与未知事件。不能在第一个 result / agent_end 后
  统一停止所有来源。
- Claude 保持 tmux；采集 hooks、MessageDisplay、transcript、statusLine 等已接入的
  结构化通道，并保留终端通道特有输出。普通回答与工具尽量归一化，只有 ANSI 输出
  的内容保持 terminal 来源记录，不声称获得了 TUI 未公开的 SDK 内部事件。
  必须在 hook relay 的裁剪、过滤之前保存完整输入。MessageDisplay 也不能先丢弃
  agent_id 记录，再声称子 Agent 输出完整。可覆盖哪些原生 hook 必须按当前 Claude
  版本核对，不能把“现有代码订阅的少数事件”定义为全部来源能力。
- Codex 的 server request 和 response、Pi 的 extension UI、Claude 的控制回调不是
  普通文本 delta，应按接口实际开放的入口采集，声明覆盖范围。
- 未识别的记录原样写入；识别失败不是忽略事件的理由。JSONL 解析失败若要求保持
  输入证据，需要先存原始字节再报告错误。
- 原始日志先持久化，再发布可确认的帧。投影结果可单独保存或按固定适配器版本重建。
  这不等于可以保证捕获到进程崩溃前尚未送达宿主的字节；完整性保证以声明的采集
  边界和已提交记录为准。
- 同一 (streamId, seq) 的对外帧在重放时必须一致。共享 schema 或适配器升级后不能
  在旧游标下发布另一组 edits；保留已发布投影，或固定投影版本重建。需要改变历史
  投影定义时，以显式的新 stream / snapshot 边界切换。
- 原始日志路径不能使用「满了丢最旧」队列。现有 DataRecorder 明确是尽力记录，
  队列上限 10,000、关闭时有 flush 超时，因此不能直接承诺满足本目标。
  可以复用数据库技术，但需要具有提交确认和明确背压语义的记录契约。
- SDK 若不能等待写入或提供背压，需要落盘缓冲和明确的失败策略；内存积压、磁盘
  写入失败、retention 导致历史不可得时，必须显式报告不完整，不能用 snapshot
  假装原始事件已经恢复。
- 保留期限、是否包含终端字节、是否包含入站命令，需要明确声明；本草案不把
  “完整”解释为无期限保存所有进程内部状态。

## 10. 与当前项目的衔接及验收

第一阶段：复用 TerminalChatSessions 与现有会话服务；在 hook relay、原始 transcript
读取、Pi Host / SDK callback 等裁剪和 mapper 之前增加完整记录捕获及来源标识。
补齐持久日志、精确游标快照和共享边界 schema，验证无 UI 连接时也能采集。

第二阶段：增加 A2A 1.0 HTTP+JSON / SSE、Task 存储与完整输出扩展。用普通 A2A
客户端验证标准能力，用扩展客户端验证同一运行的完整输出和顺序渲染。

第三阶段：Chat / WS 切换到同一 v3 组件投影，删除旧的可选字段 StreamFrame 和旧
协议分支。A2A 标准视图与完整输出扩展是同时需要的两个视图，不是保留 v2 的兼容层。

Codex 是本次对比与 schema 覆盖对象，实际接入可在之后单独推进，并非完善现有
Claude / Pi HTTP 接口的前置条件。不同驱动保持准确来源标识。

```text
existing shared runtime + durable capture + shared schema
          |
A2A 1.0 task API + full-output extension + interoperability checks
          |
Chat / WS v3 client -> remove v2 -> verify parity / transport cost
```

至少验证以下场景：

- 逐条原始输入与导出记录 deep-equal；未知事件和额外字段也相等。
- SDK 后续修改 partial 对象不能改变已保存记录。
- 文本 / 思考 / 工具 / 子 Agent 交错时，输出顺序正确、组件 id 稳定且不串线。
- 重复投递不会重复文本；缺失 seq 触发补齐，不直接跳过。
- 最终权威内容修正流式内容、fallback 撤回和 supersedes 可正确更新视图。
- 工具参数尚不完整、结构化工具结果、图片、usage、审批与错误保留原值。
- Pi agent_end 后的 retry / agent_settled、Claude 后台通知、Codex server request
  都不会导致过早结束采集。
- 从头投影与 snapshot(atSeq) + 后续事件的视图一致；snapshot 不顶替 native 日志。
- 断线、进程重启、落盘失败和超过保留期具有明确结果。
- 不打开 Chat / TUI 页面，通过 HTTP 完成启动、流式输出、交互回答、取消和续传。
- 对同一运行同时订阅完整输出 WS 与扩展 SSE，日志范围相同则逐帧语义相同、最终
  items[] 相同；标准 A2A SSE 的帧数可以不同，但最终任务产物必须一致。
- MessageDisplay 先到、transcript 后到时，中间补插工具不打乱文本顺序、不重复内容。
- HTTP 重试同一 messageId 不重复执行，内容不同时冲突；断开 HTTP 不终止后台采集。
- 普通 A2A 1.0 客户端能发现 Card、提交、流式读取产物、查询、列举、取消和订阅，
  无需理解扩展。固定官方 SDK 验证订阅路由、版本 header 与错误返回。
- 完整客户端验证扩展激活确认；Task 创建、起始游标和采集先于执行。首次连接
  前已发生的事件也可补齐；GetTask / 审批续答不重置 startAfterSeq。
- 标准响应不混入私有顶层字段、旧版 kind / final 或小写枚举。任务流首条是 Task。
- INPUT_REQUIRED / AUTH_REQUIRED 后沿用 taskId；终态之后拒绝继续旧 Task，新输入
  创建同 context 的新 Task。lastChunk 不代替 Task 结束。
- 最终状态前完成已知产物修正；之后的后台 / 晚到事件仍在 journal，不能修改终态
  Task。终态后可有界导出原始日志，断点恢复不丢瞬时状态或未知事件。
- A2A GetTask 的最终 Artifact 与标准流归并结果一致；扩展从头重放与快照加尾部
  得到相同 items[]，失败 / 取消路径也保留部分结果。

当前限制：此文是协议草案，尚无生产实现或负载测试；跨 harness 的采集完整性
必须逐入口验收，不能仅凭共有 schema 判断已经满足。

2026-10-17 共享 schema 更新：新增完整 JSON Schema、可读类型和同源流示例；
验证结果见 [共享契约验证记录](../api/harness-stream-v3.md#8-验证记录)。
此轮只更新设计与示例，没有修改运行时代码。
