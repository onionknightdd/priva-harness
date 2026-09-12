# 用量统计与审计数据存储

Agent Runner 把用量事实（token、成本、运行结果、工具调用）和审计事件写入一个
SQLite 数据库。本文记录已确认的设计决策和当前实现范围；后续步骤（事件采集、
查询接口、前端概览）在此基础上叠加。

## 决策摘要

| 项目 | 决定 |
| --- | --- |
| 存储 | `node:sqlite`（Node 22 内建），无新依赖；`@types/node` 需 `^22` |
| 位置 | `$RUNTIME_HOME_DIR/.bambuddy/.data.db`，与 `bambuddy.settings.json` 同级；用户级状态，所有 harness provider 共用 |
| 结构 | 两层：不可变 `audit_event` 是唯一事实来源；`run_fact` / `run_model_usage` / `tool_fact` 是类型化投影，供聚合 |
| 身份 | 无 `actor` 列，一个 runner 只服务一个用户 |
| 线程 | 唯一的 SQLite 连接在 `worker_threads` 里；主线程只入队 |
| 失败 | 记录失败只记日志，永不影响业务流程；`record()` 同步返回 `void`，不抛 |
| 队列 | 主线程有界队列 10,000 条，满则丢最旧并计数 |
| 关闭 | flush 上限 2 秒，超时直接 terminate |
| 时区 | 只存 `ts_utc`；本地日期在查询时按前端传入的 IANA 时区折算 |
| 保留期 | `dataRetention` 配置：审计 90 天、`tool.invoked` 审计 90 天、事实表 365 天 |
| 重试 | harness 目前无重试；`run_fact` 用自增主键 + `run_id` 索引，重试落地时再加 `attempt` 列 |

## 数据流

```
 harness / 路由                         │ 主线程                  │ Worker 线程
 ───────────────────────────────────────┼─────────────────────────┼──────────────────────────────
 recorder.record(DataRecord)  ────────► │ 有界队列 (10k, 丢最旧)   │
   同步返回, 永不 throw                  │   setImmediate 合批      │
                                        │   postMessage ─────────►│ SqliteDataStore.writeBatch
                                        │                         │   BEGIN
                                        │                         │   每条记录一个 SAVEPOINT
                                        │                         │     audit_event  INSERT
                                        │                         │     run_fact / tool_fact 投影
                                        │                         │   COMMIT
                                        │                         │ 失败的记录单独回滚, 其余保留
                                        │ worker 崩溃 → 指数退避重启 │
                                        │ 重启期间继续入队          │ 启动: running → runtime_crash
                                        │                         │ 每批之后: 距上次 ≥ 24h 则分块清理
```

## 记录类型

`src/core/resource/data-store.ts` 定义 `DataRecord`：

| kind | 审计 action | 事实表动作 |
| --- | --- | --- |
| `audit` | 调用方给定 | 无 |
| `run.started` | `run.started` | `INSERT run_fact (outcome='running')` |
| `run.session` | 无 | 回填 `run_fact.session_id`（Pi 在 openSession 后才有 id） |
| `run.finished` | `run.finished` | `UPDATE run_fact` 终态、耗时、token、成本；`INSERT run_model_usage` |
| `tool` | `tool.invoked` | `INSERT tool_fact`，写入时解析 `mcp__<server>__` 前缀 |

`run.finished` / `run.session` 找不到对应的 `running` 行时（例如 `run.started`
被满队列丢弃），审计行照常写入，事实表不动，worker 记 warn。

## Schema（`PRAGMA user_version = 1`）

```
audit_event      id, ts_utc, action, session_id, run_id, target, details(JSON)
run_fact         id, run_id, started_audit_id, finished_audit_id, started_utc, finished_utc,
                 session_id, provider, profile_id, model, source, prompt_chars, attachment_count,
                 outcome, failure_code, duration_ms, api_duration_ms, num_turns,
                 input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd
run_model_usage  run_fact_id → run_fact (CASCADE), model, 四个 token 列, cost_usd
tool_fact        id, audit_id, run_id, ts_utc, tool_use_id, tool_name, mcp_server, ok,
                 duration_ms, output_tokens, agent_id
meta             key, value          (last_prune_utc)
```

- `source ∈ {web, subagent-test, channel, scheduled}`，`outcome ∈ {running, completed, failed, aborted}`，
  `failure_code ∈ {max_turns, max_budget, api_error, auth_error, compaction_failed, provider_error,
  transport_error, runtime_crash, unknown}`，均有 `CHECK` 约束。
- 事实表指向 `audit_event` 的外键是 `ON DELETE SET NULL`：审计 90 天先于事实 365 天过期，
  数字保留、原文消失。因此"从审计重放重建事实表"只在审计保留期内成立。
- token 四列存 provider 上报的原始分量，不预先合并。处理量 = `input + cache_read + cache_write`，
  缓存命中率 = `cache_read / 处理量`，均在查询时计算。`cost_usd` 为 `NULL` 表示无报价，不是 0。
- 迁移只向前：`src/infrastructure/data/sqlite-schema.ts` 里按位置追加函数，`user_version` 记录已应用数量。
- 建库时 `auto_vacuum = INCREMENTAL`（必须在任何表存在之前设置），之后 `journal_mode = WAL`、
  `synchronous = NORMAL`、`foreign_keys = ON`。

