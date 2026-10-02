'use strict';
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, nativeTheme, globalShortcut, Tray, Menu, nativeImage, protocol, net, powerMonitor } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const { Worker } = require('node:worker_threads');
const palette = require('./palette');
const binds = require('./binds');
const { createPaster } = require('./paste');
const { createWinHelper } = require('./winfocus');
const { UI_BINDABLE_IDS } = require('../src/commands/binds.js');
const { createNotesService } = require('./notes/service');
const { createBus } = require('./events');
const { createDevCoreService } = require('./devcore/service');
const { createUpdaterService } = require('./updater/service');
const { createLinksService } = require('./links/service');
const { createVaultService } = require('./vault/service');

// Event Bus: as features anunciam o que aconteceu; módulos (DevCore) escutam sem acoplamento.
const bus = createBus();

const isDev = process.argv.includes('--dev');
const isMac = process.platform === 'darwin';
// Iniciado com o sistema (login item): só a palette e o tray sobem; a janela principal nasce sob demanda.
const startHidden = process.argv.includes('--hidden');
let quitting = false;

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

/* ─────────────── Janela principal ─────────────── */
let mainWin = null;
let mainLoaded = false;
let mainQueue = []; // comandos para a janela principal enviados antes de ela terminar de carregar

function createMainWindow() {
  startSqlWorker(); // aquece o Pyodide em segundo plano enquanto a UI carrega
  mainLoaded = false;
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
  mainWin = win;

  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
  // Fechar esconde na bandeja: o processo continua vivo para o atalho global funcionar.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    trayHintOnce();
  });
  win.on('closed', () => { if (mainWin === win) { mainWin = null; mainLoaded = false; } });
  win.webContents.on('did-finish-load', () => {
    mainLoaded = true;
    for (const cmd of mainQueue) win.webContents.send('app:command', cmd);
    mainQueue = [];
  });

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

/** Envia um comando (navegar, tema, sidebar) para a janela principal — ou enfileira até ela carregar. */
function sendToMain(cmd) {
  if (mainWin && mainLoaded) mainWin.webContents.send('app:command', cmd);
  else mainQueue = [...mainQueue.slice(-19), cmd];
}

/** Traz a janela principal para frente (criando se preciso) e, opcionalmente, navega. */
function showMain(route, params) {
  if (route) sendToMain({ type: 'go', route, params });
  if (!mainWin) { createMainWindow(); return; } // aparece sozinha no ready-to-show
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

/* ─────────────── Bandeja ─────────────── */
let tray = null;

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(palette.getStatus().registered
    ? 'Toni Devkit — Ctrl+Alt+Space abre a command palette'
    : 'Toni Devkit — atalho Ctrl+Alt+Space em uso por outro app');
  buildTrayMenu();
  tray.on('click', () => showMain());
}

/** Menu da bandeja — refeito quando os Smart Binds mudam, para mostrar o atalho atual. */
function buildTrayMenu() {
  if (!tray) return;
  const bound = (id, label) => {
    const acc = binds.accelerator(id);
    return { label, click: () => palette.run(id), ...(acc ? { accelerator: acc, registerAccelerator: false } : {}) };
  };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Devkit', click: () => showMain() },
    { label: 'Command Palette', accelerator: 'Ctrl+Alt+Space', registerAccelerator: false, click: () => palette.show('tray') },
    { type: 'separator' },
    bound('clipboard:auto', 'Formatar clipboard (SQL ou XML)'),
    bound('clipboard:sql', 'Formatar SQL do clipboard'),
    bound('clipboard:xml', 'Formatar XML do clipboard'),
    { type: 'separator' },
    { label: 'Bloquear cofre', click: () => { if (vault) vault.lock('tray'); } },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]));
}

