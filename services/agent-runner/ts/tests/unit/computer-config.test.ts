import { describe, expect, it } from 'vitest'

import { readComputerConfig } from '../../src/computer-config.js'

describe('computer configuration', () => {
  it('keeps the desktop unavailable unless its target is explicitly configured', () => {
    expect(readComputerConfig({})).toBeUndefined()
    expect(readComputerConfig({ COMPUTER_ALLOWED_ORIGINS: 'http://localhost:15173' })).toBeUndefined()
  })

  it('reads a fixed TCP target and normalizes exact origins for the UI proxy', () => {
    expect(readComputerConfig({
      COMPUTER_VNC_HOST: '127.0.0.1', COMPUTER_VNC_PORT: '5900',
      COMPUTER_ALLOWED_ORIGINS: 'http://localhost:15173/, https://agent.example, http://localhost:15173',
    })).toEqual({ host: '127.0.0.1', port: 5900, allowedOrigins: ['http://localhost:15173', 'https://agent.example'] })
    expect(readComputerConfig({ COMPUTER_VNC_HOST: '::1', COMPUTER_VNC_PORT: '5900' }))
      .toEqual({ host: '::1', port: 5900, allowedOrigins: [] })
  })

  it.each([
    { COMPUTER_VNC_HOST: 'localhost' },
    { COMPUTER_VNC_PORT: '5900' },
    { COMPUTER_VNC_HOST: '', COMPUTER_VNC_PORT: '5900' },
    { COMPUTER_VNC_HOST: 'http://localhost:5900', COMPUTER_VNC_PORT: '5900' },
    { COMPUTER_VNC_HOST: 'localhost', COMPUTER_VNC_PORT: '0' },
    { COMPUTER_VNC_HOST: 'localhost', COMPUTER_VNC_PORT: '65536' },
    { COMPUTER_VNC_HOST: 'localhost', COMPUTER_VNC_PORT: '5.9e3' },
  ])('rejects an invalid or incomplete target: %j', (env) => {
    expect(() => readComputerConfig(env)).toThrow(TypeError)
  })

  it.each(['null', '*', 'file:///tmp', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test/?q=1'])(
    'rejects an invalid allowed origin: %s', (origin) => {
      expect(() => readComputerConfig({
        COMPUTER_VNC_HOST: 'localhost', COMPUTER_VNC_PORT: '5900', COMPUTER_ALLOWED_ORIGINS: origin,
      })).toThrow(TypeError)
    },
  )
})
