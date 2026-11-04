import { createServer, type Server } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'

export interface SecretServer {
  /** Base URL of the loopback listener, e.g. `http://127.0.0.1:54321`. */
  endpoint: string
  /** Bearer token; handed to the child environment only, never logged. */
  token: string
  /** Stops serving immediately; idempotent. */
  close: () => void
}

function authorized(req: { headers: Record<string, string | string[] | undefined> }, token: Buffer): boolean {
  const header = req.headers.authorization
  const presented = typeof header === 'string' && header.startsWith('Bearer ')
    ? Buffer.from(header.slice('Bearer '.length))
    : Buffer.alloc(0)
  return presented.length === token.length && timingSafeEqual(presented, token)
}

/**
 * Loopback-only value server for `run --serve` (aws-vault `--ecs-server`
 * style). Values stay in this process: children receive only the endpoint and
 * a random bearer token, then fetch keys on demand. The listener shares the
 * parent's lifecycle — closing it (or the parent exiting) destroys it, so the
 * server dies with the child tree.
 */
export async function startSecretServer(values: Record<string, string>): Promise<SecretServer> {
  const token = randomBytes(24).toString('base64url')
  const tokenBuffer = Buffer.from(token)

  const server: Server = createServer((req, res) => {
    if (!authorized(req, tokenBuffer)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('unauthorized')
      return
    }
    const path = (req.url || '').split('?')[0]
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('method not allowed')
      return
    }
    const match = /^\/key\/(.+)$/.exec(path)
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('not found')
      return
    }
    let key: string
    try {
      key = decodeURIComponent(match[1])
    } catch {
      // Malformed percent-encoding (/key/%, /key/%ZZ) must answer 400, never
      // an uncaught exception that would take down the whole run process.
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('bad request')
      return
    }
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('unknown key')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(values[key])
  })

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('[morphix-env] Secret server did not receive a loopback port.')
  }

  let closed = false
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    token,
    close: () => {
      if (closed) return
      closed = true
      server.close()
      // Keep-alive sockets would otherwise hold the process open.
      const withConnections = server as Server & { closeAllConnections?: () => void }
      if (typeof withConnections.closeAllConnections === 'function') withConnections.closeAllConnections()
    },
  }
}