/** Na primeira vez que a janela vai para a bandeja, avisa que o app continua rodando. */
async function trayHintOnce() {
  const marker = path.join(app.getPath('userData'), 'tray-hint-shown');
  try { await fs.access(marker); return; } catch { /* ainda não mostrado */ }
  if (tray && process.platform === 'win32') {
    tray.displayBalloon({
      iconType: 'info',
      title: 'O Devkit continua rodando',
      content: 'Ctrl+Alt+Space abre a command palette. Para sair, use o ícone na bandeja.',
    });
  }
  fs.writeFile(marker, '1').catch(() => {});
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
  // Qualquer tema que não seja claro/sistema é uma variante escura (hacking, dracula, etc.) —
  // o chrome nativo da janela só entende claro/escuro/sistema.
  nativeTheme.themeSource = theme === 'light' ? 'light' : theme === 'system' ? 'system' : 'dark';
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

const XML_FILTERS = [
  { name: 'XML', extensions: ['xml', 'xsd', 'xsl', 'xslt', 'svg', 'wsdl', 'pom'] },
  { name: 'Todos os arquivos', extensions: ['*'] },
];

ipcMain.handle('file:open-xml', async (e) => {
  const r = await dialog.showOpenDialog(fromEvent(e), { properties: ['openFile'], filters: XML_FILTERS });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const stat = await fs.stat(file);
  if (stat.size > 20 * 1024 * 1024) throw new Error('Arquivo maior que 20 MB');
  return { path: file, name: path.basename(file), content: await fs.readFile(file, 'utf8') };
});

ipcMain.handle('file:save-xml', async (e, content, suggestedName) => {
  const r = await dialog.showSaveDialog(fromEvent(e), {
    defaultPath: suggestedName || 'formatado.xml',
    filters: XML_FILTERS,
  });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, String(content ?? ''), 'utf8');
  return { path: r.filePath, name: path.basename(r.filePath) };
});

const JSON_FILTERS = [
  { name: 'JSON', extensions: ['json', 'jsonc', 'geojson', 'har'] },
  { name: 'Todos os arquivos', extensions: ['*'] },
];

ipcMain.handle('file:open-json', async (e) => {
  const r = await dialog.showOpenDialog(fromEvent(e), { properties: ['openFile'], filters: JSON_FILTERS });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const stat = await fs.stat(file);
  if (stat.size > 20 * 1024 * 1024) throw new Error('Arquivo maior que 20 MB');
  return { path: file, name: path.basename(file), content: await fs.readFile(file, 'utf8') };
});

