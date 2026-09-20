window.__ModuleLoader__.load({
  id: 'dsh-topbar',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // ── dsh-topbar client half ──────────────────────────────────────────
    //
    // Two jobs:
    //   1. Read the LIVE session store and POST it to the host route
    //      /dsh-topbar/state once per second (immediately on load, and
    //      again on visibility change).
    //   2. Draw a settings card under Settings → Plugins — it reads and
    //      mutates the plugin's settings namespace through a small HTTP
    //      bridge (/dsh-topbar/settings), the same seam dsh-free-search
    //      uses. Saved config lands in settings.yaml and rides every push
    //      payload toward the GNOME extension, so changes apply live.

    const PUSH_MS = 1000
    const ROUTE = '/dsh-topbar/state'
    const SETTINGS = '/dsh-topbar/settings'
    const NS = 'dsh-topbar'

    const inject = ['sessions', 'timer', 'slots']

    let react = null
    let h = null
    try {
      react = require('react')
      h = react.createElement
    } catch (e) { /* card unavailable; the reporter still works */ }

    // ── card css ─────────────────────────────────────────────────────────
    const css = [
      '.dshtb-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:8px;min-width:0;list-style:none;transition:border-color .16s,background .16s;overflow:hidden;margin-bottom:8px}',
      '.dshtb-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}',
      '.dshtb-header{width:100%;color:inherit;cursor:pointer;text-align:left;font:inherit;background:0 0;border:0;align-items:center;gap:8px;padding:10px 14px;display:flex}',
      '.dshtb-header:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshtb-headText{flex-direction:column;flex:1 1 auto;gap:2px;min-width:0;display:flex;overflow:hidden}',
      '.dshtb-name{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-weight:600;overflow:hidden}',
      '.dshtb-description{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;font-size:12px;overflow:hidden}',
      '.dshtb-chevron{color:var(--dsw-alias-label-tertiary);flex:none;font-size:13px;transition:transform .12s}',
      '.dshtb-chevronOpen{transform:rotate(180deg)}',
      '.dshtb-body{flex-direction:column;gap:12px;padding:2px 14px 14px;display:flex}',
      '.dshtb-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
      '.dshtb-label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;flex:none}',
      '.dshtb-field{flex-direction:column;gap:4px;min-width:0;flex:1;display:flex}',
      '.dshtb-fieldLabel{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}',
      '.dshtb-input{border:1px solid var(--dsw-alias-border-l2);font:inherit;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:6px;padding:6px 8px;font-size:13px;width:100%;box-sizing:border-box}',
      '.dshtb-input:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.dshtb-num{max-width:110px}',
      '.dshtb-hint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}',
      '.dshtb-check{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-primary);font-size:13px;cursor:pointer}',
      '.dshtb-check input{accent-color:var(--dsw-alias-state-business-primary)}',
      '.dshtb-select{border:1px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:6px;padding:6px 8px;font-size:13px}',
      '.dshtb-btn{font:inherit;cursor:pointer;border-radius:6px;padding:5px 12px;font-size:13px}',
      '.dshtb-save{border:1px solid var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.dshtb-save:hover:not(:disabled){border-color:var(--dsw-alias-button-info-hover);background:var(--dsw-alias-button-info-hover)}',
      '.dshtb-save:disabled{opacity:.5;cursor:default}',
      '.dshtb-ghost{border:1px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary)}',
      '.dshtb-ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary)}',
      '.dshtb-ghost:disabled{opacity:.5;cursor:default}',
      '.dshtb-failed{color:var(--dsw-alias-state-error-primary);font-size:12px}',
      '.dshtb-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}',
      '.dshtb-footer{justify-content:flex-end;align-items:center;gap:8px;display:flex}'
    ].join('')
    const tagId = 'dsh-topbar/card.css'
    try {
      if (typeof document !== 'undefined' && typeof document.querySelector === 'function' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-topbar'
        tag.dataset.pluginCss = tagId
        tag.textContent = css
        document.head.appendChild(tag)
      }
    } catch (e) { /* no DOM (test harness, non-web platform) */ }

    const zhUI = (() => {
      try { return !String(navigator.language || '').toLowerCase().startsWith('en') } catch (e) { return true }
    })()

    const t = zhUI ? {
      title: '顶栏会话指示器',
      description: 'GNOME 顶栏各会话的运行状态色块：灰=运行中，绿=已完成，黄=等待。',
      appearance: '外观',
      display: '显示哪些状态',
      behavior: '行为',
      fontSize: '字体大小 (px)',
      fontSizeHint: '标题文字的渲染字号，9~14。改完 1 秒内生效。',
      maxLabelPx: '标题最大宽度 (px)',
      maxLabelPxHint: '超出此宽度显示省略号，60~400。',
      maxChips: '最大色块数',
      maxChipsHint: '1~12。超出时优先保留：等待 > 运行 > 已完成。',
      minimal: '极简模式（纯色小块，不带标题）',
      minimalHint: '标题移入鼠标悬停提示。',
      showRunning: '运行中（灰）',
      showDone: '已完成未确认（绿）',
      showWaiting: '等待回复/审批（黄）',
      showHint: '关闭的状态不会出现在顶栏。',
      clickAction: '点击色块',
      clickNone: '无操作',
      clickOpen: '打开 DSH 网页',
      clickOpenSession: '跳转到对应会话',
      openUrl: '网页地址',
      openUrlHint: '点击色块时用系统默认浏览器打开（http/https）。',
      openBase: '应用地址（DSH 网页）',
      openBaseHint: '色块点击将打开 <地址>?open=<会话ID>；页面加载后自动跳到该会话。',
      dwell: '提醒保持 (秒)',
      dwellHint: '回答后黄色保持多久；0 = 回答后立即消失；-1 = 常驻（直到会话真正结束或从列表消失）。',
      autoInstall: '自动安装 GNOME 扩展',
      autoInstallHint: 'DSH 启动时把扩展文件同步到 ~/.local/share/gnome-shell/extensions/（幂等，无需 sudo）。',
      autoReload: '自动重载 GNOME Shell',
      autoReloadHint: '扩展文件变化时自动重载 Shell。仅 X11；Wayland 会被拒绝（需手动注销重登或用 Alt+F2 → r）。',
      save: '保存',
      discard: '放弃',
      saving: '保存中…',
      saved: '已保存',
      loadFailed: '设置读取失败，请稍后重试。',
      readonly: '当前为只读模式，无法保存。',
      conflict: '设置已被其他窗口修改，已重新加载；请再次点击保存。',
      saveFailed: '保存失败：',
      unsaved: '有未保存的修改'
    } : {
      title: 'Top bar session indicator',
      description: 'Per-session status chips on the GNOME top bar: gray=running, green=done, yellow=waiting.',
      appearance: 'Appearance',
      display: 'Displayed states',
      behavior: 'Behavior',
      fontSize: 'Font size (px)',
      fontSizeHint: 'Chip label font size, 9~14. Applies within a second.',
      maxLabelPx: 'Max title width (px)',
      maxLabelPxHint: 'Titles truncate to this width, 60~400.',
      maxChips: 'Max chips',
      maxChipsHint: '1~12. Overflow keeps waiting first, then running, then done.',
      minimal: 'Minimal mode (solid blocks, no title)',
      minimalHint: 'Titles move to tooltips.',
      showRunning: 'Running (gray)',
      showDone: 'Completed, unacknowledged (green)',
      showWaiting: 'Waiting for reply/approval (yellow)',
      showHint: 'Hidden states never reach the bar.',
      clickAction: 'On chip click',
      clickNone: 'Do nothing',
      clickOpen: 'Open DSH web page',
      clickOpenSession: 'Jump to the session',
      openUrl: 'Page URL',
      openUrlHint: 'Opened with the default browser on click (http/https).',
      openBase: 'App URL (DSH web)',
      openBaseHint: 'Chip click opens <url>?open=<sessionId>; the page selects that session on load.',
      dwell: 'Reminder dwell (sec)',
      dwellHint: 'How long yellow stays after you answer; 0 = drop the moment you answer; -1 = keep until the session truly ends or leaves the list.',
      autoInstall: 'Auto-install GNOME extension',
      autoInstallHint: 'On DSH start, sync the extension files into ~/.local/share/gnome-shell/extensions/ (idempotent, no sudo).',
      autoReload: 'Auto-reload GNOME Shell',
      autoReloadHint: 'Reload the Shell automatically when extension files change. X11 only; refused on Wayland.',
      save: 'Save',
      discard: 'Discard',
      saving: 'Saving…',
      saved: 'Saved',
      loadFailed: 'Failed to load settings, try again later.',
      readonly: 'Read-only mode; saving is disabled.',
      conflict: 'Settings changed elsewhere; reloaded — please save again.',
      saveFailed: 'Save failed: ',
      unsaved: 'Unsaved changes'
    }

    // Same clamp ranges as the host's normalizeCfg, so a saved draft always
    // survives the server-side clamps unchanged.
    const LIMITS = {
      fontSize: [9, 14],
      maxLabelPx: [60, 400],
      maxChips: [1, 12],
      dwellSec: [0, 7200]
    }

    const num = (v) => {
      const n = Math.round(Number(v))
      return Number.isFinite(n) ? n : null
    }

    /** Ops describing every field whose draft differs from the stored value. */
    function buildOps(stored, draft) {
      const ops = []
      for (const key of Object.keys(LIMITS)) {
        const nv = num(draft[key])
        if (nv !== null && nv !== num(stored[key])) ops.push({ op: 'set', path: [key], value: nv })
      }
      for (const key of ['minimal', 'showRunning', 'showDone', 'showWaiting', 'autoInstallExt', 'autoReloadShell']) {
        const nv = draft[key] === true
        if (nv !== (stored[key] === true)) ops.push({ op: 'set', path: [key], value: nv })
      }
      const click = draft.clickAction === 'openUrl' ? 'openUrl' : 'none'
      if (click !== (stored.clickAction === 'openUrl' ? 'openUrl' : 'none')) {
        ops.push({ op: 'set', path: ['clickAction'], value: click })
      }
      const url = String(draft.openUrl || '').trim()
      if (url !== String(stored.openUrl || '')) {
        ops.push({ op: 'set', path: ['openUrl'], value: /^https?:\/\//.test(url) ? url : '' })
      }
      return ops
    }

    function TopbarCard() {
      const [open, setOpen] = react.useState(false)
      const [view, setView] = react.useState(null)     // { value, revision, writable }
      const [draft, setDraft] = react.useState(null)   // edited copy of view.value
      const [saving, setSaving] = react.useState(false)
      const [failed, setFailed] = react.useState(null)
      const [notice, setNotice] = react.useState(null)

      const load = react.useCallback(async () => {
        try {
          const res = await fetch(SETTINGS, { cache: 'no-store' })
          const body = await res.json()
          if (body && body.ok) {
            setView(body.value)
            setDraft({ ...(body.value.value || {}) })
            setFailed(null)
          } else {
            setFailed(t.loadFailed)
          }
        } catch (e) {
          setFailed(t.loadFailed)
        }
      }, [])

      // Load once when the card is first expanded — the same trade the
      // market card made (a fetch per card render would be wasteful).
      const probed = react.useRef(false)
      react.useEffect(() => {
        if (!open || probed.current) return
        probed.current = true
        void load()
      }, [open, load])

      const set = (key) => (ev) => {
        const target = ev && ev.currentTarget ? ev.currentTarget : ev
        const value = target.type === 'checkbox' ? target.checked : target.value
        setDraft((prev) => ({ ...(prev || view.value), [key]: value }))
      }

      const save = react.useCallback(async () => {
        if (!view || !draft) return
        const ops = buildOps(view.value || {}, draft)
        if (ops.length === 0) return
        setSaving(true)
        setFailed(null)
        setNotice(null)
        try {
          const res = await fetch(SETTINGS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ns: NS, ops, expectedRevision: view.revision })
          })
          const body = await res.json()
          if (body && body.ok) {
            setView(body.value)
            setDraft({ ...(body.value.value || {}) })
            setNotice(t.saved)
          } else if (body && body.code === 'settings-conflict') {
            await load()
            setFailed(t.conflict)
          } else {
            setFailed(t.saveFailed + (body && body.message || 'unknown'))
          }
        } catch (e) {
          setFailed(t.saveFailed + String(e && e.message || e))
        } finally {
          setSaving(false)
        }
      }, [view, draft, load])

      const dirty = view !== null && draft !== null && buildOps(view.value || {}, draft).length > 0
      const stored = view && view.value ? view.value : {}
      const cur = draft !== null ? draft : stored

      const rows = []
      // ─ 外观 ─
      rows.push(h('div', { className: 'dshtb-row', key: 'appearance' },
        h('div', { className: 'dshtb-label' }, t.appearance)))
      rows.push(h('div', { className: 'dshtb-row', key: 'font' },
        h('div', { className: 'dshtb-field' },
          h('span', { className: 'dshtb-fieldLabel' }, t.fontSize),
          h('input', {
            className: 'dshtb-input dshtb-num', type: 'number',
            min: LIMITS.fontSize[0], max: LIMITS.fontSize[1],
            value: cur.fontSize === undefined ? '' : cur.fontSize, onChange: set('fontSize')
          }),
          h('div', { className: 'dshtb-hint' }, t.fontSizeHint)
        ),
        h('div', { className: 'dshtb-field' },
          h('span', { className: 'dshtb-fieldLabel' }, t.maxChips),
          h('input', {
            className: 'dshtb-input dshtb-num', type: 'number',
            min: LIMITS.maxChips[0], max: LIMITS.maxChips[1],
            value: cur.maxChips === undefined ? '' : cur.maxChips, onChange: set('maxChips')
          }),
          h('div', { className: 'dshtb-hint' }, t.maxChipsHint)
        )))
      rows.push(h('div', { className: 'dshtb-row', key: 'width' },
        h('div', { className: 'dshtb-field' },
          h('span', { className: 'dshtb-fieldLabel' }, t.maxLabelPx),
          h('input', {
            className: 'dshtb-input dshtb-num', type: 'number',
            min: LIMITS.maxLabelPx[0], max: LIMITS.maxLabelPx[1],
            value: cur.maxLabelPx === undefined ? '' : cur.maxLabelPx, onChange: set('maxLabelPx')
          }),
          h('div', { className: 'dshtb-hint' }, t.maxLabelPxHint)
        ),
        h('div', { className: 'dshtb-field' },
          h('span', { className: 'dshtb-fieldLabel' }, t.dwell),
          h('input', {
            className: 'dshtb-input dshtb-num', type: 'number',
            min: LIMITS.dwellSec[0], max: LIMITS.dwellSec[1],
            value: cur.dwellSec === undefined ? '' : cur.dwellSec, onChange: set('dwellSec')
          }),
          h('div', { className: 'dshtb-hint' }, t.dwellHint)
        )))
      rows.push(h('div', { className: 'dshtb-row', key: 'minimal' },
        h('label', { className: 'dshtb-check' },
          h('input', { type: 'checkbox', checked: cur.minimal === true, onChange: set('minimal') }),
          t.minimal
        )))

      // ─ 显示 ─
      rows.push(h('div', { className: 'dshtb-row', key: 'display' },
        h('div', { className: 'dshtb-label' }, t.display),
        h('label', { className: 'dshtb-check' },
          h('input', { type: 'checkbox', checked: cur.showRunning !== false, onChange: set('showRunning') }),
          t.showRunning
        ),
        h('label', { className: 'dshtb-check' },
          h('input', { type: 'checkbox', checked: cur.showDone !== false, onChange: set('showDone') }),
          t.showDone
        ),
        h('label', { className: 'dshtb-check' },
          h('input', { type: 'checkbox', checked: cur.showWaiting !== false, onChange: set('showWaiting') }),
          t.showWaiting
        )
      ))
      rows.push(h('div', { className: 'dshtb-hint', key: 'showhint' }, t.showHint))

      // ─ 行为 ─
      rows.push(h('div', { className: 'dshtb-row', key: 'behavior' },
        h('div', { className: 'dshtb-label' }, t.behavior)))
      rows.push(h('div', { className: 'dshtb-row', key: 'click' },
        h('div', { className: 'dshtb-field' },
          h('span', { className: 'dshtb-fieldLabel' }, t.clickAction),
          h('select', { className: 'dshtb-select', value: cur.clickAction === 'openUrl' ? 'openUrl' : 'none', onChange: set('clickAction') },
            h('option', { value: 'none' }, t.clickNone),
            h('option', { value: 'openUrl' }, t.clickOpen),
            h('option', { value: 'openSession' }, t.clickOpenSession)
          )
        ),
        (cur.clickAction === 'openUrl' || cur.clickAction === 'openSession')
          ? h('div', { className: 'dshtb-field' },
              h('span', { className: 'dshtb-fieldLabel' }, cur.clickAction === 'openSession' ? t.openBase : t.openUrl),
              h('input', { className: 'dshtb-input', type: 'text', value: cur.openUrl || '', placeholder: 'https://127.0.0.1:3080', onChange: set('openUrl') }),
              h('div', { className: 'dshtb-hint' }, cur.clickAction === 'openSession' ? t.openBaseHint : t.openUrlHint)
            )
          : null
      ))
      rows.push(h('div', { className: 'dshtb-row', key: 'selfmaint' },
        h('label', { className: 'dshtb-check' },
          h('input', { type: 'checkbox', checked: cur.autoInstallExt !== false, onChange: set('autoInstallExt') }),
          t.autoInstall
        ),
        h('label', { className: 'dshtb-check' },
          h('input', { type: 'checkbox', checked: cur.autoReloadShell === true, onChange: set('autoReloadShell') }),
          t.autoReload
        )
      ))
      rows.push(h('div', { className: 'dshtb-hint', key: 'selfmaint-hint' },
        `${t.autoInstallHint} ${t.autoReloadHint}`))

      // ─ footer ─
      rows.push(h('div', { className: 'dshtb-footer', key: 'footer' },
        view && view.writable === false ? h('div', { className: 'dshtb-hint' }, t.readonly) : null,
        dirty ? h('div', { className: 'dshtb-hint' }, t.unsaved) : null,
        notice !== null ? h('div', { className: 'dshtb-ok' }, notice) : null,
        failed !== null ? h('div', { className: 'dshtb-failed' }, failed) : null,
        h('button', {
          className: 'dshtb-btn dshtb-ghost', disabled: saving || !dirty,
          onClick: () => { setDraft({ ...(view.value || {}) }); setFailed(null); setNotice(null) }
        }, t.discard),
        h('button', {
          className: 'dshtb-btn dshtb-save', disabled: saving || !dirty || !view || view.writable === false, onClick: save
        }, saving ? t.saving : t.save)
      ))

      return h('div', { className: open ? 'dshtb-card dshtb-cardOpen' : 'dshtb-card' },
        h('button', {
          type: 'button', className: 'dshtb-header', 'aria-expanded': open,
          onClick: () => { setOpen(!open) }
        },
          h('div', { className: 'dshtb-headText' },
            h('div', { className: 'dshtb-name' }, t.title),
            h('div', { className: 'dshtb-description' }, t.description)
          ),
          h('span', { className: open ? 'dshtb-chevron dshtb-chevronOpen' : 'dshtb-chevron', style: { display: 'inline-block' } }, '▾')
        ),
        open ? h('div', { className: 'dshtb-body' }, rows) : null
      )
    }

    function apply(ctx) {
      const sessionsSvc = ctx.get('sessions')
      if (sessionsSvc === undefined || sessionsSvc === null) {
        console.warn('[dsh-topbar] sessions service unavailable; not reporting')
        return
      }

      // ── deep link: ?open=<sessionId> → jump to that session ───────────
      //
      // The GNOME chip click opens <appUrl>?open=<id>; this half consumes it
      // on load, selects the session, and replaces the URL away — the same
      // read→act→clean dance the ?pair= param performs in dsh-web-all, and
      // the same sessions.open(id) seam the pet/task-board jump uses. The
      // session may not be on the list yet while the page still loads, so
      // the lookup retries briefly.
      try {
        if (typeof location !== 'undefined' && typeof history !== 'undefined') {
          const params = new URLSearchParams(location.search)
          const openId = params.get('open')
          if (openId !== null && openId !== '') {
            params.delete('open')
            const qs = params.toString()
            try {
              history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + (location.hash || ''))
            } catch (e) { /* cosmetic only */ }
            const jumpTo = (attempts) => {
              try {
                const snap = sessionsSvc.list.getSnapshot()
                const known = snap !== undefined && snap !== null && snap.byId !== undefined &&
                  snap.byId !== null && snap.byId[openId] !== undefined
                if (known) {
                  if (typeof sessionsSvc.open === 'function') sessionsSvc.open(openId)
                  return
                }
                if (attempts > 0) setTimeout(() => jumpTo(attempts - 1), 500)
                else console.warn('[dsh-topbar] deep-link session not on the list:', String(openId))
              } catch (e) {
                console.warn('[dsh-topbar] deep-link failed:', String(e && e.message || e))
              }
            }
            jumpTo(10)
          }
        }
      } catch (e) {
        console.warn('[dsh-topbar] deep link check failed:', String(e && e.message || e))
      }

      // Settings card on the official plugins tab (same seam dsh-free-search
      // and dsh-market use). Without the slot seam this silently degrades —
      // the reporter below still works.
      try {
        const slots = ctx.get('slots')
        if (slots !== undefined && slots !== null && react !== null) {
          slots.inject('settings.plugin.item', () =>
            slots.register({
              name: 'settings.plugin.item',
              key: NS,
              id: 'dsh-topbar',
              order: 120,
              inject: () => ({})
            }, TopbarCard)
          )
        }
      } catch (e) {
        console.warn('[dsh-topbar] settings card unavailable:', String(e && e.message || e))
      }

      let alive = true

      // Diagnostic snapshot of what this client observes, shipped with every
      // POST so the host can expose it through the topbar_status tool. This
      // is how we debug "the bar is empty" without a browser devtools session.
      const diag = { ids: 0, seen: [], error: '', lastPost: '' }

      const pageHidden = () => {
        try {
          return typeof document !== 'undefined' && document.visibilityState === 'hidden'
        } catch (e) { return false }
      }

      /** Map one session-list entry onto a chip state. */
      const stateOf = (entry) => {
        if (entry.running === true) return 'running'
        if (entry.completed === true) return 'done'
        return ''  // idle + acknowledged: no chip
      }

      const build = () => {
        let snap = null
        try {
          snap = sessionsSvc.list.getSnapshot()
        } catch (e) {
          diag.error = String(e && e.message || e)
          return []
        }
        if (snap === undefined || snap === null) {
          diag.error = 'snapshot undefined'
          return []
        }
        const out = []
        const ids = Array.isArray(snap.ids) ? snap.ids : []
        diag.ids = ids.length
        diag.seen = []
        for (const id of ids) {
          const entry = snap.byId ? snap.byId[id] : undefined
          if (entry === undefined || entry === null) continue
          // Sub-agent sessions would flood the bar; the sidebar nests them.
          if (entry.parentId !== undefined && entry.parentId !== null) continue
          const st = stateOf(entry)
          diag.seen.push(`${st || 'idle'}:${entry.running ? 'R' : '-'}${entry.completed ? 'C' : '-'}`)
          if (st === '') continue
          const title = entry.title || entry.displayTitle || id
          out.push({ id: String(id), title: String(title), state: st })
        }
        // Running first, then done — the most urgent chip sits closest to
        // the left edge. (Waiting chips are host-side overlays; the host
        // re-asserts the urgent-first ordering before the shell sees it.)
        const rank = { running: 0, done: 1 }
        out.sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9))
        return out
      }

      const post = async () => {
        if (!alive) return
        const list = build()
        const body = JSON.stringify({ sessions: list, diag: diag })
        // Always POST, even when the payload is unchanged: the host relays
        // the cadence toward the GNOME extension, whose 5s stale timer treats
        // silence as "the page is gone". Skipping identical payloads would
        // make a long-running turn's chip blink out while nothing was
        // happening. The payload is tiny, so the traffic is irrelevant.
        try {
          const res = await fetch(ROUTE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
          })
          diag.lastPost = res.ok ? 'ok' : 'http ' + res.status
        } catch (e) {
          diag.lastPost = 'network: ' + String(e && e.message || e).slice(0, 80)
        }
      }

      const tick = () => { if (alive) post() }

      // ── heartbeat ─────────────────────────────────────────────────────
      //
      // Chrome intensively throttles main-thread timer chains in tabs hidden
      // for more than ~5 minutes (down to 1 wake per minute), which would
      // starve the host's 15s watchdog and falsely clear the bar while the
      // user merely has another tab open. Dedicated-worker timers are not
      // intensively throttled, so the beat lives in a tiny blob Worker; the
      // ctx.timeout/setTimeout chain stays as a fallback for environments
      // without Worker (tests, exotic webviews) or if worker creation fails.

      let stopBeat = null
      let useCtxTimer = true
      try {
        ctx.timeout(() => {}, 1)
      } catch (e) {
        useCtxTimer = false
      }

      /** Fallback: self-rescheduling one-shot timer chain (ctx.timeout when
       * available — it returns a disposer — else setTimeout). */
      const beatViaTimers = () => {
        let stopped = false
        let handle = null
        const arm = (fn) => {
          if (useCtxTimer) {
            try { return ctx.timeout(fn, PUSH_MS) } catch (e) { useCtxTimer = false }
          }
          return setTimeout(fn, PUSH_MS)
        }
        const disarm = (hd) => {
          try {
            if (typeof hd === 'function') hd()
            else if (hd !== null && typeof hd === 'object' && typeof hd.dispose === 'function') hd.dispose()
            else clearTimeout(hd)
          } catch (e) { /* already gone */ }
        }
        const step = () => {
          if (stopped || !alive) return
          tick()
          handle = arm(step)
        }
        handle = arm(step)
        return () => {
          stopped = true
          if (handle !== null) disarm(handle)
          handle = null
        }
      }

      /** Preferred: the beat lives in a dedicated Worker, immune to the
       * hidden-tab timer throttling that hits main-thread chains. */
      const beatViaWorker = () => {
        const src = 'let t=null;self.onmessage=function(e){' +
          'if(e.data==="stop"){if(t!==null){clearInterval(t);t=null}}' +
          'else if(t===null){t=setInterval(function(){self.postMessage(0)},' + String(PUSH_MS) + ')}}'
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
        let w
        try {
          w = new Worker(url)
        } finally {
          URL.revokeObjectURL(url)
        }
        let dead = false
        w.onmessage = () => { if (!dead && alive) tick() }
        w.onerror = () => {
          // e.g. a CSP that blocks blob: workers — degrade to the timer chain.
          if (dead) return
          dead = true
          try { w.terminate() } catch (e) { /* already gone */ }
          stopBeat = beatViaTimers()
        }
        w.postMessage('start')
        return () => {
          dead = true
          try { w.postMessage('stop'); w.terminate() } catch (e) { /* already gone */ }
        }
      }

      // First snapshot right away — no reason to wait a full beat.
      tick()

      if (typeof Worker === 'function') {
        try { stopBeat = beatViaWorker() } catch (e) { stopBeat = beatViaTimers() }
      } else {
        stopBeat = beatViaTimers()
      }

      // When the tab returns to the foreground push immediately so the bar
      // catches up without waiting for the next beat.
      let removeVis = null
      try {
        const onVis = () => { if (!pageHidden()) tick() }
        document.addEventListener('visibilitychange', onVis)
        removeVis = () => document.removeEventListener('visibilitychange', onVis)
      } catch (e) { /* no document (non-web platform) */ }

      // Don't leave chips behind if the page unloads. sendBeacon ships the
      // body as text/plain (it cannot set a JSON content type); the host
      // route never inspects Content-Type, it just parses the body — that is
      // the (documented-here) contract this relies on.
      let removeUnload = null
      try {
        const onUnload = () => {
          try {
            navigator.sendBeacon(ROUTE, JSON.stringify({ sessions: [] }))
          } catch (e) { /* best effort */ }
        }
        window.addEventListener('pagehide', onUnload)
        removeUnload = () => window.removeEventListener('pagehide', onUnload)
      } catch (e) { /* ignore */ }

      const dispose = () => {
        alive = false
        if (stopBeat !== null) {
          try { stopBeat() } catch (e) { /* already gone */ }
          stopBeat = null
        }
        if (removeVis !== null) removeVis()
        if (removeUnload !== null) removeUnload()
      }
      if (typeof ctx.on === 'function') ctx.on('dispose', dispose)
      return dispose
    }

    exports.name = 'dsh-topbar'
    exports.inject = inject
    exports.apply = apply
    return module.exports
  }
})
