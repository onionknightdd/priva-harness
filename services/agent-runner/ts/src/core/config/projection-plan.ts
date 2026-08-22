import type { ProviderId } from '../contract/agent-provider.js'

export type ProjectionOpKind = 'write' | 'delete'

export interface ProjectionOp {
  readonly kind: ProjectionOpKind
  readonly path: string
  readonly content?: string
}

export interface ProjectionPlan {
  readonly provider: ProviderId
  readonly ops: readonly ProjectionOp[]
  readonly unsupported: readonly string[]
}

export function emptyProjectionPlan(provider: ProviderId): ProjectionPlan {
  return { provider, ops: [], unsupported: [] }
}

export function unhandledResourceSlice(
  resource: string,
  present: boolean,
): Pick<ProjectionPlan, 'ops' | 'unsupported'> {
  return {
    ops: [],
    unsupported: present ? [resource] : [],
  }
}

export function mergeProjectionSlices(
  provider: ProviderId,
  slices: readonly Pick<ProjectionPlan, 'ops' | 'unsupported'>[],
): ProjectionPlan {
  return {
    provider,
    ops: slices.flatMap((slice) => slice.ops),
    unsupported: slices.flatMap((slice) => slice.unsupported),
  }
}
