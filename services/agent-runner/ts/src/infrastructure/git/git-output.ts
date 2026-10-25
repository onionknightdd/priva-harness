import type { GitBranch, GitChange, GitCommit, GitCommitFile } from '../../core/resource/git-repository.js'

export function parseChanges(output: string): GitChange[] {
  const records = output.split('\0')
  const changes: GitChange[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (!record) continue
    const indexStatus = record[0] ?? ' '
    const worktreeStatus = record[1] ?? ' '
    const renamed = [indexStatus, worktreeStatus].some((status) => status === 'R' || status === 'C')
    changes.push({
      path: record.slice(3), originalPath: renamed ? records[++i] ?? null : null,
      indexStatus, worktreeStatus,
      conflicted: indexStatus === 'U' || worktreeStatus === 'U' || ['AA', 'DD'].includes(record.slice(0, 2)),
    })
  }
  return changes
}

export function parseBranches(output: string): GitBranch[] {
  return output.split('\n').filter(Boolean).flatMap((record) => {
    const [ref = '', head = '', upstream = '', symref = ''] = record.split('\0')
    if (symref) return []
    const remote = ref.startsWith('refs/remotes/')
    return [{ name: ref.replace(/^refs\/(heads|remotes)\//u, ''), current: head === '*', remote, upstream: upstream.replace(/^refs\/(heads|remotes)\//u, '') || null }]
  })
}

export function parseCommits(output: string): GitCommit[] {
  const fields = output.split('\0')
  const commits: GitCommit[] = []
  for (let i = 0; i + 6 < fields.length; i += 7) {
    const [id = '', shortId = '', parents = '', subject = '', body = '', authorName = '', authoredAt = ''] = fields.slice(i, i + 7)
    if (id) commits.push({ id, shortId, parents: parents ? parents.split(' ') : [], subject, body: body.trimEnd(), authorName, authoredAt })
  }
  return commits
}

export function parseCommitFiles(names: string, numstat: string): GitCommitFile[] {
  const stats = new Map<string, { additions: number | null; deletions: number | null }>()
  const counts = numstat.split('\0')
  for (let i = 0; i < counts.length; i++) {
    const record = counts[i]
    if (!record) continue
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    const additions = record.slice(0, firstTab)
    const deletions = record.slice(firstTab + 1, secondTab)
    let path = record.slice(secondTab + 1)
    if (!path) { i += 2; path = counts[i] ?? '' }
    stats.set(path, { additions: additions === '-' ? null : Number(additions), deletions: deletions === '-' ? null : Number(deletions) })
  }
  const fields = names.split('\0')
  const files: GitCommitFile[] = []
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i]
    if (!status) continue
    const firstPath = fields[++i] ?? ''
    const renamed = status.startsWith('R') || status.startsWith('C')
    const path = renamed ? fields[++i] ?? '' : firstPath
    files.push({ path, originalPath: renamed ? firstPath : null, status: status[0] ?? '', ...(stats.get(path) ?? { additions: null, deletions: null }) })
  }
  return files
}
