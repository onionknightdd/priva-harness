import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { array } from 'zod'

import {
  clientReplySchema, computerDirectory, controlPath, deviceInfoSchema, frame, readFrames,
  type ComputerMethod, type DeviceInfo,
} from './protocol.js'

export class ComputerClient {
  constructor(private readonly directory = computerDirectory()) {}

  async list(): Promise<DeviceInfo[]> {
    return array(deviceInfoSchema).parse(await this.call({ method: 'list' }))
  }

  request(deviceId: string, method: ComputerMethod): Promise<unknown> {
    return this.call({ method, deviceId })
  }

  private async call(request: { method: ComputerMethod | 'list'; deviceId?: string }): Promise<unknown> {
    const path = await controlPath(this.directory)
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const socket = createConnection(path)
      socket.once('connect', () => { socket.write(frame({ ...request, id })) })
      socket.once('error', reject)
      socket.once('close', () => reject(new Error('Computer broker connection closed')))
      socket.setTimeout(35_000, () => socket.destroy(new Error('Computer broker request timed out')))
      readFrames(socket, (message) => {
        const response = clientReplySchema.parse(message)
        if (response.id !== id) throw new Error('Unexpected response ID')
        if (response.ok) resolve(response.value)
        else reject(new Error(response.error))
        socket.destroy()
      }, () => socket.destroy(new Error('Invalid computer broker response')))
    })
  }
}
