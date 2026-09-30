// dsh-topbar — host half.
//
// The client half reads the live session store (running / completed) and
// POSTs it to a small HTTP route we register on the DSH web server. We then
// raise the D-Bus call to the GNOME extension, because a browser page cannot
// speak D-Bus directly.
//
// Why the client must be the source of truth for gray/green: `completed` is
// the sidebar's green "unacknowledged" reminder. It lives in the session
// manager's in-memory `completedNotifications` set and is NEVER written to
// the session log, so a log-reading bridge cannot see it. Only the page can.
//
// Why yellow is decided here: the sidebar's yellow dot covers every "the
// agent needs you" state — approval, a question (ask_user_question) and
// plan review. The session store has no such field (pendingInteraction is a
// UI slot prop the page cannot read), but on the host all three arrive as
// waterfall events: 'approval/request' and 'user-questions/request' (plan
// review rides the question service). We watch both and overlay the mark
// onto the snapshot the client sends, which is what turns a chip yellow.
//
// Why a plain webServer route instead of the rpc/typert seam: the gateway
// dispatches /api only to typert service bindings, which require a
// self-consistent namespace face — a well-known source of mount deadlocks in
// community plugins. A named HTTP route is the simpler, documented contract
// (`webServer.register({kind, path, handler})`).
//
// Settings live under the `dsh-topbar` namespace (settings.installSection,
// same seam dsh-free-search uses) and ride EVERY push payload toward the
// GNOME extension as `cfg`, so a settings change lands on the bar within a
// second — no DSH restart, no Shell reload.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

const BUS_NAME = 'org.dsh.Topbar'
const OBJ_PATH = '/org/dsh/Topbar'
const METHOD = 'org.dsh.Topbar.Push'

const ROUTE = '/dsh-topbar/state'
const SETTINGS_ROUTE = '/dsh-topbar/settings'
const MAX_BODY = 64 * 1024

// How long the client may stay silent before we clear the bar. The extension
// also expires on its own (5s); this side covers "the page is gone entirely"
// and keeps the two independent.
const CLIENT_STALE_MS = 15000

// Prefer the distro build; fall back to PATH.
const GDBUS = fs.existsSync('/usr/bin/gdbus') ? '/usr/bin/gdbus' : 'gdbus'

const EXT_UUID = 'dsh-topbar@cf206.local'
const PKG_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const EXT_TARGET = path.join(os.homedir(), '.local/share/gnome-shell/extensions', EXT_UUID)
const EXT_FILES = ['metadata.json', 'extension.js']

// This package's settings namespace — also the settings tab's card key.
const NS = 'dsh-topbar'

// Defaults keep today's behavior; ranges are clamped in normalizeCfg.
const Config = z.object({
  fontSize: z.number().default(11),
  maxLabelPx: z.number().default(140),
  maxChips: z.number().default(8),
  showRunning: z.boolean().default(true),
  showDone: z.boolean().default(true),
  showWaiting: z.boolean().default(true),
  // What a sub-agent's activity does to the bar. The CLIENT half owns the
  // filter (it is the only side that sees origin/parentId), so this key is
  // declared here purely so settings.yaml can persist it.
  //   'rollup' — the sub-agent gets no chip of its own, but while it runs the
  //              TOP-LEVEL session keeps its gray chip alive. Covers the blind
  //              spot where a continuable child outlives the parent's turn.
  //   'hide'   — sub-agents never touch the bar.
  subagentMode: z.string().default('rollup'),
  minimal: z.boolean().default(false),
  clickAction: z.string().default('none'),
  // '' = xdg-open(系统默认);预设 firefox/microsoft-edge/google-chrome-stable/chromium;或自定义单 token 命令
  browser: z.string().default(''),
  openUrl: z.string().default(''),
  // -1 = 常驻: after the user answers, the chip stays yellow until the
  // session's real state changes (turn ends / session leaves the list).
  dwellSec: z.number().default(90),
  autoInstallExt: z.boolean().default(true),
  autoReloadShell: z.boolean().default(true)
})

export const name = 'dsh-topbar'

