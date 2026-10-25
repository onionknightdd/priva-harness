# SDK worker 并发实测：10 / 50 / 100

2026-10-24，在独立 Debian PoC 中完成。没有接入 Agent Runner。

结论：本轮固定 8 CPU、6 GiB、无 swap 的预算下，10 并发全部通过；50 和 100
并发触发 cgroup OOM。主要容量约束是 SDK Node + Claude Code 的内存，突发启动
延迟同时受到 CPU 配额和内存回收影响。存量目录数量不是本轮负载的变量。

## 环境与口径

- Debian 13，Node.js 24.21.0，Claude Agent SDK 0.3.301，bubblewrap 0.12.0。
- Docker Desktop / arm64，Linux 6.12.76-linuxkit；VM 18 个逻辑 CPU、约 8 GiB RAM。
- 每档新建独立容器，限制 `--cpus=8 --memory=6g --memory-swap=6g --pids-limit=8192`。
- minikube 在压测期间停止，不与负载竞争资源；测试使用热文件缓存，没有执行 drop_caches。
- 各档一次同时启动的 burst；P50/P95 是该次 burst 内 worker 间的分位数，不是多轮实验的置信区间。
- 每个 worker 都运行完整 SDK、Claude Code 和内嵌 MCP，执行 6 次真实文件工具调用。
- 模型响应为本地确定性 Messages API fixture，不含真实推理、API 限流或模型网络延迟。

```text
8 CPU / 6 GiB test cgroup
  +-- fixture + sampler
  `-- N x [bwrap -> SDK Node + Claude Code]
        launch -> first model request -> hold 10 s -> six tools -> exit
