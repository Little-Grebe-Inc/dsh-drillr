// drillr settings page for DeepSeek Harness (browser half).
// Saves the drillr API key into the DSH credential store through the host
// Fetch routes in index.js (inside DSH's access check). The ModuleLoader id must equal the package name.
window.__ModuleLoader__.load({
  id: 'dsh-drillr',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useState } = React

    // utm_* lets drillr count visits and sign-ups that came from this page.
    const UTM = '?utm_source=dsh&utm_medium=plugin&utm_content=settings'
    const KEYS_URL = 'https://drillr.ai/account/api-keys' + UTM
    const DOCS_URL = 'https://drillr.ai/docs/mcp' + UTM

    const DICTS = {
      en: {
        label: 'drillr',
        title: 'drillr financial data',
        intro: 'drillr gives the agent financial data and research tools for US, Japan and China A-share equities: filings with full-text and fact search, read-only SQL over financial tables, company discovery, news and research signals.',
        step: 'Create an API key at drillr.ai, paste it below and save. The key is checked and tried against the gateway before it is stored, so a wrong value cannot break a working connection. It is stored in the DSH credential store on this computer; the drillr tools (mcp__drillr__*) connect once it is saved.',
        createKey: 'Create an API key',
        docs: 'Tool reference',
        keyLabel: 'drillr API key',
        placeholder: 'drl_…',
        save: 'Save key',
        remove: 'Remove key',
        status: 'Key',
        notSet: 'not set',
        set: 'saved',
        tools: 'Tools',
        toolsReady: 'connected',
        toolsWaiting: 'not connected yet (refresh in a few seconds)',
        saved: 'Saved. Ask the agent, for example: "Use drillr to look up the ticker for Apple".',
        removed: 'Removed.',
        loading: 'Loading…',
        errors: {
          empty: 'Paste a key first.',
          url: 'That is a web address, not an API key. Open drillr.ai/account/api-keys, copy the key itself and paste it here.',
          invalid: 'This does not look like an API key: use the single token shown on drillr.ai.',
          format: 'drillr keys start with drl_ or dgr_. Copy the whole key from drillr.ai/account/api-keys.',
          rejected: 'drillr rejected this key (revoked or mistyped). Your previous key is unchanged.',
          unreachable: 'Could not reach gateway.drillr.ai. Check the network and try again; your previous key is unchanged.',
          failed: 'Request failed: ',
        },
      },
      zh: {
        label: 'drillr',
        title: 'drillr 金融数据',
        intro: 'drillr 为智能体提供美股、日股、A 股的金融数据与研究工具：公司公告与财报的全文和事实检索、财务报表只读 SQL、公司发现、新闻与研究信号。',
        step: '在 drillr.ai 创建 API key，粘贴到下面并保存。保存前会先校验格式并试连 gateway，失败不会覆盖正在用的 key。key 保存在本机 DSH 的凭据库里；保存后 drillr 工具（mcp__drillr__*）会自动连上。',
        createKey: '创建 API key',
        docs: '工具说明',
        keyLabel: 'drillr API key',
        placeholder: 'drl_…',
        save: '保存 key',
        remove: '删除 key',
        status: 'Key',
        notSet: '未设置',
        set: '已保存',
        tools: '工具',
        toolsReady: '已连接',
        toolsWaiting: '尚未连接（几秒后刷新）',
        saved: '已保存。可以直接问智能体，例如：「用 drillr 查一下苹果公司的股票代码」。',
        removed: '已删除。',
        loading: '加载中…',
        errors: {
          empty: '请先粘贴 key。',
          url: '这是网页地址，不是 API key。请打开 drillr.ai/account/api-keys，复制 key 本身粘贴进来。',
          invalid: '这不像 API key：请粘贴 drillr.ai 上显示的完整 key。',
          format: 'drillr 的 key 以 drl_ 或 dgr_ 开头，请从 drillr.ai/account/api-keys 复制完整的一串。',
          rejected: 'drillr 拒绝了这把 key（已撤销或填写有误）。原来的 key 未被改动。',
          unreachable: '连不上 gateway.drillr.ai，请检查网络后重试。原来的 key 未被改动。',
          failed: '请求失败：',
        },
      },
    }

    function dict() {
      const lang = String(document.documentElement.lang || navigator.language || 'zh').toLowerCase()
      return lang.indexOf('zh') === 0 ? DICTS.zh : DICTS.en
    }

    const S = {
      root: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640, color: 'var(--dsw-alias-label-primary)', fontSize: 13, lineHeight: 1.55 },
      title: { fontSize: 16, fontWeight: 600, margin: 0 },
      muted: { color: 'var(--dsw-alias-label-secondary)', margin: 0 },
      links: { display: 'flex', gap: 16 },
      link: { color: 'var(--dsw-alias-label-link, #4d6bfe)', cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit' },
      row: { display: 'flex', gap: 8, alignItems: 'center' },
      input: { flex: 1, minWidth: 0, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', font: 'inherit' },
      primary: { padding: '7px 14px', borderRadius: 8, border: 'none', background: '#4d6bfe', color: '#fff', font: 'inherit', cursor: 'pointer' },
      secondary: { padding: '7px 14px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' },
      meta: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', margin: 0 },
      ok: { color: 'var(--dsw-alias-state-success-primary, #22a06b)', margin: 0 },
      bad: { color: 'var(--dsw-alias-state-error-primary, #d93026)', margin: 0 },
    }

    function request(method, path, body) {
      // Relative, like DSH's own pages: the request goes to the host's /api
      // channel with the session cookie and passes the DSH access check.
      return fetch('api/drillr' + path, {
        method,
        cache: 'no-store',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      }).then((res) => res.json().catch(() => ({})).then((json) => {
        if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status)
        return json
      }))
    }

    function DrillrSettings() {
      const t = dict()
      const [status, setStatus] = useState(null)
      const [key, setKey] = useState('')
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      const [error, setError] = useState('')

      const describeError = (err) => {
        const code = err && err.message
        return t.errors[code] || t.errors.failed + String(code || err)
      }

      const load = () => request('GET', '/status').then(setStatus).catch((err) => setError(describeError(err)))
      useEffect(() => { load() }, [])

      const run = (method, body, done) => {
        if (busy) return
        setBusy(true)
        setMessage('')
        setError('')
        request(method, '/key', body)
          .then((next) => {
            setStatus(next)
            setKey('')
            setMessage(done)
            setTimeout(load, 3000)
          })
          .catch((err) => setError(describeError(err)))
          .then(() => setBusy(false))
      }

      return h('div', { style: S.root },
        h('h3', { style: S.title }, t.title),
        h('p', { style: S.muted }, t.intro),
        h('p', { style: S.muted }, t.step),
        h('div', { style: S.links },
          h('button', { type: 'button', style: S.link, onClick: () => window.open(KEYS_URL, '_blank', 'noopener') }, t.createKey + ' ↗'),
          h('button', { type: 'button', style: S.link, onClick: () => window.open(DOCS_URL, '_blank', 'noopener') }, t.docs + ' ↗')
        ),
        h('div', { style: S.row },
          h('input', {
            type: 'password',
            autoComplete: 'off',
            spellCheck: false,
            'aria-label': t.keyLabel,
            placeholder: t.placeholder,
            value: key,
            style: S.input,
            onChange: (event) => setKey(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') run('POST', { key }, t.saved) },
          }),
          h('button', { type: 'button', style: S.primary, disabled: busy, onClick: () => run('POST', { key }, t.saved) }, t.save),
          status && status.configured
            ? h('button', { type: 'button', style: S.secondary, disabled: busy, onClick: () => run('DELETE', null, t.removed) }, t.remove)
            : null
        ),
        status
          ? h('dl', { style: S.meta },
            h('dt', null, t.status), h('dd', { style: { margin: 0 } }, status.configured ? t.set + (status.masked ? ' (' + status.masked + ')' : '') : t.notSet),
            h('dt', null, t.tools), h('dd', { style: { margin: 0 } }, status.toolsReady ? t.toolsReady : t.toolsWaiting)
          )
          : h('p', { style: S.muted }, t.loading),
        message ? h('p', { style: S.ok }, message) : null,
        error ? h('p', { style: S.bad }, error) : null
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'drillr',
          order: 90,
          label: () => dict().label,
        }, DrillrSettings)))
      },
    }
  },
})