// 'webServer' is injected at runtime (see apply) because the service is not
// guaranteed to exist at static-inject time in every composition.
export const inject = []

let lastPushAt = 0
let lastContent = null
let shellCleared = false

const state = {
  sessions: [],
  at: 0,
  pushes: 0,
  failures: 0,
  lastError: '',
  // Self-install outcome, surfaced through topbar_status.
  extInstall: { changed: false, reloadAttempted: false, message: '' },
  // What the client reported about its own view of the session store.
  diag: { ids: 0, seen: [], error: '', lastPost: '' }
}

/**
 * Sessions currently blocked on a human decision, keyed by session id.
 *
 * The page cannot see these: the sidebar's yellow dot is driven by UI
 * runtime slot props, not by fields of the session list store, so the client
 * half has no access to them. The host CAN see them, because approval and
 * question requests are host-side waterfall events. We track them here and
 * overlay them onto the snapshot the client sends, which is what turns a
 * chip yellow.
 *
 * Mark shape: { title, at, settled }. `at` is the timestamp the dwell clock
 * runs against (the moment of the DECISION once settled); `settled` flips to
 * true when the waterfall resolves, i.e. the instant the user answers.
 */
const pendingInteractions = new Map()

/**
 * Per-reporter views: every DSH page heartbeats its own snapshot, keyed by
 * the page's stable token (sessionStorage). A single "last write wins"
 * snapshot breaks the moment two pages are open — the latest reporter
 * redicts the union and pages disagreeing on unacknowledged state make the
 * bar flicker (a sibling page that lacks a session used to delete the
 * pending-interaction mark — the "yellow turned gray" bug).
 */
const reporters = new Map() // token -> { clean: [...], at: ms }

/** Merge every live reporter's raw view: per session keep the URGENTest
 *  reported state (waiting > running > done > absent). Stale reporters have
 *  been pruned by the caller. */
function mergedRawSessions() {
  const byId = new Map()
  for (const rep of reporters.values()) {
    for (const s of rep.clean) {
      const cur = byId.get(s.id)
      if (cur === undefined) { byId.set(s.id, { ...s }); continue }
      if (cur.state !== s.state) {
        const rank = { waiting: 0, running: 1, done: 2 }
        if ((rank[s.state] ?? 9) < (rank[cur.state] ?? 9)) cur.state = s.state
      }
    }
  }
  return [...byId.values()]
}

/** Titles remembered from client snapshots, for chips the client omitted. */
const knownTitles = new Map()

/**
 * Live config getter. Stubbed to defaults until apply() binds it to the
 * plugin's saved settings and the settings service keeps it fresh via
 * setSource (installSection's onChange path). snapshotForShell and the
 * reconciler read it — so it must be module scope, NOT an apply's local.
 */
let current = () => ({})

/** Captured webServer face; its port/host is the DSH web page address. */
let webServerFace = null

function log(...args) {
  if (process.env.DSH_TOPBAR_DEBUG === '1') console.error('[dsh-topbar]', ...args)
}

function clampInt(value, lo, hi, dflt) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}

