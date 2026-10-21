'use strict';
const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, nativeTheme, globalShortcut, Tray, Menu, nativeImage, protocol, net, powerMonitor, screen, Notification } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const { Worker } = require('node:worker_threads');
const palette = require('./palette');
const binds = require('./binds');
const { createPaster } = require('./paste');
const { createWinHelper } = require('./winfocus');
const { UI_BINDABLE_IDS, SELECTION_BIND_IDS } = require('../src/commands/binds.js');
const { createSelectionCopier } = require('./selection');
const { createNotesService, isExecutableAsset } = require('./notes/service');
const { mimeFor, visualKind, THUMB_KINDS } = require('../src/notes/attachments.js');
const { createNotesSettings } = require('./notes/settings');
const { createWatcher } = require('./notes/watch');
const { createBus } = require('./events');
const { createDevCoreService } = require('./devcore/service');
const { createUpdaterService } = require('./updater/service');
const { createLinksService } = require('./links/service');
const { createVaultService } = require('./vault/service');
const { createStickiesService } = require('./stickies/service');
const { createGitService } = require('./git/service');
const { createAvatarService } = require('./git/avatars');
const { createLogsService } = require('./logs/service');
const { createAimonService } = require('./aimon/service');
const { createPlansArchive } = require('./aimon/plans');
const { createPrefs: createAimonPrefs } = require('./aimon/prefs');
const { createUsageStore } = require('./aimon/usage');
const { createReviewer } = require('./aimon/review');
const { exportUsage } = require('./aimon/exporter');
const { createDbService } = require('./db/service');
const { fromVaultFields } = require('../src/db/connstr.js');
const { createAiService } = require('./ai/service');
const { primaryIndex } = require('../src/vault/entry.js');

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
    { label: 'Mostrar/ocultar sticky notes', click: () => { if (stickies) stickies.toggleAll().catch(() => {}); } },
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
  // As outras janelas (sticky notes) trocam de tema na hora.
  for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== _e.sender) w.webContents.send('theme:changed', theme);
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

/**
 * Dispara um bind: a maioria roda oculta na palette; os de UI (lista de snippets) mostram a palette.
 * Os de formatação (SELECTION_BIND_IDS) primeiro copiam o texto selecionado no programa em foco (electron/selection.js).
 */
const runBind = (id) => {
  if (UI_BINDABLE_IDS.includes(id)) return palette.show('snippets');
  if (!SELECTION_BIND_IDS.includes(id)) return palette.run(id);
  return copySelection().then(() => palette.run(id), (e) => binds.notify({ ok: false, message: e.message }));
};

// Colar snippet: a palette esconde, o foco volta ao programa anterior e o Ctrl+V é simulado (ver electron/paste.js).
const winHelper = createWinHelper();
const copySelection = createSelectionCopier({ clipboard, win: winHelper });
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
const broadcastNotes = (evt) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('notes:changed', evt);
  if (evt && evt.type === 'removed' && stickies) stickies.noteRemoved(evt.id); // nota excluída sai da tela
};

// Pasta das notas: DEVKIT_NOTES_DIR > escolhida em Configurações (vale após reiniciar) > Documentos\Devkit Notes.
let notesSettings = null;
const getNotesSettings = () => notesSettings || (notesSettings = createNotesSettings(path.join(app.getPath('userData'), 'notes-settings.json')));
const defaultNotesDir = () => path.join(app.getPath('documents'), 'Devkit Notes');
const notesDir = () => process.env.DEVKIT_NOTES_DIR || getNotesSettings().raw().dir || defaultNotesDir();

// Pasta sincronizada por outro programa (Dropbox, OneDrive, Syncthing…): vigia a pasta e relê o que mudou por fora.
let notesWatcher = null;
function applyNotesSync(on) {
  if (on && !notesWatcher) notesWatcher = createWatcher({ dir: notes.dir, onChange: () => notes.reload() });
  if (on) notesWatcher.start(); else if (notesWatcher) notesWatcher.stop();
}

function initNotes() {
  const cfg = getNotesSettings().get();
  notes = createNotesService({
    dir: notesDir(), broadcast: broadcastNotes, events: bus, historyGapMs: cfg.historyGapMin * 60 * 1000, historyMax: cfg.historyMax,
    stateFile: process.env.DEVKIT_NOTES_DIR ? undefined : path.join(app.getPath('userData'), 'notes-state.json'), syncFolder: cfg.syncFolder,
  });
  notesReady = notes.init().then((info) => { applyNotesSync(cfg.syncFolder); return info; }).catch((e) => { console.error('[notes]', e); throw e; });
}

const NOTES_API = ['info', 'reload', 'list', 'get', 'save', 'create', 'remove', 'restore', 'search', 'recent', 'markViewed', 'resolveLink', 'tags', 'tasks', 'toggleTask', 'appendTask', 'folders', 'createFolder', 'renameFolder', 'moveFolder', 'moveNote', 'removeFolder', 'restoreFolder', 'saveImage', 'saveAttachment', 'orphanAssets', 'cleanAssets', 'backlinks', 'linkRefs', 'renameLinks', 'history', 'version', 'restoreVersion', 'trashList', 'restoreFromTrash', 'deleteFromTrash', 'emptyTrash', 'templates', 'fromTemplate', 'ensureRootFolder', 'graph', 'trashCount',
  'setFolderMeta', 'moveFolderOrder', 'folderClash', 'duplicateFolder', 'trashFolders', 'restoreFolderFromTrash', 'folderAbs'];
