'use strict';
/**
 * Logs (processo principal): quais logs estão abertos, acompanhar ao vivo e lembrar do que o usuário usa.
 * O trabalho pesado (ler, indexar, filtrar) fica no worker — callWorker(op, args) — ver engine.js.
 *
 * - Ao vivo: fs.watch no arquivo atual + conferência de tamanho a cada pollMs (no Windows o fs.watch perde
 *   gravações de quem mantém o arquivo aberto, como o JBoss). Cresceu → lê só o que chegou. Encolheu (truncado)
 *   ou o arquivo foi trocado (rotação: outro inode/data de criação) → reabre e avisa.
 * - Pasta: junta os arquivos rotacionados de uma "família" (src/logs/rotate.js) — o atual é o que fica ao vivo.
 * - %APPDATA%\Toni Devkit\logs.json: recentes, filtros salvos e formato/encoding escolhidos à mão por caminho.
 */
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { families } = require('../../src/logs/rotate.js');

const MAX_RECENTS = 15;
const MAX_PRESETS = 40;

function createLogsService({ file, callWorker, broadcast = () => {}, watch = fss.watch, pollMs = 1000, now = () => Date.now() }) {
  let state = { recents: [], presets: [], overrides: {} };
  const queue = createQueue();
  const open = new Map(); // id → { id, spec, name, files, live, watcher, timer, ino, busy, seenErrors, errors }
  let seq = 0;

  async function init() {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      state = {
        recents: Array.isArray(raw.recents) ? raw.recents : [],
        presets: Array.isArray(raw.presets) ? raw.presets : [],
        overrides: raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {},
      };
    } catch { /* primeira vez */ }
  }
  const persist = () => queue.run('save', () => atomicWrite(file, JSON.stringify(state, null, 2)));

  const isGz = (name) => /\.gz$/i.test(name);

  /** Arquivos de um pedido de abertura. → { files, families?, family?, name } */
  async function resolve(spec) {
    const p = path.resolve(String(spec.path || ''));
    const st = await fs.stat(p).catch(() => null);
    if (!st) throw new Error(`Não encontrado: ${p}`);
    if (st.isFile()) {
      return { files: [{ path: p, name: path.basename(p), mtime: st.mtimeMs, size: st.size, gz: isGz(p) }], name: path.basename(p) };
    }
    if (!st.isDirectory()) throw new Error(`Não é arquivo nem pasta: ${p}`);
    const entries = [];
    for (const d of await fs.readdir(p, { withFileTypes: true })) {
      if (!d.isFile()) continue;
      const s = await fs.stat(path.join(p, d.name)).catch(() => null);
      if (s) entries.push({ name: d.name, mtime: s.mtimeMs, size: s.size });
    }
    const fams = families(entries);
    if (!fams.length) throw new Error('Nenhum arquivo de log nesta pasta (.log, .txt, .out, .json, rotacionados…)');
    const fam = (spec.family && fams.find((f) => f.family.toLowerCase() === String(spec.family).toLowerCase())) || fams[0];
    return {
      files: fam.files.map((f) => ({ path: path.join(p, f.name), name: f.name, date: f.date, mtime: f.mtime, size: f.size, gz: f.gz })),
      families: fams.map((f) => ({ family: f.family, count: f.files.length, size: f.size, mtime: f.mtime, active: f.active })),
      family: fam.family,
      name: `${path.basename(p)}${path.sep}${fam.family}`,
    };
  }

  const keyOf = (spec) => (spec.kind === 'folder' ? 'd:' + path.resolve(spec.path).toLowerCase() + '|' + String(spec.family || '').toLowerCase() : 'f:' + path.resolve(spec.path).toLowerCase());

  async function remember(spec, name) {
    const key = keyOf(spec);
    state.recents = [{ kind: spec.kind, path: path.resolve(spec.path), family: spec.family || null, name, at: now() },
      ...state.recents.filter((r) => keyOf(r) !== key)].slice(0, MAX_RECENTS);
    await persist();
  }

  /**
   * Abre um arquivo ou pasta. spec: { kind: 'file'|'folder', path, family?, format?, encoding?, tail? }
   * → info do worker + { id, name, spec, families, family, live }
   */
  async function openSource(spec, reuseId) {
    spec = { kind: spec.kind === 'folder' ? 'folder' : 'file', path: String(spec.path || ''), family: spec.family || null, format: spec.format, encoding: spec.encoding, tail: spec.tail !== false };
    const ov = state.overrides[keyOf(spec)] || {};
    const format = spec.format || ov.format || 'auto';
    const encoding = spec.encoding || ov.encoding || 'auto';
    const r = await resolve(spec);
    if (spec.kind === 'folder' && !spec.family) spec.family = r.family;
    const id = reuseId || 'l' + (++seq);
    const last = r.files[r.files.length - 1];
    const live = spec.tail && !last.gz;
    const prev = open.get(id);
    if (prev) stopTail(prev);
    const src = { id, spec, name: r.name, files: r.files, families: r.families || null, family: r.family || null, live, watcher: null, timer: null, ino: null, busy: false, seenErrors: prev ? prev.seenErrors : null, errors: 0, info: null };
    open.set(id, src);
    broadcast({ type: 'opening', id, name: r.name });
    let info;
    try {
      info = await callWorker('open', { id, files: r.files, format, encoding, tail: live });
    } catch (e) {
      open.delete(id);
      throw e;
    }
    src.info = info;
    src.errors = info.levelTotals[5] + info.levelTotals[6];
    if (src.seenErrors == null) src.seenErrors = src.errors;
    if (live) await startTail(src);
    if (!reuseId) await remember(spec, r.name);
    return out(src, info);
  }

  const out = (src, info) => ({ ...info, id: src.id, name: src.name, spec: src.spec, families: src.families, family: src.family, live: src.live });

  /* ─────────────── Ao vivo ─────────────── */

  async function fileId(p) {
    try { const s = await fs.stat(p, { bigint: true }); return `${s.ino}:${s.birthtimeNs}`; } catch { return null; }
  }

  async function startTail(src) {
    const f = src.files[src.files.length - 1];
    src.ino = await fileId(f.path);
    let t = null;
    const kick = () => { clearTimeout(t); t = setTimeout(() => check(src), 120); };
    try { src.watcher = watch(f.path, kick); if (src.watcher && src.watcher.on) src.watcher.on('error', () => {}); } catch { src.watcher = null; }
    src.timer = setInterval(() => check(src), pollMs);
    if (src.timer.unref) src.timer.unref();
    src.kickTimer = () => clearTimeout(t);
  }

  function stopTail(src) {
    if (src.watcher) { try { src.watcher.close(); } catch { /* já fechado */ } }
    if (src.timer) clearInterval(src.timer);
    if (src.kickTimer) src.kickTimer();
    src.watcher = null; src.timer = null;
  }

  async function check(src) {
    if (src.busy || open.get(src.id) !== src || !src.live) return;
    src.busy = true;
    try {
      const f = src.files[src.files.length - 1];
      const ino = await fileId(f.path);
      if (ino && src.ino && ino !== src.ino) return await reopen(src, 'rotated');
      const r = await callWorker('grow', { id: src.id });
      if (r.reset) return await reopen(src, 'truncated');
      if (r.missing) return; // apagado no meio de uma rotação: a próxima volta acha o novo
      if (r.added || r.settled) broadcast({ type: 'appended', id: src.id, n: r.n, added: r.added });
    } catch (e) {
      broadcast({ type: 'error', id: src.id, error: String(e.message || e) });
    } finally { src.busy = false; }
  }

  async function reopen(src, reason) {
    stopTail(src);
    try {
      const info = await openSource(src.spec, src.id);
      broadcast({ type: 'reset', id: src.id, reason, info });
    } catch (e) {
      broadcast({ type: 'error', id: src.id, error: String(e.message || e) });
    }
  }

  /* ─────────────── API ─────────────── */

  return {
    init,
    open: (spec) => openSource(spec || {}),
    /** Mesmo log com outro formato/encoding (lembrado para a próxima vez). */
    async reformat(id, { format, encoding } = {}) {
      const src = open.get(id);
      if (!src) throw new Error('Log não está aberto');
      const key = keyOf(src.spec);
      state.overrides[key] = { ...(state.overrides[key] || {}), ...(format ? { format } : {}), ...(encoding ? { encoding } : {}) };
      if (format === 'auto') delete state.overrides[key].format;
      if (encoding === 'auto') delete state.overrides[key].encoding;
      await persist();
      stopTail(src);
      return openSource({ ...src.spec, format: format === 'auto' ? undefined : format || src.spec.format, encoding: encoding === 'auto' ? undefined : encoding || src.spec.encoding }, id);
    },
    /** Outra família de arquivos da mesma pasta. */
    async switchFamily(id, family) {
      const src = open.get(id);
      if (!src || src.spec.kind !== 'folder') throw new Error('Só para pastas');
      stopTail(src);
      const info = await openSource({ ...src.spec, family }, id);
      await remember(info.spec, info.name);
      return info;
    },
    async setLive(id, on) {
      const src = open.get(id);
      if (!src) return false;
      const last = src.files[src.files.length - 1];
      if (on && !last.gz && !src.live) { src.live = true; src.spec.tail = true; await startTail(src); check(src); }
      if (!on && src.live) { src.live = false; src.spec.tail = false; stopTail(src); }
      return src.live;
    },
    async close(id) {
      const src = open.get(id);
      if (src) { stopTail(src); open.delete(id); }
      await callWorker('close', { id }).catch(() => {});
      return true;
    },
    /** Logs abertos (a tela volta para eles quando reabre). */
    list() {
      return [...open.values()].map((s) => ({ id: s.id, name: s.name, spec: s.spec, live: s.live, family: s.family, families: s.families }));
    },
    /** Para o Início: abertos, ao vivo, e erros novos desde a última vez que a aba foi vista. */
    async summaries() {
      const outl = [];
      for (const s of open.values()) {
        let info = null;
        try { info = await callWorker('info', { id: s.id }); } catch { continue; }
        const errors = info.levelTotals[5] + info.levelTotals[6];
        s.errors = errors;
        outl.push({ id: s.id, name: s.name, live: s.live, n: info.n, errors, warns: info.levelTotals[4], newErrors: Math.max(0, errors - (s.seenErrors || 0)), tsMax: info.tsMax });
      }
      return outl;
    },
    async markSeen(id) {
      const s = open.get(id);
      if (!s) return false;
      try { const info = await callWorker('info', { id }); s.seenErrors = info.levelTotals[5] + info.levelTotals[6]; } catch { /* fechado */ }
      return true;
    },
    recents: () => state.recents,
    async forgetRecent(p) {
      state.recents = state.recents.filter((r) => r.path.toLowerCase() !== String(p || '').toLowerCase());
      await persist();
      return state.recents;
    },
    presets: () => state.presets,
    async savePresets(list) {
      state.presets = (Array.isArray(list) ? list : [])
        .filter((p) => p && typeof p.name === 'string' && p.name.trim())
        .slice(0, MAX_PRESETS)
        .map((p) => ({ id: String(p.id || Math.random().toString(36).slice(2, 10)), name: p.name.trim().slice(0, 60), q: String(p.q || '').slice(0, 2000), levels: Array.isArray(p.levels) ? p.levels.filter((l) => Number.isInteger(l) && l >= 0 && l <= 6) : null }));
      await persist();
      return state.presets;
    },
    /** Famílias de logs numa pasta (para escolher antes de abrir). */
    async scanFolder(dir) { const r = await resolve({ kind: 'folder', path: dir }); return r.families; },
    unwatch() { for (const s of open.values()) stopTail(s); },
    flush: () => queue.flush(),
    _open: open,
    _check: (id) => check(open.get(id)),
  };
}

module.exports = { createLogsService };
