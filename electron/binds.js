'use strict';
/**
 * Smart Binds no processo principal: guarda os atalhos em userData/binds.json, registra no
 * globalShortcut e, ao disparar, pede à janela da palette (oculta) para rodar o comando.
 * O resultado volta por binds:result e vira uma notificação silenciosa — nenhuma janela rouba o foco.
 */
const { app, globalShortcut, Notification, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { BINDABLE, DEFAULT_BINDS, normalizeBinds } = require('../src/commands/binds.js');

let binds = {};
let status = {}; // { [commandId]: { accelerator, registered } }
let onRun = () => {};
let onChange = () => {};

const file = () => path.join(app.getPath('userData'), 'binds.json');

function unregisterAll() {
  for (const acc of Object.values(binds)) {
    try { globalShortcut.unregister(acc); } catch { /* ignore */ }
  }
}

/** Troca os atalhos registrados. Atalho em uso por outro app não é fatal: fica registered=false. */
function apply(next) {
  unregisterAll();
  binds = normalizeBinds(next);
  status = {};
  for (const [id, acc] of Object.entries(binds)) {
    let registered = false;
    try { registered = globalShortcut.register(acc, () => onRun(id)); } catch { registered = false; }
    status[id] = { accelerator: acc, registered };
  }
  onChange();
}

/** Sem arquivo = nunca configurado → padrões. Arquivo com {} = o usuário limpou tudo. */
async function init({ run, changed } = {}) {
  if (run) onRun = run;
  if (changed) onChange = changed;
  let saved = DEFAULT_BINDS;
  try { saved = JSON.parse(await fs.readFile(file(), 'utf8')); } catch { /* usa os padrões */ }
  apply(saved);
}

async function set(next) {
  apply(next);
  await fs.writeFile(file(), JSON.stringify(binds, null, 2), 'utf8');
  return get();
}

/**
 * Durante a gravação de um atalho em Configurações os binds ficam desligados: um atalho global
 * registrado engole o keydown antes de ele chegar à janela.
 */
function suspend(on) {
  if (on) unregisterAll();
  else apply(binds);
  return get();
}

const get = () => ({ binds: { ...binds }, status: { ...status }, bindable: BINDABLE, defaults: DEFAULT_BINDS });

// Imagem do toast. Sem ela o Windows usa o ícone do executável (o do Electron em dev). O ícone pequeno
// do cabeçalho vem do atalho do Menu Iniciar com o mesmo AppUserModelId — correto só no app instalado.
let toastIcon = null;
const icon = () => toastIcon || (toastIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'assets', 'icon.png')));

/** Feedback do comando rodado pela palette oculta. */
function notify({ ok, message } = {}) {
  if (!message || !Notification.isSupported()) return;
  new Notification({
    title: ok ? 'Toni Devkit' : 'Toni Devkit — erro',
    body: String(message),
    icon: icon(),
    silent: true,
  }).show();
}

module.exports = { init, set, get, suspend, notify, accelerator: (id) => binds[id] || null };
