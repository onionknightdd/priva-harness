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