/** Normalize + clamp any raw config object into the canonical shape. */
function normalizeCfg(raw) {
  const cfg = {
    fontSize: 11,
    maxLabelPx: 140,
    maxChips: 8,
    showRunning: true,
    showDone: true,
    showWaiting: true,
    subagentMode: 'rollup',
    minimal: false,
    clickAction: 'none',
    openUrl: '',
    browser: '',
    dwellSec: 90,
    autoInstallExt: true,
    autoReloadShell: true
  }
  if (raw === null || typeof raw !== 'object') return cfg
  cfg.fontSize = clampInt(raw.fontSize, 8, 20, 11)
  cfg.maxLabelPx = clampInt(raw.maxLabelPx, 40, 800, 140)
  cfg.maxChips = clampInt(raw.maxChips, 1, 16, 8)
  cfg.showRunning = raw.showRunning !== false
  cfg.showDone = raw.showDone !== false
  cfg.showWaiting = raw.showWaiting !== false
  cfg.subagentMode = raw.subagentMode === 'hide' ? 'hide' : 'rollup'
  cfg.minimal = raw.minimal === true
  cfg.clickAction = raw.clickAction === 'openUrl' || raw.clickAction === 'openSession' ? raw.clickAction : 'none'
  const url = String(raw.openUrl === undefined || raw.openUrl === null ? '' : raw.openUrl)
  cfg.openUrl = /^https?:\/\//.test(url) ? url : ''
  const browserRaw = String(raw.browser === undefined || raw.browser === null ? '' : raw.browser).trim()
  // 仅接受预设或无空格的单 token 命令(经 execFile 数组执行,无 shell 注入面)
  cfg.browser = ['', 'firefox', 'microsoft-edge', 'google-chrome-stable', 'chromium'].includes(browserRaw)
    ? browserRaw
    : (/^[A-Za-z0-9_./+-]{1,80}$/.test(browserRaw) ? browserRaw : '')
  const dwell = Math.round(Number(raw.dwellSec))
  // 0 = 回答后立即跟随真实状态（无残余提醒）；-1 = 常驻；其余 0~7200 秒。
  cfg.dwellSec = dwell === -1 ? -1 : (Number.isFinite(dwell) ? Math.min(7200, Math.max(0, dwell)) : 90)
  cfg.autoInstallExt = raw.autoInstallExt !== false
  cfg.autoReloadShell = raw.autoReloadShell !== false
  return cfg
}

/** The subset of cfg the GNOME extension needs on every push. */
function cfgForShell(cfg) {
  return {
    fontSize: cfg.fontSize,
    maxLabelPx: cfg.maxLabelPx,
    maxChips: cfg.maxChips,
    minimal: cfg.minimal,
    clickAction: cfg.clickAction,
    openUrl: cfg.openUrl,
    browser: cfg.browser
  }
}

/** True while the browser half is still reporting. */
function clientLive() {
  return state.at !== 0 && Date.now() - state.at <= CLIENT_STALE_MS
}

// ── Shell transport ─────────────────────────────────────────────────────
//
// The GNOME extension expires every chip 5s after the last Push — silence
// IS its liveness signal. A pure content-dedup would therefore let a long
// turn's gray chip blink out mid-turn (a running session's snapshot never
// changes, so "nothing changed" would look exactly like "the page died").
// So: content changes push immediately; unchanged snapshots still reach the
// shell at ~1 per HEARTBEAT_MS, safely inside the extension's 5s budget; a
// FAILED push retries on the next client tick (lastPushAt only advances on
// success, so the retry window opens within one tick). The config block is
// part of the dedup content: a settings change triggers a real push even if
// no session state changed.

const HEARTBEAT_MS = 3500

/** Send a snapshot + config to the GNOME extension over the session bus. */
function pushToShell(list, cfg) {
  const content = JSON.stringify({ sessions: list, cfg })
  if (content === lastContent && Date.now() - lastPushAt < HEARTBEAT_MS) return
  lastContent = content
  execFile(
    GDBUS,
    ['call', '--session', '--dest', BUS_NAME, '--object-path', OBJ_PATH,
      '--method', METHOD, JSON.stringify({ ts: Date.now(), sessions: list, cfg })],
    { timeout: 4000 },
    (err) => {
      if (err) {
        state.failures += 1
        state.lastError = String(err.message || err).split('\n')[0]
        log('push failed:', state.lastError)
      } else {
        state.pushes += 1
        state.lastError = ''
        lastPushAt = Date.now()
      }
    }
  )
}

/** The list that should be on the bar right now: overlay + flags + cap. */
function snapshotForShell() {
  const cfg = normalizeCfg(current())
  const merged = withInteractions(state.sessions)
  const visible = merged.filter((s) =>
    s.state === 'waiting' ? cfg.showWaiting :
      s.state === 'running' ? cfg.showRunning :
        s.state === 'done' ? cfg.showDone : true)
  let list = visible.slice(0, cfg.maxChips)
  // Effective base: the user's 应用地址 when set; otherwise the DSH web page
  // address this very process serves (webServer knows its port/host), so the
  // field is optional — the common local case needs no manual entry.
  const base = cfg.openUrl !== '' ? cfg.openUrl : autoBaseUrl()
  cfg.openUrl = base
  // Click-to-session: attach each chip's deep link when the click action
  // demands it. The page half reads ?open=<id> on load, calls
  // sessions.open(id) (the same seam the pet/task-board jump uses) and
  // replaces the URL away.
  if ((cfg.clickAction === 'openSession' || cfg.clickAction === 'openUrl') && base !== '') {
    if (cfg.clickAction === 'openSession') {
      list = list.map((s) => ({ ...s, url: sessionDeepLink(s.id, base) }))
    }
  }
  return { list, cfg: cfgForShell(cfg) }
}

