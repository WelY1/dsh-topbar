// DSH Topbar Sessions — legacy variant: GNOME Shell 3.36 - 44 (legacy GJS).
//
// The host plugin and install.sh pick this variant when `gnome-shell
// --version` reports a major < 45; the ESM twin lives in
// ../modules/extension.js. This file is the WHOLE extension: the deployed
// directory holds only this file plus metadata.json, so it must not import a
// sibling module.
//
// Architecture: this extension OWNS the well-known D-Bus name
// `org.dsh.Topbar` and exports a `Push` method. The DSH host plugin calls
// Push(JSON) with the full session snapshot PLUS a `cfg` block carrying the
// user's DSH-side settings (font size, chip width, cap, minimal mode, click
// action). The extension only renders + expires; all state logic lives
// plugin-side.
//
// Stale handling: because the user runs `dsh web` in a terminal, the data
// source can vanish without notice. Every push refreshes a clock; if no push
// arrives within STALE_MS we clear the chips so no zombie indicators remain.
//
// Config changes ride the same channel: a changed `cfg` alters the payload
// content, so the push arrives immediately, and every chip is rebuilt with
// the new geometry — no Shell reload needed for setting tweaks.

const St = imports.gi.St;
const Main = imports.ui.main;
const Gio = imports.gi.Gio;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;

const BUS_NAME = 'org.dsh.Topbar';
const OBJ_PATH = '/org/dsh/Topbar';
const IFACE = '<node><interface name="org.dsh.Topbar">' +
  '<method name="Push"><arg type="s" direction="in"/><arg type="s" direction="out"/></method>' +
  '</interface></node>';

// Confirmed palette (user-approved).
const COLORS = {
  running: '#8a8a8a',   // 灰 — turn in flight
  done:    '#3fa34d',   // 绿 — completed, not yet acknowledged
  waiting: '#e0a819'    // 黄 — approval / question pending
};

// Defaults mirror the host's settings schema; the payload's cfg block
// overrides these per push.
const DEFAULT_CFG = {
  fontSize: 11,
  maxLabelPx: 140,
  maxChips: 8,
  minimal: false,
  clickAction: 'none',  // 'none' | 'openUrl' | 'openSession'
  openUrl: '',
  browser: ''           // '' = xdg-open; firefox/microsoft-edge/google-chrome-stable/chromium/自定义 token
};

// No push for this long => assume the DSH process is gone and clear chips.
const STALE_MS = 5000;

let _box = null;          // St.BoxLayout holding every chip
let _chips = new Map();   // sessionId -> { bin, label, state, title, clickId }
let _exported = null;     // Gio.DBusExportedObject
let _ownerId = null;      // bus_own_name id
let _staleTimer = null;   // GLib timeout id
let _lastPushAt = 0;
let _cfg = { ...DEFAULT_CFG };

function _clampInt(value, lo, hi, dflt) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

function _normalizeCfg(raw) {
  const cfg = { ...DEFAULT_CFG };
  if (raw === null || typeof raw !== 'object') return cfg;
  cfg.fontSize = _clampInt(raw.fontSize, 8, 20, 11);
  cfg.maxLabelPx = _clampInt(raw.maxLabelPx, 40, 800, 140);
  cfg.maxChips = _clampInt(raw.maxChips, 1, 16, 8);
  cfg.minimal = raw.minimal === true;
  cfg.clickAction = raw.clickAction === 'openUrl' || raw.clickAction === 'openSession' ? raw.clickAction : 'none';
  const url = String(raw.openUrl === undefined || raw.openUrl === null ? '' : raw.openUrl);
  cfg.openUrl = /^https?:\/\//.test(url) ? url : '';
  // 同 host 侧白名单/单 token 规则,双保险。
  const br = String(raw.browser === undefined || raw.browser === null ? '' : raw.browser).trim();
  cfg.browser = ['', 'firefox', 'microsoft-edge', 'google-chrome-stable', 'chromium'].includes(br)
    ? br
    : (/^[A-Za-z0-9_./+-]{1,80}$/.test(br) ? br : '');
  return cfg;
}

function _widthOf(text) {
  const l = new St.Label({ text: text });
  l.set_style('font-size:' + _cfg.fontSize + 'px;');
  return l.get_preferred_width(-1)[1];
}

