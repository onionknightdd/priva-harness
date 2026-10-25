import { useTranslation } from "react-i18next"

const en = {
  files: "Files", changes: "Changes", history: "History", branch: "Branch", branches: "Switch branch",
  searchBranches: "Search branches…", local: "Local", remote: "Remote",
  selectUpstream: "Select remote branch", searchRemoteBranches: "Search remote branches…",
  noRemoteBranches: "No remote branches available. Fetch remote updates first.",
  upstreamDescription: "Use the selected remote branch as the upstream for this local branch.",
  upstreamRequiresBranch: "Check out a local branch with a commit before choosing its upstream.",
  current: "Current", detached: "Detached HEAD", noBranches: "No matching branches",
  fetch: "Fetch", refresh: "Refresh Git", noRemote: "No remote configured",
  noUpstream: "No upstream branch", staged: "Staged", unstaged: "Unstaged", untracked: "Untracked", conflicted: "Conflicts",
  stage: "Stage file", unstage: "Unstage file", stageAll: "Stage all", unstageAll: "Unstage all",
  clean: "Working tree clean", cleanDescription: "Changes in this repository will appear here.",
  loading: "Loading…", retry: "Retry", notRepository: "This folder is not in a Git repository.",
  chooseRepository: "Open a repository folder to view its branches and changes.", noSelection: "Select a change or commit",
  selectionHint: "Review changes, stage files, and explore repository history.", noHistory: "No commits yet", loadMore: "Load more commits",
  diff: "Diff", source: "Source", inline: "Inline", split: "Side by side", back: "Back to Git", openFile: "Open file",
  binary: "Binary file", binaryDescription: "This file cannot be displayed as a text diff.",
  truncated: "This preview is truncated. Open the file to inspect its complete contents.",
  emptyDiff: "No text changes", emptySource: "This revision has no file content.",
  conflictDescription: "This file has unresolved conflicts. Open it to resolve them, then stage the resolved file.",
  operationBlocked: "A Git operation is in progress. Finish it in the terminal.",
  mergeProgress: "Merge in progress. Resolve conflicts, stage the files, and commit in the terminal to finish the merge.",
  changedFiles: "Changed files", noCommitFiles: "This commit has no changed files.", committed: "Committed", sourceDeleted: "Deleted file · showing previous content",
  newSource: "Current revision", oldSource: "Previous revision", loadingHistory: "Loading history…", repository: "Repository",
  noRemainingChanges: "This file no longer has changes.",
  modified: "Modified", added: "Added", deleted: "Deleted", renamed: "Renamed", copied: "Copied", typeChanged: "Type changed",
}

type GitText = { [Key in keyof typeof en]: string }

const zh: GitText = {
  files: "文件", changes: "变更", history: "历史", branch: "分支", branches: "切换分支",
  searchBranches: "搜索分支…", local: "本地", remote: "远程",
  selectUpstream: "选择远程分支", searchRemoteBranches: "搜索远程分支…",
  noRemoteBranches: "没有可选的远程分支，请先获取远端更新。",
  upstreamDescription: "将选中的远程分支设为当前本地分支的上游。",
  upstreamRequiresBranch: "请先切换到已有提交的本地分支，再选择上游。",
  current: "当前", detached: "分离 HEAD", noBranches: "没有匹配的分支",
  fetch: "获取远端更新", refresh: "刷新 Git", noRemote: "尚未配置远程仓库",
  noUpstream: "尚未设置上游分支", staged: "已暂存", unstaged: "未暂存", untracked: "未跟踪", conflicted: "冲突",
  stage: "暂存文件", unstage: "取消暂存", stageAll: "全部暂存", unstageAll: "全部取消暂存",
  clean: "工作区无改动", cleanDescription: "此仓库的文件变更会显示在这里。",
  loading: "正在加载…", retry: "重试", notRepository: "此目录不属于 Git 仓库。",
  chooseRepository: "打开仓库目录后，即可查看分支和变更。", noSelection: "选择文件变更或提交",
  selectionHint: "查看差异、暂存文件，以及浏览仓库历史。", noHistory: "尚无提交", loadMore: "加载更多提交",
  diff: "差异", source: "源码", inline: "行内", split: "并排", back: "返回 Git", openFile: "打开文件",
  binary: "二进制文件", binaryDescription: "此文件无法显示文本差异。",
  truncated: "预览内容已截断。打开文件可查看完整内容。",
  emptyDiff: "没有文本变更", emptySource: "此版本没有文件内容。",
  conflictDescription: "此文件存在未解决的冲突。请打开文件解决冲突，再暂存已解决的文件。",
  operationBlocked: "Git 操作正在进行，请在终端完成该操作。",
  mergeProgress: "合并正在进行。解决冲突并暂存文件后，在终端提交即可完成合并。",
  changedFiles: "变更文件", noCommitFiles: "此提交没有变更文件。", committed: "已提交", sourceDeleted: "文件已删除 · 显示之前的内容",
  newSource: "当前版本", oldSource: "之前版本", loadingHistory: "正在加载历史…", repository: "仓库",
  noRemainingChanges: "此文件已没有待处理的变更。",
  modified: "已修改", added: "已添加", deleted: "已删除", renamed: "已重命名", copied: "已复制", typeChanged: "类型已改变",
}

export function useGitText(): GitText {
  const { i18n } = useTranslation()
  return i18n.language.startsWith("zh") ? zh : en
}
