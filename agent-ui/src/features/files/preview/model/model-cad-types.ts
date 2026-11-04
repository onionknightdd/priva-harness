export type CadNode = { name: string; meshes: number[]; children: CadNode[] }
export type CadMesh = {
  name: string
  color?: number[]
  brep_faces: { first: number; last: number; color: number[] | null }[]
  attributes: { position: { array: number[] }; normal?: { array: number[] } }
  index: { array: number[] }
}
export type CadResult = { success: boolean; root: CadNode; meshes: CadMesh[] }
export type OcctModule = {
  ReadStepFile: (data: Uint8Array, options: Record<string, unknown>) => CadResult
  ReadIgesFile: (data: Uint8Array, options: Record<string, unknown>) => CadResult
}
