import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import { array } from 'zod'

import {
  clientReplySchema, computerDirectory, controlPath, deviceInfoSchema, EXIT_LINE, frame, readLines, WORKER_LINE_BYTES,
  type DeviceInfo, type DeviceMethod,
} from './protocol.js'

/** The MCP stream of a device's worker. It ends when the device, the worker or this side closes it. */
export interface WorkerConnection {
  send(line: string): void
  close(): void
  onLine?: (line: string) => void
  /** Called once, with the device's reason when it gave one. */
  onClose?: (reason: string) => void
}

export class ComputerClient {
  constructor(private readonly directory = computerDirectory()) {}

  async list(): Promise<DeviceInfo[]> {
    return array(deviceInfoSchema).parse(await this.call({ method: 'list' }))
  }

  status(deviceId: string): Promise<unknown> {
    return this.call({ method: 'status', deviceId })
  }

  /** Start the device's worker and keep its stream for this caller. */
  async open(deviceId: string): Promise<WorkerConnection> {
    const socket = await this.connect()
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      let connection: WorkerConnection | undefined
      let reason = 'The connection to the device closed.'
      socket.once('error', (error) => { if (!connection) reject(error) })
      socket.once('close', () => {
        if (connection) connection.onClose?.(reason)
        else reject(new Error('Computer broker connection closed'))
      })
      socket.setTimeout(35_000, () => socket.destroy(new Error('Computer broker request timed out')))
      readLines(socket, (line) => {
        if (connection) {
          if (line.startsWith(EXIT_LINE)) reason = line.slice(EXIT_LINE.length)
          else connection.onLine?.(line)
          return
        }
        const response = clientReplySchema.parse(JSON.parse(line))
        if (response.id !== id) throw new Error('Unexpected response ID')
        if (!response.ok) { reject(new Error(response.error)); socket.destroy(); return }
        socket.setTimeout(0)
        connection = {
          send: (output) => { if (!socket.destroyed) socket.write(`${output}\n`) },
          close: () => socket.destroy(),
        }
        resolve(connection)
      }, () => socket.destroy(new Error('Invalid computer broker response')), WORKER_LINE_BYTES)
      socket.write(frame({ method: 'open', deviceId, id }))
    })
  }

  private async connect(): Promise<Socket> {
    const path = await controlPath(this.directory)
    return new Promise((resolve, reject) => {
      const socket = createConnection(path)
      socket.once('connect', () => { socket.off('error', reject); resolve(socket) })
      socket.once('error', reject)
    })
  }

  private async call(request: { method: DeviceMethod | 'list'; deviceId?: string }): Promise<unknown> {
    const socket = await this.connect()
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      socket.once('error', reject)
      socket.once('close', () => reject(new Error('Computer broker connection closed')))
      socket.setTimeout(35_000, () => socket.destroy(new Error('Computer broker request timed out')))
      readLines(socket, (line) => {
        const response = clientReplySchema.parse(JSON.parse(line))
        if (response.id !== id) throw new Error('Unexpected response ID')
        if (response.ok) resolve(response.value)
        else reject(new Error(response.error))
        socket.destroy()
      }, () => socket.destroy(new Error('Invalid computer broker response')), WORKER_LINE_BYTES)
      socket.write(frame({ ...request, id }))
    })
  }
}
