import { join } from 'node:path'

const PI_PRODUCT_DIRECTORY = '.bambuddy'

export function piGlobalDir(harnessHome: string): string {
  return join(harnessHome, PI_PRODUCT_DIRECTORY)
}

export function piProjectDir(cwd: string): string {
  return join(cwd, PI_PRODUCT_DIRECTORY)
}
