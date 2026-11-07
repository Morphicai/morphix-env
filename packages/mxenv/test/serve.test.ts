import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFile } from 'child_process'
import { promisify } from 'util'
import { request as httpRequest } from 'http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { startSecretServer } from '../src/serve'

const execFileAsync = promisify(execFile)

const CLI = join(__dirname, '..', 'dist', 'cli.js')
const TMP = join(tmpdir(), `mxenv-serve-${randomUUID()}`)
const HOME = join(TMP, 'home')

function value(label: string): string {
  return `mxenv_test_${label}_${randomUUID().replace(/-/g, '')}`
}

function write(name: string, content: string): string {
  const path = join(TMP, name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  return path
}

function run(args: string[]) {
  return spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME },
    cwd: TMP,
  })
}

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(HOME, { recursive: true })
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('startSecretServer', () => {
  it('authorizes only with the bearer token and dies on close', async () => {
    const server = await startSecretServer({ MX_UNIT: 'unit-value' })
    expect(server.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(server.token.length).toBeGreaterThan(20)

    const authorized = await fetch(`${server.endpoint}/key/MX_UNIT`, {
      headers: { Authorization: `Bearer ${server.token}` },
    })
    expect(authorized.status).toBe(200)
    expect(await authorized.text()).toBe('unit-value')

    expect((await fetch(`${server.endpoint}/key/MX_UNIT`)).status).toBe(401)
    expect((await fetch(`${server.endpoint}/key/MX_UNIT`, { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401)
    expect((await fetch(`${server.endpoint}/key/NOPE`, { headers: { Authorization: `Bearer ${server.token}` } })).status).toBe(404)
    expect((await fetch(`${server.endpoint}/key/MX_UNIT`, { method: 'POST', headers: { Authorization: `Bearer ${server.token}` } })).status).toBe(405)

    server.close()
    await expect(fetch(`${server.endpoint}/key/MX_UNIT`)).rejects.toThrow()
    server.close() // idempotent
  })

  it('answers 400 for malformed percent-encoding without taking the process down', async () => {
    const server = await startSecretServer({ MX_UNIT: 'unit-value' })
    const port = Number(server.endpoint.slice('http://127.0.0.1:'.length))
    // Raw request line: fetch/URL would normalize the path before it left the
    // client, so the server-side decode path must be exercised directly.
    const rawStatus = (path: string) => new Promise<number>((resolvePromise, reject) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Authorization: `Bearer ${server.token}` },
      }, (res) => {
        res.resume()
        resolvePromise(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })

    expect(await rawStatus('/key/%')).toBe(400)
    expect(await rawStatus('/key/%ZZ')).toBe(400)

    // The listener survived: a well-formed request still succeeds.
    const healthy = await fetch(`${server.endpoint}/key/MX_UNIT`, {
      headers: { Authorization: `Bearer ${server.token}` },
    })
    expect(healthy.status).toBe(200)
    expect(await healthy.text()).toBe('unit-value')
    server.close()
  })
})

describe('mxenv run --serve', () => {
  it('keeps values out of env, serves them on demand, and destroys the server with the child', async () => {
    const expected = value('serve')
    write('.env.local', `MXTEST_SERVE=${expected}\n`)
    const child = write('child.js', `
      const fs = require('fs')
      const { execFileSync } = require('child_process')
      ;(async () => {
        const [expected, tokenPath, cli] = process.argv.slice(2)
        const endpoint = process.env.MXENV_ENDPOINT
        const token = process.env.MXENV_TOKEN
        const lines = []
        lines.push('endpoint:' + endpoint)
        lines.push('token_present:' + (token ? 'yes' : 'no'))
        lines.push('env_secret:' + (Object.values(process.env).includes(expected) ? 'LEAKED' : 'absent'))
        const auth = { headers: { Authorization: 'Bearer ' + token } }
        const direct = await fetch(endpoint + '/key/MXTEST_SERVE', auth)
        lines.push('fetch_match:' + ((await direct.text()) === expected ? 'yes' : 'no'))
        lines.push('noauth:' + (await fetch(endpoint + '/key/MXTEST_SERVE')).status)
        lines.push('unknown:' + (await fetch(endpoint + '/key/NOPE', auth)).status)
        const client = execFileSync(cli, ['fetch', 'MXTEST_SERVE'], { encoding: 'utf8', env: process.env })
        lines.push('client_match:' + (client === expected ? 'yes' : 'no'))
        try {
          execFileSync(cli, ['fetch', 'NOPE'], { encoding: 'utf8', env: process.env })
          lines.push('client_unknown:no_error')
        } catch (error) {
          lines.push('client_unknown:' + (error.status === 1 && String(error.stderr).includes('Unknown key') ? 'ok' : 'bad'))
        }
        fs.writeFileSync(tokenPath, token)
        console.log('token_echo:' + token)
        console.log(lines.join('\\n'))
        process.exit(0)
      })().catch((error) => { console.log('CHILD_ERROR:' + error.message); process.exit(1) })
    `)
    const tokenPath = write('token.txt', '')

    const result = spawnSync('node', [CLI, 'run', '--serve', '--no-infisical', '--', 'node', child, expected, tokenPath, CLI], {
      encoding: 'utf8',
      env: { ...process.env, HOME },
      cwd: TMP,
    })
    expect(result.status).toBe(0)
    const out = `${result.stdout}${result.stderr}`

    expect(out).toContain('token_present:yes')
    expect(out).toContain('env_secret:absent')
    expect(out).toContain('fetch_match:yes')
    expect(out).toContain('noauth:401')
    expect(out).toContain('unknown:404')
    expect(out).toContain('client_match:yes')
    expect(out).toContain('client_unknown:ok')
    // The token is injected, so echoing it is redacted — and the real value
    // never appears anywhere in the forwarded output.
    expect(out).toContain('token_echo:[REDACTED]')
    expect(out).not.toContain(expected)
    const token = readFileSync(tokenPath, 'utf8')
    expect(token.length).toBeGreaterThan(20)
    expect(out).not.toContain(token)

    // Server lifetime: unreachable the moment the child (and parent) exited.
    const endpoint = out.match(/endpoint:(http:\/\/127\.0\.0\.1:\d+)/)?.[1]
    expect(endpoint).toBeTruthy()
    await expect(fetch(`${endpoint}/key/MXTEST_SERVE`)).rejects.toThrow()

    // Audit stays value-free.
    const day = new Date().toISOString().slice(0, 10)
    const audit = readFileSync(join(HOME, '.mxenv', 'audit', `${day}.jsonl`), 'utf8')
    expect(audit).toContain('MXTEST_SERVE')
    expect(audit).not.toContain(expected)
    expect(audit).not.toContain(token)
  }, 20_000)
})

describe('mxenv fetch', () => {
  it('fails with a clear message outside a --serve environment', () => {
    const expected = value('fetch')
    write('.env.local', `MXTEST_FETCH=${expected}\n`)
    const result = run(['fetch', 'MXTEST_FETCH'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('MXENV_ENDPOINT')
    expect(result.stderr).not.toContain(expected)
  })

  it('requires a key name', () => {
    const result = run(['fetch'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Usage: mxenv fetch')
  })

  it('parses the key after value-taking flags (not the flag value)', async () => {
    const secret = value('flagparse')
    const server = await startSecretServer({ MXTEST_FLAGKEY: secret })
    try {
      // Async spawn: a blocking spawnSync would freeze this process's event
      // loop and starve the in-process server it queries.
      const { stdout } = await execFileAsync('node', [CLI, 'fetch', '-e', 'dev', 'MXTEST_FLAGKEY'], {
        encoding: 'utf8',
        env: { ...process.env, HOME, MXENV_ENDPOINT: server.endpoint, MXENV_TOKEN: server.token },
        cwd: TMP,
      })
      expect(stdout).toBe(secret)
    } finally {
      server.close()
    }
  })

  it('refuses a non-loopback MXENV_ENDPOINT so the token never leaves the machine', () => {
    const token = `tok_${randomUUID().replace(/-/g, '')}`
    const result = spawnSync('node', [CLI, 'fetch', 'WHATEVER'], {
      encoding: 'utf8',
      // TEST-NET-3 (documentation range): guaranteed no real listener.
      env: { ...process.env, HOME, MXENV_ENDPOINT: 'http://203.0.113.10:9999', MXENV_TOKEN: token },
      cwd: TMP,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('loopback')
    expect(result.stderr).not.toContain(token)
  })
})

describe('run without --serve', () => {
  it('still injects values into the child environment (unchanged default path)', () => {
    const expected = value('plain')
    write('.env.local', `MXTEST_PLAIN=${expected}\n`)
    const child = write('plain.js', `
      console.log('env_secret:' + (Object.values(process.env).includes(process.argv[2]) ? 'present' : 'absent'))
    `)
    const result = spawnSync('node', [CLI, 'run', '--no-infisical', '--', 'node', child, expected], {
      encoding: 'utf8',
      env: { ...process.env, HOME },
      cwd: TMP,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('env_secret:present')
    expect(result.stdout).not.toContain(expected)
  }, 20_000)
})
