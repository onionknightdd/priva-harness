declare module "occt-import-js" {
  export default function initialize(options?: { locateFile?: (path: string) => string }): Promise<import("./model-cad-types").OcctModule>
}
