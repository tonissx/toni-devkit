'use strict';
/**
 * Links rápidos (alias → URL com {q}). Ficam em Documentos\Devkit Notes\.devkit\links.json: vão junto se as notas
 * forem sincronizadas/versionadas, mas não aparecem no Notes (pastas que começam com "." são ignoradas).
 *
 * O arquivo é relido quando muda no disco (outra máquina sincronizou); a gravação é atômica e em fila.
 * Formato: { v: 1, links: [{ id, alias, name, url, param, recent, created, updated }] }
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { normalizeLink, buildUrl, pushRecent, sameAlias, withPlaceholder } = require('../../src/links/link.js');

function createLinksService({ file, broadcast = () => {}, now = () => new Date() }) {
  const queue = createQueue();
  let links = [];
  let mtime = 0;

  async function load() {
    try {
      const st = await fs.stat(file);
      if (st.mtimeMs === mtime) return;
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      // withPlaceholder: links salvos sem {q} mas com rótulo/"=" no fim passam a receber o valor (versões antigas).
      links = Array.isArray(data && data.links)
        ? data.links.filter((l) => l && l.id && l.alias && l.url).map((l) => ({ ...l, url: withPlaceholder(l.url, l.param) }))
        : [];
      mtime = st.mtimeMs;
    } catch (e) {
      if (e.code === 'ENOENT') { links = []; mtime = 0; return; }
      console.error('[links] arquivo ilegível, mantendo o que está em memória:', e.message);
    }
  }

  const persist = () => queue.run('links', async () => {
    await atomicWrite(file, JSON.stringify({ v: 1, links }, null, 2));
    try { mtime = (await fs.stat(file)).mtimeMs; } catch { /* segue */ }
  });

  const sorted = () => [...links].sort((a, b) => a.alias.localeCompare(b.alias, 'pt-BR', { sensitivity: 'base' }));
  const find = (id) => {
    const l = links.find((x) => x.id === id);
    if (!l) throw new Error('O link não existe mais');
    return l;
  };

  async function list() {
    await load();
    return sorted();
  }

  async function save(raw) {
    await load();
    const prev = raw && raw.id ? links.find((x) => x.id === raw.id) || null : null;
    const next = normalizeLink(raw, prev, now());
    const clash = links.find((x) => x.id !== next.id && sameAlias(x.alias, next.alias));
    if (clash) throw new Error(`O alias “${next.alias}” já é usado por ${clash.name || clash.url}`);
    links = prev ? links.map((x) => (x.id === next.id ? next : x)) : [...links, next];
    await persist();
    broadcast({ reason: 'save' });
    return next;
  }

  async function remove(id) {
    await load();
    find(id);
    links = links.filter((x) => x.id !== id);
    await persist();
    broadcast({ reason: 'remove' });
    return true;
  }

  /** Monta a URL do valor e registra o valor nos recentes do link → url. */
  async function use(id, value) {
    await load();
    const l = find(id);
    const url = buildUrl(l, value);
    const recent = pushRecent(l.recent, value);
    if (recent.join('\n') !== (l.recent || []).join('\n')) {
      links = links.map((x) => (x.id === id ? { ...x, recent } : x));
      await persist();
      broadcast({ reason: 'use' });
    }
    return url;
  }

  /** Esquece um valor recente (botão × na palette). */
  async function forget(id, value) {
    await load();
    links = links.map((x) => (x.id === id ? { ...x, recent: (x.recent || []).filter((v) => v !== value) } : x));
    await persist();
    broadcast({ reason: 'forget' });
    return true;
  }

  return { init: load, list, save, remove, use, forget, flush: () => queue.flush(), file };
}

module.exports = { createLinksService };
