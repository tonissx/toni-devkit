'use strict';
/**
 * Monitor de IA (processo principal): acompanha as sessões recentes de agentes de IA (Claude Code, Codex…) lendo o que
 * cada ferramenta já grava em disco. Somente leitura — nada é gravado nem sai da máquina.
 *
 * - Cada provedor (providers/*.js) sabe achar as sessões e traduzir uma linha do .jsonl em eventos normalizados (util.js).
 * - Aqui ficam o acompanhamento incremental (lê só o que cresceu desde o último tamanho visto; a última linha, se vier
 *   cortada, espera a próxima volta), o estado por sessão (state.js) e uma janela dos últimos eventos para a timeline.
 * - Só roda enquanto a tela está aberta (setActive): o fs.watch perde gravações no Windows, então é varredura por tempo.
 */
const fs = require('node:fs/promises');
const state = require('./state');
const { segments, overlayWaiting, stats: lanesStats } = require('./lanes');
const { createGitInfo } = require('./gitinfo');
const { redact } = require('../../src/logs/redact.js');
const { sessionDigest } = require('../../src/tools/aimon/aiInput.js');

const WINDOW_MS = 24 * 3600e3;
const MAX_EVENTS = 3000;     // por sessão, na memória
const FIRST_READ_MAX = 6 * 1024 * 1024; // arquivo maior que isso: lê só o final (a contagem de turnos/tokens fica parcial)

