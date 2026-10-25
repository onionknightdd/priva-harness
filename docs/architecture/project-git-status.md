# 当前项目 Git 状态

Composer 下方展示所选工作目录当前 checkout 的分支。读取不依赖 Claude / Pi、
session id 或模型调用，新对话也可使用；会话列表中的历史 `git_branch` 保持原语义。

```text
Draft / active session cwd
          |
          v
SessionGitIndicator -> GET /api/sandbox/git/status?cwd=...
                                  |
                                  v
                         GitStatusReader
                                  |
                                  v
                         NodeGitStatusReader
                         directory -> Git HEAD
```

`cwd` 必填且为绝对目录。后端解析真实路径，检查目录位于 `WORKSPACE_DIR` 内；
越界的符号链接也会被拒绝。响应设置 `Cache-Control: no-store`：

```json
{
  "cwd": "/workspace/project/src",
  "root": "/workspace/project",
  "branch": "main",
  "commit": "a1b2c3d"
}
```

- 普通分支返回 `branch` 与至少 7 位的唯一短 `commit`；未提交的初始分支 `commit=null`。
- Detached HEAD 返回 `branch=null` 和短 `commit`。
- 非 Git 工作树（包括 bare 仓库）返回 `root/branch/commit=null`。
- 子目录和 linked worktree 由 Git 自己解析，不假设 `.git` 是目录。
- 缺失或不合法的 query 返回 422，非绝对路径 / 非目录返回 400，越界 / 无权限返回 403，
  目录不存在返回 404，Git 未安装返回 503，其他读取失败返回 500 和可重试的说明。

Git 通过 `execFile` 参数数组执行，不经过 shell；每条命令限制为 3 秒和 64 KiB 输出。
仅查询仓库根目录、符号 HEAD 和 commit，不扫描工作区改动、不操作远端、不修改仓库。
子进程清除会覆盖仓库位置的 Git 环境变量，防止 runner 的启动环境覆盖请求的 `cwd`。

前端在打开会话、切换目录、运行开始 / 结束、窗口 focus、页面恢复可见和手动重试时读取。
隐藏的聊天视图暂停请求；切目录时立即隐藏旧分支，取消过期请求并忽略迟到结果。
读取失败显示可重试状态，不当作非 Git 目录隐藏，也不继续显示旧分支。
没有持续轮询：外部终端切换分支后，在上述刷新时机更新。

在 `services/agent-runner/ts/` 运行接口集成测试：

```sh
TMPDIR=/tmp npm test -- tests/integration/transport/http/git-status.test.ts
```

