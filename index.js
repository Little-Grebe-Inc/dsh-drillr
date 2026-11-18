/**
 * Host half of the drillr bundle.
 *
 * The MCP connection is the official `@deepseek-ai/dsh-mcp-client` row in
 * `cordis.patch.yml`; it sends `Authorization: Bearer ${credential:DRILLR_API_KEY}`
 * and waits until that credential exists. This plugin only lets the drillr settings
 * page (client.js) save, inspect and remove that credential through the DSH
 * credential store, so the key never lands in a config file or in the chat.
 */
export const name = 'dsh-drillr'
export const inject = ['webServer', 'credentials']

const REF = 'DRILLR_API_KEY'
const PREFIX = '/drillr-api'
const MAX_BODY_BYTES = 4096
const MAX_KEY_LENGTH = 512
const PROBE_TOOL = 'mcp__drillr__ticker_lookup'

function sendJson(res, status, body) {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch {
    // The client went away; nothing to report to.
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** A key must be one header-safe token: printable ASCII without spaces. */
function normalizeKey(raw) {
  const key = typeof raw === 'string' ? raw.trim() : ''
  if (!key) return { error: 'empty' }
  if (key.length > MAX_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key)) return { error: 'invalid' }
  return { key }
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

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      try {
        const path = new URL(req.url || '/', 'http://local').pathname
        if (path === `${PREFIX}/status` && req.method === 'GET') {
          sendJson(res, 200, await status())
          return
        }
        if (path === `${PREFIX}/key` && req.method === 'POST') {
          let parsed
          try {
            parsed = JSON.parse(await readBody(req))
          } catch {
            sendJson(res, 400, { error: 'invalid-request' })
            return
          }
          const { key, error } = normalizeKey(parsed && parsed.key)
          if (error) {
            sendJson(res, 400, { error })
            return
          }
          await ctx.credentials.set(REF, key)
          sendJson(res, 200, await status())
          return
        }
        if (path === `${PREFIX}/key` && req.method === 'DELETE') {
          await ctx.credentials.unset(REF)
          sendJson(res, 200, await status())
          return
        }
        sendJson(res, 404, { error: 'not-found' })
      } catch (err) {
        ctx.logger.warn('drillr: settings request failed: %s', err && err.message ? err.message : String(err))
        sendJson(res, 500, { error: 'internal' })
      }
    },
  }))
}
