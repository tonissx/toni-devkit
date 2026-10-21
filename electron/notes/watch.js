'use strict';
/**
 * Vigia a pasta das notas e avisa (com debounce) quando algo muda por fora do app — o caso típico é um
 * Dropbox/OneDrive/Syncthing trazendo as edições de outro PC. Não decide o que mudou: quem recebe `onChange`
 * relê a pasta (service.reload), que só notifica o que de fato é diferente — então o eco das gravações do
 * próprio app é inofensivo.
 *
 * Ignora o que não é nota ou anexo: arquivos temporários da escrita atômica (*.tmp), caminhos dentro de
 * pastas "." (.devkit/history, .trash…) e arquivos de bloqueio dos sincronizadores. `.assets` não conta:
 * um anexo sozinho não muda nenhuma nota.
 */
const fs = require('node:fs');

const IGNORED_FILE_RE = /(\.tmp|\.crdownload|\.part|~)$|^~\$|^\.(syncthing\.|dropbox)|\.dropbox\.cache$|^desktop\.ini$/i;

/** O evento do fs.watch (caminho relativo) merece reler a pasta? */
function relevant(rel) {
  if (!rel) return true; // alguns sistemas não informam o nome
  const parts = String(rel).split(/[\\/]/).filter(Boolean);
  if (parts.some((p) => p.startsWith('.') && p !== '.folder.json')) return false;
  const name = parts[parts.length - 1] || '';
  if (IGNORED_FILE_RE.test(name)) return false;
  return /\.md$/i.test(name) || name === '.folder.json' || !/\.[^.\\/]+$/.test(name); // .md, config de pasta ou diretório
}

function createWatcher({ dir, onChange, debounceMs = 400, watch = fs.watch }) {
  let watcher = null;
  let timer = null;

  const fire = () => { timer = null; Promise.resolve().then(onChange).catch((e) => console.error('[notes] reload', e)); };
  const poke = (_type, rel) => {
    if (!relevant(rel)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, debounceMs);
  };

  return {
    start() {
      if (watcher) return true;
      try {
        watcher = watch(dir, { recursive: true, persistent: false }, poke);
        watcher.on('error', (e) => { console.error('[notes] watcher', e); this.stop(); });
        return true;
      } catch (e) { console.error('[notes] watcher', e); watcher = null; return false; }
    },
    stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (watcher) { try { watcher.close(); } catch { /* já fechado */ } watcher = null; }
    },
    get active() { return !!watcher; },
  };
}

module.exports = { createWatcher, relevant };
