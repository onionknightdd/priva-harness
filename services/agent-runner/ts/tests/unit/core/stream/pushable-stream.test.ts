import { describe, expect, it } from 'vitest'

import { PushableStream } from '../../../../src/core/stream/pushable-stream.js'

describe('PushableStream', () => {
  it('yields pushed values then ends on close', async () => {
    const stream = new PushableStream<number>()
    const values: number[] = []
    const consume = (async () => {
      for await (const value of stream) {
        values.push(value)
      }
    })()

    stream.push(1)
    stream.push(2)
    stream.close()
    await consume

    expect(values).toEqual([1, 2])
  })

  it('ignores push after close', async () => {
    const stream = new PushableStream<string>()
    const values: string[] = []
    const consume = (async () => {
      for await (const value of stream) {
        values.push(value)
      }
    })()
    stream.close()
    stream.push('late')
    await consume
    expect(values).toEqual([])
  })

  it('rejects a second iterator', () => {
    const stream = new PushableStream<number>()
    void stream[Symbol.asyncIterator]()
    expect(() => stream[Symbol.asyncIterator]()).toThrow(
      /can only be iterated once/u,
    )
  })
})
