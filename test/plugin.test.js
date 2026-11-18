import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Tests run against both the repo checkout and the installed profile copy:
//   node --test test/plugin.test.js
//   DRILLR_PLUGIN_INDEX=~/.dsh/profiles/desktop/node_modules/dsh-drillr/index.js node --test test/plugin.test.js
const here = path.dirname(fileURLToPath(import.meta.url))
const target = process.env.DRILLR_PLUGIN_INDEX || path.join(here, '..', 'index.js')

const { apply, normalizeKey, probeKey, MCP_URL } = await import(pathToFileURL(path.resolve(target)).href)

const GOOD = 'drl_75a85025_YkhVqPWfjF9syLvjbV45sGqFkGPD7wV1'
const REAL_FETCH = globalThis.fetch

function fakeResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => body }
}

function setup() {
  const store = new Map()
  const routes = []
  const ctx = {
    effect: (fn) => fn(),
    get: (name) => (name === 'tools' ? { get: () => false } : undefined),
    credentials: {
      describe: async (ref) => ({
        configured: store.has(ref),
        masked: store.has(ref) ? 'drl_75a85…7wV1' : undefined,
        source: 'file',
      }),
      set: async (ref, key) => void store.set(ref, key),
      unset: async (ref) => void store.delete(ref),
    },
    webServer: { register: (row) => void routes.push(row) },
    logger: { warn: () => {} },
  }
  apply(ctx)
  assert.equal(routes.length, 1, 'register exactly one settings route')
  return { store, handler: routes[0].handler }
}

function call(handler, method, url, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter()
    req.method = method
    req.url = url
    const res = {
      writeHead(status) {
        this.statusCode = status
      },
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : undefined })
      },
    }
    handler(req, res)
    setImmediate(() => {
      if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    })
  })
}

test.afterEach(() => {
  globalThis.fetch = REAL_FETCH
})

test('normalizeKey accepts drillr key shapes and trims whitespace', () => {
  assert.deepEqual(normalizeKey(`  ${GOOD}  `), { key: GOOD })
  assert.deepEqual(normalizeKey('dgr_live_41546e26_a297829926b63d730c9afb'), { key: 'dgr_live_41546e26_a297829926b63d730c9afb' })
  assert.equal(normalizeKey('').error, 'empty')
  assert.equal(normalizeKey(undefined).error, 'empty')
})

test('normalizeKey rejects a pasted URL instead of storing it', () => {
  assert.equal(normalizeKey('https://admin.drillr.ai/analytics/visitors?from=2026-11-18').error, 'url')
  assert.equal(normalizeKey('http://drillr.ai/account/api-keys').error, 'url')
})

test('normalizeKey rejects non-key strings', () => {
  assert.equal(normalizeKey('not-a-key').error, 'format')
  assert.equal(normalizeKey('abc123').error, 'format')
  assert.equal(normalizeKey('drl_').error, 'format')
  assert.equal(normalizeKey('x'.repeat(600)).error, 'invalid')
  assert.equal(normalizeKey('drl_a b').error, 'invalid')
})

test('probeKey maps gateway answers', async () => {
  globalThis.fetch = async () => fakeResponse(200, JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'drillr-data' } } }))
  assert.deepEqual(await probeKey(GOOD), { ok: true })

  globalThis.fetch = async () => fakeResponse(401, 'unauthorized')
  assert.deepEqual(await probeKey(GOOD), { error: 'rejected' })

  globalThis.fetch = async () => fakeResponse(200, JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'no' } }))
  assert.deepEqual(await probeKey(GOOD), { error: 'rejected' })

  // The gateway only checks the token on tools/call and answers 200 + {"error":"Unauthorized"} in some paths.
  globalThis.fetch = async () => fakeResponse(200, JSON.stringify({ error: 'Unauthorized' }))
  assert.deepEqual(await probeKey(GOOD), { error: 'rejected' })

  globalThis.fetch = async () => fakeResponse(200, JSON.stringify({
    result: { content: [{ type: 'text', text: '| Company | Ticker |\n| AAPL |' }] },
    jsonrpc: '2.0', id: 1,
  }))
  assert.deepEqual(await probeKey(GOOD), { ok: true })

  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED')
  }
  assert.deepEqual(await probeKey(GOOD), { error: 'unreachable' })

  globalThis.fetch = async () => ({ status: 502, ok: false, text: async () => '' })
  assert.deepEqual(await probeKey(GOOD), { error: 'unreachable' })
})

test('probeKey reads the JSON-RPC payload from an SSE frame', async () => {
  globalThis.fetch = async () => fakeResponse(200, 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"drillr-data"}}}\n\n')
  assert.deepEqual(await probeKey(GOOD), { ok: true })
})

test('saving a URL is refused and never reaches the credential store', async () => {
  const { store, handler } = setup()
  const out = await call(handler, 'POST', '/drillr-api/key', { key: 'https://admin.drillr.ai/analytics/visitors?from=2026-11-18' })
  assert.equal(out.status, 400)
  assert.equal(out.body.error, 'url')
  assert.equal(store.size, 0)
})

test('a rejected key keeps the previous working key', async () => {
  const { store, handler } = setup()
  globalThis.fetch = async () => fakeResponse(200, JSON.stringify({ result: { serverInfo: { name: 'drillr-data' } } }))
  const first = await call(handler, 'POST', '/drillr-api/key', { key: GOOD })
  assert.equal(first.status, 200)
  assert.equal(first.body.configured, true)
  assert.equal(store.get('DRILLR_API_KEY'), GOOD)

  globalThis.fetch = async () => fakeResponse(401, 'unauthorized')
  const second = await call(handler, 'POST', '/drillr-api/key', { key: 'drl_deadbeef_wrongwrongwrong' })
  assert.equal(second.status, 400)
  assert.equal(second.body.error, 'rejected')
  assert.equal(store.get('DRILLR_API_KEY'), GOOD, 'previous key must survive')
})

test('network failure is reported without overwriting the key', async () => {
  const { store, handler } = setup()
  globalThis.fetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND')
  }
  const out = await call(handler, 'POST', '/drillr-api/key', { key: GOOD })
  assert.equal(out.status, 503)
  assert.equal(out.body.error, 'unreachable')
  assert.equal(store.size, 0)
})

test('status and delete round-trip', async () => {
  const { store, handler } = setup()
  const empty = await call(handler, 'GET', '/drillr-api/status')
  assert.equal(empty.status, 200)
  assert.equal(empty.body.configured, false)
  assert.equal(empty.body.toolsReady, false)

  globalThis.fetch = async () => fakeResponse(200, JSON.stringify({ result: {} }))
  await call(handler, 'POST', '/drillr-api/key', { key: GOOD })
  const saved = await call(handler, 'GET', '/drillr-api/status')
  assert.equal(saved.body.configured, true)
  assert.equal(saved.body.source, 'file')

  const removed = await call(handler, 'DELETE', '/drillr-api/key')
  assert.equal(removed.status, 200)
  assert.equal(removed.body.configured, false)
  assert.equal(store.size, 0)
})

test('the probe targets the gateway the profile is configured with', () => {
  assert.equal(MCP_URL, 'https://gateway.drillr.ai/mcp/data')
})