/** The DSH web origin this process serves, derived from webServer's own face. */
function autoBaseUrl() {
  try {
    if (webServerFace === undefined || webServerFace === null) return ''
    const port = webServerFace.port
    if (!port) return ''
    const bindHost = webServerFace.host || ''
    const host = bindHost === '' || bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost
    return `http://${host}:${port}`
  } catch (e) {
    return ''
  }
}

/** The app URL that opens one session: <openUrl>?open=<id>. */
function sessionDeepLink(id, baseUrl) {
  try {
    const u = new URL(baseUrl)
    u.searchParams.set('open', String(id))
    return u.toString()
  } catch (e) {
    return ''
  }
}

/** Empty the bar (client-vanished watchdog); the shell keeps its cfg. */
function clearShell() {
  pushToShell([], snapshotForShell().cfg)
}

/**
 * Overlay host-known pending interactions onto a client snapshot.
 *
 * A session waiting on a human may not even appear in the client's list
 * (idle sessions and subagents are omitted), so a mark can both recolor an
 * existing chip and introduce a new one. Titles come from the remembered
 * map first, then the request's tool name / question header as a last
 * resort.
 *
 * The overlay only forces `waiting` while the client still reports the
 * session as `running`: once the turn ends (done/…) the chip follows its
 * real state immediately, consistent with the reconciler below.
 */
function withInteractions(sessions) {
  const seen = new Set()
  const out = []
  for (const s of sessions) {
    seen.add(s.id)
    if (s.title) knownTitles.set(s.id, s.title)
    if (pendingInteractions.has(s.id) && s.state === 'running') {
      out.push({ ...s, state: 'waiting' })
    } else {
      out.push(s)
    }
  }
  // Interactions for sessions the client did not report (idle sessions,
  // subagents) become their own chips.
  for (const [id, info] of pendingInteractions) {
    if (seen.has(id)) continue
    out.push({
      id,
      title: knownTitles.get(id) || info.title || id,
      state: 'waiting'
    })
  }
  // Waiting first, then running, then done — the most urgent chip sits
  // closest to the left edge (the client can only report running/done, so
  // the urgent-first ordering has to be re-asserted here).
  const rank = { waiting: 0, running: 1, done: 2 }
  out.sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9))
  return out
}

