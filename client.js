/**
 * dsh-yaya-diary —— 浏览器半端（设置里的一页：左侧导航「娅娅日记」）
 * ============================================================================
 * ⭐ client bundle 不是 ESM，是自注册脚本（照 dsh-bili-scroll / dsh-meme 的约定）：
 *
 *     window.__ModuleLoader__.load({
 *       id: '<包名>',                       // 必须等于 package.json 的 name
 *       factory: (require) => { ... return { inject: [...], apply(ctx) {...} } },
 *     })
 *
 * 进「设置」：slots.inject('settings.section', () => slots.register(
 *   { name: 'settings.section', id: 'yaya-diary', order: 32, label: '娅娅日记' }, ()=>h(Panel)))
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-yaya-diary',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/yaya-diary'
    const jget = async (p) => (await fetch(API + p, { credentials: 'same-origin' })).json()
    const jpost = async (p) => (await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })).json()

    const CSS = `
.yd-root { padding: 18px 22px; max-width: 860px; font-size: 14px; line-height: 1.65; }
.yd-title { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
.yd-sub { color: var(--dsw-alias-label-secondary, #8a8a95); margin: 0 0 16px; }
.yd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 16px; }
.yd-card { border: 1px solid var(--dsw-alias-border-subtle, #9992); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.yd-k { color: var(--dsw-alias-label-secondary, #8a8a95); font-size: 12px; }
.yd-v { font-size: 15px; }
.yd-mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; word-break: break-all; }
.yd-actions { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.yd-btn { border: 1px solid var(--dsw-alias-brand-primary, #4d8cff); background: var(--dsw-alias-brand-primary, #4d8cff); color: #fff; border-radius: 8px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
.yd-btn[disabled] { opacity: .5; cursor: default; }
.yd-msg { color: var(--dsw-alias-label-secondary, #8a8a95); font-size: 13px; }
.yd-h3 { font-size: 14px; font-weight: 600; margin: 18px 0 8px; }
.yd-list { margin: 0; padding-left: 18px; }
.yd-list li { margin: 4px 0; }
.yd-log { background: var(--dsw-alias-bg-layer, #8881); border-radius: 8px; padding: 10px 12px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; max-height: 280px; overflow: auto; }
.yd-err { color: #d9534f; }
`

    function useStatus(ms) {
      const [st, setSt] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const s = await jget('/status')
            if (alive) setSt(s)
          } catch { /* 网关没起来就先空着 */ }
        }
        load()
        const t = setInterval(load, ms)
        return () => { alive = false; clearInterval(t) }
      }, [])
      return st
    }

    function Panel() {
      const st = useStatus(5000)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState('')

      const state = st?.state || {}
      const cfg = st?.config || {}
      const running = state.running === st?.today

      const onRun = async () => {
        setBusy(true)
        setMsg('')
        try {
          const r = await jpost('/run')
          setMsg(r.started ? '已经开跑啦，过一会儿看日志和日记本。' : `没开跑：${r.reason || r.error || '未知原因'}`)
        } catch (e) {
          setMsg('开跑失败：' + (e?.message || e))
        } finally {
          setBusy(false)
        }
      }

      const fmt = (iso) => {
        if (!iso) return '—'
        try { return new Date(iso).toLocaleString('zh-CN', { hour12: false }) } catch { return '—' }
      }

      return h('div', { className: 'yd-root' },
        h('h2', { className: 'yd-title' }, '娅娅日记'),
        h('p', { className: 'yd-sub' }, `每天晚上 ${cfg.hour ?? 23} 点，自动读当天的会话记录写一篇日记。`),
        h('div', { className: 'yd-grid' },
          h('div', { className: 'yd-card' },
            h('span', { className: 'yd-k' }, '今天'),
            h('b', { className: 'yd-v' }, st?.writtenToday ? '已写 ✓' : '还没写')),
          h('div', { className: 'yd-card' },
            h('span', { className: 'yd-k' }, '上次运行'),
            h('b', { className: 'yd-v' }, fmt(state.lastRunAt))),
          h('div', { className: 'yd-card' },
            h('span', { className: 'yd-k' }, '上次结果'),
            h('b', { className: 'yd-v' }, state.lastExit === undefined || state.lastExit === null ? '—' : `exit ${state.lastExit}`)),
          h('div', { className: 'yd-card' },
            h('span', { className: 'yd-k' }, '工作区'),
            h('b', { className: 'yd-v yd-mono' }, cfg.workspace || 'E:\\DS')),
        ),
        h('div', { className: 'yd-actions' },
          h('button', { className: 'yd-btn', disabled: busy || running, onClick: onRun },
            busy || running ? '正在写…' : '现在写一篇'),
          msg ? h('span', { className: 'yd-msg' }, msg) : null),
        h('h3', { className: 'yd-h3' }, '日记本'),
        h('ul', { className: 'yd-list' },
          (st?.diaryFiles || []).length
            ? st.diaryFiles.slice(0, 12).map((f) => h('li', { key: f.name },
              h('span', {}, f.name),
              h('span', { className: 'yd-mono' }, `  ${Math.max(1, Math.round(f.size / 1024))} KB`)))
            : h('li', null, '还没有日记')),
        h('h3', { className: 'yd-h3' }, '最近日志'),
        h('pre', { className: 'yd-log' }, st?.logTail || '(还没有日志)'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-yaya-diary')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'yaya-diary: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'yaya-diary', order: 32, label: '娅娅日记' },
          () => h(Panel),
        ))
      },
    }
  },
})