测试使用临时真实仓库，覆盖首次提交前、分支切换、子目录、detached HEAD、worktree、
非仓库、bare 仓库、目录校验、符号链接、Git 环境隔离、缺少 Git 与损坏的仓库。
前端验证命令与布局见 [前端规范](../front-end-desgin.md#development-and-verification)。

## Workspace / 文件浏览器的 Git 双视图

两个入口共用仓库视图与 API，展示整个仓库当前的工作区、暂存区与历史，而非某个
Agent 会话产生的修改。原有 Composer `GitStatusReader` 接口仍只做轻量 HEAD 读取。

```text
Agent Workspace ─┐
                 ├─ Files / Git shared view
文件浏览器 ──────┘          │
                            ├─ repository → 分支 / 上游 / 变更分组
                            ├─ history → commit → files / first-parent diff
                            ├─ diff → HEAD / Index / Working tree / commit
                            └─ action + expectedBranch + expectedCommit
                                         │
                              GitRepositoryService
                                         │
                              NodeGitRepositoryService
                                         │
                       workspace boundary + literal Git arguments
                                         │
                         common Git dir mutation queue → Git
```

新增接口均位于 `/api/sandbox/git/`，响应 `Cache-Control: no-store`：

- `GET repository?cwd=...` 返回根目录、当前分支、完整 commit SHA、upstream、remote、
  `remotes`、ahead/behind、进行中的 merge/rebase/cherry-pick、变更与本地/远端分支。
  `changes` 保存 index/worktree 两列状态；同一文件可同时有已暂存与未暂存改动。
- `GET history?cwd=...&skip=0&limit=50` 分页读取当前 HEAD 的提交，默认 50 条，最多 100 条。
  未创建首个 commit 时返回空列表。
- `GET commit?cwd=...&commit=<SHA>` 返回提交正文、作者、时间、父提交与改动文件的统计。
  Merge 提交统一与第一父提交比较；根提交与空树比较。
- `GET diff?cwd=...&path=<仓库相对路径>&area=staged|unstaged|untracked|commit` 返回 patch、
  两侧文本、标签、binary/truncated 标志；`area=commit` 还需要 `commit=<SHA>`。
  文本单侧最多 256 KiB，patch 最多 512 KiB，超出明确标记 truncated；二进制不返回源码。
- `POST action` 必须携带 `cwd`、`expectedBranch`、`expectedCommit` 与 `action`。
  操作为 `stage`、`unstage`、`commit`、`switch`、`create-branch`、`set-upstream`、`fetch`、`pull`、`push`；
  按操作传入 `paths`、`message`、`branch`、`startPoint`（commit SHA）或 `remote`。
  `paths` 只传所选 change 的当前 `path`，重命名两侧由后端根据 index 状态处理。
  响应为以仓库根目录刷新后的 `repository` 和操作说明 `message`，即使切换分支删除了
  请求的 cwd 子目录也可以返回成功状态。

### 写操作与边界

```text
Action
  │
  ├─ resolve cwd / repository root / Git dirs inside WORKSPACE_DIR
  ├─ acquire queue keyed by common Git dir (linked worktrees share refs)
  ├─ re-read HEAD and branch → mismatch: 409 + refresh instruction
  ├─ validate selected paths / branch / configured remote
  ├─ execute one noninteractive Git command
  └─ return fresh repository state → release queue
```

cwd、仓库根目录、Git directory 和 common directory 都必须位于真实 `WORKSPACE_DIR`
边界内；文件路径禁止绝对路径、`..`、`.git` 与逃逸符号链接。删除文件会校验仍存在的
父目录。Git 参数使用 `execFile` 数组与 `--literal-pathspecs`，不经 shell；清除可覆盖
仓库位置的继承 Git 环境。Git 子进程本地操作超时 15 秒，远端操作超时 60 秒，普通输出
最多 4 MiB；远端使用非交互认证、SSH batch mode，不弹出编辑器。错误保留可操作的
Git 说明，并脱敏 URL 中的用户名/密码。

- 暂存/取消暂存只修改 index；支持未创建首个提交的仓库，不删除工作文件。
- 提交仅使用已暂存内容，保留配置的作者身份与 hooks。缺少身份、冲突、hooks 或签名失败
  直接报告错误；rebase / cherry-pick 须先在终端完成。
- 分支切换不强制覆盖修改；远端分支首次切换使用 tracking branch。
- `set-upstream` 的 `branch` 只接受现存的远程分支名；要求当前为已有提交的本地分支。
  使用完整 `refs/remotes/` 引用更新当前分支的 upstream，避免同名本地分支歧义；
  不切换 HEAD、不修改 index 或工作文件，也不执行远端网络操作。
- Pull 只允许干净工作区、有 upstream 的分支，使用 `--ff-only --no-rebase` 且禁用自动
  stash。分叉返回错误，保留本地 HEAD；Fetch 可能已经更新远端引用。
- Push 显式发送当前 HEAD 到配置的 upstream 分支；未配置 upstream 时要求选择已配置
  remote 并设置 tracking。不 force push、不 mirror、不附带 tags。
- 非仓库返回空仓库状态；bare 仓库没有可浏览的工作树。其他读/写失败不会伪装成空状态。
- 队列协调本 Runner 进程的请求，外部终端仍由 Git index/ref locks 协调。操作前核对
  HEAD/branch 防止用户对旧 checkout 操作；对远端超时应先刷新核实结果再重试。

从 `services/agent-runner/ts/` 执行：

```sh
TMPDIR=/tmp npm test -- tests/integration/transport/http/git-repository.test.ts tests/integration/transport/http/git-status.test.ts
```

测试创建独立临时真实 Git 仓库和本地 bare remote，覆盖未出生分支、暂存/取消暂存、
提交、两侧内容、空/二进制/大文件、重命名/删除、分页、分支、detached HEAD、worktree、
合并冲突、第一父提交 diff、workspace/path 边界、旧 HEAD、Git 环境隔离、缺少身份、
Publish / Fetch / Pull / Push、远端 tracking branch 和非快进拒绝；不操作用户仓库。
