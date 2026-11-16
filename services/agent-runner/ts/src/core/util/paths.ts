import path from 'node:path'

/**
 * Resolve `target` against `root` and return it only when it names a strict
 * descendant. A name that merely begins with dots, such as `..draft.png`, is
 * a descendant; only a `..` path segment leaves the root.
 */
export function resolveInside(root: string, target: string): string | undefined {
  const base = path.resolve(root)
  const resolved = path.resolve(base, target)
  const relative = path.relative(base, resolved)
  const escapes = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  return relative === '' || escapes ? undefined : resolved
}
