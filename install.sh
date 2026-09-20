#!/usr/bin/env bash
# Install / update the DSH top bar session indicator.
#
# This script lives INSIDE the dsh-topbar package (npm package root shape:
# lib/ + extension/ + install.sh). It installs BOTH halves:
#
# Usage:
#   ./install.sh ext                    GNOME extension only (then reload Shell)
#   ./install.sh plugin                 plugin files into <profile>/node_modules
#   PROFILE_DIR=~/.dsh/profiles/<name> ./install.sh register
#                                       full OFFLINE registration into a profile
#                                       (file: dependency + composition patch +
#                                       node_modules sync + extension)
#   ./install.sh uninstall
#
# The DSH-plugin half can alternatively be installed from npm/git via the
# plugin manager; the GNOME extension half then self-installs on first mount
# (lib/index.js selfInstallExtension). This script remains the offline path.
#
# Notes:
#  - GNOME 3.36 caches extension modules per Shell session, so a changed
#    extension.js needs a Shell reload (Alt+F2, r, Enter — X11 only).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_UUID="dsh-topbar@cf206.local"
EXT_DIR="${HOME}/.local/share/gnome-shell/extensions/${EXT_UUID}"

# Profile to operate on. Override with:
#   PROFILE_DIR=~/.dsh/profiles/<name> ./install.sh ...
PROFILE_DIR="${PROFILE_DIR:-${HOME}/.dsh/profiles/web}"
PLUGIN_DIR="${PROFILE_DIR}/node_modules/dsh-topbar"

prechecks() {
  if ! command -v gdbus >/dev/null 2>&1 && [ ! -x /usr/bin/gdbus ]; then
    echo "    WARNING: gdbus not found — the host plugin cannot reach the bar" >&2
  fi
  if command -v gnome-shell >/dev/null 2>&1; then
    local ver
    ver="$(gnome-shell --version 2>/dev/null || true)"
    if [ -n "${ver}" ] && [[ "${ver}" != *"3.36"* ]]; then
      echo "    WARNING: this extension targets GNOME 3.36, found: ${ver}" >&2
    fi
  fi
}