// Salva texto (json/yaml/csv/svg) ou bytes (png); o filtro do diálogo vem da extensão do nome sugerido.
ipcMain.handle('file:save-export', async (e, content, suggestedName) => {
  const ext = (path.extname(suggestedName || '').slice(1) || 'json').toLowerCase();
  const r = await dialog.showSaveDialog(fromEvent(e), {
    defaultPath: suggestedName || 'dados.json',
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Todos os arquivos', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const data = typeof content === 'string' ? content : Buffer.from(content);
  await fs.writeFile(r.filePath, data, typeof content === 'string' ? 'utf8' : undefined);
  return { path: r.filePath, name: path.basename(r.filePath) };
});

const TEXT_FILTERS = [
  { name: 'Todos os arquivos', extensions: ['*'] },
  { name: 'Texto e código', extensions: ['txt', 'json', 'xml', 'sql', 'js', 'ts', 'csv', 'log', 'md', 'yml', 'yaml', 'ini', 'properties', 'html', 'css'] },
];

ipcMain.handle('file:open-text', async (e) => {
  const r = await dialog.showOpenDialog(fromEvent(e), { properties: ['openFile'], filters: TEXT_FILTERS });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  const stat = await fs.stat(file);
  if (stat.size > 20 * 1024 * 1024) throw new Error('Arquivo maior que 20 MB');
  return { path: file, name: path.basename(file), content: await fs.readFile(file, 'utf8') };
});

/* ─────────────── Command palette, janela principal e sistema ─────────────── */
ipcMain.on('palette:toggle', () => palette.toggle('app'));
// restore: Esc na palette aberta por atalho → o foco volta para o programa que estava na frente.
ipcMain.on('palette:hide', (_e, opts) => {
  palette.hide();
  if (opts && opts.restore) snippetPaster.restoreFocus().catch(() => {}); else snippetPaster.forget();
});
ipcMain.on('palette:resize', (_e, height) => palette.resize(height));
ipcMain.handle('palette:status', () => palette.getStatus());

/* ─────────────── Smart Binds (atalhos globais → comandos da palette) ─────────────── */
ipcMain.handle('binds:get', () => binds.get());
ipcMain.handle('binds:set', (_e, next) => binds.set(next && typeof next === 'object' ? next : {}));
ipcMain.handle('binds:suspend', (_e, on) => binds.suspend(!!on));
ipcMain.on('binds:result', (_e, result) => binds.notify(result));

/** Dispara um bind: a maioria roda oculta na palette; os de UI (lista de snippets) mostram a palette. */
const runBind = (id) => (UI_BINDABLE_IDS.includes(id) ? palette.show('snippets') : palette.run(id));

// Colar snippet: a palette esconde, o foco volta ao programa anterior e o Ctrl+V é simulado (ver electron/paste.js).
const winHelper = createWinHelper();
const snippetPaster = createPaster({ clipboard, win: winHelper, hide: () => palette.hide(), notify: (r) => binds.notify(r) });
ipcMain.handle('snippet:paste', (_e, payload) => snippetPaster.paste(payload && typeof payload === 'object' ? payload : {}));
// Abertura por atalho: guarda a janela ativa (o foco volta para ela ao colar ou no Esc). Outras origens esquecem a antiga.
palette.setBeforeShow((source) => (source === 'shortcut' || source === 'snippets' ? snippetPaster.capture() : snippetPaster.forget()));

ipcMain.on('app:open', (_e, route, params) => {
  palette.hide();
  showMain(typeof route === 'string' ? route : undefined, params && typeof params === 'object' ? params : undefined);
});
ipcMain.on('app:command', (_e, cmd) => { if (cmd && typeof cmd.type === 'string') sendToMain(cmd); });
ipcMain.on('app:quit', () => { quitting = true; app.quit(); });

/* ─────────────── Event Bus (renderer → processo principal) ─────────────── */
ipcMain.on('events:emit', (_e, name, data) => { bus.emit(String(name), data); });

/* ─────────────── DevCore ─────────────── */
// Estado do jogo em %APPDATA%/Toni Devkit/devcore.json. DEVKIT_DEVCORE_NOW_OFFSET (ms) desloca o relógio — só para testes.
let devcore = null;
let devcoreReady = null;
const clockOffset = Number(process.env.DEVKIT_DEVCORE_NOW_OFFSET) || 0;
const broadcastDevCore = (msg) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('devcore:changed', msg); };

function initDevCore() {
  devcore = createDevCoreService({
    file: path.join(app.getPath('userData'), 'devcore.json'),
    now: () => Date.now() + clockOffset,
    broadcast: broadcastDevCore,
  });
  devcoreReady = devcore.init().then(() => {
    devcore.start();
    bus.on('*', (name, data) => devcore.onEvent(name, data));
  }).catch((e) => { console.error('[devcore]', e); throw e; });
}

ipcMain.handle('devcore:get', async () => { await devcoreReady; return devcore.get(); });
ipcMain.handle('devcore:act', async (_e, action) => { await devcoreReady; return devcore.act(action); });
ipcMain.handle('devcore:abilities', async () => { await devcoreReady; return devcore.abilities(); });
ipcMain.handle('devcore:items', async () => { await devcoreReady; return devcore.items(); });

/* ─────────────── Notes ─────────────── */
// Um .md por nota em Documentos\Devkit Notes (DEVKIT_NOTES_DIR sobrescreve — usado nos testes).
let notes = null;
let notesReady = null;
const broadcastNotes = (evt) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('notes:changed', evt); };

const notesDir = () => process.env.DEVKIT_NOTES_DIR || path.join(app.getPath('documents'), 'Devkit Notes');

function initNotes() {
  notes = createNotesService({ dir: notesDir(), broadcast: broadcastNotes, events: bus });
  notesReady = notes.init().catch((e) => { console.error('[notes]', e); throw e; });
}

const NOTES_API = ['info', 'list', 'get', 'save', 'create', 'remove', 'restore', 'search', 'recent', 'markViewed', 'resolveLink', 'tags', 'tasks', 'toggleTask', 'appendTask', 'folders', 'createFolder', 'renameFolder', 'moveFolder', 'moveNote', 'removeFolder', 'restoreFolder', 'saveImage', 'backlinks', 'linkRefs', 'renameLinks', 'history', 'version', 'restoreVersion', 'trashList', 'restoreFromTrash', 'deleteFromTrash', 'emptyTrash', 'templates', 'fromTemplate', 'ensureRootFolder', 'graph', 'trashCount'];
for (const fn of NOTES_API) {
  ipcMain.handle('notes:' + fn, async (_e, ...args) => { await notesReady; return notes[fn](...args); });
}
ipcMain.handle('notes:open-folder', async () => { await notesReady; return shell.openPath(notes.dir); });
// Clique numa imagem do preview: abre no visualizador do sistema.
ipcMain.handle('notes:open-asset', async (_e, ref) => { await notesReady; return shell.openPath(notes.assetFile(ref)); });