/** Truncate to fit maxPx using binary search over codepoints (UTF-8 safe). */
function _truncate(text, maxPx) {
  const s = String(text === undefined || text === null ? '' : text);
  if (s === '') return '';
  if (_widthOf(s) <= maxPx) return s;
  const chars = Array.from(s);
  const ELL = '…';
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const cand = chars.slice(0, mid).join('') + ELL;
    if (_widthOf(cand) <= maxPx) lo = mid; else hi = mid - 1;
  }
  if (lo <= 0) return ELL;
  return chars.slice(0, lo).join('') + ELL;
}

function _styleFor(state) {
  const bg = COLORS[state] !== undefined ? COLORS[state] : COLORS.running;
  let css = 'background-color:' + bg + ';' +
    'border-radius:4px;' +
    'margin:0 2px;';
  css += _cfg.minimal
    ? 'width:12px;height:12px;padding:0;'
    : 'padding:2px 8px;';
  return css;
}

/** Open one URL. browser 空 = xdg-open(系统默认);预设映射到各家命令行
 *  (Firefox 用 --new-tab 确保进已运行实例的新标签页);其余按自定义单 token 处理。 */
function _chipClick(url) {
  try {
    if (url === '') return;
    let argv;
    switch (_cfg.browser) {
      case 'firefox':
        argv = ['firefox', '--new-tab', url];
        break;
      case 'microsoft-edge':
      case 'google-chrome-stable':
      case 'chromium':
        argv = [_cfg.browser, url];
        break;
      default:
        argv = [_cfg.browser !== '' ? _cfg.browser : 'xdg-open', url];
        break;
    }
    log('[dsh-topbar] click: browser="' + _cfg.browser + '" argv=' + argv.join(' '));
    imports.misc.util.spawn(argv);
  } catch (e) {
    log('[dsh-topbar] open url failed: ' + e);
  }
}

/**
 * Which URL this chip's click opens, if any:
 *   openSession → the per-session deep link attached by the host (rec.url)
 *   openUrl     → the configured page, same for every chip
 */
function _targetUrl(rec) {
  if (_cfg.clickAction === 'openSession' && typeof rec.url === 'string' && rec.url !== '') {
    return rec.url;
  }
  if (_cfg.clickAction === 'openUrl' && _cfg.openUrl !== '') {
    return _cfg.openUrl;
  }
  return '';
}

/** (Re)wire a chip's click handler to its current target URL. */
function _wireClick(entry, chipUrl) {
  const bin = entry.bin;
  if (entry.clickId !== null) {
    try { bin.disconnect(entry.clickId); } catch (e) { /* already gone */ }
    entry.clickId = null;
  }
  entry.url = chipUrl;
  if (chipUrl !== '') {
    bin.reactive = true;
    try {
      entry.clickId = bin.connect('button-release-event', function () { _chipClick(chipUrl); return false; });
    } catch (e) { /* cosmetic only */ }
  } else {
    bin.reactive = false;
  }
}

function _makeChip(rec) {
  const bin = new St.Bin({
    style: _styleFor(rec.state),
    y_align: Clutter.ActorAlign.CENTER
  });
  let label = null;
  if (!_cfg.minimal) {
    label = new St.Label({
      text: _truncate(rec.title, _cfg.maxLabelPx),
      y_align: Clutter.ActorAlign.CENTER
    });
    label.set_style('color:#fff;font-size:' + _cfg.fontSize + 'px;');
    bin.set_child(label);
  }
  // St.Bin hover text is optional and must never break rendering; guard the
  // capability. In minimal mode the tooltip IS the title, so always set it.
  try {
    if (typeof bin.set_tooltip_text === 'function' && rec.title) {
      bin.set_tooltip_text(String(rec.title));
    }
  } catch (e) { /* cosmetic only */ }
  const entry = { bin: bin, label: label, state: rec.state, title: rec.title, url: '', clickId: null };
  _wireClick(entry, _targetUrl(rec));
  return entry;
}

