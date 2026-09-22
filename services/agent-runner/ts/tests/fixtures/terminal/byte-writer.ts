import { createInterface } from 'node:readline'

// A controllable TUI: tests send JSON byte arrays on stdin, without shell
// echo or terminal line discipline altering the output under test.
process.stdin.setRawMode(true)
createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
  process.stdout.write(Buffer.from(JSON.parse(line) as number[]))
})
process.stdout.write(process.argv[2] === undefined ? 'READY' : Buffer.from(process.argv[2], 'base64'))