## 自动清理

`dataRetention` 在 `bambuddy.settings.json` 中配置，缺省：

```json
{ "dataRetention": { "auditRetentionDays": 90, "toolAuditRetentionDays": 90, "factRetentionDays": 365 } }
```

三项均须为正整数天数，启动时读取一次。全新数据库在 worker 启动时只把当前时间写入
`meta.last_prune_utc` 作为基线，不执行清理、不写审计行。之后清理在 worker 里、每个写入批次之后
检查：距 `meta.last_prune_utc` 不足 24 小时则跳过，否则按顺序执行

1. `audit_event` 中 `action = 'tool.invoked'` 且早于 `toolAuditRetentionDays`
2. 其余 `audit_event` 早于 `auditRetentionDays`
3. `tool_fact` 早于 `factRetentionDays`
4. `run_fact`（`outcome != 'running'`）早于 `factRetentionDays`，级联 `run_model_usage`

每步每次最多删 2000 行、一个事务，块间通过 `setImmediate` 让队列中的写入先执行。全部完成后
`PRAGMA incremental_vacuum`、`PRAGMA wal_checkpoint(TRUNCATE)`，写一条 `retention.pruned` 审计
（details 含各表删除数与生效的保留期）并更新 `meta.last_prune_utc`。清理失败只记日志，下个周期再试。

因为事实表只保留 365 天，概览页的"全部"区间语义上是"近一年"，前端文案须如实表述。

## 代码位置

```
src/core/resource/data-store.ts             记录类型、保留期默认值、状态与日志接口
src/core/contract/data-recorder.ts          DataRecorder { record(record): void }
src/infrastructure/data/sqlite-schema.ts    DDL 与迁移
src/infrastructure/data/sqlite-data-store.ts 同步存储（writeBatch / reconcileRunning / createPruneJob / status）
src/infrastructure/data/data-worker.ts      worker 入口
src/infrastructure/data/worker-data-recorder.ts 主线程代理（队列、重启、flush、status）
src/infrastructure/data/data-worker-protocol.ts 主线程 ↔ worker 消息
tests/unit/infrastructure/data/             存储与 worker 的单元测试
```

开发和测试从 `.ts` 源码运行时，worker 以 `execArgv: ['--import', 'tsx']` 启动以解析 `.js` 导入
说明符；生产从 `dist/` 加载 `.js`。

## 事件层：provider 如何上报一轮的用量

`run.completed` 与 `run.failed` 共享 `RunAccounting`（`core/event/agent-event.ts`）：
`durationMs`、`apiDurationMs?`、`numTurns?`、`usage?`、`byModel?`、`costUsd?`。失败事件另有
`code: RunFailureCode` 与 `apiErrorStatus?`。

**Claude**：`result.modelUsage` 与 `total_cost_usd` 是同一个 `query()` 生命周期内的**累计值**
（warm runtime 跨多轮复用同一个 query），而 `result.usage` 只覆盖主循环、不含子代理。因此
mapper 保存上一次 result 的 `modelUsage` 快照，本轮 = 累计 − 快照；任一计数器小于快照视为 CLI
重置了计数（`/clear`、resume），此时累计值即本轮值。runtime 每次新建 `query()` 调用
`mapper.resetUsageBaseline()`。`usage` 取各模型增量之和（含子代理与压缩调用），只有 result 不带
`modelUsage` 时才回退到 `result.usage` 与 `total_cost_usd` 差值。失败码：`error_max_turns` →
`max_turns`，`error_max_budget_usd` → `max_budget`，`api_error_status` 401/403 → `auth_error`，
其他状态码 → `api_error`，否则 `provider_error`；压缩失败 → `compaction_failed`。

**Pi**：`agent_end.messages` 是本轮新产生的全部消息，每条 assistant message 带一次 API 调用的
`usage` 与 `model`。mapper 遍历求和并按模型分桶，`numTurns` = assistant message 数。Pi 只给
自由文本 `errorMessage`，失败码按文本启发式归类（401/403/unauthorized → `auth_error`，HTTP
状态码 / rate limit / 网络错误 → `api_error`，其余 `provider_error`）；原文仍在 `message` 里。
Pi 对无报价模型给出 `cost.total = 0` 而非缺失，因此 Pi 侧无法区分"零成本"与"无报价"。

**来源**：`AgentRunOptions.source: RunSource` 为必填，`run-route.ts` 传 `'web'`，
`subagent-test.ts` 传 `'subagent-test'`；`'channel'`、`'scheduled'` 已预留在类型中。

## 当前范围与后续

已完成：存储层、worker 管道、主线程代理、保留期清理、启动回收、`main.ts` 接线；provider 事件层
的用量求和 / 按模型拆分 / 失败码归一化 / `source`。此时还没有任何业务事件进入 `record()`。

后续步骤：

1. harness 采集：`run.started` / `run.session` / `run.finished`（含 `runtime_crash` 分支）。
2. 工具、技能、权限、问答、压缩、子代理、工作流审计。
3. 路由层审计（session 生命周期、配置变更）。
4. 查询接口（时区由请求携带）与前端概览页。
