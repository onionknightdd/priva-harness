import { cp, rm } from 'node:fs/promises'

const source = new URL('../src/resources/plugins/', import.meta.url)
const destination = new URL('../dist/resources/plugins/', import.meta.url)
await rm(destination, { recursive: true, force: true })
// Plugin runtimes carry relative package symlinks; rewriting them to absolute
// source paths would point the built copy back into src.
await cp(source, destination, { recursive: true, verbatimSymlinks: true })
