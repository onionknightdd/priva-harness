# Claude Agent SDK + bubblewrap 最小 PoC

独立于 Agent Runner。Debian 13 上由 bubblewrap 启动整个 Node SDK worker，
验证 Bash、原生 Read/Write、SDK 内嵌 MCP 都只能访问选中的用户目录。

Claude Code 内置沙箱主要约束 Bash 命令；SDK 的原生文件工具和内嵌 MCP
不能只靠这一配置获得同样的文件系统边界。因此这里在启动 SDK 之前建立
bubblewrap namespace，让 Node worker 和所有子进程共同受其约束。

```text
Debian test process (UID 1000)
  +-- temporary fixtures
  |     +-- sb-1234 ----------------------> /mnt/user/sb-1234 (rw)
  |     |     `-- escape -> ../sb-5678       inside bubblewrap
  |     `-- sb-5678 (same owner, NOT mounted)
  |
  +-- local Messages API fixture <--------- HTTP (shared network)
  |
  `-- bwrap [new mount/user/PID namespaces]
        `-- node /app/worker.mjs
              +-- embedded MCP -> node:fs
              `-- Claude Code subprocess
                    +-- Bash -> shell and children
                    `-- Read / Write
```

模型响应由本地 HTTP fixture 固定返回 `tool_use`；SDK、其捆绑的 Claude Code
二进制、所有文件工具和内嵌 MCP 都真实执行。不调用真实模型，不需要 API 密钥。
这样每次都执行相同的越界请求，不把模型拒绝执行当成隔离成功。

## 运行

在本目录构建、运行独立 Debian 容器，无宿主目录、Docker socket 或 Runner 挂载：

```sh
docker build -t priva-harness/claude-sdk-bwrap-poc:debian13 .
docker run --rm --cap-drop ALL \
  --security-opt no-new-privileges=true \
  --security-opt seccomp=unconfined \
  --security-opt systempaths=unconfined \
  priva-harness/claude-sdk-bwrap-poc:debian13
```

若 npm 官方源下载较慢，可给构建添加
`--build-arg NPM_REGISTRY=https://registry.npmmirror.com`。
版本和包内容仍由原始 `package-lock.json` 的 integrity 校验固定。

这些 Docker 选项用于允许容器内创建嵌套 namespace 和挂载新的 `/proc`。
容器以非 root 用户运行，不使用 `--privileged`；文件隔离边界仍由 bubblewrap 建立。
该命令是独立实验环境的启动方式，不是生产容器安全配置。

也可在允许非特权 user namespace 的 Debian 主机直接运行：

```sh
sudo apt-get update
sudo apt-get install -y bubblewrap
# 此最小启动脚本使用 /usr/local/bin/node；验证镜像使用 Node.js 24。
npm ci
npm run check
npm test
```

`npm test` 必须由普通用户执行，自动建立并清理测试目录和本地 API fixture。
它分别以 `sb-1234` 和 `sb-5678` 作为当前用户运行一遍完整验证。
运行结束输出每条检查及 JSON 汇总；任何缺失工具调用、错误类型不符或越界泄漏
都会导致非零退出。若 bubblewrap 无法启动，直接失败，不退回无沙箱执行。

## 文件和隔离策略

- `sandbox.sh`：唯一的挂载策略。只把选中的 `sb-NUMBER` 映射到 `/mnt/user/sb-NUMBER`；
  不挂载其父目录或其他用户目录。根目录只读，阻止在其下创建其他用户的目录。
- `worker.mjs`：真实 SDK `query()` 和两个直接调用 `node:fs` 的 MCP 工具。
  MCP 不做路径过滤。SDK 权限使用 `bypassPermissions`，内置 Bash 沙箱关闭，
  避免把应用层拒绝或另一层沙箱误当成外层 bubblewrap 的效果。
- `tests/verify.mjs`：数据、模型 fixture、工具调用和宿主侧断言。

