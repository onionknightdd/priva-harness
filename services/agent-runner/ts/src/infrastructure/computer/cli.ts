import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

import { errorMessage } from '../../core/util/errors.js'
import { startComputerBroker } from './broker.js'
import { ComputerClient } from './client.js'
import { computerDirectory, deviceIdSchema, methodSchema } from './protocol.js'

async function privateFile(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > 256 * 1024) {
      throw new Error('Expected a private regular file owned by the broker account (0600 or 0400)')
    }
    return await file.readFile()
  } finally { await file.close() }
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args
  if (command === 'serve') {
    const { values } = parseArgs({ args: rest, options: {
      'host-key': { type: 'string' }, devices: { type: 'string' }, port: { type: 'string', default: '2222' },
      'bind-address': { type: 'string', default: '127.0.0.1' },
    } })
    if (!values['host-key'] || !values.devices) throw new Error('serve needs --host-key and --devices')
    const port = z.coerce.number().int().min(1).max(65535).parse(values.port)
    const keys = z.record(deviceIdSchema, z.string()).parse(JSON.parse((await privateFile(values.devices)).toString()))
    const broker = await startComputerBroker({ directory: computerDirectory(), port, bindAddress: values['bind-address'],
      devices: keys, hostKey: await privateFile(values['host-key']) })
    let closing = false
    const stop = () => {
      if (closing) return
      closing = true
      void broker.close().catch((error: unknown) => { console.error(errorMessage(error)); process.exitCode = 1 })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    return
  }
  const client = new ComputerClient()
  if (command === 'list' && !rest.length) console.log(JSON.stringify(await client.list()))
  else if (command === 'request' && rest.length === 2) {
    console.log(JSON.stringify(await client.request(deviceIdSchema.parse(rest[0]), methodSchema.parse(rest[1]))))
  } else throw new Error('Expected serve, list, or request DEVICE status|calculator-check')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2)).catch((error: unknown) => { console.error(errorMessage(error)); process.exitCode = 1 })
}