for (const fn of NOTES_API) {
  ipcMain.handle('notes:' + fn, async (_e, ...args) => { await notesReady; return notes[fn](...args); });
}
// Sem argumento abre a pasta das notas; com um caminho de pasta, abre aquela pasta no Explorer.
ipcMain.handle('notes:open-folder', async (_e, folder) => { await notesReady; return shell.openPath(folder ? notes.folderAbs(folder) : notes.dir); });

// Configurações de Notes (Configurações… na tela). Histórico vale na hora; a pasta das notas, após reiniciar.
ipcMain.handle('notes:settings', async () => {
  const s = getNotesSettings();
  return { ...s.get(), dir: notes ? notes.dir : notesDir(), defaultDir: defaultNotesDir(), envLocked: !!process.env.DEVKIT_NOTES_DIR, customDir: s.raw().dir || null };
});
ipcMain.handle('notes:set-settings', async (_e, patch) => {
  await notesReady;
  const cfg = getNotesSettings().set(patch);
  notes.configure({ historyGapMs: cfg.historyGapMin * 60 * 1000, historyMax: cfg.historyMax, syncFolder: cfg.syncFolder });
  applyNotesSync(cfg.syncFolder);
  return { restart: notesDir() !== notes.dir }; // a pasta nova só vale na próxima abertura
});
ipcMain.handle('notes:pick-dir', async (e) => {
  const r = await dialog.showOpenDialog(fromEvent(e), { title: 'Pasta das notas', properties: ['openDirectory', 'createDirectory'], defaultPath: notes ? notes.dir : undefined });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle('notes:relaunch', () => { app.relaunch(); app.quit(); });
// Clique numa imagem/anexo do preview: abre no programa padrão do sistema. Executáveis (.exe, .bat, .ps1…)
// pedem confirmação antes, já que o arquivo pode ter chegado por sync ou ser de outra pessoa.
ipcMain.handle('notes:open-asset', async (e, ref) => {
  await notesReady;
  const file = notes.assetFile(ref);
  if (isExecutableAsset(file)) {
    const r = await dialog.showMessageBox(fromEvent(e), {
      type: 'warning', buttons: ['Executar', 'Mostrar na pasta', 'Cancelar'], defaultId: 2, cancelId: 2,
      title: 'Abrir anexo', message: 'Este anexo é um arquivo executável.',
      detail: `${path.basename(file)}\n\nExecute só se você confia na origem dele.`,
    });
    if (r.response === 1) { shell.showItemInFolder(file); return ''; }
    if (r.response !== 0) return '';
  }
  return shell.openPath(file);
});
// Pré-visualização de anexos (modal do preview): metadados/texto do arquivo e "Mostrar na pasta".
ipcMain.handle('notes:read-asset', async (_e, ref) => { await notesReady; return notes.readAsset(ref); });
// Miniatura do anexo (PDF, vídeo, Word/Excel/PowerPoint) pelo provedor de miniaturas do Windows — o mesmo do
// Explorer. Devolve um data URL PNG, ou '' quando o sistema não consegue (o renderer mostra um placeholder).
// Executáveis nunca passam pelo shell. Os anexos são imutáveis (nome único), então o cache vale a sessão toda.
const assetThumbs = new Map();
ipcMain.handle('notes:asset-thumb', async (_e, ref) => {
  await notesReady;
  const file = notes.assetFile(ref);
  if (!THUMB_KINDS.has(visualKind(file))) return '';
  if (assetThumbs.has(file)) return assetThumbs.get(file);
  let url = '';
  try {
    const img = await nativeImage.createThumbnailFromPath(file, { width: 192, height: 192 });
    if (img && !img.isEmpty()) url = img.toDataURL();
  } catch { /* sem provedor de miniatura para este arquivo */ }
  assetThumbs.set(file, url);
  return url;
});
ipcMain.handle('notes:asset-bytes', async (_e, ref) => { await notesReady; return notes.assetBytes(ref); });
ipcMain.handle('notes:reveal-asset', async (_e, ref) => { await notesReady; shell.showItemInFolder(notes.assetFile(ref)); });

// Imagens das notas (.assets\) chegam ao renderer por devkit-note://asset/<nome> (a CSP libera só este esquema).
// stream: <video>/<audio> pedem o arquivo aos pedaços (Range) para poder buscar no meio.
protocol.registerSchemesAsPrivileged([{ scheme: 'devkit-note', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
function registerNotesProtocol() {
  protocol.handle('devkit-note', async (req) => {
    try {
      const u = new URL(req.url);
      if (u.host !== 'asset') return new Response('Not found', { status: 404 });
      await notesReady;
      const file = notes.assetFile(decodeURIComponent(u.pathname.slice(1)));
      const res = await net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
      const mime = mimeFor(file); // o file:// não dá Content-Type para tudo (ex.: m4a, flac)
      if (!mime || res.headers.get('content-type') === mime) return res;
      const headers = new Headers(res.headers);
      headers.set('content-type', mime);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
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
const broadcastVault = (evt) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('vault:changed', evt);
  // Monitor do Banco esperando a credencial: tenta de novo assim que o cofre abre.
  if (evt && evt.unlocked && dbSvc) dbSvc.vaultUnlocked();
};

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

const VAULT_API = ['status', 'create', 'unlock', 'lock', 'list', 'index', 'resolve', 'save', 'remove', 'reveal', 'copy', 'setSettings', 'changePassword', 'reset'];
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

/* ─────────────── Sticky notes (notas fixadas na tela) ─────────────── */
// %APPDATA%/Toni Devkit/stickies.json — posição/cor de cada janela, por computador (ver electron/stickies/service.js).
let stickies = null;
let stickiesReady = null;
const stickyByContents = new Map(); // webContents.id → noteId (a janela da sticky só mexe na própria nota)
const broadcastStickies = (evt) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('stickies:changed', evt); };

// Sempre por cima: a sticky existe para ficar à vista sobre o programa em que se está trabalhando.
function createStickyWindow(noteId, { bounds, collapsed }) {
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 200,
    minHeight: 38,
    show: false,
    frame: false,
    resizable: !collapsed,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#141417',
    title: 'Devkit — Sticky note',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  const id = win.webContents.id;
  stickyByContents.set(id, noteId);
  win.on('closed', () => stickyByContents.delete(id));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => { if (!stickies.list().hidden) win.showInactive(); });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'sticky.html'), { query: { id: noteId } });
  return win;
}

function initStickies() {
  stickies = createStickiesService({
    file: path.join(app.getPath('userData'), 'stickies.json'),
    createWindow: createStickyWindow,
    workAreas: () => screen.getAllDisplays().map((d) => d.workArea),
    cursorWorkArea: () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea,
    broadcast: broadcastStickies,
  });
  stickiesReady = stickies.init().then(() => stickies.restore()).catch((e) => { console.error('[stickies]', e); });
}

const stickyOf = (e) => stickyByContents.get(e.sender.id);
ipcMain.handle('stickies:list', async () => { await stickiesReady; return stickies.list(); });
ipcMain.handle('stickies:open', async (_e, noteId, opts) => { await stickiesReady; return stickies.open(String(noteId || ''), opts && typeof opts === 'object' ? opts : {}); });
ipcMain.handle('stickies:toggleAll', async () => { await stickiesReady; return stickies.toggleAll(); });
// Chamados pela própria janela da sticky: valem só para a nota dela.
ipcMain.handle('stickies:self', async (e) => { await stickiesReady; const id = stickyOf(e); return id ? { noteId: id, ...stickies.get(id) } : null; });
ipcMain.handle('stickies:set', async (e, patch) => { await stickiesReady; return stickies.set(stickyOf(e), patch && typeof patch === 'object' ? patch : {}); });
ipcMain.handle('stickies:close', async (e) => { await stickiesReady; return stickies.close(stickyOf(e)); });

/* ─────────────── Git (repositórios locais) ─────────────── */
// Lista de repositórios em %APPDATA%/Toni Devkit/git-repos.json; o git do sistema roda sem shell (ver electron/git/service.js).
let gitSvc = null;
let gitReady = null;
const broadcastGit = (evt) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('git:changed', evt); };

function initGit() {
  gitSvc = createGitService({ file: path.join(app.getPath('userData'), 'git-repos.json'), broadcast: broadcastGit });
  gitReady = gitSvc.init().catch((e) => { console.error('[git]', e); });
}

const GIT_API = ['version', 'list', 'add', 'remove', 'scan', 'open', 'summaries', 'status', 'log', 'commit', 'diff', 'branches', 'compare', 'stashes', 'stashFiles', 'reflog', 'overview', 'backups', 'exec', 'restoreBackup', 'mergePreview', 'conflictFile', 'rebaseInfo', 'files', 'blame', 'searchText', 'bisectState', 'tags', 'cleanPreview', 'gitignore', 'rhythm', 'fileVersions', 'worktrees'];
for (const fn of GIT_API) {
  ipcMain.handle('git:' + fn, async (_e, ...args) => { await gitReady; return gitSvc[fn](...args); });
}
// Fotos do Gravatar (opcional, ligado em Configurações): a busca é aqui para a CSP da tela continuar fechada.
const gitAvatars = createAvatarService();
ipcMain.handle('git:avatars', (_e, emails) => gitAvatars.get(Array.isArray(emails) ? emails : []));
// Adicionar escolhendo a pasta no diálogo do sistema.
ipcMain.handle('git:pick', async (e) => {
  await gitReady;
  const r = await dialog.showOpenDialog(fromEvent(e), { title: 'Escolha a pasta do repositório (ou uma pasta para procurar repositórios)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});
// Pastas comuns para procurar repositórios (Documentos, source/repos, a pasta do usuário).
ipcMain.handle('git:scan-default', async () => {
  await gitReady;
  const home = app.getPath('home');
  const roots = [app.getPath('documents'), path.join(home, 'source', 'repos'), path.join(home, 'repos'), path.join(home, 'projetos'), home];
  const seen = new Set();
  const out = [];
  for (const root of roots) {
    for (const f of await gitSvc.scan(root, root === home ? 2 : 3)) if (!seen.has(f.toLowerCase())) { seen.add(f.toLowerCase()); out.push(f); }
  }
  return out;
});
// Abrir o repositório no Explorer, no VS Code ou num terminal.
ipcMain.handle('git:open-in', async (_e, repo, where) => {
  await gitReady;
  const top = await gitSvc.top(repo);
  if (where === 'vscode') return shell.openExternal('vscode://file/' + top.replace(/\\/g, '/'));
  if (where === 'terminal') {
    const { spawn } = require('node:child_process');
    const p = process.platform === 'win32'
      ? spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/K', 'cd', '/d', top], { detached: true, windowsHide: true, stdio: 'ignore' })
      : spawn(process.platform === 'darwin' ? 'open' : 'x-terminal-emulator', process.platform === 'darwin' ? ['-a', 'Terminal', top] : [], { cwd: top, detached: true, stdio: 'ignore' });
    p.unref();
    return true;
  }
  return shell.openPath(top);
});

/* ─────────────── Logs (worker thread com o índice; ver electron/logs) ─────────────── */
// O worker sobe no primeiro uso. Ele guarda o texto dos logs abertos (≈ tamanho dos arquivos), então ganha um
// limite de memória maior que o padrão.
let logsWorker = null;
let logsWorkerReady = null;
let logsSeq = 0;
const logsPending = new Map();
let logsSvc = null;
let logsReady = null;
const broadcastLogs = (evt) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('logs:changed', evt); };

function startLogsWorker() {
  if (logsWorker) return logsWorkerReady;
  const workerFile = path.join(__dirname, 'logs', 'worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  logsWorker = new Worker(workerFile, { resourceLimits: { maxOldGenerationSizeMb: 6144 } });
  logsWorkerReady = new Promise((resolve, reject) => {
    logsWorker.on('message', (msg) => {
      if (msg.type === 'ready') return resolve();
      if (msg.type === 'event') return broadcastLogs(msg.evt);
      const p = logsPending.get(msg.id);
      if (!p) return;
      logsPending.delete(msg.id);
      msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
    });
    logsWorker.on('error', reject);
  });
  logsWorker.on('exit', () => {
    for (const p of logsPending.values()) p.reject(new Error('O leitor de logs foi encerrado (memória?) — abra o log de novo'));
    logsPending.clear();
    logsWorker = null;
    logsWorkerReady = null;
    if (logsSvc) { logsSvc.unwatch(); logsSvc._open.clear(); }
    broadcastLogs({ type: 'crashed' });
  });
  logsWorkerReady.catch(() => {});
  return logsWorkerReady;
}

function callLogs(op, args) {
  return startLogsWorker().then(() => new Promise((resolve, reject) => {
    const id = ++logsSeq;
    logsPending.set(id, { resolve, reject });
    logsWorker.postMessage({ id, op, args });
  }));
}

function initLogs() {
  logsSvc = createLogsService({ file: path.join(app.getPath('userData'), 'logs.json'), callWorker: callLogs, broadcast: broadcastLogs });
  logsReady = logsSvc.init().catch((e) => { console.error('[logs]', e); });
}

/* ─────────────── Monitor de IA (sessões do Claude Code, Codex…; ver electron/aimon) ─────────────── */
// Somente leitura. O acompanhamento roda com a tela aberta (aimon:setActive) ou, se o usuário ligar, em segundo plano.
let aimonSvc = null;
// Métricas diárias (só números) em %APPDATA%Toni Devkitaimon-usage.json — ver electron/aimon/usage.js.
let aimonUsage = null;
const aimonUsageStore = () => aimonUsage || (aimonUsage = createUsageStore({ file: path.join(app.getPath('userData'), 'aimon-usage.json') }));
let aimonUsageReady = null;
const aimon = () => aimonSvc || (aimonSvc = createAimonService({
  providers: [require('./aimon/providers/claude'), require('./aimon/providers/codex')],
  broadcast: (evt) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('aimon:changed', evt); },
  usage: aimonUsageStore(),
  getPrices: () => (aimonPrefs ? aimonPrefs.get().prices : {}),
  getLimit: () => (aimonPrefs ? aimonPrefs.get().limitTokens : null),
  getReview: (key) => aimonReviewer().brief(key),
  onAttention: (ev) => aimonNotify(ev),
  onSettled: (ev) => aimonReviewer().settled(ev.key),
}));
// Revisão automática das alterações quando a sessão fica ociosa: só com a IA em modo Local e se você ligou (electron/aimon/review.js).
let aimonRev = null;
const aimonReviewer = () => aimonRev || (aimonRev = createReviewer({
  getPrefs: () => (aimonPrefs ? aimonPrefs.get() : { autoReview: false }),
  getMode: () => (ai && ai.getConfig ? ai.getConfig().mode : 'off'),
  collect: async (key) => {
    const r = await aimon().gitAiInput(key);
    return r && r.diff ? { diff: r.diff, branch: r.branch, goal: aimon().goal(key) } : null;
  },
  generate: async (id, task, input) => { if (aiReady) await aiReady; return ai.generate(id, task, input); },
  onChange: () => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('aimon:changed', { type: 'review' }); },
}));
// Segundo plano (desligado por padrão): mantém o acompanhamento mesmo com a tela fechada — é o que alimenta o selo na
// tela do Git. Quem só usa o Git não liga nada. Preferência em %APPDATA%Toni Devkitaimon.json.
// Os avisos do sistema também precisam do acompanhamento ligado, então quem os liga mantém o segundo plano implícito.
let aimonPrefs = null;
let aimonScreenOpen = false;
const syncAimon = () => {
  const p = aimonPrefs ? aimonPrefs.get() : { background: false, notify: false };
  return aimon().setActive(aimonScreenOpen || p.background || p.notify);
};
function initAimon() {
  aimonPrefs = createAimonPrefs({ file: path.join(app.getPath('userData'), 'aimon.json') });
  aimonUsageReady = aimonUsageStore().init().catch((e) => console.error('[aimon-usage]', e));
  aimonPrefs.init().then(() => aimonUsageReady).then(() => { const p = aimonPrefs.get(); if (p.background || p.notify) syncAimon(); }).catch((e) => console.error('[aimon]', e));
}
// Aviso do sistema quando uma sessão passa a esperar por você ou dá erro. Clicar leva à sessão no Monitor de IA.
const aimonToasts = new Set(); // referência até o clique/fechamento: sem ela o coletor de lixo pode descartar o aviso
function aimonNotify(ev) {
  if (!aimonPrefs || !aimonPrefs.get().notify || !Notification.isSupported()) return;
  const looking = mainWin && !mainWin.isDestroyed() && mainWin.isVisible() && mainWin.isFocused() && aimonScreenOpen;
  if (looking) return; // já está na tela do monitor, com a janela em foco
  const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const waiting = ev.kind === 'waiting';
  const n = new Notification({
    title: waiting ? 'Esperando você' : ev.kind === 'limit' ? 'Perto do limite de uso' : 'Sessão de IA com erro',
    body: [cut([ev.project, ev.title].filter(Boolean).join(' — '), 110), cut(ev.detail || (waiting ? 'Aguardando a sua resposta ou permissão' : ''), 110)].filter(Boolean).join('\n'),
    icon: nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'icon.png')),
  });
  aimonToasts.add(n);
  const done = () => aimonToasts.delete(n);
  n.on('click', () => { done(); showMain('aimon', ev.key ? { sel: ev.key } : { tab: 'usage' }); });
  n.on('close', done);
  n.on('failed', done);
  n.show();
}
ipcMain.handle('aimon:setActive', (_e, on) => { aimonScreenOpen = !!on; return syncAimon(); });
ipcMain.handle('aimon:prefs', () => (aimonPrefs ? aimonPrefs.get() : { background: false, notify: false, prices: {}, limitTokens: null, autoReview: false }));
ipcMain.handle('aimon:setBackground', async (_e, on) => { if (!aimonPrefs) return false; await aimonPrefs.setBackground(!!on); syncAimon(); return aimonPrefs.get().background; });
ipcMain.handle('aimon:setNotify', async (_e, on) => { if (!aimonPrefs) return false; await aimonPrefs.setNotify(!!on); syncAimon(); return aimonPrefs.get().notify; });
ipcMain.handle('aimon:setPrices', async (_e, prices) => (aimonPrefs ? aimonPrefs.setPrices(prices) : {}));
// Métricas de uso (painel "Uso"): o custo é uma estimativa a partir dos tokens e dos preços (padrão ou personalizados).
ipcMain.handle('aimon:usage', async (_e, days) => {
  if (aimonUsageReady) await aimonUsageReady;
  const a = await plans().catch(() => null);
  const rows = a ? a.list({}).map((p) => ({ ts: p.ts, status: p.status })) : [];
  return aimon().usage(Number(days) || 7, rows);
});
ipcMain.handle('aimon:usageClear', async () => aimon().usageClear());
// Exportar as métricas (CSV, JSON ou Markdown) para um arquivo que a pessoa escolhe.
ipcMain.handle('aimon:usageExport', async (_e, days, format) => {
  if (aimonUsageReady) await aimonUsageReady;
  const a = await plans().catch(() => null);
  const range = await aimon().usage(Number(days) || 7, a ? a.list({}).map((p) => ({ ts: p.ts, status: p.status })) : []);
  const out = exportUsage(range, String(format));
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(mainWin && !mainWin.isDestroyed() ? mainWin : undefined, {
    title: 'Exportar métricas de uso', defaultPath: `uso-ia-${range.days}d-${stamp}.${out.ext}`,
    filters: [{ name: out.ext.toUpperCase(), extensions: [out.ext] }],
  });
  if (r.canceled || !r.filePath) return { saved: false };
  await fs.writeFile(r.filePath, (out.ext === 'csv' ? '﻿' : '') + out.text, 'utf8'); // BOM: o Excel reconhece os acentos
  return { saved: true, path: r.filePath };
});
ipcMain.handle('aimon:burn', () => aimon().burn());
ipcMain.handle('aimon:setLimit', async (_e, n) => (aimonPrefs ? aimonPrefs.setLimit(n) : null));
ipcMain.handle('aimon:setAutoReview', async (_e, on) => (aimonPrefs ? aimonPrefs.setAutoReview(!!on) : false));
ipcMain.handle('aimon:review', (_e, key) => aimonReviewer().read(String(key || '')));
ipcMain.handle('aimon:reviewRun', (_e, key) => aimonReviewer().run(String(key || '')));
ipcMain.handle('aimon:compare', (_e, keys) => aimon().compare(keys));
ipcMain.handle('aimon:context', (_e, key) => aimon().context(String(key || '')));
ipcMain.handle('aimon:pairs', () => aimon().pairs());
// Base da análise de padrões: primeiros pedidos das sessões recentes + planos aprovados/recusados (com o motivo da recusa).
ipcMain.handle('aimon:patterns', async () => {
  const base = aimon().patterns();
  const a = await plans().catch(() => null);
  const rows = a ? a.list({}).slice(0, 40) : [];
  const withReason = await Promise.all(rows.filter((p) => p.status === 'rejected').slice(0, 10).map(async (p) => ({ status: 'rejected', title: p.title, reason: (a.get(p.id) || {}).reason || p.reason || '' })));
  const approved = rows.filter((p) => p.status === 'approved').slice(0, 10).map((p) => ({ status: 'approved', title: p.title }));
  return { ...base, plans: [...withReason, ...approved] };
});
ipcMain.handle('aimon:search', async (_e, q, opts) => {
  const o = opts && typeof opts === 'object' ? opts : {};
  const r = await aimon().search(String(q || ''), { days: Number(o.days) || 14, limit: Number(o.limit) || 60 });
  // Planos (guardados à parte): entram na frente, com o mesmo formato de recorte.
  const needle = String(q || '').trim();
  if (needle.length >= 2) {
    const a = await plans().catch(() => null);
    if (a) r.plans = a.list({ q: needle }).slice(0, 15).map((p) => ({ id: p.id, ts: p.ts, status: p.status, title: p.title, project: p.project, sessionId: p.sessionId, snippet: p.snippet || null }));
  }
  return r;
});
ipcMain.handle('aimon:dayDigest', () => aimon().dayDigest());
// Abre um terminal na pasta da sessão rodando `claude --resume <id>` (ou `codex resume <id>`, ou a ferramenta pura).
ipcMain.handle('aimon:resume', async (_e, req) => {
  const r = req && typeof req === 'object' ? req : {};
  const known = typeof r.key === 'string' ? aimon().sessionInfo(r.key) : null; // sessão acompanhada: usa o que o monitor leu, não o que a tela mandou
  return require('./aimon/resume').open({ provider: known ? known.provider : r.provider, sessionId: known ? known.sessionId : r.sessionId, cwd: known ? known.cwd : r.cwd, mode: r.mode });
});
// Só consulta o que o acompanhamento já leu; nunca o liga (sem segundo plano nem tela aberta, volta vazio).
ipcMain.handle('aimon:repoActivity', () => (aimonSvc ? aimonSvc.repoActivity() : {}));
// Planos aprovados/recusados das sessões, guardados em %APPDATA%Toni Devkitaimon-plans.json (ver electron/aimon/plans.js).
let plansArchive = null;
let plansReady = null;
const plans = () => {
  if (!plansArchive) {
    const claude = require('./aimon/providers/claude');
    plansArchive = createPlansArchive({ file: path.join(app.getPath('userData'), 'aimon-plans.json'), listFiles: () => claude.listSessions(0) });
    plansReady = plansArchive.init().catch((e) => console.error('[aimon-plans]', e));
  }
  return plansReady.then(() => plansArchive);
};
ipcMain.handle('aimon:plansScan', async () => (await plans()).scan());
ipcMain.handle('aimon:plans', async (_e, opts) => { const a = await plans(); return { rows: a.list(opts && typeof opts === 'object' ? opts : {}), projects: a.projects() }; });
ipcMain.handle('aimon:plan', async (_e, id) => (await plans()).get(String(id || '')));
ipcMain.handle('aimon:planForget', async (_e, id) => (await plans()).forget(String(id || '')));
ipcMain.handle('aimon:plansClear', async () => (await plans()).clear());
ipcMain.handle('aimon:providers', () => aimon().providers());
ipcMain.handle('aimon:list', (_e, opts) => aimon().list(opts && typeof opts === 'object' ? opts : {}));
ipcMain.handle('aimon:gitChanges', (_e, key) => aimon().gitChanges(String(key || '')));
ipcMain.handle('aimon:gitDiff', (_e, key, p, area) => aimon().gitDiff(String(key || ''), p, area));
ipcMain.handle('aimon:digest', (_e, key) => aimon().digest(String(key || '')));
ipcMain.handle('aimon:gitAiInput', (_e, key) => aimon().gitAiInput(String(key || '')));
ipcMain.handle('aimon:resolveRepo', (_e, cwd) => aimon().resolveRepo(cwd));
ipcMain.handle('aimon:lanes', (_e, opts) => aimon().lanes(opts && typeof opts === 'object' ? opts : {}));
ipcMain.handle('aimon:timeline', (_e, key, opts) => aimon().timeline(String(key || ''), opts && typeof opts === 'object' ? opts : {}));

// Serviço (abrir, ao vivo, recentes, filtros salvos).
const LOGS_SVC_API = ['open', 'reformat', 'switchFamily', 'setLive', 'close', 'list', 'summaries', 'markSeen', 'recents', 'forgetRecent', 'presets', 'savePresets', 'scanFolder'];
for (const fn of LOGS_SVC_API) {
  ipcMain.handle('logs:' + fn, async (_e, ...args) => { await logsReady; return logsSvc[fn](...args); });
}
// Consultas: vão direto ao worker (args: { id, qid, ... }).
const LOGS_WORKER_API = ['query', 'rows', 'entry', 'context', 'locate', 'seekTime', 'next', 'sparks', 'charts', 'textOf', 'info'];
for (const op of LOGS_WORKER_API) {
  ipcMain.handle('logs:' + op, (_e, args) => callLogs(op, args && typeof args === 'object' ? args : {}));
}
ipcMain.handle('logs:pickFile', async (e) => {
  const r = await dialog.showOpenDialog(fromEvent(e), {
    title: 'Abrir log', properties: ['openFile'],
    filters: [{ name: 'Logs', extensions: ['log', 'txt', 'out', 'json', 'ndjson', 'jsonl', 'gz', '1', '2', '3'] }, { name: 'Todos os arquivos', extensions: ['*'] }],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
ipcMain.handle('logs:pickFolder', async (e) => {
  const r = await dialog.showOpenDialog(fromEvent(e), { title: 'Pasta de logs (junta os arquivos rotacionados)', properties: ['openDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
});
// Exportar o resultado do filtro: escolhe o arquivo aqui, o worker grava em stream.
ipcMain.handle('logs:export', async (e, args) => {
  const a = args && typeof args === 'object' ? args : {};
  const md = a.kind === 'md';
  const r = await dialog.showSaveDialog(fromEvent(e), {
    title: 'Exportar entradas filtradas',
    defaultPath: (a.name || 'logs').replace(/[\\/:*?"<>|]+/g, '_') + (md ? '.md' : '.log'),
    filters: md ? [{ name: 'Markdown', extensions: ['md'] }] : [{ name: 'Log', extensions: ['log', 'txt'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const res = await callLogs('exportTo', { id: a.id, qid: a.qid, kind: md ? 'md' : 'log', file: r.filePath });
  return { ...res, path: r.filePath };
});
ipcMain.handle('logs:reveal', (_e, p) => { if (p) shell.showItemInFolder(String(p)); return true; });

/* ─────────────── Banco (monitor de SQL Server; ver electron/db) ─────────────── */
// Servidores em %APPDATA%/Toni Devkit/db-servers.json (sem senha); histórico em db-monitor/<servidor>/AAAA-MM-DD.ndjson.
// A senha vem do Vault, lida aqui no processo principal — a tela nunca a recebe.
let dbSvc = null;
let dbReady = null;
const broadcastDb = (evt) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('db:changed', evt); };

function initDb() {
  dbSvc = createDbService({
    file: path.join(app.getPath('userData'), 'db-servers.json'),
    dir: path.join(app.getPath('userData'), 'db-monitor'),
    broadcast: broadcastDb,
    getCredential: async (entryId) => {
      await vaultReady;
      if (!vault || !vault.status().unlocked) throw new Error('O Vault está trancado');
      const entry = (vault.list() || []).find((e) => e.id === entryId);
      if (!entry) throw new Error('A credencial escolhida não existe mais no Vault');
      const fields = entry.fields.map((f, i) => ({ name: f.name, value: f.secret ? vault.reveal(entryId, i) : f.value }));
      const v = fromVaultFields(fields);
      if (!v.user) throw new Error(`A entrada "${entry.name}" do Vault não tem usuário`);
      return { user: v.user, password: v.password };
    },
  });
  dbReady = dbSvc.init().catch((e) => { console.error('[db]', e); });
}

const DB_API = ['list', 'settings', 'setSettings', 'add', 'update', 'remove', 'test', 'watch', 'now', 'history', 'at', 'incident', 'deadlocks', 'topQueries', 'queryStoreDbs', 'queryStoreTop', 'schemaDbs', 'schema', 'health', 'plan', 'kill', 'summaries'];
for (const fn of DB_API) {
  ipcMain.handle('db:' + fn, async (_e, ...args) => { await dbReady; return dbSvc[fn](...args); });
}
// Plano de execução (.sqlplan) e grafo de deadlock (.xdl): os dois abrem no SSMS como desenho.
const DB_FILE_KINDS = { sqlplan: { title: 'Salvar plano de execução', name: 'Plano do SQL Server' }, xdl: { title: 'Salvar grafo do deadlock', name: 'Deadlock do SQL Server' } };
ipcMain.handle('db:savePlan', async (e, xml, name, ext = 'sqlplan') => {
  const kind = DB_FILE_KINDS[ext] ? ext : 'sqlplan';
  const r = await dialog.showSaveDialog(fromEvent(e), {
    title: DB_FILE_KINDS[kind].title, defaultPath: String(name || 'plano').replace(/[\\/:*?"<>|]+/g, '_') + '.' + kind,
    filters: [{ name: DB_FILE_KINDS[kind].name, extensions: [kind] }],
  });
  if (r.canceled || !r.filePath) return null;
  await fs.writeFile(r.filePath, String(xml || ''), 'utf8');
  return r.filePath;
});

/* ─────────────── IA (opcional: Ollama local ou API do Claude) ─────────────── */
// %APPDATA%/Toni Devkit/ai.json. A chave da API fica no Vault: o serviço a lê aqui, no processo principal, só na hora
// de chamar a API — a tela nunca a recebe. Ver electron/ai/service.js.
let ai = null;
let aiReady = null;

function initAi() {
  ai = createAiService({
    file: path.join(app.getPath('userData'), 'ai.json'),
    getApiKey: async (entryId) => {
      if (!entryId || !vault || !vault.status().unlocked) return null;
      const entry = (vault.list() || []).find((e) => e.id === entryId);
      if (!entry) return null;
      const i = primaryIndex(entry);
      return i === -1 ? null : vault.reveal(entryId, i);
    },
  });
  aiReady = ai.init().catch((e) => { console.error('[ai]', e); });
}

ipcMain.handle('ai:status', async () => { await aiReady; return ai.status(); });
ipcMain.handle('ai:config', async () => { await aiReady; return ai.getConfig(); });
// Mudou a configuração: avisa todas as janelas (a palette e as stickies são outras janelas).
ipcMain.handle('ai:setConfig', async (_e, patch) => {
  await aiReady;
  const cfg = await ai.setConfig(patch && typeof patch === 'object' ? patch : {});
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('ai:changed', cfg);
  return cfg;
});
ipcMain.handle('ai:buildRequest', async (_e, task, input) => { await aiReady; return ai.buildRequest(task, input); });
// Progresso e pedaços de texto vão só para a janela que pediu.
ipcMain.handle('ai:installOllama', async (e) => { await aiReady; return ai.installOllama((p) => e.sender.send('ai:progress', { kind: 'install', ...p })); });
ipcMain.handle('ai:pullModel', async (e, name) => { await aiReady; return ai.pullModel(String(name || ''), (p) => e.sender.send('ai:progress', { kind: 'pull', name, ...p })); });
ipcMain.handle('ai:generate', async (e, requestId, task, input) => {
  await aiReady;
  return ai.generate(String(requestId), task, input, (chunk) => e.sender.send('ai:chunk', { requestId: String(requestId), chunk }));
});
ipcMain.handle('ai:cancel', async (_e, requestId) => { await aiReady; return ai.cancel(String(requestId)); });

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
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'io.github.tonissx.tonidevkit' : 'io.github.tonissx.tonidevkit.dev');

  app.whenReady().then(() => {
    initNotes();
    initStickies();
    initLinks();
    initGit();
    initLogs();
    initAimon();
    initDb();
    initAi();
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
    if (stickies) stickies.setQuitting(); // as janelas fecham, mas as stickies voltam na próxima vez
    if (notesFlushed || !notes) return;
    e.preventDefault();
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('notes:flush');
    setTimeout(async () => {
      await notes.flush().catch(() => {});
      if (devcore) await devcore.flush().catch(() => {});
      if (links) await links.flush().catch(() => {});
      if (vault) await vault.flush().catch(() => {});
      if (stickies) await stickies.flush().catch(() => {});
      if (gitSvc) { gitSvc.unwatch(); await gitSvc.flush().catch(() => {}); }
      if (logsSvc) { logsSvc.unwatch(); await logsSvc.flush().catch(() => {}); }
      if (dbSvc) { dbSvc.stopAll(); await dbSvc.flush().catch(() => {}); }
      if (aimonSvc) aimonSvc.stop();
      if (aimonRev) aimonRev.stop();
      if (aimonPrefs) await aimonPrefs.flush().catch(() => {});
      if (aimonUsage) await aimonUsage.flush().catch(() => {});
      if (plansArchive) await plansArchive.flush().catch(() => {});
      notesFlushed = true;
      app.quit();
    }, 300);
  });
  // Sem janelas visíveis o app continua na bandeja (a janela da palette nunca fecha).
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (sqlWorker) sqlWorker.terminate();
    if (logsWorker) logsWorker.terminate();
  });
}