可见的必要文件包括只读 `/usr`、动态链接路径、少量 `/etc` 配置和证书、
只读 SDK 依赖及 worker；`/proc` 是新 PID namespace 的视图，`/dev` 由 bwrap 创建。
HOME 和 `/tmp` 是每次运行新建的 tmpfs，不继承宿主内容。环境变量清空后仅设置
运行所需值，API key 是无效测试字符串。
具体设置为 `HOME=/home/worker`、`CLAUDE_CONFIG_DIR=/home/worker/.claude`，
启动工作目录是 `/mnt/user/sb-NUMBER`。不同 worker 的 HOME 路径相同，但内容独立；
沙箱结束后 HOME 内容不保留，挂载的用户目录中的写入仍保留在宿主。

本 PoC 共享网络以连接本地 API fixture，**没有验证网络隔离**；也不是内核逃逸、
资源配额或完整多租户生产安全审计。测试文件无敏感数据。

## 验收

每个用户执行 27 条工具检查，两轮共 54 条：三条通道分别验证自身目录读写成功、
对方目录读写失败、经自身目录中符号链接到对方的读写失败，共 18 条；
再验证宿主原始路径、`/proc/1/root` 和只读运行时，共 4 条；最后 5 条通过真实 Bash
`ls` 检查根目录、`/mnt/user`、对方目录、双方原始宿主路径。

进程内的期望视图如下，原始宿主路径不会同时暴露在进程里：

```text
Host source       A worker view             B worker view
/.../sb-1234  ->  /mnt/user/sb-1234          absent
/.../sb-5678  ->  absent                     /mnt/user/sb-5678

A: ls /mnt/user  -> sb-1234
B: ls /mnt/user  -> sb-5678
```

`/.../` 是测试生成的临时父目录；真实目录为 `/sb-5678` 时，同一个脚本也能将它
映射到 `/mnt/user/sb-5678`。`--bind` 的源路径与目标路径独立。

此外确认：同一 UID 在宿主能读写对方目录；沙箱仅列出当前用户；worker mount namespace
不同于宿主；所有 MCP 调用的 PID 和 mount namespace 均与 worker 相同；无工具权限
拒绝；自身输出落盘；对方的随机标记未泄露，文件和目录内容未改变。

原生 Write 对失效的父目录符号链接可能先触发 SDK 自身的校验；测试会单独标注
`SDK symlink guard, not OS evidence`，不将其当作 OS 拒绝的证据。
对 B 的直接读写，以及 Bash/MCP 的符号链接读写，仍必须返回文件系统错误。

## 实测结果

已在独立 Debian 13 Docker 容器中通过两轮共 54 条检查：
Claude Agent SDK `0.3.301`、bubblewrap `0.12.0`、非 root UID `1000`。
`npm run check` 和 Docker 内的 `npm test` 均退出 `0`。

```text
A worker:
  ls -1 /mnt/user                 => sb-1234
  ls -ld /mnt/user/sb-5678        => No such file or directory
B worker:
  ls -1 /mnt/user                 => sb-5678
  ls -ld /mnt/user/sb-1234        => No such file or directory

ls -1 / (both):
  app bin dev etc home lib mnt proc sbin tmp usr
```

两轮均确认 MCP 回调与 SDK worker 的 PID 和 mount namespace 相同。
每轮原生 Write 的符号链接用例触发上述 SDK guard，其余预期拒绝均为文件系统错误。
完整本地执行记录保存在 `results/verification.log`（不加入版本控制）。

## 目录规模与挂载开销

`tests/mount-overhead.mjs` 保留了此前执行的独立微基准：创建 50 个用户、
每用户 100 个 agent、每 agent 20 个租户，共 105050 个目录；比较不同目录规模、
显式 bind 数量以及缓存命中的文件读取耗时。它不启动 SDK。

```text
temporary directory tree (105050 directories)
  +-- direct /usr/bin/true
  +-- bwrap + one bind: small directory / whole tree / one leaf
  +-- bwrap + 10 or 100 explicit binds
  `-- direct / bwrap: cached 4 KiB reads
```

脚本使用镜像内的 `/opt/poc` 路径，请在构建上述 Debian 镜像后执行：

```sh
docker run --rm --cap-drop ALL \
  --security-opt no-new-privileges=true \
  --security-opt seccomp=unconfined \
  --security-opt systempaths=unconfined \
  priva-harness/claude-sdk-bwrap-poc:debian13 npm run bench:mounts
