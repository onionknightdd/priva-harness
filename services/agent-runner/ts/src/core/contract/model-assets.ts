import type { ResourceQuery } from '../resource/resource-catalog.js'
import type { UserFileInfo } from '../resource/user-file.js'

export type ModelSource = { readonly kind: 'file'; readonly path: string }
  | ({ readonly kind: 'skill'; readonly skillId: string; readonly path: string } & ResourceQuery)

export interface ModelAssetInfo extends UserFileInfo {
  readonly pointCloud: { readonly copc: boolean } | null
}

export interface ModelAssets {
  inspect(source: ModelSource): Promise<ModelAssetInfo>
  resolve(source: ModelSource, resource?: string): Promise<UserFileInfo>
}

export interface PointCloudJob {
  readonly id: string
  readonly status: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled'
  readonly revision: string
  readonly error?: string
  readonly url?: string
  readonly consumerId?: string
}

export interface PointClouds {
  prepare(source: ModelSource): Promise<PointCloudJob>
  get(id: string): Promise<PointCloudJob>
  cancel(id: string, consumerId: string): Promise<PointCloudJob>
  asset(id: string): Promise<UserFileInfo>
  release(id: string): void
  close(): Promise<void>
}
