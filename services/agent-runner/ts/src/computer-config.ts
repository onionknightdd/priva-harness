import { isIP } from 'node:net'

export interface ComputerConfig {
  readonly host: string
  readonly port: number
  readonly allowedOrigins: readonly string[]
}

export function readComputerConfig(env: NodeJS.ProcessEnv): ComputerConfig | undefined {
  const host = env['COMPUTER_VNC_HOST']?.trim()
  const rawPort = env['COMPUTER_VNC_PORT']?.trim()
  if (host === undefined && rawPort === undefined) return undefined
  if (!host || !rawPort) {
    throw new TypeError('COMPUTER_VNC_HOST and COMPUTER_VNC_PORT must both be configured')
  }
  if (isIP(host) === 0 && !/^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(host)) {
    throw new TypeError('COMPUTER_VNC_HOST must be a hostname or IP address, without a URL or port')
  }
  const port = Number(rawPort)
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('COMPUTER_VNC_PORT must be an integer between 1 and 65535')
  }
  const allowedOrigins = (env['COMPUTER_ALLOWED_ORIGINS'] ?? '').split(',')
    .map((origin) => origin.trim()).filter(Boolean).map((origin) => {
      let url: URL
      try { url = new URL(origin) } catch {
        throw new TypeError('COMPUTER_ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins')
      }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) {
        throw new TypeError('COMPUTER_ALLOWED_ORIGINS must contain only HTTP(S) origins, without paths or credentials')
      }
      return url.origin
    })
  return Object.freeze({ host, port, allowedOrigins: Object.freeze([...new Set(allowedOrigins)]) })
}