```

启动与退出测试每项预热 5 次、采样 40 次，交错执行；缓存读取每项采样 12 次。
此前同一脚本的实测中位数：直接启动 `true` 为 1.064 ms；单个 bind 挂小目录为
4.204 ms、挂整棵目录树为 3.838 ms、挂其中一个叶目录为 4.216 ms；10 / 100 个
显式 bind 分别为 4.560 / 40.082 ms。每轮 10000 次缓存读取中位数分别为
20.698 ms（直接）与 20.673 ms（bwrap）。

这是 Docker Desktop / arm64 / overlayfs 上的串行热缓存测试，未覆盖用户提出的
完整 500 用户规模、session 目录、冷盘或目录遍历成本。原始输出保存在本地
`results/benchmark.log`，不加入版本控制。

## 并发 SDK 压测

[10 / 50 / 100 并发实测报告](CONCURRENCY-RESULTS.md)包含 CPU、内存、启动分位数及 OOM 结果。

`tests/concurrency.mjs` 使用相同的 `sandbox.sh` 和 `worker.mjs`，不接入 Runner。
每个 worker 有独立目录、完整 Node SDK、Claude Code 子进程和内嵌 MCP。
本地 fixture 广播固定工具请求，不调用真实模型。

```text
dedicated cgroup v2 container
  +-- benchmark harness + model fixture + resource sampler
  +-- bwrap -> Node SDK 1 -> Claude Code 1
  +-- bwrap -> Node SDK 2 -> Claude Code 2
  `-- ... N workers, N = 10 / 50 / 100

launch all -> first model request barrier -> idle 10 s
           -> 6 tools each -> completion barrier -> exit all
```

启动时间分别记录从各 worker 的 spawn 到 Node SDK 导入完成、SDK init 事件、
首次携带完整工具列表的模型请求。主要采用最后一个指标；它不包含人为设置的等待。
所有就绪 worker 在 barrier 同时存活，避免把轮流执行误计为并发。
6 次工具调用为 Bash、原生 Read/Write、内嵌 MCP 三条通道各一次读、一次写。
工作负载完成后验证工具结果、宿主文件和 MCP 所在进程。

资源每 250 ms 采样一次：`cpu.stat`、`memory.current/peak/stat/events`、
`pids.current/events` 及 CPU、memory、I/O PSI。CPU 以占用的逻辑核数表示，
`1.0` 相当于单核 100%；`pids.current` 包含线程。容器总内存包括 fixture、
worker、内核及记账到此 cgroup 的文件缓存。阶段边界另读 `/proc/*/smaps_rollup`
按进程类别统计 PSS，避免共享映射被 RSS 重复计算；不可读取时明确计数。

示例以 8 核、6 GiB、无容器 swap 为固定测试预算。先确保 VM 有足够空闲资源，
再为每个并发档位建立全新容器；这里的资源限额不是生产容量建议：

```sh
docker build -t priva-harness/claude-sdk-bwrap-poc:debian13 .
# 将 10 分别替换成 50、100，逐档执行。
docker run --name claude-bwrap-load-10 \
  --cpus=8 --memory=6g --memory-swap=6g --pids-limit=8192 \
  --cap-drop ALL --security-opt no-new-privileges=true \
  --security-opt seccomp=unconfined --security-opt systempaths=unconfined \
  priva-harness/claude-sdk-bwrap-poc:debian13 npm run bench:concurrency -- 10
mkdir -p results/concurrency
docker cp claude-bwrap-load-10:/tmp/poc-concurrency results/concurrency/10
docker rm claude-bwrap-load-10
```

`report.json` 包含分阶段 CPU、内存峰值、启动分位数、进程 PSS、成功率和每个 worker
的错误；`samples.jsonl` 保存原始时间序列。启动与工具阶段各有 180 秒截止时间。
OOM、线程额度失败、超时或工具结果不符均报告失败并返回非零退出码，不把部分成功
当成全量通过。输出的耗时分位数仅覆盖到达该阶段的 worker，需与成功数一起解读。
压测范围是短会话的启动、等待模型期间的驻留和轻量文件工具调用；不包括真实模型
延迟、API 限流、长上下文、安装依赖或编译任务。

参考：[bubblewrap](https://github.com/containers/bubblewrap)、
[Claude Code 沙箱](https://code.claude.com/docs/en/sandboxing)、
[SDK 自定义工具](https://code.claude.com/docs/en/agent-sdk/custom-tools)。