function createAimonService({ providers, broadcast = () => {}, now = () => Date.now(), pollMs = 1500, rescanMs = 6000, windowMs = WINDOW_MS, gitinfo = null }) {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const tracked = new Map(); // "provider:sessionId" → { meta, ctx, st, events, offset, tail, busy, partial, version }
  let timer = null;
  let lastScan = 0;
  let scanning = false;
  let dirty = false;
  const repos = new Map();   // cwd → { info, at }: de que repositório (e worktree) é a pasta da sessão
  const resolving = new Set();
  const dirtyBy = new Map(); // cwd → { n, at }: arquivos alterados, só das sessões em andamento (alerta no card)
  const dirtyBusy = new Set();
  const liveBy = new Map();  // "provedor:sessão" → estado ao vivo informado pelo agente (só sessões principais)
  const waits = new Map();   // "provedor:sessão" → [{ from, to|null }]: quando o agente informou "esperando você"
  let gi = gitinfo;
  let gen = 0; // sobe quando o acompanhamento para: um tick já em andamento não avisa mais a tela

  const keyOf = (m) => m.provider + ':' + m.sessionId;

  async function readFrom(file, from) {
    const fh = await fs.open(file, 'r');
    try {
      const { size } = await fh.stat();
      if (size <= from) return { size, text: '' };
      const buf = Buffer.alloc(size - from);
      await fh.read(buf, 0, buf.length, from);
      return { size, text: buf.toString('utf8') };
    } finally { await fh.close(); }
  }

  /** Lê o que cresceu no arquivo e aplica os eventos. Devolve true se algo mudou. */
  async function pull(t) {
    if (t.busy) return false;
    t.busy = true;
    try {
      const st = await fs.stat(t.meta.file).catch(() => null);
      if (!st) return false;
      let from = t.offset;
      if (st.size < t.offset) { reset(t); from = 0; } // truncado/recriado
      if (st.size === from && t.offset > 0) return false;
      if (t.offset === 0 && st.size > FIRST_READ_MAX) { from = st.size - FIRST_READ_MAX; t.partial = true; t.skipFirst = true; }
      const r = await readFrom(t.meta.file, from);
      // Só consome até a última quebra de linha: o resto é uma linha ainda sendo gravada.
      const cut = r.text.lastIndexOf('\n');
      if (cut < 0) return false;
      const chunk = r.text.slice(0, cut + 1);
      t.offset = from + Buffer.byteLength(chunk, 'utf8');
      const lines = chunk.split('\n');
      if (t.skipFirst) { lines.shift(); t.skipFirst = false; } // começou no meio de uma linha
      const prov = byId.get(t.meta.provider);
      let changed = false;
      for (const line of lines) {
        if (!line) continue;
        let evs;
        try { evs = prov.parseLine(line, t.ctx); } catch { evs = []; } // um adaptador nunca derruba o monitor
        for (const ev of evs) {
          state.apply(t.st, ev);
          if (ev.kind !== 'usage' && ev.kind !== 'title') { t.events.push(ev); changed = true; }
          else changed = true;
        }
      }
      if (t.events.length > MAX_EVENTS) t.events.splice(0, t.events.length - MAX_EVENTS);
      if (t.ctx.cwd) t.st.cwd = t.ctx.cwd;
      if (t.ctx.branch) t.st.branch = t.ctx.branch;
      if (changed) t.version++;
      return changed;
    } catch { return false; } finally { t.busy = false; }
  }

  function reset(t) {
    t.st = state.createSessionState(); t.ctx = {}; t.events = []; t.offset = 0; t.partial = false; t.skipFirst = false;
  }

  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      const since = now() - windowMs;
      const seen = new Set();
      for (const p of providers) {
        let list = [];
        try { list = await p.listSessions(since); } catch { list = []; }
        for (const m of list) {
          const k = keyOf(m);
          seen.add(k);
          let t = tracked.get(k);
          if (!t) { t = { meta: m, ctx: {}, st: state.createSessionState(), events: [], offset: 0, partial: false, skipFirst: false, busy: false, version: 0 }; tracked.set(k, t); }
          else t.meta = m;
        }
      }
      for (const k of [...tracked.keys()]) if (!seen.has(k)) tracked.delete(k); // saiu da janela
      lastScan = now();
    } finally { scanning = false; }
  }

  /** Descobre o repositório das pastas das sessões, em segundo plano (o git roda com limite de concorrência). */
  function resolveRepos() {
    for (const t of tracked.values()) {
      const cwd = t.st.cwd;
      if (!cwd || resolving.has(cwd)) continue;
      const hit = repos.get(cwd);
      if (hit && now() - hit.at < 30_000) continue;
      resolving.add(cwd);
      (gi || (gi = createGitInfo())).resolve(cwd).then((info) => {
        const before = JSON.stringify(hit && hit.info);
        repos.set(cwd, { info, at: now() });
        if (JSON.stringify(info) !== before) dirty = true;
      }, () => {}).finally(() => resolving.delete(cwd));
    }
  }

  /** Quantos arquivos estão alterados na pasta das sessões em andamento (um `status` leve, no máximo a cada 5 s). */
  function refreshDirty() {
    for (const t of tracked.values()) {
      const cwd = t.st.cwd;
      if (!cwd || !t.st.turnOpen || dirtyBusy.has(cwd) || !repoOf(t)) continue;
      const hit = dirtyBy.get(cwd);
      if (hit && now() - hit.at < 5000) continue;
      dirtyBusy.add(cwd);
      (gi || (gi = createGitInfo())).dirtyCount(cwd).then((n) => {
        if (!hit || hit.n !== n) dirty = true;
        dirtyBy.set(cwd, { n, at: now() });
      }, () => {}).finally(() => dirtyBusy.delete(cwd));
    }
  }

  /** Estado ao vivo informado pelos agentes (ex.: ~/.claude/sessions) e o histórico de quando ficaram esperando. */
  async function refreshLive() {
    for (const p of providers) {
      if (typeof p.live !== 'function') continue;
      let map;
      try { map = await p.live(); } catch { continue; }
      const seen = new Set();
      for (const [sid, info] of map) {
        const key = p.id + ':' + sid;
        seen.add(key);
        const prev = liveBy.get(key);
        liveBy.set(key, info);
        const list = waits.get(key) || [];
        const open = list.length && list[list.length - 1].to == null ? list[list.length - 1] : null;
        if (info.status === 'waiting' && !open) list.push({ from: info.statusUpdatedAt || now(), to: null });
        else if (info.status !== 'waiting' && open) open.to = info.statusUpdatedAt || now();
        if (list.length > 50) list.splice(0, list.length - 50);
        waits.set(key, list);
        if (!prev || prev.status !== info.status || prev.waitingFor !== info.waitingFor) dirty = true;
      }
      for (const key of [...liveBy.keys()]) {
        if (!key.startsWith(p.id + ':') || seen.has(key)) continue;
        liveBy.delete(key); // o processo acabou: fecha o que estava aberto
        const list = waits.get(key);
        if (list && list.length && list[list.length - 1].to == null) list[list.length - 1].to = now();
        dirty = true;
      }
    }
  }

  async function tick() {
    const g = gen;
    if (now() - lastScan >= rescanMs) await scan();
    let any = false;
    await Promise.all([...tracked.values()].map(async (t) => { if (await pull(t)) any = true; }));
    await refreshLive();
    resolveRepos();
    refreshDirty();
    // O status depende do relógio (trabalhando → esperando): reavisa a tela mesmo sem linha nova se algo está em andamento.
    const live = [...tracked.values()].some((t) => t.st.turnOpen);
    if (g === gen && (any || dirty || live)) { dirty = false; broadcast({ type: 'changed' }); }
  }

  /** Repositório da sessão (null enquanto não resolveu ou se a pasta não é um repositório). */
  const repoOf = (t) => {
    const hit = t.st.cwd && repos.get(t.st.cwd);
    const i = hit && hit.info;
    return i && i.git ? { top: i.top, main: i.main, name: i.name, branch: i.branch || t.st.branch || null, worktree: i.worktree } : null;
  };

  const row = (t) => ({
    key: keyOf(t.meta), provider: t.meta.provider, sessionId: t.meta.sessionId, parentId: t.meta.parentId || null,
    label: t.meta.label || null, project: t.meta.project || null, file: t.meta.file, mtime: t.meta.mtime, partial: t.partial,
    ...state.summary(t.st, now(), t.meta.parentId ? null : liveBy.get(keyOf(t.meta)) || null),
    repo: repoOf(t),
    dirty: t.st.turnOpen && dirtyBy.has(t.st.cwd) ? dirtyBy.get(t.st.cwd).n : null,
  });

  return {
    /** Provedores conhecidos e se a ferramenta está instalada (a pasta existe). */
    async providers() {
      const out = [];
      for (const p of providers) {
        const ok = await fs.stat(p.root()).then((s) => s.isDirectory(), () => false);
        out.push({ id: p.id, name: p.name, icon: p.icon, installed: ok });
      }
      return out;
    },
    /** Liga/desliga o acompanhamento (a tela abriu/fechou). */
    setActive(on) {
      if (on && !timer) {
        dirty = true;
        const run = () => tick().catch(() => {});
        run();
        timer = setInterval(run, pollMs);
        if (timer.unref) timer.unref();
      } else if (!on && timer) { clearInterval(timer); timer = null; gen++; }
      return !!timer;
    },
    /** Sessões da janela, mais recentes primeiro; subagentes trazem parentId. */
    list({ provider } = {}) {
      return [...tracked.values()].filter((t) => !provider || provider === 'all' || t.meta.provider === provider).map(row)
        .sort((a, b) => (b.lastTs || b.mtime) - (a.lastTs || a.mtime));
    },
    /** Eventos de uma sessão (os últimos `limit`). */
    timeline(key, { limit = 500 } = {}) {
      const t = tracked.get(key);
      if (!t) return { events: [], total: 0, version: 0 };
      return { events: t.events.slice(-limit), total: t.events.length, version: t.version, partial: t.partial, summary: row(t) };
    },
    /** Alterações não comitadas da pasta de uma sessão (só leitura). */
    gitChanges(key) {
      const t = tracked.get(key);
      if (!t || !t.st.cwd) return Promise.resolve({ exists: false, git: false, files: [], total: 0, counts: {}, truncated: false });
      return (gi || (gi = createGitInfo())).changes(t.st.cwd);
    },
    /** Diff de um arquivo da lista de gitChanges (o caminho só vale se estiver nela). */
    gitDiff(key, filePath, area) {
      const t = tracked.get(key);
      if (!t || !t.st.cwd) return Promise.reject(new Error('Sessão não encontrada'));
      return (gi || (gi = createGitInfo())).diffFile(t.st.cwd, String(filePath || ''), area ? String(area) : undefined);
    },
    /** Resumo estruturado da sessão para a IA (pedidos, respostas, ferramentas, arquivos, commits), com todos os eventos guardados. */
    digest(key) {
      const t = tracked.get(key);
      return t ? sessionDigest(row(t), t.events) : sessionDigest({}, []);
    },
    /** O que a IA recebe do Git de uma sessão (diff do que não foi comitado, mensagens recentes, branch), já mascarado. */
    async gitAiInput(key) {
      const t = tracked.get(key);
      if (!t || !t.st.cwd) return { diff: '', recent: [], branch: null, files: [], omitted: [] };
      const r = await (gi || (gi = createGitInfo())).aiInput(t.st.cwd);
      return { ...r, diff: redact(r.diff).text, recent: r.recent.map((s) => redact(s).text) };
    },
    /** Repositório de uma pasta qualquer (para abrir um plano antigo no Git). */
    resolveRepo(cwd) { return (gi || (gi = createGitInfo())).resolve(String(cwd || '')); },
    /** Raias: blocos trabalhando/esperando de cada sessão desde `since` (ms). Só entram sessões com atividade no período. */
    lanes({ provider, since = 0 } = {}) {
      const at = now();
      const out = [];
      for (const t of tracked.values()) {
        if (provider && provider !== 'all' && t.meta.provider !== provider) continue;
        const segs = overlayWaiting(segments(t.events, at, { from: since }), waits.get(keyOf(t.meta)), since, at);
        const errors = t.events.filter((e) => e.kind === 'error' && e.ts >= since).map((e) => ({ ts: e.ts, code: e.code || null, message: e.summary || '' }));
        if (!segs.length && !errors.length) continue;
        const r = row(t);
        const commits = t.events.filter((e) => e.kind === 'commit' && e.ts >= since).map((e) => ({ ts: e.ts, hash: e.hash, branch: e.branch, subject: e.summary }));
        out.push({ key: r.key, provider: r.provider, sessionId: r.sessionId, parentId: r.parentId, label: r.label, title: r.title, project: r.project, cwd: r.cwd, status: r.status, partial: r.partial, repo: r.repo, commits, errors, segments: segs });
      }
      return { now: at, since, lanes: out, stats: lanesStats(out, at) };
    },
    /**
     * Atividade por repositório principal, para a tela do Git: só olha o que o acompanhamento já leu (nunca liga o
     * acompanhamento). Sem o monitor aberto, devolve {}.
     */
    repoActivity() {
      const out = {};
      if (!timer) return out; // monitor fechado: o que há em memória é velho
      for (const t of tracked.values()) {
        const r = repoOf(t);
        if (!r) continue;
        const status = state.statusOf(t.st, now());
        const live = status === 'working' || status === 'waiting';
        const e = out[r.main] || (out[r.main] = { name: r.name, active: 0, agents: 0, total: 0, worktrees: {} });
        if (t.meta.parentId) { if (live) e.agents++; } else { e.total++; if (live) e.active++; }
        if (r.worktree && live) e.worktrees[r.top] = { title: t.st.title || t.meta.label || null, status, key: keyOf(t.meta) };
      }
      return out;
    },
    stop() { if (timer) { clearInterval(timer); timer = null; gen++; } },
    _tick: tick,
    _tracked: tracked,
  };
}

module.exports = { createAimonService };
