'use strict';
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Worker } = require('node:worker_threads');

const isDev = process.argv.includes('--dev');
const isMac = process.platform === 'darwin';

/* ─────────────── Motor SQL (worker thread com Pyodide + sqlparse) ─────────────── */
let sqlWorker = null;
let sqlReady = null;
let seq = 0;
const pending = new Map();

function startSqlWorker() {
  if (sqlWorker) return sqlReady;
  // Worker threads não leem de dentro do .asar: usa a cópia desempacotada (asarUnpack).
  const workerFile = path.join(__dirname, 'sql', 'worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  sqlWorker = new Worker(workerFile);
  sqlReady = new Promise((resolve, reject) => {
    sqlWorker.on('message', (msg) => {
      if (msg.type === 'ready') return resolve({ sqlparse: msg.sqlparse });
      if (msg.type === 'fatal') return reject(new Error(msg.error));
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
    });
    sqlWorker.on('error', reject);
  });
  sqlWorker.on('exit', () => {
    for (const p of pending.values()) p.reject(new Error('Motor SQL encerrado'));
    pending.clear();
    sqlWorker = null;
    sqlReady = null;
  });
  sqlReady.catch(() => {});
  return sqlReady;
}

function callSql(op, payload) {
  return startSqlWorker().then(() => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    sqlWorker.postMessage({ id, op, ...payload });
  }));
}

/* ─────────────── Janela ─────────────── */
function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#050506',
    title: 'Toni Devkit',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    frame: isMac, // Windows/Linux: title bar própria do design system (tk-titlebar)
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));

  // Links externos abrem no navegador, nunca dentro do app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

/* ─────────────── IPC ─────────────── */
const fromEvent = (e) => BrowserWindow.fromWebContents(e.sender);

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
}));

ipcMain.on('win:minimize', (e) => fromEvent(e)?.minimize());
ipcMain.on('win:toggle-maximize', (e) => {
  const w = fromEvent(e);
  if (w) (w.isMaximized() ? w.unmaximize() : w.maximize());
});
ipcMain.on('win:close', (e) => fromEvent(e)?.close());

ipcMain.handle('theme:set', (_e, theme) => {
  nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : 'system';
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text ?? '')); return true; });
ipcMain.handle('clipboard:read', () => clipboard.readText());

ipcMain.handle('sql:status', () => startSqlWorker());
ipcMain.handle('sql:format', (_e, sql, options) => callSql('format', { sql, options }));

const SQL_FILTERS = [
  { name: 'SQL', extensions: ['sql', 'txt'] },
  { name: 'Todos os arquivos', extensions: ['*'] },
];

ipcMain.handle('file:open-sql', async (e) => {
  const r = await dialog.showOpenDialog(fromEvent(e), { properties: ['openFile'], filters: SQL_FILTERS });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const stat = await fs.stat(file);
  if (stat.size > 20 * 1024 * 1024) throw new Error('Arquivo maior que 20 MB');
  return { path: file, name: path.basename(file), content: await fs.readFile(file, 'utf8') };
});

ipcMain.handle('file:save-sql', async (e, content, suggestedName) => {
  const r = await dialog.showSaveDialog(fromEvent(e), {
    defaultPath: suggestedName || 'formatado.sql',
    filters: SQL_FILTERS,
  });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, String(content ?? ''), 'utf8');
  return { path: r.filePath, name: path.basename(r.filePath) };
});

/* ─────────────── Ciclo de vida ─────────────── */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });

  app.whenReady().then(() => {
    startSqlWorker(); // aquece o Pyodide em segundo plano enquanto a UI carrega
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => {
    if (sqlWorker) sqlWorker.terminate();
    if (!isMac) app.quit();
  });
}
