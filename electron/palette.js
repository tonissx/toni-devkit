'use strict';
/**
 * Janela da command palette + atalho global.
 *
 * A palette é uma janela própria (sem moldura, transparente, sempre no topo, fora da barra de tarefas),
 * criada oculta na inicialização e reaproveitada com show/hide — por isso abre instantaneamente e
 * aparece sobre qualquer app sem restaurar a janela principal. Fecha ao perder o foco.
 */
const { BrowserWindow, globalShortcut, screen } = require('electron');
const path = require('node:path');

const ACCELERATOR = 'Control+Alt+Space';
const WIDTH = 680;
const MIN_HEIGHT = 64;
const MAX_HEIGHT = 540;

let win = null;
let loaded = false;
let pendingShow = null;
let status = { accelerator: ACCELERATOR, registered: false };

function create() {
  loaded = false;
  win = new BrowserWindow({
    width: WIDTH,
    height: 360,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false, // a sombra é desenhada pelo CSS do painel
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Devkit — Command Palette',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.on('blur', () => { if (win && !win.webContents.isDevToolsOpened()) hide(); });
  win.on('closed', () => { win = null; loaded = false; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('did-finish-load', () => {
    loaded = true;
    if (pendingShow) { const s = pendingShow; pendingShow = null; show(s); }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'palette.html'));
}

/** Mostra a palette centralizada no monitor onde está o cursor, a ~20% do topo. */
function show(source = 'app') {
  if (!win) create();
  if (!loaded) { pendingShow = source; return; }
  const { workArea: wa } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [, h] = win.getSize();
  win.setBounds({ x: Math.round(wa.x + (wa.width - WIDTH) / 2), y: Math.round(wa.y + wa.height * 0.2), width: WIDTH, height: h });
  win.show();
  win.focus();
  win.webContents.focus();
  win.webContents.send('palette:opened', { source });
}

function hide() {
  // Ao esconder, o Windows devolve o foco para a janela que estava ativa antes.
  if (win && win.isVisible()) win.hide();
}

const isOpen = () => !!(win && win.isVisible() && win.isFocused());

function toggle(source) {
  if (isOpen()) hide(); else show(source);
}

/** A altura acompanha o conteúdo (medido no renderer), assim não sobra área transparente clicável. */
function resize(height) {
  if (!win) return;
  const h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(Number(height) || 0)));
  const b = win.getBounds();
  if (b.height !== h) win.setBounds({ ...b, height: h });
}

/** Registra o único atalho global do app. Falha (atalho em uso por outro app) não é fatal. */
function registerShortcut() {
  let registered = false;
  try { registered = globalShortcut.register(ACCELERATOR, () => toggle('shortcut')); } catch { registered = false; }
  status = { accelerator: ACCELERATOR, registered };
  return status;
}

module.exports = { create, show, hide, toggle, resize, registerShortcut, getStatus: () => status, ACCELERATOR };
