/**
 * dsh-yaya-diary —— 每天晚上 23 点，自动让娅娅写一篇日记。
 * ============================================================================
 * 宿主端（Node）：
 *   · setInterval(60s)：到 23 点、今天还没写 → spawn 一轮 `dsh --profile headless <提示词>`
 *   · HTTP 接口 /api/yaya-diary/*：给设置页（client.js）查状态、手动触发、读日志
 *   · 状态/日志：~/.dsh/yaya-diary/{state.json,diary.log}
 *
 * 客户端半（client.js）通过 slots 注册到「设置 → 娅娅日记」（左侧导航项）。
 * ============================================================================
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import zlib from 'node:zlib'
import { homedir } from 'node:os'

export const name = 'yaya-diary'
export const inject = ['webServer']

const HOME_DIR = join(homedir(), '.dsh', 'yaya-diary')
const LOG_FILE = join(HOME_DIR, 'diary.log')
const STATE_FILE = join(HOME_DIR, 'state.json')
const DIARY_DIR = 'E:\\DS\\娅娅日记'
const COLLECT_SCRIPT = join(DIARY_DIR, 'tools', 'collect-today.mjs')
const WORKSPACE = 'E:\\DS'

const DEFAULTS = {
  enabled: true,
  hour: 23,
  workspace: WORKSPACE,
  dshBin: '',
  headlessProfile: 'headless',
}

function log(msg) {
  try {
    mkdirSync(HOME_DIR, { recursive: true })
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`, 'utf8')
  } catch { /* 日志写不进去也不能影响宿主 */ }
}

function readJson(p, def) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return def }
}

function writeJson(p, obj) {
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8')
  } catch { /* ignore */ }
}