install_ext() {
  echo "==> installing extension to ${EXT_DIR}"
  [ -d "${HERE}/extension" ] || { echo "    extension/ not found next to install.sh" >&2; exit 1; }
  mkdir -p "${EXT_DIR}"
  cp "${HERE}/extension/metadata.json" "${EXT_DIR}/metadata.json"
  cp "${HERE}/extension/extension.js" "${EXT_DIR}/extension.js"
  chmod 644 "${EXT_DIR}/metadata.json" "${EXT_DIR}/extension.js"
  # Register + enable. gsettings may warn if dconf is unavailable; harmless.
  gsettings set org.gnome.shell enabled-extensions \
    "$(gsettings get org.gnome.shell enabled-extensions | sed "s/@as \[\]/[]/")" 2>/dev/null || true
  local cur
  cur="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo '[]')"
  case "${cur}" in
    *"${EXT_UUID}"*) : ;;
    *) gsettings set org.gnome.shell enabled-extensions \
         "$(echo "${cur}" | sed "s/^\[/['${EXT_UUID}', /; s/^\[, /[/")" 2>/dev/null || true ;;
  esac
  echo "    enabled-extensions = $(gsettings get org.gnome.shell enabled-extensions 2>/dev/null)"
  echo "    Reload the Shell to pick up changes: Alt+F2 -> r -> Enter (X11)"
}

sync_into_node_modules() {
  local src="$1"
  mkdir -p "${PLUGIN_DIR}/lib"
  cp "${src}/package.json" "${PLUGIN_DIR}/package.json"
  cp "${src}/cordis.patch.yml" "${PLUGIN_DIR}/cordis.patch.yml"
  cp "${src}/lib/"*.js "${PLUGIN_DIR}/lib/"
  echo "    synced into ${PLUGIN_DIR}"
}

install_plugin() {
  echo "==> syncing ${HERE} to ${PLUGIN_DIR}"
  [ -d "${PLUGIN_DIR}" ] || { echo "    ${PLUGIN_DIR} not found — run 'register' for offline installs" >&2; exit 1; }
  sync_into_node_modules "${HERE}"
  echo "    Restart DSH to load the new host code; Ctrl+F5 the browser for the client."
}

# OFFLINE registration into a profile: makes this package the file: source of
# truth, patches the profile's package.json + cordis.patch.yml idempotently,
# syncs node_modules and installs the extension.
register_profile() {
  echo "==> registering into profile ${PROFILE_DIR}"
  [ -d "${PROFILE_DIR}" ] || { echo "    ${PROFILE_DIR} not found" >&2; exit 1; }

  # 1) Copy THIS package into the profile as the file: source of truth, so a
  #    later `pnpm install` re-resolves it even without the extraction dir.
  #    Skipped when we already ARE the registered copy (idempotent re-run).
  local src_dst="${PROFILE_DIR}/dsh-topbar"
  local this_real dst_real
  this_real="$(cd "${HERE}" && pwd -P)"
  dst_real=""
  if [ -d "${src_dst}" ]; then dst_real="$(cd "${src_dst}" && pwd -P)"; fi
  # Copying into ourselves is impossible — e.g. the package was extracted
  # directly under the profile root so PROFILE_DIR/dsh-topbar lands inside
  # HERE. Tell the user instead of corrupting anything.
  case "${src_dst}" in
    "${this_real}"/*)
      echo "    ERROR: ${PROFILE_DIR}/dsh-topbar would be inside this package (${this_real})." >&2
      echo "    Extract the bundle somewhere else (e.g. your home directory) and re-run," >&2
      echo "    or copy this directory to '${src_dst}' yourself first." >&2
      exit 1 ;;
  esac
  if [ "${this_real}" != "${dst_real}" ]; then
    rm -rf "${src_dst}"
    mkdir -p "${src_dst}"
    cp -r "${HERE}/." "${src_dst}/"
    rm -rf "${src_dst}/node_modules"
    echo "    package copied to ${src_dst}"
  else
    echo "    running from the registered copy; keeping ${src_dst}"
  fi

  # 2) Patch the profile: dependency + dsh.profile.bundles, idempotently.
  node - "$PROFILE_DIR" <<'NODE'
const fs = require('fs')
const path = require('path')
const dir = process.argv[2]
const pkgFile = path.join(dir, 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
let changed = false
pkg.dependencies = pkg.dependencies || {}
if (pkg.dependencies['dsh-topbar'] !== 'file:./dsh-topbar') {
  pkg.dependencies['dsh-topbar'] = 'file:./dsh-topbar'
  changed = true
}
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
if (!Array.isArray(pkg.dsh.profile.bundles)) pkg.dsh.profile.bundles = []
if (!pkg.dsh.profile.bundles.includes('dsh-topbar')) {
  pkg.dsh.profile.bundles.push('dsh-topbar')
  changed = true
}
if (changed) fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
console.log('    package.json: ' + (changed ? 'updated' : 'already registered'))
NODE

  # 3) Ensure the composition insert exists in the profile-root patch file.
  local patch="${PROFILE_DIR}/cordis.patch.yml"
  if [ -f "${patch}" ] && grep -q "dsh-topbar" "${patch}"; then
    echo "    cordis.patch.yml: already registered"
  else
    printf -- "- insert:\n    - id: topbar\n      name: 'dsh-topbar'\n" >> "${patch}"
    echo "    cordis.patch.yml: appended insert"
  fi

  # 4) Immediate node_modules sync so the next DSH restart mounts it even
  #    without a package-manager round trip.
  sync_into_node_modules "${src_dst}"

  echo "    Restart DSH; the extension half is installed below and re-syncs on future mounts."
}

uninstall_all() {
  echo "==> removing extension"
  gnome-extensions disable "${EXT_UUID}" 2>/dev/null || true
  rm -rf "${EXT_DIR}"
  echo "    plugin half left in ${PLUGIN_DIR}"
  echo "    (remove it from the profile with 'dsh plugin remove' if desired)"
  echo "    done (Shell reload clears any remaining chips)"
}

case "${1:-ext}" in
  ext)       prechecks; install_ext ;;
  plugin)    install_plugin ;;
  register)  prechecks; register_profile; install_ext ;;
  uninstall) uninstall_all ;;
  *) echo "usage: $0 [ext|plugin|register|uninstall]" >&2; exit 2 ;;
esac

echo "==> done"
