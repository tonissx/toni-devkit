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
  autoUpdater: injected = null, // só para testes: um electron-updater falso
}) {
  const mode = detectMode({ isPackaged, platform, portableDir });
  let state = { mode, status: 'idle', version: currentVersion, latestVersion: null, releaseUrl: null, progress: null, error: null };

  const setState = (patch) => { state = { ...state, ...patch }; broadcast(state); return state; };

  let autoUpdater = null;
  let quiet = false;      // checagem em segundo plano: não mexe no status (um download pronto continua pronto)
  let installing = false; // "Reiniciar e instalar" já em andamento
  if (mode === 'full') {
    autoUpdater = injected || require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    const live = (fn) => (...args) => { if (!quiet) fn(...args); };
    autoUpdater.on('checking-for-update', live(() => setState({ status: 'checking', error: null })));
    autoUpdater.on('update-available', live((info) => setState({ status: 'available', latestVersion: info.version })));
    autoUpdater.on('update-not-available', live(() => setState({ status: 'not-available' })));
    autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', progress: p }));
    autoUpdater.on('update-downloaded', (info) => setState({ status: 'downloaded', latestVersion: info.version }));
    autoUpdater.on('error', live((err) => setState({ status: 'error', error: String((err && err.message) || err) })));
  }

  // Sempre a última release, mesmo que outra tenha saído depois da verificação.
  const latestReleaseUrl = `https://github.com/${owner}/${repo}/releases/latest`;

  async function checkOnly() {
    setState({ status: 'checking', error: null });
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      const latest = String(data.tag_name || '').replace(/^v/, '');
      if (isNewer(latest, currentVersion)) setState({ status: 'available', latestVersion: latest, releaseUrl: latestReleaseUrl });
      else setState({ status: 'not-available' });
    } catch (e) {
      setState({ status: 'error', error: String((e && e.message) || e) });
    }
    return state;
  }

  /**
   * Checagem silenciosa (com uma atualização já baixada): só troca o estado se saiu uma versão
   * MAIS NOVA que a baixada. Sem rede ou sem novidade, o download pronto continua valendo.
   */
  async function refresh() {
    quiet = true;
    try {
      const r = await autoUpdater.checkForUpdates();
      const v = r && r.updateInfo && r.updateInfo.version;
      if (v && isNewer(v, state.latestVersion || state.version)) setState({ status: 'available', latestVersion: v, progress: null });
    } catch { /* sem rede: mantém o que já está baixado */ } finally { quiet = false; }
    return state;
  }

  const downloadNow = () => autoUpdater.downloadUpdate().then(() => state, () => state);

  return {
    get: () => state,

    check() {
      if (mode === 'unsupported') return Promise.resolve(state);
      if (mode === 'check-only') return checkOnly();
      if (state.status === 'checking' || state.status === 'downloading') return Promise.resolve(state);
      if (state.status === 'downloaded') return refresh(); // não apaga o "Reiniciar e instalar"
      return autoUpdater.checkForUpdates().then(() => state, () => state);
    },

    /** Baixa a versão MAIS NOVA no momento do clique (o `available` guardado pode ser de horas atrás). */
    async download() {
      if (mode !== 'full' || state.status !== 'available') return state;
      try { await autoUpdater.checkForUpdates(); } catch { return state; } // renova o que será baixado
      if (state.status !== 'available') return state; // a release sumiu / já está em dia
      return downloadNow();
    },

    /** Instala a versão mais nova: se saiu outra depois do download, baixa essa e instala só ela. */
    async install() {
      if (mode !== 'full' || state.status !== 'downloaded' || installing) return state;
      installing = true;
      try {
        await refresh();
        if (state.status === 'available') await downloadNow();
        if (state.status === 'downloaded') autoUpdater.quitAndInstall();
      } finally { installing = false; }
      return state;
    },
  };
}

module.exports = { createUpdaterService, detectMode, isNewer, parseSemver };
