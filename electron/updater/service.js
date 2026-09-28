'use strict';
/**
 * Serviço de atualização (processo principal).
 * - Windows instalado (NSIS) e Linux (AppImage): modo "full" — electron-updater troca os arquivos sozinho.
 * - macOS e Windows portátil: modo "check-only" — só avisa que existe versão nova (via API do GitHub) e
 *   deixa a UI abrir a página da release no navegador; nenhum dos dois consegue se auto-substituir em disco.
 * - Modo dev (app não empacotado): "unsupported" — nunca toca no electron-updater.
 */

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)/;

function parseSemver(v) {
  const m = SEMVER.exec(String(v ?? '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/** true se `a` for uma versão mais nova que `b`. */
function isNewer(a, b) {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (!va || !vb) return false;
  if (va.major !== vb.major) return va.major > vb.major;
  if (va.minor !== vb.minor) return va.minor > vb.minor;
  return va.patch > vb.patch;
}

/** Decide o modo de atualização a partir do ambiente — sem efeitos colaterais, fácil de testar. */
function detectMode({ isPackaged, platform, portableDir }) {
  if (!isPackaged) return 'unsupported';
  if (platform === 'darwin') return 'check-only';
  if (platform === 'win32' && portableDir) return 'check-only';
  if (platform === 'win32' || platform === 'linux') return 'full';
  return 'unsupported';
}

function createUpdaterService({
  isPackaged,
  platform,
  portableDir,
  currentVersion,
  owner = 'tonissx',
  repo = 'toni-devkit',
  broadcast = () => {},
}) {
  const mode = detectMode({ isPackaged, platform, portableDir });
  let state = { mode, status: 'idle', version: currentVersion, latestVersion: null, releaseUrl: null, progress: null, error: null };

  const setState = (patch) => { state = { ...state, ...patch }; broadcast(state); return state; };

  let autoUpdater = null;
  if (mode === 'full') {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: null }));
    autoUpdater.on('update-available', (info) => setState({ status: 'available', latestVersion: info.version }));
    autoUpdater.on('update-not-available', () => setState({ status: 'not-available' }));
    autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', progress: p }));
    autoUpdater.on('update-downloaded', (info) => setState({ status: 'downloaded', latestVersion: info.version }));
    autoUpdater.on('error', (err) => setState({ status: 'error', error: String((err && err.message) || err) }));
  }

  async function checkOnly() {
    setState({ status: 'checking', error: null });
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      const latest = String(data.tag_name || '').replace(/^v/, '');
      if (isNewer(latest, currentVersion)) setState({ status: 'available', latestVersion: latest, releaseUrl: data.html_url });
      else setState({ status: 'not-available' });
    } catch (e) {
      setState({ status: 'error', error: String((e && e.message) || e) });
    }
    return state;
  }

  return {
    get: () => state,

    check() {
      if (mode === 'unsupported') return Promise.resolve(state);
      if (mode === 'check-only') return checkOnly();
      return autoUpdater.checkForUpdates().then(() => state, () => state);
    },

    download() {
      if (mode !== 'full' || state.status !== 'available') return Promise.resolve(state);
      return autoUpdater.downloadUpdate().then(() => state, () => state);
    },

    install() {
      if (mode === 'full' && state.status === 'downloaded') autoUpdater.quitAndInstall();
      return state;
    },
  };
}

module.exports = { createUpdaterService, detectMode, isNewer, parseSemver };
