import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Tests run against both the repo checkout and the installed profile copy:
//   node --test test/plugin.test.js
//   DRILLR_PLUGIN_INDEX=~/.dsh/profiles/desktop/node_modules/dsh-drillr/index.js node --test test/plugin.test.js
const here = path.dirname(fileURLToPath(import.meta.url))
const target = process.env.DRILLR_PLUGIN_INDEX || path.join(here, '..', 'index.js')

const plugin = await import(pathToFileURL(path.resolve(target)).href)
const { apply, normalizeKey, probeKey, MCP_URL, STATUS_PATH, KEY_PATH, SKILL } = plugin

const GOOD = 'drl_75a85025_YkhVqPWfjF9syLvjbV45sGqFkGPD7wV1'
const REAL_FETCH = globalThis.fetch

function fakeResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => body }
}

function setup({ skills = true } = {}) {
  const store = new Map()
  const routes = new Map()
  const providers = []
  const ctx = {
    // Cordis optional injection: the callback runs only when the host has the services.
    inject: (names, callback) => {
      if (names.includes('skills') && skills) callback({ skills: { registerProvider: (factory) => void providers.push(factory()) } })
    },
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
    // Only DSH's fenced Fetch registry exists here: a raw webServer route would throw.
    connection: {
      fetch: {
        register: (route) => {
          assert.ok(!routes.has(route.path), `duplicate route ${route.path}`)
          routes.set(route.path, route)
        },
      },
    },
    logger: { warn: () => {} },
  }
  apply(ctx)
  return { store, routes, providers }
}

/** Dispatch like DSH's /api channel: exact path, declared method, WHATWG Request in and Response out. */
async function call(routes, method, pathname, body) {
  const route = routes.get(pathname)
  if (!route || !route.methods.includes(method)) return { status: 404 }
  const init = { method }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
    init.headers = { 'content-type': 'application/json' }
  }
  const res = await route.fetch(new Request('http://dsh.internal' + pathname, init))
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : undefined }
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
  const { store, routes } = setup()
  const out = await call(routes, 'POST', KEY_PATH, { key: 'https://admin.drillr.ai/analytics/visitors?from=2026-11-18' })
  assert.equal(out.status, 400)
  assert.equal(out.body.error, 'url')
  assert.equal(store.size, 0)
})

test('a rejected key keeps the previous working key', async () => {
  const { store, routes } = setup()
  globalThis.fetch = async () => fakeResponse(200, JSON.stringify({ result: { serverInfo: { name: 'drillr-data' } } }))
  const first = await call(routes, 'POST', KEY_PATH, { key: GOOD })
  assert.equal(first.status, 200)
  assert.equal(first.body.configured, true)
  assert.equal(store.get('DRILLR_API_KEY'), GOOD)

  globalThis.fetch = async () => fakeResponse(401, 'unauthorized')
  const second = await call(routes, 'POST', KEY_PATH, { key: 'drl_deadbeef_wrongwrongwrong' })
  assert.equal(second.status, 400)
  assert.equal(second.body.error, 'rejected')
  assert.equal(store.get('DRILLR_API_KEY'), GOOD, 'previous key must survive')
})

test('network failure is reported without overwriting the key', async () => {
  const { store, routes } = setup()
  globalThis.fetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND')
  }
  const out = await call(routes, 'POST', KEY_PATH, { key: GOOD })
  assert.equal(out.status, 503)
  assert.equal(out.body.error, 'unreachable')
  assert.equal(store.size, 0)
})

test('status and delete round-trip', async () => {
  const { store, routes } = setup()
  const empty = await call(routes, 'GET', STATUS_PATH)
  assert.equal(empty.status, 200)
  assert.equal(empty.body.configured, false)
  assert.equal(empty.body.toolsReady, false)

  globalThis.fetch = async () => fakeResponse(200, JSON.stringify({ result: {} }))
  await call(routes, 'POST', KEY_PATH, { key: GOOD })
  const saved = await call(routes, 'GET', STATUS_PATH)
  assert.equal(saved.body.configured, true)
  assert.equal(saved.body.source, 'file')

  const removed = await call(routes, 'DELETE', KEY_PATH)
  assert.equal(removed.status, 200)
  assert.equal(removed.body.configured, false)
  assert.equal(store.size, 0)
})

test('the probe targets the gateway the profile is configured with', () => {
  assert.equal(MCP_URL, 'https://gateway.drillr.ai/mcp/data')
})

test('settings routes are registered only through the DSH access check', () => {
  assert.deepEqual(plugin.inject, ['connection', 'credentials'], 'no raw webServer access')
  const { routes } = setup()
  assert.deepEqual([...routes.keys()].sort(), ['/api/drillr/key', '/api/drillr/status'])
  for (const route of routes.values()) assert.ok(route.path.startsWith('/api/'), 'Fetch routes must sit under /api')
  assert.deepEqual(routes.get(STATUS_PATH).methods, ['GET'])
  assert.deepEqual(routes.get(KEY_PATH).methods, ['POST', 'DELETE'])
})

test('an oversized or malformed body is refused before the gateway is called', async () => {
  const { store, routes } = setup()
  let probed = false
  globalThis.fetch = async () => {
    probed = true
    return fakeResponse(200, JSON.stringify({ result: {} }))
  }
  const big = await call(routes, 'POST', KEY_PATH, JSON.stringify({ key: GOOD, pad: 'x'.repeat(5000) }))
  assert.equal(big.status, 413)
  const bad = await call(routes, 'POST', KEY_PATH, '{not json')
  assert.equal(bad.status, 400)
  assert.equal(bad.body.error, 'invalid-request')
  assert.equal(probed, false)
  assert.equal(store.size, 0)
})

test('the research skill is offered through the skill registry and loads its guide', async () => {
  const { providers } = setup()
  assert.equal(providers.length, 1)
  const [provider] = providers
  assert.equal(provider.name, 'dsh-drillr')
  const [candidate] = await provider.list()
  assert.equal(candidate.name, 'drillr-financial-research')
  assert.match(candidate.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  assert.ok(candidate.description.length > 0 && candidate.description.length <= 1024)
  const skill = await provider.get(candidate, {})
  assert.equal(skill.name, SKILL.name)
  assert.equal(skill.source, 'bundled')
  assert.ok(!('rank' in skill) && !('locator' in skill), 'loaded definition drops catalog-only fields')
  assert.match(skill.content, /get_table_schema/)
  assert.match(skill.content, /00700\.HK/)
})

test('a host without a skill registry still gets the settings routes', () => {
  const { routes, providers } = setup({ skills: false })
  assert.equal(providers.length, 0)
  assert.equal(routes.size, 2)
})