// Imagens das notas (.assets\) chegam ao renderer por devkit-note://asset/<nome> (a CSP libera só este esquema).
protocol.registerSchemesAsPrivileged([{ scheme: 'devkit-note', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
function registerNotesProtocol() {
  protocol.handle('devkit-note', async (req) => {
    try {
      const u = new URL(req.url);
      if (u.host !== 'asset') return new Response('Not found', { status: 404 });
      await notesReady;
      return net.fetch(pathToFileURL(notes.assetFile(decodeURIComponent(u.pathname.slice(1)))).toString());
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// Abrir uma nota (ou uma nova) na janela principal — usado pela palette.
ipcMain.on('app:open-note', (_e, payload) => {
  palette.hide();
  if (payload && (typeof payload.id === 'string' || payload.new)) sendToMain({ type: 'open-note', ...payload });
  showMain('notes');
});

/* ─────────────── Links rápidos (alias → URL com {q}) ─────────────── */
// Documentos\Devkit Notes\.devkit\links.json — junto das notas, fora da interface do Notes.
let links = null;
let linksReady = null;
const broadcastLinks = (evt) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('links:changed', evt); };

function initLinks() {
  links = createLinksService({ file: path.join(notesDir(), '.devkit', 'links.json'), broadcast: broadcastLinks });
  linksReady = links.init().catch((e) => { console.error('[links]', e); });
}

for (const fn of ['list', 'save', 'remove', 'forget']) {
  ipcMain.handle('links:' + fn, async (_e, ...args) => { await linksReady; return links[fn](...args); });
}
// Abrir: monta a URL (só http/https, validado em src/links/link.js), guarda o valor nos recentes e abre no navegador.
ipcMain.handle('links:open', async (_e, id, value) => {
  await linksReady;
  const url = await links.use(id, value);
  palette.hide();
  await shell.openExternal(url);
  return url;
});
// Copiar: só monta a URL (e guarda o valor nos recentes); o renderer põe no clipboard.
ipcMain.handle('links:url', async (_e, id, value) => { await linksReady; return links.use(id, value); });

ipcMain.handle('shell:open-url', (_e, url) => {
  const u = new URL(String(url));
  if (u.protocol !== 'https:') throw new Error('Só links https são permitidos');
  palette.hide();
  return shell.openExternal(u.toString());
});

// Iniciar com o sistema já em segundo plano (--hidden). Em dev o executável é o electron.exe,
// então o caminho do app precisa ir junto nos argumentos.
const loginArgs = () => (app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']);
ipcMain.handle('app:login-item', (_e, enable) => {
  const supported = process.platform !== 'linux';
  if (supported && typeof enable === 'boolean') app.setLoginItemSettings({ openAtLogin: enable, args: loginArgs() });
  return { supported, openAtLogin: supported && app.getLoginItemSettings({ args: loginArgs() }).openAtLogin };
});

/* ─────────────── Vault (cofre de dados sensíveis) ─────────────── */
// %APPDATA%/Toni Devkit/vault.json, criptografado com a senha mestra (ver electron/vault/service.js).
let vault = null;
let vaultReady = null;
const broadcastVault = (evt) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('vault:changed', evt); };

function initVault() {
  vault = createVaultService({
    file: path.join(app.getPath('userData'), 'vault.json'),
    clipboard,
    // Fora do histórico do Windows (Win+V) pelo auxiliar; sem ele (outro SO, auxiliar fora do ar), texto comum.
    writeSecret: async (text) => {
      if (process.platform === 'win32') {
        try { await winHelper.secretClip(text); return; } catch (e) { console.warn('[vault] clipboard protegido indisponível:', e.message); }
      }
      clipboard.writeText(text);
    },
    broadcast: broadcastVault,
  });
  vaultReady = vault.init().catch((e) => { console.error('[vault]', e); throw e; });
  // Tela bloqueada ou PC suspenso: tranca o cofre.
  powerMonitor.on('lock-screen', () => vault.lock('system'));
  powerMonitor.on('suspend', () => vault.lock('system'));
}

const VAULT_API = ['status', 'create', 'unlock', 'lock', 'list', 'resolve', 'save', 'remove', 'reveal', 'copy', 'setSettings', 'changePassword', 'reset'];
for (const fn of VAULT_API) {
  ipcMain.handle('vault:' + fn, async (_e, ...args) => { await vaultReady; return vault[fn](...args); });
}
ipcMain.handle('vault:export', async (e) => {
  await vaultReady;
  if (!vault.status().unlocked) throw new Error('O cofre está bloqueado');
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(fromEvent(e), {
    defaultPath: `devkit-vault-${stamp}.json`,
    filters: [{ name: 'Cofre do Devkit (criptografado)', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  return vault.exportTo(r.filePath);
});

/* ─────────────── Atualização ─────────────── */
// Windows instalado (NSIS) e Linux: electron-updater troca os arquivos sozinho. macOS e Windows
// portátil (não conseguem se auto-substituir em disco): só avisam e abrem a release no navegador.
let updater = null;
const broadcastUpdater = (s) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('updater:changed', s); };

function initUpdater() {
  updater = createUpdaterService({
    isPackaged: app.isPackaged,
    platform: process.platform,
    portableDir: process.env.PORTABLE_EXECUTABLE_DIR || null,
    currentVersion: app.getVersion(),
    broadcast: broadcastUpdater,
  });
  if (updater.get().mode === 'unsupported') return;
  let lastCheck = 0;
  const checkIfStale = (minMs) => {
    if (Date.now() - lastCheck < minMs) return;
    lastCheck = Date.now();
    updater.check().catch(() => {});
  };
  setTimeout(() => checkIfStale(0), 15_000);
  const interval = setInterval(() => checkIfStale(0), 4 * 60 * 60 * 1000);
  if (interval.unref) interval.unref();
  // O app vive na bandeja: quando o usuário abre a janela é que ele vai atualizar, então confere de novo
  // (no máximo a cada 10 min) para não oferecer uma versão que já ficou velha.
  app.on('browser-window-focus', (_e, win) => { if (win === mainWin) checkIfStale(10 * 60 * 1000); });
}

ipcMain.handle('updater:status', () => updater.get());
ipcMain.handle('updater:check', () => updater.check());
ipcMain.handle('updater:download', () => updater.download());
ipcMain.handle('updater:install', () => updater.install());

/* ─────────────── Ciclo de vida ─────────────── */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());

  // AppUserModelId próprio: a barra de tarefas e as notificações pegam ícone/nome do atalho do Menu Iniciar com
  // o mesmo ID. Instalado, é o atalho do instalador. Em dev, sem ID explícito o processo fica com o padrão
  // electron.app.Electron e herda o ícone de qualquer atalho "Electron" que exista; com um ID sem atalho, o
  // Windows usa o ícone da janela. O sufixo .dev evita agrupar com o Devkit instalado.
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'br.com.navship.tonidevkit' : 'br.com.navship.tonidevkit.dev');

  app.whenReady().then(() => {
    initNotes();
    initLinks();
    initVault();
    registerNotesProtocol();
    initDevCore();
    initUpdater();
    palette.create();
    palette.registerShortcut();
    createTray();
    binds.init({ run: runBind, changed: buildTrayMenu })
      .then(() => {
        // Sobe o auxiliar do Windows em segundo plano: o 1º atalho já encontra a janela anterior para guardar.
        winHelper.warm();
        // Com um atalho que formata SQL, aquece o Pyodide em segundo plano: o primeiro uso não espera o motor subir.
        if (binds.accelerator('clipboard:auto') || binds.accelerator('clipboard:sql')) setTimeout(() => startSqlWorker().catch(() => {}), 5000);
      })
      .catch((e) => console.error('[binds]', e));
    if (!startHidden) createMainWindow();
    app.on('activate', () => showMain());
  });

  // Antes de sair: pede às janelas que gravem o que estiver pendente no auto-save e espera a fila de gravação.
  let notesFlushed = false;
  app.on('before-quit', (e) => {
    quitting = true;
    if (notesFlushed || !notes) return;
    e.preventDefault();
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('notes:flush');
    setTimeout(async () => {
      await notes.flush().catch(() => {});
      if (devcore) await devcore.flush().catch(() => {});
      if (links) await links.flush().catch(() => {});
      if (vault) await vault.flush().catch(() => {});
      notesFlushed = true;
      app.quit();
    }, 300);
  });
  // Sem janelas visíveis o app continua na bandeja (a janela da palette nunca fecha).
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (sqlWorker) sqlWorker.terminate();
  });
}