/** Read and JSON-parse a bounded request body. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

// ── GNOME extension self-install ─────────────────────────────────────────
//
// The GNOME Shell half cannot be installed by DSH's plugin manager, but this
// process runs on the target host and knows its own package directory. On
// mount we compare the bundled extension files with the deployed copies and
// self-install when they differ — all under ~/.local, no sudo. The only
// step left to the user is the Shell reload, which can optionally be
// triggered automatically on X11 (never on Wayland).

function selfInstallExtension(cfg) {
  if (cfg.autoInstallExt !== true) return
  try {
    const srcDir = path.join(PKG_ROOT, 'extension')
    let changed = false
    for (const file of EXT_FILES) {
      const src = path.join(srcDir, file)
      if (!fs.existsSync(src)) continue
      const content = fs.readFileSync(src)
      let existing = null
      try { existing = fs.readFileSync(path.join(EXT_TARGET, file)) } catch (e) { existing = null }
      if (existing === null || !content.equals(existing)) { changed = true; break }
    }
    if (!changed) return
    fs.mkdirSync(EXT_TARGET, { recursive: true })
    for (const file of EXT_FILES) {
      const src = path.join(srcDir, file)
      if (fs.existsSync(src)) fs.writeFileSync(path.join(EXT_TARGET, file), fs.readFileSync(src))
    }
    enableShellExtensionSetting()
    state.extInstall.changed = true
    state.extInstall.message =
      `extension installed to ${EXT_TARGET}; reload GNOME Shell (Alt+F2 → r on X11, ` +
      'or enable autoReloadShell in the topbar settings)'
    log(state.extInstall.message)

    if (cfg.autoReloadShell !== true) return
    if (String(process.env.XDG_SESSION_TYPE || '').includes('wayland')) {
      state.extInstall.message += ' [Wayland detected: automatic reload refused]'
      return
    }
    execFile(GDBUS,
      ['call', '--session', '--dest', 'org.gnome.Shell', '--object-path', '/org/gnome/Shell',
        '--method', 'org.gnome.Shell.Eval', 'global.reexec_self(); "reloading"'],
      { timeout: 4000 },
      (err) => {
        state.extInstall.reloadAttempted = true
        if (err) log('shell reload failed:', String(err.message || err).split('\n')[0])
      })
  } catch (e) {
    state.extInstall.message = 'self-install failed: ' + String(e && e.message || e)
    log(state.extInstall.message)
  }
}

/** Ensure the extension uuid is in GNOME's enabled-extensions list. */
function enableShellExtensionSetting() {
  execFile('gsettings', ['get', 'org.gnome.shell', 'enabled-extensions'], { timeout: 4000 }, (err, stdout) => {
    if (err) return // dconf unavailable; the manual install path covers this
    let list = []
    try {
      const raw = String(stdout || '').trim()
      const body = raw.startsWith('@as') ? raw.slice(3).trim() : raw
      const parsed = JSON.parse(body.replace(/'/g, '"'))
      if (Array.isArray(parsed)) list = parsed.map(String)
    } catch (e) { /* rewrite an empty list below */ }
    if (list.includes(EXT_UUID)) return
    list.push(EXT_UUID)
    const variant = '[' + list.map((item) => "'" + item + "'").join(', ') + ']'
    execFile('gsettings', ['set', 'org.gnome.shell', 'enabled-extensions', variant], { timeout: 4000 }, () => {})
  })
}

export function apply(ctx, config) {
  ctx.logger?.info?.('dsh-topbar: host ready')

  // `config` is the plugin's saved settings at apply time; the settings
  // service keeps it live via setSource below. Until that service mounts,
  // the clamped defaults apply — which is all the self-install needs.
  // `current` itself lives at module scope (snapshotForShell reads it).
  current = () => normalizeCfg(config)
  selfInstallExtension(normalizeCfg(config))

  // Settings section on the official seam (same wiring as dsh-free-search).
  ctx.inject(['settings'], (sctx) => {
    if (typeof sctx.settings?.installSection === 'function') {
      sctx.settings.installSection(ctx, NS, Config, normalizeCfg(config), {
        setSource: (source) => { current = source },
        onChange: () => {
          if (clientLive()) {
            const { list, cfg } = snapshotForShell()
            pushToShell(list, cfg)
          }
        }
      })
    } else {
      sctx.logger?.warn?.('dsh-topbar: settings service lacks installSection; edit the settings.yaml dsh-topbar: key manually')
    }
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const disposers = [
        // Live session snapshot from the page.
        webCtx.webServer.register({
          kind: 'exact',
          path: ROUTE,
          handler: async (req, res) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            let payload = null
            try {
              payload = await readBody(req)
            } catch (e) {
              sendJson(res, 400, { ok: false, error: String(e.message || e) })
              return
            }
            const sessions = Array.isArray(payload?.sessions) ? payload.sessions : []
            // Client-reported diagnostics (what it saw in the session store).
            if (payload?.diag !== null && typeof payload?.diag === 'object') {
              const kids = payload.diag.subagents
              state.diag = {
                ids: Number(payload.diag.ids) || 0,
                seen: Array.isArray(payload.diag.seen) ? payload.diag.seen.slice(0, 20).map(String) : [],
                error: typeof payload.diag.error === 'string' ? payload.diag.error : '',
                lastPost: typeof payload.diag.lastPost === 'string' ? payload.diag.lastPost : '',
                subagents: kids !== null && typeof kids === 'object'
                  ? { kids: Number(kids.kids) || 0, busy: Number(kids.busy) || 0 }
                  : { kids: 0, busy: 0 }
              }
            }
            // Normalize defensively: this crosses a trust boundary.
            const clean = []
            for (const s of sessions) {
              if (s === null || typeof s !== 'object') continue
              const id = typeof s.id === 'string' ? s.id : ''
              if (id === '') continue
              clean.push({
                id,
                title: typeof s.title === 'string' ? s.title : '',
                state: typeof s.state === 'string' ? s.state : 'running'
              })
            }
            // Reporter identity: one DSH page = one live view. Old clients
            // without the field degrade to a single '?'-keyed slot, which
            // keeps the previous single-page semantics.
            const reporter = typeof payload?.reporter === 'string' && payload.reporter !== ''
              ? payload.reporter : '?'
            // Prune reporters gone silent beyond the watchdog horizon.
            const now = Date.now()
            for (const [rid, rep] of reporters) {
              if (now - rep.at > CLIENT_STALE_MS) {
                reporters.delete(rid)
                log('reporter pruned:', rid)
              }
            }
            // Store THIS reporter's raw view, then overlay interactions onto
            // the merged view. The reconciler compares against the merged
            // RAW view: the overlaid rendering has 'waiting' forced onto
            // marked sessions, so it can never show a moved-on session.
            reporters.set(reporter, { clean, at: now })
            state.at = now
            shellCleared = false // client alive again; the watchdog re-arms
            const mergedRaw = mergedRawSessions()
            state.sessions = withInteractions(mergedRaw)
            const { list, cfg } = snapshotForShell()
            pushToShell(list, cfg)
            sendJson(res, 200, { ok: true, count: list.length })
          }
        }),
        // Settings bridge for our card: GET reads the section, POST mutates
        // it (settings.describe/mutate with revision-conflict detection,
        // allowlisted to our own namespace — the dsh-free-search pattern).
        webCtx.webServer.register({
          kind: 'exact',
          path: SETTINGS_ROUTE,
          handler: async (req, res) => {
            const settings = ctx.get('settings')
            if (settings === undefined || settings === null) {
              sendJson(res, 503, { ok: false, code: 'settings-unavailable', message: 'settings service not mounted' })
              return
            }
            const toView = (descriptor) => ({
              ns: String(descriptor.ns),
              value: descriptor.value,
              base: descriptor.base,
              user: descriptor.user,
              revision: descriptor.revision,
              writable: settings.writable !== false
            })
            if (req.method === 'GET') {
              const descriptor = settings.describe({})
                .find((candidate) => String(candidate.ns) === NS)
              if (descriptor === undefined) {
                sendJson(res, 404, { ok: false, code: 'settings-not-exposed', message: `namespace "${NS}" is not registered` })
                return
              }
              sendJson(res, 200, { ok: true, value: toView(descriptor) })
              return
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'method not allowed' })
              return
            }
            let body = null
            try {
              body = await readBody(req)
            } catch (e) {
              sendJson(res, 400, { ok: false, code: 'settings-rejected', message: String(e.message || e) })
              return
            }
            if (body === null || typeof body !== 'object' || !Array.isArray(body.ops)) {
              sendJson(res, 400, { ok: false, code: 'settings-rejected', message: 'malformed settings request' })
              return
            }
            if (settings.writable === false) {
              sendJson(res, 403, { ok: false, code: 'settings-readonly', message: 'settings are not writable' })
              return
            }
            const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
            try {
              await settings.mutate(NS, body.ops, expectedRevision)
            } catch (e) {
              const conflict = e !== null && typeof e === 'object' && e.name === 'SettingsConflictError'
              sendJson(res, conflict ? 409 : 500, {
                ok: false,
                code: conflict ? 'settings-conflict' : 'internal',
                message: String(e && e.message || e)
              })
              return
            }
            const descriptor = settings.describe({})
              .find((candidate) => String(candidate.ns) === NS)
            if (descriptor === undefined) {
              sendJson(res, 500, { ok: false, code: 'internal', message: 'namespace disposed after mutate' })
              return
            }
            sendJson(res, 200, { ok: true, value: toView(descriptor) })
          }
        })
      ]
      return () => { for (const dispose of disposers) { try { dispose() } catch (e) { /* gone */ } } }
    }, 'dsh-topbar: routes')
  })

  // Client-vanished watchdog: clear the bar ONCE per staleness episode so no
  // stale chips survive — with multi-page reporting, staleness only counts
  // when EVERY reporter went silent (each POST refreshes state.at).
  // The flag also keeps closed pages from re-spawning gdbus calls; it resets
  // the moment any client reports again.
  ctx.effect(() => {
    const timer = setInterval(() => {
      try {
        if (state.at === 0) return
        if (Date.now() - state.at > CLIENT_STALE_MS && !shellCleared) {
          shellCleared = true
          clearShell()
        }
      } catch (e) {
        log('stale watchdog error:', String(e && e.message || e))
      }
    }, 5000)
    return () => clearInterval(timer)
  }, 'dsh-topbar: stale watchdog')

  // ── Pending interactions (yellow) ──────────────────────────────────────
  //
  // Both watched events are host-side WATERFALLS: every listener must call
  // next() and pass its result through, otherwise the interaction never
  // resolves and the agent stalls forever. We only observe.
  //
  // `{ global: true, prepend: true }` matches the registration other plugins
  // use so we are not scoped to one session.
  //
  // Note on clearing: `approval/asked` / `approval/decided` are audit-log
  // writes (`session.append`), NOT emittable ctx events, so we cannot listen
  // for the decision. Instead we settle the mark when the waterfall's own
  // promise resolves — the approval service awaits decide() inline before
  // appending 'approval/decided'.
  //
  // IMPORTANT: settling does NOT clear the yellow. The waterfall resolves
  // the instant the user answers, which is typically within seconds —
  // clearing there would erase the reminder before anyone who stepped away
  // could ever see it. The mark's `settled` flag gates the dwell clock: only
  // AFTER the answer does the dwell start counting, for dwellSec seconds
  // (configurable; -1 = 常驻, the chip stays yellow until the session's real
  // state changes). An UNANSWERED request never dwell-expires — while the
  // agent is blocked on you, the chip must stay yellow (if the page is gone,
  // the watchdog clears the bar anyway).
  function watchInteraction(eventName, titleOf) {
    ctx.on(eventName, (req, next) => {
      let id = ''
      try {
        if (req !== null && typeof req === 'object') {
          const agent = req.agent
          id = agent !== undefined && agent !== null && agent.id !== undefined
            ? String(agent.id) : ''
          if (id !== '') {
            pendingInteractions.set(id, { title: titleOf(req), at: Date.now(), settled: false, vanishedSince: 0 })
            // Repaint immediately rather than waiting for the next client
            // tick — but never resurrect the bar while the client is stale;
            // the watchdog owns it until the page reports again.
            if (clientLive()) {
              const { list, cfg } = snapshotForShell()
              pushToShell(list, cfg)
            }
          }
        }
      } catch (e) {
        log('interaction listener failed:', String(e && e.message || e))
      }

      // This listener sits FIRST on the chain (prepend), so the decision is
      // still ahead of us. Observe settlement without ever altering the
      // waterfall's own result.
      let answered
      try {
        answered = Promise.resolve(next())
      } catch (e) {
        log('interaction chain threw:', String(e && e.message || e))
        return
      }
      if (id !== '') {
        // Restart the dwell at the moment of the DECISION, not at the moment
        // the request was raised. Otherwise a user who takes 60s to read the
        // prompt gets only 30s of reminder afterwards.
        //
        // dwellSec === 0 means "no residual reminder": drop the mark right
        // here so the chip snaps to its real state on this very repaint,
        // instead of waiting up to 2s for the reconciler tick.
        const settle = () => {
          const mark = pendingInteractions.get(id)
          if (mark !== undefined) {
            const live = normalizeCfg(current())
            const zeroDwell = live.dwellSec === 0
            if (zeroDwell) {
              pendingInteractions.delete(id)
            } else {
              mark.settled = true
              mark.at = Date.now()
            }
            if (clientLive()) {
              const { list, cfg } = snapshotForShell()
              pushToShell(list, cfg)
            }
          }
          log('interaction settled for', id, '(dwell restarts; chip stays)')
        }
        answered.then(settle, settle)
      }
      return answered
    }, { global: true, prepend: true })
  }

  watchInteraction('approval/request', (req) =>
    typeof req.toolName === 'string' ? req.toolName : '')

  // Questions and plan reviews both arrive here; the first question's
  // header ("Plan review", …) is the best short chip title.
  watchInteraction('user-questions/request', (req) =>
    Array.isArray(req.questions) && req.questions[0] !== undefined &&
      typeof req.questions[0].header === 'string' ? req.questions[0].header : '')

  // Retire a yellow chip when its reason is gone:
  //   moved on — the turn reached a settled state (done/…), so the chip
  //              follows the real state at once;
  //   vanished — the client used to report the session but it has left the
  //              list (session removed): nothing to keep reminding about;
  //   dwell    — the user ANSWERED and dwellSec (or its -1 常驻 mode) says
  //              the reminder has done its job.
  // An unanswered request matches none of these and stays yellow for as long
  // as the agent is blocked — that is the point.
  ctx.effect(() => {
    const timer = setInterval(() => {
      try {
      if (pendingInteractions.size === 0) return
      const cfg = normalizeCfg(current())
      const dwellMs = cfg.dwellSec === -1 ? Infinity : cfg.dwellSec * 1000
      // The reconciler judges against the merged RAW view of every live
      // reporter, not the last one: a sibling page that lost sight of the
      // session must not delete a pending mark (the vanished-check below
      // only counts sessions the union itself no longer contains).
      const merged = mergedRawSessions()
      let changed = false
      for (const [id, info] of pendingInteractions) {
        const live = merged.find((s) => s.id === id)
        const movedOn = live !== undefined && live.state !== 'running'
        // 触发者的会话列表在页面刷新/加载窗口里会短暂缺失; 只要用 5 秒宽限
        // 确认"合并视图里彻底没有"再删除, 否则新页面加载的第一帧就会误删
        // 一个仍挂起的审批标记(实测把黄标打成灰)。
        if (live === undefined) {
          if (!info.vanishedSince) info.vanishedSince = Date.now()
          else if (Date.now() - info.vanishedSince > 5000 && knownTitles.has(id)) {
            pendingInteractions.delete(id)
            changed = true
          }
        } else {
          info.vanishedSince = 0
          if (movedOn || (info.settled === true && Date.now() - info.at > dwellMs)) {
            pendingInteractions.delete(id)
            changed = true
          }
        }
      }
      if (changed && clientLive()) {
        const { list, cfg: shellCfg } = snapshotForShell()
        pushToShell(list, shellCfg)
      }
      } catch (e) {
        // A bug here must degrade the bar, never kill the DSH process.
        log('interaction reconciler error:', String(e && e.message || e))
      }
    }, 2000)
    return () => clearInterval(timer)
  }, 'dsh-topbar: interaction reconciler')

  // Diagnostic tool, mirroring the ntfy_status convention. 'tools' is
  // runtime-injected: a static dependency can prevent the plugin from ever
  // mounting in the web composition.
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(() => {
      const dispose = toolsCtx.tools.register({
        name: 'topbar_status',
        description: 'Report DSH top bar indicator state: last client report, push/failure counts, current config, self-install outcome, and the sessions currently on the bar.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => {
          const { list, cfg } = snapshotForShell()
          return {
            sessions: list.length,
            pendingInteractions: [...pendingInteractions.keys()],
            clientLive: clientLive(),
            shellCleared,
            lastReportMsAgo: state.at === 0 ? null : Date.now() - state.at,
            pushes: state.pushes,
            failures: state.failures,
            lastError: state.lastError,
            clientDiag: state.diag,
            extInstall: state.extInstall,
            cfg,
            detail: list.map((s) => `${s.state}:${s.title || s.id}`)
          }
        }
      })
      return () => { if (typeof dispose === 'function') dispose() }
    }, 'dsh-topbar: status tool')
  })
}
