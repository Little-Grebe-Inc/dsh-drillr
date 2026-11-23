/**
 * Host half of the drillr bundle.
 *
 * The MCP connection is the official `@deepseek-ai/dsh-mcp-client` row in
 * `cordis.patch.yml`; it sends `Authorization: Bearer ${credential:DRILLR_API_KEY}`
 * and waits until that credential exists. This plugin only lets the drillr settings
 * page (client.js) save, inspect and remove that credential through the DSH
 * credential store, so the key never lands in a config file or in the chat.
 *
 * The page talks to this plugin over DSH's own Fetch routes
 * (`ctx.connection.fetch.register`), not raw `webServer` routes, so every call
 * passes the DSH access check first: the Host/Origin fence plus the signed
 * browser-session cookie, owner Peer only. A web page open in the same browser
 * can neither read the key status nor replace or delete the key.
 *
 * A key is saved only after it passes two checks: it has to look like a drillr
 * key, and a live `initialize` call to the gateway has to accept it. A pasted
 * URL, a typo or a revoked key therefore can never replace a working one.
 */
export const name = 'dsh-drillr'
export const inject = ['connection', 'credentials']

const REF = 'DRILLR_API_KEY'
/** Fetch routes live under DSH's `/api` channel, inside its access check. */
export const STATUS_PATH = '/api/drillr/status'
export const KEY_PATH = '/api/drillr/key'
const MAX_BODY_BYTES = 4096
const MAX_KEY_LENGTH = 512
const PROBE_TOOL = 'mcp__drillr__ticker_lookup'

/** The hosted MCP endpoint the profile's MCP client row points at. */
export const MCP_URL = 'https://gateway.drillr.ai/mcp/data'

/** drillr keys are one token: `drl_<id>_<secret>` or `dgr_live_<id>_<secret>`. */
const KEY_PATTERN = /^(?:drl|dgr)_[A-Za-z0-9_]+$/

// The gateway answers `initialize` and `tools/list` without a key and only
// checks the token on `tools/call`, so the probe has to be a real (cheap) call.
const PROBE_CALL = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'ticker_lookup', arguments: { query: 'AAPL', market: 'us' } },
}

const PROBE_TIMEOUT_MS = 10_000

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Validate a pasted key without touching the network.
 * Returns `{ key }` or `{ error }` with one of: empty | url | invalid | format.
 */
export function normalizeKey(raw) {
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (!key) return { error: 'empty' }
  // Browser URLs are the most common wrong paste (the address bar instead of the key page).
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(key)) return { error: 'url' }
  if (key.length > MAX_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key)) return { error: 'invalid' }
  if (!KEY_PATTERN.test(key)) return { error: 'format' }
  return { key }
}

/** Pull the JSON-RPC payload out of a plain JSON or `text/event-stream` body. */
function parsePayload(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    // Streamable HTTP servers may answer with SSE frames.
  }
  for (const line of trimmed.split('\n').reverse()) {
    const candidate = line.trim()
    if (!candidate.startsWith('data:')) continue
    try {
      return JSON.parse(candidate.slice(5).trim())
    } catch {
      // keep scanning older frames
    }
  }
  return null
}

/**
 * Ask the gateway to accept `key` before it is stored.
 * Returns `{ ok: true }` or `{ error: rejected | unreachable }`.
 */
export async function probeKey(key, fetchImpl = globalThis.fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetchImpl(MCP_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(PROBE_CALL),
      signal: controller.signal,
    })
    if (res.status === 401 || res.status === 403) return { error: 'rejected' }
    if (!res.ok) return { error: 'unreachable' }
    const payload = parsePayload(await res.text())
    if (!payload || payload.error || !payload.result) return { error: 'rejected' }
    return { ok: true }
  } catch {
    return { error: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

export function apply(ctx) {
  const toolsReady = () => {
    try {
      const tools = ctx.get('tools')
      return Boolean(tools && typeof tools.get === 'function' && tools.get(PROBE_TOOL))
    } catch {
      return false
    }
  }

  const status = async () => {
    const info = await ctx.credentials.describe(REF)
    return {
      configured: Boolean(info && info.configured),
      masked: info && typeof info.masked === 'string' ? info.masked : undefined,
      source: info && typeof info.source === 'string' ? info.source : undefined,
      toolsReady: toolsReady(),
    }
  }

  const saveKey = async (request) => {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return json(413, { error: 'invalid-request' })
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return json(400, { error: 'invalid-request' })
    }
    const { key, error } = normalizeKey(parsed && parsed.key)
    if (error) return json(400, { error })
    const probe = await probeKey(key)
    if (!probe.ok) return json(probe.error === 'rejected' ? 400 : 503, { error: probe.error })
    await ctx.credentials.set(REF, key)
    return json(200, await status())
  }

  const guarded = (handler) => async (request) => {
    try {
      return await handler(request)
    } catch (err) {
      ctx.logger.warn('drillr: settings request failed: %s', err && err.message ? err.message : String(err))
      return json(500, { error: 'internal' })
    }
  }

  ctx.connection.fetch.register({
    path: STATUS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guarded(async () => json(200, await status())),
  })
  ctx.connection.fetch.register({
    path: KEY_PATH,
    methods: ['POST', 'DELETE'],
    requestBody: 'buffered',
    fetch: guarded(async (request) => {
      if (request.method === 'POST') return saveKey(request)
      await ctx.credentials.unset(REF)
      return json(200, await status())
    }),
  })
}