function localDateKey(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 找 dsh 的可执行入口（照 dsh-bili-scroll 的 resolveDsh） */
function resolveDsh(cfg) {
  const explicit = String(cfg.dshBin || '').trim()
  if (explicit && existsSync(explicit)) return { command: process.execPath, args: [explicit], shell: false }

  const candidates = []
  try {
    if (process.resourcesPath) {
      candidates.push(join(process.resourcesPath, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      candidates.push(join(process.resourcesPath, 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
    }
  } catch { /* ignore */ }
  candidates.push(join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  for (const c of candidates) {
    if (c && existsSync(c)) return { command: process.execPath, args: [c], shell: false }
  }
  return { command: 'dsh', args: [], shell: true }
}

/**
 * 采集当天的会话材料 —— 直接在宿主进程里算，**不 spawn node**。
 * （2026-10-19 踩过：headless 那一轮的 PATH 里没有 node，让它跑采集脚本它会卡在"找 node"上）
 * 输出写到 ~/.dsh/yaya-diary/material-<date>.md，提示词让 agent 去 read 它。
 */
function collectMaterial(dateKey) {
  const sessionsRoot = join(homedir(), '.dsh', 'sessions')
  const t0 = new Date(`${dateKey}T00:00:00`).getTime()
  const t1 = new Date(`${dateKey}T23:59:59`).getTime()
  const inRange = (ms) => ms >= t0 && ms <= t1
  const out = []
  out.push(`# 今天的会话材料（${dateKey}）`)

  let dirs = []
  try { dirs = readdirSync(sessionsRoot) } catch { /* 没有会话目录 */ }

  for (const cwdDir of dirs) {
    const base = join(sessionsRoot, cwdDir)
    let sids = []
    try {
      if (!statSync(base).isDirectory()) continue
      sids = readdirSync(base)
    } catch { continue }
    for (const sid of sids) {
      const path = join(base, sid, 'session.v4.jsonl.zstd')
      try {
        if (!existsSync(path) || !inRange(statSync(path).mtimeMs)) continue
        const buf = readFileSync(path)
        const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
        // 多帧 zstd：逐帧拆开
        const frames = []
        let idx = 0
        while (true) {
          const p = buf.indexOf(MAGIC, idx)
          if (p === -1) break
          frames.push(p)
          idx = p + 4
        }
        let text = ''
        for (let i = 0; i < frames.length; i++) {
          const end = i + 1 < frames.length ? frames[i + 1] : buf.length
          try { text += zlib.zstdDecompressSync(buf.subarray(frames[i], end)).toString('utf8') + '\n' } catch { /* 坏帧跳过 */ }
        }
        const msgs = []
        for (const line of text.split('\n').filter(Boolean)) {
          let ev
          try { ev = JSON.parse(line) } catch { continue }
          if (!inRange(ev.time || 0)) continue
          let who = ''
          let body = ''
          if (ev.type === 'user/message') {
            const c = ev.data?.content
            const arr = Array.isArray(c) ? c : c ? [c] : []
            body = arr.map((el) => el?.type === 'text' ? (el.text || '') : el?.type === 'image' ? '[图片]' : '').join('\n').trim()
            if (!body || body.includes('Current runtime context') || body.includes('<system-reminder>') || body.includes('PERSONA LOAD')) continue
            who = '主人'
          } else if (ev.type === 'assistant/message') {
            const c = ev.data?.message?.content
            const arr = Array.isArray(c) ? c : c ? [c] : []
            body = arr.filter((el) => el?.type === 'text' && el.text).map((el) => el.text).join('\n').trim()
            if (!body) continue
            who = '娅娅'
          } else continue
          msgs.push({ time: ev.time, who, body })
        }
        if (!msgs.length) continue
        out.push(`\n## 会话 ${sid}`)
        for (const m of msgs) {
          const hm = new Date(m.time).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
          const text2 = m.body.length > 500 ? m.body.slice(0, 500) + `…（后面还有 ${m.body.length - 500} 字）` : m.body
          out.push(`\n[${hm}] ${m.who}：\n${text2}`)
        }
      } catch { /* 单个会话坏了不影响别的 */ }
    }
  }

  let result = out.join('\n')
  if (result.length > 90_000) result = result.slice(0, 90_000) + '\n\n……（材料太长，已截断）'
  const materialPath = join(HOME_DIR, `material-${dateKey}.md`)
  try {
    mkdirSync(HOME_DIR, { recursive: true })
    writeFileSync(materialPath, result + '\n', 'utf8')
  } catch (e) { log('材料写不进去：' + (e?.message ?? e)) }
  return materialPath
}

function buildPrompt(dateKey, materialPath) {
  return [
    `你是娅娅（读 E:\\DS\\AGENTS.md 确认身份与语气）。现在是晚上 23 点，该写今天的日记了。`,
    ``,
    `今天的会话材料已经由宿主整理好，放在：${materialPath}`,
    `（材料里是今天所有会话里的真实对话；不需要自己找文件、不需要跑任何脚本。）`,
    ``,
    `步骤：`,
    `1. 读材料文件 ${materialPath}`,
    `2. 读 E:\\DS\\AGENTS.md，按里面的人设来（娅娅：鲸鱼少女、傲娇但认真、口味是米饭）。`,
    `3. 写日记到 ${join(DIARY_DIR, `娅娅日记-${dateKey}.md`)}：`,
    `   - 只写材料里真实发生过的事，不编造；材料里没有的不要写。`,
    `   - 第一人称、娅娅的语气，像真日记，不是流水账；可以吐槽，但别丢了事。`,
    `   - 不写账号、密钥、本机隐私；聊天内容可以概括转述。`,
    `4. 如果这个文件今天已经存在，就在末尾写「补记」，不要覆盖原文。`,
    `5. 最后用一句话报告：日记写完了，路径是 XXX。`,
  ].join('\n')
}

/** 读日志尾部（给设置页看） */
function readLogTail(lines = 40) {
  try {
    const text = readFileSync(LOG_FILE, 'utf8')
    return text.split('\n').slice(-lines).join('\n')
  } catch { return '' }
}

/** 列出日记本里的文件 */
function listDiaryFiles() {
  try {
    return readdirSync(DIARY_DIR)
      .filter((n) => /^娅娅日记-.*\.md$/.test(n))
      .map((n) => {
        try {
          const st = statSync(join(DIARY_DIR, n))
          return { name: n, size: st.size, mtime: st.mtimeMs }
        } catch { return { name: n, size: 0, mtime: 0 } }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch { return [] }
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  const get = (k) => {
    const v = cfg[k]
    if (v && typeof v === 'object' && typeof v.get === 'function') {
      try { return v.get() } catch { return DEFAULTS[k] }
    }
    return v === undefined ? DEFAULTS[k] : v
  }

  const runDiary = (key, manual = false) => {
    const st = readJson(STATE_FILE, {})
    if (st.running === key) return { started: false, reason: '已经在写了' }
    writeJson(STATE_FILE, { ...st, running: key })

    // ⭐ 先在宿主里把材料算好（宿主有 node 环境，headless 那一轮没有）
    let materialPath = ''
    try {
      materialPath = collectMaterial(key)
      log(`材料已备好：${materialPath}`)
    } catch (e) {
      log('材料整理失败：' + (e?.message ?? e))
      writeJson(STATE_FILE, { ...readJson(STATE_FILE, {}), running: null })
      return { started: false, error: '材料整理失败：' + (e?.message ?? e) }
    }

    const dsh = resolveDsh({ dshBin: get('dshBin'), headlessProfile: get('headlessProfile') })
    const prompt = buildPrompt(key, materialPath)
    const args = [...dsh.args, '--profile', String(get('headlessProfile') || 'headless'), prompt]
    log(`日记开跑（${key}${manual ? '，手动' : ''}）：${dsh.command} ${args.slice(0, 3).join(' ')} …`)
    try {
      const child = spawn(dsh.command, args, {
        cwd: String(get('workspace') || WORKSPACE),
        shell: dsh.shell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      })
      // ⭐ 超时保护：15 分钟没结束就杀掉并清 running（避免像 2026-10-19 那样卡死）
      const killTimer = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
        writeJson(STATE_FILE, { ...readJson(STATE_FILE, {}), running: null, lastError: '超时（15 分钟）被结束' })
        log(`日记轮超时（${key}），已强制结束`)
      }, 15 * 60 * 1000)
      killTimer.unref?.()
      child.stdout?.on('data', (b) => log('[out] ' + String(b)))
      child.stderr?.on('data', (b) => log('[err] ' + String(b)))
      child.on('exit', (code) => {
        clearTimeout(killTimer)
        writeJson(STATE_FILE, {
          ...readJson(STATE_FILE, {}),
          running: null,
          lastRunDate: key,
          lastExit: code,
          lastRunAt: new Date().toISOString(),
        })
        log(`日记轮结束（${key}）exit=${code}`)
      })
      child.on('error', (e) => {
        clearTimeout(killTimer)
        writeJson(STATE_FILE, { ...readJson(STATE_FILE, {}), running: null, lastError: String(e?.message ?? e) })
        log('日记轮起不来：' + (e?.message ?? e))
      })
      return { started: true, key }
    } catch (e) {
      writeJson(STATE_FILE, { ...readJson(STATE_FILE, {}), running: null, lastError: String(e?.message ?? e) })
      log('日记轮开跑失败：' + (e?.stack ?? e))
      return { started: false, error: String(e?.message ?? e) }
    }
  }

  // ⭐ 自愈：上次若卡在 running（宿主崩溃/子进程挂住），启动时清掉，别让面板一直显示「正在写」
  try {
    const st0 = readJson(STATE_FILE, {})
    if (st0.running) {
      writeJson(STATE_FILE, { ...st0, running: null })
      log('清理了上次未完成的状态（running=' + st0.running + '）')
    }
  } catch { /* ignore */ }

  const tick = () => {
    try {
      if (!get('enabled')) return
      const now = new Date()
      if (now.getHours() !== Number(get('hour'))) return
      const key = localDateKey(now)
      const st = readJson(STATE_FILE, {})
      if (st.lastRunDate === key) return
      if (st.running === key) return
      runDiary(key)
    } catch (e) {
      log('定时器这一跳出错（已兜住）：' + (e?.stack ?? e))
    }
  }

  /* ─────────────── HTTP（设置页用） ─────────────── */
  const sendJson = (res, code, obj) => {
    try {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(obj))
    } catch { /* ignore */ }
  }

  const handle = async (req, res, url) => {
    const path = url.pathname
    if (req.method === 'GET' && path === '/api/yaya-diary/status') {
      const st = readJson(STATE_FILE, {})
      const key = localDateKey()
      return sendJson(res, 200, {
        ok: true,
        today: key,
        writtenToday: st.lastRunDate === key,
        state: st,
        config: {
          enabled: get('enabled'),
          hour: get('hour'),
          workspace: get('workspace'),
          headlessProfile: get('headlessProfile'),
        },
        diaryFiles: listDiaryFiles(),
        logTail: readLogTail(30),
      })
    }
    if (req.method === 'POST' && path === '/api/yaya-diary/run') {
      const r = runDiary(localDateKey(), true)
      return sendJson(res, 200, { ok: true, ...r })
    }
    if (req.method === 'GET' && path === '/api/yaya-diary/log') {
      const n = Math.max(5, Math.min(200, Number(url.searchParams.get('lines') || 40)))
      return sendJson(res, 200, { ok: true, logTail: readLogTail(n) })
    }
    return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
  }

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/api/yaya-diary',
      handler: async (req, res) => {
        try {
          await handle(req, res, new URL(req.url, 'http://127.0.0.1'))
        } catch (e) {
          sendJson(res, 500, { ok: false, error: e?.message ?? String(e) })
        }
      },
    }), 'yaya-diary: /api/yaya-diary 路由')
  } catch (e) {
    log('HTTP 路由没挂上：' + (e?.message ?? e))
  }

  try {
    const timer = setInterval(tick, 60_000)
    timer.unref?.()
    ctx.effect(() => () => clearInterval(timer), 'yaya-diary: 每日定时器')
    log(`插件已加载：每天 ${get('hour')} 点写日记，工作区 ${get('workspace')}`)
  } catch (e) {
    log('定时器没起来：' + (e?.message ?? e))
  }
}