```

启动时间从各 worker 的 spawn 到首次携带完整工具列表的模型请求，不包含人为设置的
10 秒等待。每档都在 barrier 保持就绪 worker 存活，检查实际同时驻留数。
每 250 ms 读取 cgroup 资源数据，并在 barrier 读取进程 PSS；内存峰值采用内核
`memory.peak`，不会漏掉两次采样之间的峰值。

## 测量结果

| 请求并发 | 最终完整通过 | barrier 同时就绪 | 启动样本数 | 启动 P50 / P95 | 容器内存峰值 | OOM kill |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| 10 | 10 / 10 | 10 | 10 | 0.706 / 0.725 s | 1.621 GiB | 0 |
| 50 | 40 / 50 | 43 | 48 | 4.254 / 4.699 s | 6.000 GiB | 10 |
| 100 | 41 / 100 | 44 | 48 | 16.189 / 16.801 s | 6.000 GiB | 59 |

50 / 100 档的启动分位数仅覆盖到达首次模型请求的 48 个 worker，其中还有进程之后
被 OOM 杀死。因此这两行不代表 50 / 100 个 worker 成功运行时的延迟。
100 档的内核峰值为 6144.043 MiB，存在限额附近的短暂记账超量。

| 请求并发 | 启动阶段平均 CPU 核数 | 等待阶段平均 CPU 核数 | 工具阶段平均 CPU 核数 | 全程 CPU 秒 | 6 次工具调用 P95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10 | 7.37 | 0.20 | 7.08 | 9.96 | 0.169 s |
| 50 | 7.92 | 0.45 | 7.24 | 54.44 | 1.124 s |
| 100 | 7.98 | 0.43 | 7.73 | 167.64 | 2.645 s |

`1 CPU 核` = 单个逻辑 CPU 的 100%。CPU 秒是所有容器进程 CPU 用时之和，
不是墙钟耗时。平均值包含 fixture 和采样程序；后两档的等待和工具阶段只有
幸存 worker，并非全部请求并发。工具耗时覆盖返回 6 个工具结果的 worker；
100 档有 42 个返回结果，其中 1 个在最终退出前被杀，完整通过数为 41。

## 瓶颈证据

10 并发无 OOM 时，等待阶段的进程 PSS 如下：

| 进程类别 | 进程数 | 合计 PSS |
| --- | ---: | ---: |
| SDK Node worker | 10 | 462.38 MiB |
| Claude Code | 10 | 1118.13 MiB |
| bubblewrap 辅助进程 | 20 | 2.98 MiB |

两种 worker 进程合计约 158 MiB PSS / worker；bubblewrap 用户态辅助进程约
0.30 MiB / worker。namespace、页表等内核开销另计，不能把 0.30 MiB 当作
bubblewrap 的全部系统开销。10 并发的容器内核内存采样峰值约 37 MiB。

PSS 会按共享映射分摊，RSS 求和会重复计算公共代码页。cgroup 内存仅包含记账到
该 cgroup 的页，部分热文件页可能记账到其他 cgroup，所以 PSS 和
`memory.current` 不要求相等。等待末尾容器内存分别为 1.490、5.799、5.894 GiB。

50 档：启动期间 7 次 OOM kill，工具阶段再发生 3 次。100 档：启动期间 56 次，
工具阶段再发生 3 次。全部 69 个失败 worker 均有 Claude Code 被 SIGKILL 的
错误，数量与对应 cgroup 的 OOM kill 增量一致；没有工具结果校验失败。

100 档约 17.33 秒的启动阶段内，CPU 平均占用 7.98 核，memory PSI 的 some
累计阻塞时间约 11.32 秒，CPU PSI some 约 16.10 秒。这说明大规模同时启动
既耗尽 CPU 配额，也持续触发内存回收与 OOM；启动 P95 从 0.725 秒上升到
16.801 秒不能归因于目录挂载成本。

三档线程峰值分别为 325、1368、1630，均未触发 8192 的 pids 限制。fixture 和
采样程序全程 CPU 用时分别为 0.21、0.43、0.95 秒，远低于容器总 CPU 用时；
未见模型 fixture 持续占满单核的证据。

## 对容量规划的含义

6 GiB 下已经验证通过的请求档位是 10；40～41 个幸存进程不是安全并发上限。
大规模启动需要排队或限制同时启动数，驻留 worker 也需要独立的内存预算。
单纯把启动过程错开不能解决总驻留内存超过限额的问题。

若仅按本次健康的 10 并发短会话粗略外推，100 个 worker 的基础进程 PSS
约需 15.4 GiB，尚未计入更长上下文、工具子进程、编译、页缓存和安全余量。
这是估算，不是已验证的 100 并发机器配置。本轮没有扩大已确认的 6 GiB 预算。

## 复现与原始数据

命令和指标定义见 [README](README.md#并发-sdk-压测)，实现为
[`tests/concurrency.mjs`](tests/concurrency.mjs)。每档容器退出后导出了原始文件，
再移除测试容器；以下本地数据不加入版本控制：

- [10 并发报告](results/concurrency/10/report.json)
- [50 并发报告](results/concurrency/50/report.json)
- [100 并发报告](results/concurrency/100/report.json)
- 每个目录内的 `samples.jsonl` 为原始采样，`container-state.json` 为退出状态。

检查记录：Docker 构建和 `npm run check` 通过，原有双用户隔离检查 54 项通过；
并发脚本单 worker 校准通过；10 并发退出码 0，50 / 100 并发均因上述 OOM 退出 1。

实验容器均已移除。停止 minikube 时遇到不可中断的内核 I/O 等待，常规停止失败，
因此重启了 Docker Desktop VM。测试后已启动原 minikube profile，确认节点 Ready、
API Server / Kubelet Running、Runner 和桌面 Pod 就绪；重连宿主端口转发后，
Runner `:18001` 与 UI 代理 `:15173` 的 profile 接口均返回 HTTP 200。
`minikube start` 退出 0，但 ingress addon 校验超时，其 Pod 为 ImagePullBackOff；
该插件未就绪，未在本次 PoC 中修改其镜像或配置。
