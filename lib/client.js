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
    //   2. Draw the configuration card on this bundle's Plugins page: it
    //      renders the HOST-owned form of the entry's settings namespace
    //      (ctx.configForms) through the shared SettingsForm renderer. Saved
    //      values ride every push payload toward the GNOME extension, so they
    //      land on the bar within a second.

    const PUSH_MS = 1000
    const ROUTE = '/dsh-topbar/state'
    // The key `plugins.bundle.config` dispatches this bundle by: its npm
    // package name.
    const NS = 'dsh-topbar'
    // The settings namespace is the profile ENTRY id our bundle patch declares
    // (cordis.patch.yml → `- id: topbar`), which is also the id the host half's
    // Config schema is projected under. A client package must not import a host
    // package, so it is spelled here (as the shipped settings pages do).
    const CFG_NS = 'topbar'

    const inject = ['sessions', 'timer', 'slots']

    let react = null
    let h = null
    try {
      react = require('react')
      h = react.createElement
    } catch (e) { /* card unavailable; the reporter still works */ }

    // ── configuration card ───────────────────────────────────────────────
    //
    // 0.2.0-rc2 hands the browser a Host-owned form per profile entry
    // (`ctx.configForms`) and the UI primitives ship the renderer for it. The
    // card below is that seam: staging, the overridden badge, the revision
    // fence and the write all belong to the Host — nothing here talks to a
    // private route or keeps a draft cache of its own.
    let primitives = null
    try {
      primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    } catch (e) { /* primitives unavailable; the reporter still works */ }

    // ── card css ─────────────────────────────────────────────────────────
    //
    // Only what the shared renderer does not ship: the switch and the selects,
    // whose label / hint / reset chrome this card draws itself.
    const css = [
      '.dshtb-form{flex-direction:column;gap:14px;display:flex}',
      '.dshtb-field{flex-direction:column;gap:6px;min-width:0;display:flex}',
      '.dshtb-fieldLabel{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}',
      '.dshtb-hint{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}',
      '.dshtb-bad{color:var(--dsw-alias-state-error-primary)}',
      '.dshtb-select{border:1px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);border-radius:6px;padding:6px 8px;font-size:13px}',
      '.dshtb-reset{align-self:flex-start;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;padding:0;font-size:12px;text-decoration:underline}',
      '.dshtb-reset:disabled{opacity:.5;cursor:default}'
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

    // Copy for the form frame and for the rows this card draws itself. A field
    // row reads its label under `label` and its hint under `hint`, so the field
    // table below stays a list of names.
    const t = zhUI ? {
      description: 'GNOME 顶栏各会话的运行状态色块：灰=运行中，绿=已完成，黄=等待。',
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
      subagent: '子智能体',
      subagentHint: '子智能体自己不出色块。选「上卷」时，子智能体运行中会让它所属的会话保持灰色——父会话这一轮已经结束也照样看得见；选「隐藏」则完全不进顶栏。',
      subagentRollup: '上卷到所属会话',
      subagentHide: '完全隐藏',
      clickAction: '点击色块',
      clickActionHint: '点击顶栏色块时的行为。',
      clickNone: '无操作',
      clickOpen: '打开 DSH 网页',
      clickOpenSession: '跳转到对应会话',
      openUrl: '网页地址',
      openUrlHint: '点击色块时用系统默认浏览器打开（http/https）。',
      openBase: '应用地址（DSH 网页）',
      openBaseHint: '可留空——自动使用本机 DSH 网页地址；填写则跳转打开 <地址>?open=<会话ID>。',
      jumpBrowser: '跳转浏览器',
      jumpBrowserHint: '留空 = 系统默认（xdg-open）；选定后用该浏览器的命令行打开，需已在 PATH 中。',
      browserAuto: '系统默认 (xdg-open)',
      browserFirefox: 'Firefox',
      browserEdge: 'Edge (microsoft-edge)',
      browserChrome: 'Chrome (google-chrome-stable)',
      browserChromium: 'Chromium',
      dwell: '提醒保持 (秒)',
      dwellHint: '回答后黄色保持多久；0 = 回答后立即消失；-1 = 常驻（直到会话真正结束或从列表消失）。',
      autoInstall: '自动安装 GNOME 扩展',
      autoInstallHint: 'DSH 启动时把扩展文件同步到 ~/.local/share/gnome-shell/extensions/（幂等，无需 sudo）。',
      autoReload: '自动重载 GNOME Shell',
      autoReloadHint: '扩展文件变化时自动重载 Shell。仅 X11；Wayland 会被拒绝（需手动注销重登或用 Alt+F2 → r）。',
      overridden: '已覆盖',
      reset: '恢复默认',
      invalidNumber: '请输入该范围内的整数。',
      invalidChoice: '请选择一个有效选项。',
      form: {
        unavailable: '该插件当前未加载，暂时无法配置。',
        readOnly: '本部署的设置为只读。',
        saveFailed: '本部署没有接受这些值，已保留供你修改。',
        save: '保存',
        saving: '保存中…'
      }
    } : {
      description: 'Per-session status chips on the GNOME top bar: gray=running, green=done, yellow=waiting.',
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
      subagent: 'Sub-agents',
      subagentHint: 'Sub-agents never get their own chip. "Roll up" keeps the owning session gray while a sub-agent runs — still visible after the parent turn ended; "Hide" keeps them off the bar entirely.',
      subagentRollup: 'Roll up to the owning session',
      subagentHide: 'Hide entirely',
      clickAction: 'On chip click',
      clickActionHint: 'What clicking a chip on the bar does.',
      clickNone: 'Do nothing',
      clickOpen: 'Open DSH web page',
      clickOpenSession: 'Jump to the session',
      openUrl: 'Page URL',
      openUrlHint: 'Opened with the default browser on click (http/https).',
      openBase: 'App URL (DSH web)',
      openBaseHint: 'Optional — defaults to this DSH web origin; when set, chip click opens <url>?open=<sessionId>.',
      jumpBrowser: 'Jump browser',
      jumpBrowserHint: 'Empty = system default (xdg-open); pick a browser or a custom single-token command on PATH.',
      browserAuto: 'System default (xdg-open)',
      browserFirefox: 'Firefox',
      browserEdge: 'Edge (microsoft-edge)',
      browserChrome: 'Chrome (google-chrome-stable)',
      browserChromium: 'Chromium',
      dwell: 'Reminder dwell (sec)',
      dwellHint: 'How long yellow stays after you answer; 0 = drop the moment you answer; -1 = keep until the session truly ends or leaves the list.',
      autoInstall: 'Auto-install GNOME extension',
      autoInstallHint: 'On DSH start, sync the extension files into ~/.local/share/gnome-shell/extensions/ (idempotent, no sudo).',
      autoReload: 'Auto-reload GNOME Shell',
      autoReloadHint: 'Reload the Shell automatically when extension files change. X11 only; refused on Wayland.',
      overridden: 'Overridden',
      reset: 'Reset to default',
      invalidNumber: 'Enter a whole number inside this range.',
      invalidChoice: 'Pick one of the listed values.',
      form: {
        unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
        readOnly: 'This deployment stores settings read-only.',
        saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
        save: 'Save',
        saving: 'Saving…'
      }
    }

    // Enum allowlists, normalized through the SAME list the host's normalizeCfg
    // falls back on — an unknown/absent value reads as the first entry (the
    // host default) instead of masquerading as an edit.
    const CLICK_ACTIONS = ['none', 'openUrl', 'openSession']
    const SUBAGENT_MODES = ['rollup', 'hide']
    const BROWSERS = ['', 'firefox', 'microsoft-edge', 'google-chrome-stable', 'chromium']
    const oneOf = (list, v) => (list.includes(v) ? v : list[0])

    // ── reporter-side live config ─────────────────────────────────────────
    //
    // build() needs subagentMode from the first tick, whether or not the card
    // is ever opened, so the Host form is subscribed once at load. The shipped
    // default holds until the first accepted section arrives (and on a
    // deployment that never serves the namespace): the bar keeps working, it
    // just uses the default sub-agent rule.
    let liveCfg = { subagentMode: 'rollup' }

    const adoptCfg = (section) => {
      if (section === null || section === undefined || typeof section !== 'object') return
      const mode = oneOf(SUBAGENT_MODES, section.subagentMode)
      if (mode !== liveCfg.subagentMode) liveCfg = { ...liveCfg, subagentMode: mode }
    }

    /** One row per settings field: the control it gets, its copy, and (for a
     *  number) the range a draft has to stay inside to be savable. */
    const FIELDS = [
      { field: 'fontSize', kind: 'number', lo: 9, hi: 14, label: 'fontSize', hint: 'fontSizeHint' },
      { field: 'maxChips', kind: 'number', lo: 1, hi: 12, label: 'maxChips', hint: 'maxChipsHint' },
      { field: 'maxLabelPx', kind: 'number', lo: 60, hi: 400, label: 'maxLabelPx', hint: 'maxLabelPxHint' },
      { field: 'dwellSec', kind: 'number', lo: -1, hi: 7200, label: 'dwell', hint: 'dwellHint' },
      { field: 'minimal', kind: 'bool', label: 'minimal', hint: 'minimalHint' },
      { field: 'showRunning', kind: 'bool', label: 'showRunning', hint: 'showHint' },
      { field: 'showDone', kind: 'bool', label: 'showDone', hint: 'showHint' },
      { field: 'showWaiting', kind: 'bool', label: 'showWaiting', hint: 'showHint' },
      { field: 'subagentMode', kind: 'select', values: SUBAGENT_MODES, options: { rollup: 'subagentRollup', hide: 'subagentHide' }, label: 'subagent', hint: 'subagentHint' },
      { field: 'clickAction', kind: 'select', values: CLICK_ACTIONS, options: { none: 'clickNone', openUrl: 'clickOpen', openSession: 'clickOpenSession' }, label: 'clickAction', hint: 'clickActionHint' },
      { field: 'openUrl', kind: 'text', label: 'openUrl', hint: 'openUrlHint' },
      { field: 'browser', kind: 'select', values: BROWSERS, passthrough: true, options: { '': 'browserAuto', firefox: 'browserFirefox', 'microsoft-edge': 'browserEdge', 'google-chrome-stable': 'browserChrome', chromium: 'browserChromium' }, label: 'jumpBrowser', hint: 'jumpBrowserHint' },
      { field: 'autoInstallExt', kind: 'bool', label: 'autoInstall', hint: 'autoInstallHint' },
      { field: 'autoReloadShell', kind: 'bool', label: 'autoReload', hint: 'autoReloadHint' }
    ]

    /** A whole-number field that refuses a draft outside the range the host
     *  clamps to, so a saved value never silently changes on the bar. */
    const rangeField = (field, lo, hi) => {
      const numeric = primitives.settingsNumberField(field)
      return {
        ...numeric,
        parse: (text) => {
          const write = numeric.parse(text)
          if (write === undefined || write.kind !== 'set') return write
          const value = write.value
          return Number.isSafeInteger(value) && value >= lo && value <= hi ? write : undefined
        }
      }
    }

    /** A closed-choice field: the draft is one of the allowlisted values. */
    const choiceField = (row) => ({
      field: row.field,
      format: (value) => (typeof value === 'string' && value !== '' ? value : row.values[0]),
      parse: (text) => (row.values.includes(text) ? { kind: 'set', value: text } : undefined)
    })

    /** The browser field: a preset, or a single-token command on PATH (the host
     *  accepts the same shape and falls back to the system default otherwise). */
    const browserField = (row) => ({
      field: row.field,
      format: (value) => (typeof value === 'string' ? value : ''),
      parse: (text) => (row.values.includes(text) || /^[A-Za-z0-9_./+-]{1,80}$/.test(text)
        ? { kind: 'set', value: text }
        : undefined)
    })

    /** A switch field: the draft text is 'true' or 'false'. */
    const boolField = (row) => ({
      field: row.field,
      format: (value) => (value === true ? 'true' : 'false'),
      parse: (text) => (text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined)
    })

    /** The spec one row stages its drafts through. */
    const specOf = (row) => {
      if (row.kind === 'number') return rangeField(row.field, row.lo, row.hi)
      if (row.kind === 'bool') return boolField(row)
      if (row.kind === 'select') return row.passthrough === true ? browserField(row) : choiceField(row)
      return primitives.settingsTextField(row.field)
    }

    /** The choices one select shows: its presets, plus the stored value when a
     *  preset list would otherwise hide a browser the user typed elsewhere. */
    const selectValues = (row, text) => (row.passthrough === true && !row.values.includes(text)
      ? row.values.concat([text])
      : row.values)

    /** The row copy the stored click action implies: the open URL doubles as
     *  the app address when the chip jumps to a session. */
    const rowText = (row, snapshot) => (row.field === 'openUrl' && snapshot.fields.clickAction.text === 'openSession'
      ? { label: 'openBase', hint: 'openBaseHint' }
      : { label: row.label, hint: row.hint })

    /** The chrome the shared renderer gives its own fields, for the controls it
     *  ships none of (the switch and the selects). */
    function customRow(common, control) {
      return h('div', { className: 'dshtb-field', key: common.key },
        h('span', { className: 'dshtb-fieldLabel' }, common.label),
        control,
        common.overridden
          ? h('button', {
              type: 'button', className: 'dshtb-reset', disabled: common.disabled,
              onClick: common.onReset
            }, common.resetLabel)
          : null,
        h('div', { className: common.invalid ? 'dshtb-hint dshtb-bad' : 'dshtb-hint' },
          common.invalid ? common.invalidLabel : common.hint)
      )
    }

    /**
     * One settings card: the Host form's rows inside the shared form frame.
     *
     * The frame owns availability, writability, the save and the discard; every
     * row here is a projection of the Host form, so the card never predicts what
     * a save would do — the next accepted section is what it renders.
     */
    function TopbarSettingsCard(props) {
      const snapshot = react.useSyncExternalStore(
        (listener) => props.formStore.subscribe(listener),
        () => props.formStore.getSnapshot()
      )
      if (props.view === 'summary') return t.description
      const shell = snapshot
      const actions = props.formActions
      const rows = FIELDS.map((row) => {
        const state = snapshot.fields[row.field]
        const copy = rowText(row, snapshot)
        const common = {
          key: row.field,
          id: 'dsh-topbar-' + row.field,
          label: t[copy.label],
          hint: t[copy.hint],
          text: state.text,
          overridden: state.overridden,
          invalid: state.invalid,
          overriddenLabel: t.overridden,
          resetLabel: t.reset,
          invalidLabel: t[row.kind === 'number' ? 'invalidNumber' : 'invalidChoice'],
          disabled: !shell.writable || shell.saving,
          onEdit: (text) => { actions.edit(row.field, text) },
          onReset: () => { actions.resetField(row.field) }
        }
        if (row.kind === 'number') return h(primitives.SettingsValueField, { ...common, numeric: true })
        if (row.kind === 'text') return h(primitives.SettingsValueField, common)
        if (row.kind === 'bool') {
          return customRow(common, h(primitives.Switch, {
            checked: state.text === 'true',
            label: common.label,
            disabled: common.disabled,
            onChange: (next) => { actions.edit(row.field, next ? 'true' : 'false') }
          }))
        }
        return customRow(common, h('select', {
          className: 'dshtb-select',
          value: state.text,
          disabled: common.disabled,
          'aria-label': common.label,
          onChange: (event) => { actions.edit(row.field, event.target.value) }
        }, selectValues(row, state.text).map((value) => h('option', { key: value, value },
          row.options[value] === undefined ? value : t[row.options[value]]))))
      })
      return h(primitives.SettingsForm, {
        labels: t.form,
        state: shell,
        onSave: actions.save,
        onDiscard: actions.discard
      }, h('div', { className: 'dshtb-form' }, rows))
    }

    function apply(ctx) {
      const sessionsSvc = ctx.get('sessions')
      if (sessionsSvc === undefined || sessionsSvc === null) {
        console.warn('[dsh-topbar] sessions service unavailable; not reporting')
        return
      }

      // ── green light source ─────────────────────────────────────────────
      //
      // DSH 0.2.0-rc2 dropped `SessionSummary.completed`, which this client
      // used to read for "finished but not yet acknowledged". That fact now
      // lives only in the unified UI status service (uiSession — declared in
      // this plugin's `inject`, without which the service is not reachable):
      // a Map of SessionId → { running, pendingInteraction, completionUnread },
      // the same source the sidebar's green dot reads.
      //
      // Resolved on EVERY build, never cached up here: the service may register
      // after this plugin starts, and re-reading lets the green state come up
      // on its own instead of staying dark until a reload. While it is missing
      // the green stays dark, and running / the sub-agent rollup / the
      // heartbeat keep reporting exactly as before.
      let statusWarned = false
      const statusMap = () => {
        try {
          const uiSession = ctx.get('uiSession')
          const feed = uiSession === undefined || uiSession === null ? null : uiSession.sessionStatus
          if (feed === undefined || feed === null || typeof feed.getSnapshot !== 'function') return null
          const snap = feed.getSnapshot()
          return snap === undefined || snap === null ? null : snap
        } catch (e) {
          // Once, not once per beat: a faulted service must not flood the
          // console while the bar keeps reporting everything else.
          if (!statusWarned) {
            statusWarned = true
            console.warn('[dsh-topbar] session status unavailable; done chips stay dark:', String(e && e.message || e))
          }
          return null
        }
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

      // Configuration card on this bundle's page. `plugins.bundle.config` is a
      // KEYED slot whose key is the npm package name the owner dispatches, and
      // the plugin manager declares it only while the page entry is mounted —
      // hence the slots.inject wrapper. The Host form is the only source of
      // values; the reporter below works whether or not the card ever mounts.
      if (primitives !== null && react !== null) {
        try {
          const slots = ctx.get('slots')
          if (slots !== undefined && slots !== null) {
            ctx.inject(['configForms'], (fctx) => {
              const form = fctx.configForms.get(CFG_NS)
              const model = new primitives.SettingsFormModel(form, FIELDS.map(specOf))
              fctx.effect(() => () => { model.dispose() }, 'dsh-topbar: settings form')
              const store = model.bind(() => {
                const fields = {}
                for (const row of FIELDS) fields[row.field] = model.field(row.field)
                return { ...model.shell(), fields }
              })
              const actions = model.actions()
              // build() needs subagentMode from the first tick, so the form is
              // read once here and followed afterwards — not only while the
              // card happens to be open. This is also the native replacement
              // for the private settings fetch the client used to do.
              const read = () => {
                const snapshot = form.getSnapshot()
                adoptCfg(snapshot.status === 'ready' ? snapshot.value : undefined)
              }
              read()
              fctx.effect(() => form.subscribe(read), 'dsh-topbar: live config')
              // whileServed: a deployment whose Host half never exposes the
              // namespace shows no card at all, rather than fields nothing
              // would accept.
              fctx.effect(() => fctx.configForms.whileServed([CFG_NS], () => slots.inject('plugins.bundle.config', () =>
                slots.register(
                  { name: 'plugins.bundle.config', key: NS },
                  (props) => h(TopbarSettingsCard, { ...props, formStore: store, formActions: actions })
                ))), 'dsh-topbar: card')
            })
          }
        } catch (e) {
          console.warn('[dsh-topbar] plugin config card unavailable:', String(e && e.message || e))
        }
      }

      let alive = true

      // Stable per-page identity for the heartbeat. Every tab reports its own
      // view; the host merges reporters by priority (waiting > running >
      // done), which removes the last-writer-wins flicker between pages.
      // sessionStorage survives reloads within the tab and stays unique.
      try {
        console.info('[dsh-topbar] client v0.4.4 loaded — subagent rollup armed')
      } catch (e) { /* console unavailable */ }
      let reporter = ''
      try {
        reporter = sessionStorage.getItem('dsh-topbar-reporter') || ''
        if (reporter === '') {
          reporter = 'r-' + (typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8))
          sessionStorage.setItem('dsh-topbar-reporter', reporter)
        }
      } catch (e) { /* storage unavailable: host degrades to a '?' slot */ }

      // Diagnostic snapshot of what this client observes, shipped with every
      // POST so the host can expose it through the topbar_status tool. This
      // is how we debug "the bar is empty" without a browser devtools session.
      const diag = { ids: 0, seen: [], error: '', lastPost: '', subagents: { kids: 0, busy: 0 } }

      const pageHidden = () => {
        try {
          return typeof document !== 'undefined' && document.visibilityState === 'hidden'
        } catch (e) { return false }
      }

      /** Map one session-list entry onto a chip state.
       *
       * `running` prefers the unified status and falls back to the summary bit
       * (`SessionSummary.running` is still there and still correct); `done` is
       * the unread-completion reminder. `SessionSummary.completed` no longer
       * exists in DSH 0.2.0-rc2, so reading it would silently keep the green
       * state dead.
       */
      const stateOf = (entry, status) => {
        if ((status?.running ?? entry.running) === true) return 'running'
        if (status?.completionUnread === true) return 'done'
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
        const rollup = liveCfg.subagentMode !== 'hide'

        // ── sub-agents: no chip of their own, but keep the owner alive ─────
        //
        // A sub-agent's `running` bit belongs to the CHILD, and the parent's
        // own turn may already have ended (a continuable child outliving it).
        // Without rollup that is a silent blind spot: real work, empty bar.
        // So collect child→parent once, then walk every running child up to
        // the top-level session that owns the chip. Transitive on purpose:
        // a grandchild keeps its whole ancestor chain lit.
        const parentOf = new Map()
        const runningKids = []
        for (const id of ids) {
          const entry = snap.byId ? snap.byId[id] : undefined
          if (entry === undefined || entry === null) continue
          if (entry.origin !== 'subagent') continue
          const key = String(id)
          const pid = entry.parentId
          if (typeof pid === 'string' && pid !== '') parentOf.set(key, pid)
          if (entry.running === true) runningKids.push(key)
        }
        // Top-level sessions kept alive by a running descendant.
        const busy = new Set()
        if (rollup) {
          for (const kid of runningKids) {
            let cur = kid
            const guard = new Set()
            while (!guard.has(cur)) {
              guard.add(cur)
              const up = parentOf.get(cur)
              if (up === undefined) break
              busy.add(up)
              cur = up
            }
          }
        }
        diag.subagents = { kids: runningKids.length, busy: busy.size }

        // One status snapshot per build, keyed by the same SessionId the
        // summary list uses; null when the service is missing.
        const statusById = statusMap()

        for (const id of ids) {
          const entry = snap.byId ? snap.byId[id] : undefined
          if (entry === undefined || entry === null) continue
          // Sub-agent sessions would flood the bar; the sidebar nests them.
          //
          // `origin === 'subagent'` is the ONLY correct test. `parentId` is NOT:
          // it is projected from the header's `parentSession`, which a FORKED
          // conversation also records (seed lineage: "the session this one was
          // forked from"). DSH's own header type documents the split —
          //   subagent child : parentSession set, isSeeded false, origin 'subagent', depth 1
          //   forked chat     : parentSession set, isSeeded true,  origin absent,  depth 0
          // Filtering on parentId therefore dropped every forked conversation
          // from the bar: a running fork showed no chip at all.
          if (entry.origin === 'subagent') continue
          const status = statusById === null || typeof statusById.get !== 'function'
            ? undefined
            : statusById.get(String(id))
          let st = stateOf(entry, status)
          // A running descendant outranks this session's own resting state:
          // work is in flight, so the chip is gray even if the parent itself
          // is idle (or green from an earlier completed turn).
          if (st !== 'running' && busy.has(String(id))) st = 'running'
          diag.seen.push(`${st || 'idle'}:${entry.running ? 'R' : '-'}${status?.completionUnread === true ? 'C' : '-'}`)
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
        const body = JSON.stringify({ sessions: list, reporter, diag: diag })
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