/** Diff the incoming snapshot against rendered chips. */
function _render(sessions) {
  if (_box === null) return;

  const seen = new Set();
  for (let i = 0; i < sessions.length; i++) {
    const rec = sessions[i];
    if (rec === null || typeof rec !== 'object') continue;
    const id = String(rec.id === undefined || rec.id === null ? '' : rec.id);
    if (id === '') continue;
    seen.add(id);

    const title = rec.title === undefined || rec.title === null ? '' : String(rec.title);
    const state = COLORS[rec.state] !== undefined ? rec.state : 'running';

    let entry = _chips.get(id);
    if (entry === undefined) {
      entry = _makeChip({ state: state, title: title, url: rec.url });
      _chips.set(id, entry);
      _box.add_child(entry.bin);
    } else {
      if (entry.state !== state) {
        entry.bin.set_style(_styleFor(state));
        entry.state = state;
      }
      if (entry.title !== title) {
        if (entry.label !== null) entry.label.set_text(_truncate(title, _cfg.maxLabelPx));
        try {
          if (typeof entry.bin.set_tooltip_text === 'function' && title) {
            entry.bin.set_tooltip_text(title);
          }
        } catch (e) { /* cosmetic only */ }
        entry.title = title;
      }
      // Keep the click target fresh (deep links change as sessions appear).
      const chipUrl = _targetUrl(rec);
      if (entry.url !== chipUrl) {
        _wireClick(entry, chipUrl);
      }
    }
  }

  // Remove chips whose session disappeared.
  const doomed = [];
  _chips.forEach(function (entry, id) {
    if (!seen.has(id)) doomed.push(id);
  });
  for (let i = 0; i < doomed.length; i++) {
    const id = doomed[i];
    const entry = _chips.get(id);
    if (entry.bin.get_parent() !== null) _box.remove_child(entry.bin);
    entry.bin.destroy();
    _chips.delete(id);
  }
}

function _clearAll() {
  if (_box === null) return;
  _chips.forEach(function (entry) {
    if (entry.bin.get_parent() !== null) _box.remove_child(entry.bin);
    entry.bin.destroy();
  });
  _chips.clear();
}

/** D-Bus entry point: the plugin pushes a full snapshot + config as JSON. */
function _onPush(json) {
  let payload = null;
  try {
    payload = JSON.parse(String(json));
  } catch (e) {
    return 'bad-json';
  }
  if (payload === null || typeof payload !== 'object') return 'bad-shape';

  // Config rides every push; a change forces a full rebuild with the new
  // geometry (labels re-truncate against the new font/width).
  const nextCfg = _normalizeCfg(payload.cfg);
  if (JSON.stringify(nextCfg) !== JSON.stringify(_cfg)) {
    _cfg = nextCfg;
    _clearAll();
  }

  _lastPushAt = Date.now();
  // The host already trims against maxChips with the priority order intact;
  // slicing here again is a backstop for a misbehaving source.
  const sessions = (Array.isArray(payload.sessions) ? payload.sessions : [])
    .slice(0, _cfg.maxChips);
  try {
    _render(sessions);
  } catch (e) {
    log('[dsh-topbar] render failed: ' + e);
    return 'render-error';
  }
  return 'ok:' + sessions.length;
}

function _startStaleWatch() {
  _staleTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, function () {
    if (_lastPushAt > 0 && (Date.now() - _lastPushAt) > STALE_MS) {
      _clearAll();
      _lastPushAt = 0;
    }
    return true; // keep ticking
  });
}

function init() {
  // Nothing to do; panel is built in enable().
}

function enable() {
  _box = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER });
  // Append at the END of the left box: right of Activities + app menu,
  // left of the clock. Matches the user's reference screenshot.
  Main.panel._leftBox.add_child(_box);

  // Export the service and own the name so the plugin can call us.
  try {
    const impl = { Push: _onPush };
    _exported = Gio.DBusExportedObject.wrapJSObject(IFACE, impl);
    _exported.export(Gio.DBus.session, OBJ_PATH);
    _ownerId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      null, null, null
    );
  } catch (e) {
    log('[dsh-topbar] D-Bus export failed: ' + e);
  }

  _startStaleWatch();
  log('[dsh-topbar] enabled on ' + BUS_NAME);
}

function disable() {
  if (_staleTimer !== null) {
    GLib.source_remove(_staleTimer);
    _staleTimer = null;
  }
  _clearAll();
  if (_box !== null) {
    if (_box.get_parent() !== null) _box.get_parent().remove_child(_box);
    _box.destroy();
    _box = null;
  }
  try {
    if (_exported !== null) _exported.unexport();
  } catch (e) { /* already gone */ }
  _exported = null;
  try {
    if (_ownerId !== null) Gio.bus_unown_name(_ownerId);
  } catch (e) { /* already gone */ }
  _ownerId = null;
  _chips = new Map();
  _lastPushAt = 0;
  log('[dsh-topbar] disabled');
}
