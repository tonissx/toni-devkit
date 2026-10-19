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
const { splitByDay, dayKey, dayStart } = require('./usage');
const { zero, sumTokens } = require('./pricing');
const { searchSessions } = require('./search');
const { createGitInfo } = require('./gitinfo');
const { redact } = require('../../src/logs/redact.js');
const { sessionDigest } = require('../../src/tools/aimon/aiInput.js');

const WINDOW_MS = 24 * 3600e3;
const MAX_EVENTS = 3000;     // por sessão, na memória
const FIRST_READ_MAX = 6 * 1024 * 1024; // arquivo maior que isso: lê só o final (a contagem de turnos/tokens fica parcial)
const USAGE_FLUSH_MS = 30_000;         // de quanto em quanto tempo as métricas diárias vão para o disco
const CONFLICT_MS = 30 * 60_000;       // dois agentes no mesmo arquivo: só conta edição dessa janela
const IDLE_DIRTY_MS = 6 * 3600e3;      // sessão parada há mais que isso não tem o git consultado
const base = (p) => String(p || '').split('\\').join('/').split('/').filter(Boolean).pop() || '';

function createAimonService({ providers, broadcast = () => {}, now = () => Date.now(), pollMs = 1500, rescanMs = 6000, windowMs = WINDOW_MS, gitinfo = null,
  usage = null, getPrices = () => ({}), onAttention = () => {} }) {
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
  const lastStatus = new Map();  // "provedor:sessão" → último status visto (para avisar só na mudança)
  const notified = new Map();    // "provedor:sessão:tipo" → quando avisou (evita repetir em poucos segundos)
  const conflictMap = new Map(); // "provedor:sessão" → [{ path, with: [rótulos] }]: outro agente editou o mesmo arquivo há pouco
  const ownerOfCwd = new Map();  // pasta → sessão principal mais recente dela (só ela mostra "parada com alterações")
  let lastUsageFlush = 0;

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
          if (ev.kind === 'usage') addDaily(t, ev);
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
    t.st = state.createSessionState(); t.ctx = {}; t.events = []; t.offset = 0; t.partial = false; t.skipFirst = false; t.daily = {};
  }

  /** Tokens do evento de uso, no dia dele (as métricas diárias; ver usage.js). */
  function addDaily(t, ev) {
    if (!ev.ts) return;
    const day = dayKey(ev.ts);
    const d = t.daily[day] || (t.daily[day] = { tokens: zero(), byModel: {} });
    d.tokens = sumTokens(d.tokens, ev.tokens || {});
    if (ev.model) d.byModel[ev.model] = sumTokens(d.byModel[ev.model] || zero(), ev.tokens || {});
  }

  const projectOf = (t) => { const r = repoOf(t); return (r && r.name) || base(t.st.cwd) || t.meta.project || ''; };

  /** O que cada sessão acumulou, por dia: tokens (sessões e subagentes) e tempo trabalhando/esperando (só sessões principais). */
  function usageContribution() {
    const out = {};
    const at = now();
    for (const t of tracked.values()) {
      const key = keyOf(t.meta);
      const agent = !!t.meta.parentId;
      const split = agent ? {} : splitByDay(overlayWaiting(segments(t.events, at, { from: 0 }), waits.get(key), 0, at));
      const project = projectOf(t);
      for (const day of new Set([...Object.keys(t.daily), ...Object.keys(split)])) {
        const d = t.daily[day] || { tokens: zero(), byModel: {} };
        const sp = split[day] || { workMs: 0, waitMs: 0, waitCount: 0 };
        const tok = d.tokens.input + d.tokens.output + d.tokens.cacheRead + d.tokens.cacheWrite;
        if (!tok && !sp.workMs && !sp.waitMs) continue;
        (out[day] || (out[day] = {}))[key] = { project, agent, tokens: d.tokens, byModel: d.byModel, workMs: sp.workMs, waitMs: sp.waitMs, waitCount: sp.waitCount };
      }
    }
    return out;
  }

  function flushUsage(force) {
    if (!usage) return;
    if (!force && now() - lastUsageFlush < USAGE_FLUSH_MS) return;
    lastUsageFlush = now();
    try { usage.merge(usageContribution()); usage.persist().catch(() => {}); } catch { /* métrica nunca derruba o monitor */ }
  }

  /** Avisa (onAttention) quando uma sessão principal passa a esperar por você (informado pelo próprio agente) ou dá erro. */
  function checkAttention() {
    const at = now();
    for (const t of tracked.values()) {
      if (t.meta.parentId) continue;
      const key = keyOf(t.meta);
      const live = liveBy.get(key) || null;
      const status = state.statusOf(t.st, at, live);
      const prev = lastStatus.get(key);
      lastStatus.set(key, status);
      if (prev === undefined || prev === status) continue; // 1ª vez que vê a sessão só anota: não avisa do que já estava assim
      // "Esperando" só vale quando o agente informa: a estimativa pelo transcript confunde com ferramenta demorada.
      const kind = status === 'error' ? 'error' : status === 'waiting' && live && live.status === 'waiting' ? 'waiting' : null;
      if (!kind) continue;
      const nk = key + ':' + kind;
      if (at - (notified.get(nk) || 0) < 20_000) continue;
      notified.set(nk, at);
      try {
        onAttention({ kind, key, project: projectOf(t), title: t.meta.label || t.st.title || t.st.lastText || 'Sessão sem título',
          detail: kind === 'waiting' ? live.waitingFor || null : (t.st.error && t.st.error.message) || null, ts: at });
      } catch { /* aviso nunca derruba o monitor */ }
    }
    for (const k of [...lastStatus.keys()]) if (!tracked.has(k)) lastStatus.delete(k);
  }

  /** Dois agentes ao mesmo tempo no mesmo arquivo (editado nos últimos 30 min): nas mesmas pastas isso vira conflito. */
  function computeConflicts() {
    conflictMap.clear();
    const at = now();
    const byPath = new Map();
    for (const t of tracked.values()) {
      const key = keyOf(t.meta);
      const status = state.statusOf(t.st, at, t.meta.parentId ? null : liveBy.get(key) || null);
      if (status !== 'working' && status !== 'waiting') continue;
      for (const [norm, e] of t.st.edits) if (at - e.ts <= CONFLICT_MS) (byPath.get(norm) || byPath.set(norm, []).get(norm)).push({ t, path: e.path });
    }
    const label = (t) => t.meta.label || t.st.title || (t.meta.parentId ? 'Subagente' : 'Outra sessão');
    for (const list of byPath.values()) {
      if (list.length < 2) continue;
      for (const a of list) {
        // Pai e subagente no mesmo arquivo é rotina: não conta.
        const others = list.filter((b) => b !== a && b.t.meta.parentId !== a.t.meta.sessionId && a.t.meta.parentId !== b.t.meta.sessionId);
        if (!others.length) continue;
        const k = keyOf(a.t.meta);
        const cur = conflictMap.get(k) || [];
        if (cur.length < 3) cur.push({ path: a.path, with: [...new Set(others.map((o) => label(o.t)))].slice(0, 3) });
        conflictMap.set(k, cur);
      }
    }
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
          if (!t) { t = { meta: m, ctx: {}, st: state.createSessionState(), events: [], offset: 0, partial: false, skipFirst: false, busy: false, version: 0, daily: {} }; tracked.set(k, t); }
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
    ownerOfCwd.clear();
    for (const t of tracked.values()) { // a sessão principal mais recente de cada pasta
      if (t.meta.parentId || !t.st.cwd) continue;
      const ts = t.st.lastTs || t.meta.mtime;
      const cur = ownerOfCwd.get(t.st.cwd);
      if (!cur || ts > cur.ts) ownerOfCwd.set(t.st.cwd, { key: keyOf(t.meta), ts });
    }
    for (const t of tracked.values()) {
      const cwd = t.st.cwd;
      // Em andamento: a cada 5 s. Parada há pouco (e dona da pasta): a cada 30 s, para avisar de alteração sem commit.
      const parked = !t.st.turnOpen && !t.meta.parentId && now() - (t.st.lastTs || t.meta.mtime) < IDLE_DIRTY_MS && (ownerOfCwd.get(cwd) || {}).key === keyOf(t.meta);
      if (!cwd || (!t.st.turnOpen && !parked) || dirtyBusy.has(cwd) || !repoOf(t)) continue;
      const hit = dirtyBy.get(cwd);
      if (hit && now() - hit.at < (t.st.turnOpen ? 5000 : 30_000)) continue;
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
    computeConflicts();
    checkAttention();
    flushUsage(false);
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
    dirty: dirtyOf(t),
    conflicts: conflictMap.get(keyOf(t.meta)) || [],
  });

  /** Arquivos alterados na pasta: das sessões em andamento e da sessão principal mais recente de cada pasta (parada com alterações). */
  function dirtyOf(t) {
    const hit = t.st.cwd && dirtyBy.get(t.st.cwd);
    if (!hit || now() - hit.at > 120_000) return null; // sem consulta recente (acompanhamento parou, ou a sessão não é a dona da pasta)
    if (t.st.turnOpen) return hit.n;
    const owner = ownerOfCwd.get(t.st.cwd);
    return !t.meta.parentId && owner && owner.key === keyOf(t.meta) ? hit.n : null;
  }

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
        lastStatus.clear(); // recomeça: o que já estava esperando ao ligar não gera aviso
        lastUsageFlush = 0;
        const run = () => tick().catch(() => {});
        run();
        timer = setInterval(run, pollMs);
        if (timer.unref) timer.unref();
      } else if (!on && timer) { clearInterval(timer); timer = null; gen++; flushUsage(true); }
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
    /** Métricas de uso dos últimos `days` dias (custo estimado, tokens, tempo trabalhando e esperando). `plans`: [{ ts, status }]. */
    async usage(days, plans) {
      if (!usage) return null;
      flushUsage(true);
      return usage.range(days, { prices: getPrices(), plans });
    },
    /** Esquece as métricas guardadas. */
    async usageClear() { if (usage) await usage.clear(); return true; },
    /** Busca em prompts e respostas das sessões gravadas em disco (últimos `days` dias), sem índice: lê os arquivos na hora. */
    search(q, opts = {}) { return searchSessions({ providers, q, days: opts.days, limit: opts.limit, now: now() }); },
    /** Base do diário do dia: o que cada sessão principal fez desde a meia-noite (já enxuto; o texto ainda passa por `redact` na tarefa). */
    dayDigest() {
      const since = dayStart(dayKey(now()));
      const sessions = [];
      for (const t of tracked.values()) {
        if (t.meta.parentId) continue;
        const evs = t.events.filter((e) => e.ts >= since);
        if (!evs.length) continue;
        const d = sessionDigest(row(t), evs);
        const daily = t.daily[dayKey(now())];
        sessions.push({ ...d, lastTs: t.st.lastTs, tokens: daily ? daily.tokens.input + daily.tokens.output + daily.tokens.cacheRead + daily.tokens.cacheWrite : 0 });
      }
      sessions.sort((a, b) => a.lastTs - b.lastTs);
      return { date: dayKey(now()), sessions: sessions.slice(-12) };
    },
    /** Dados de uma sessão acompanhada, para abrir um terminal nela. */
    sessionInfo(key) { const t = tracked.get(key); return t ? { provider: t.meta.provider, sessionId: t.meta.sessionId, cwd: t.st.cwd } : null; },
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
    stop() { if (timer) { clearInterval(timer); timer = null; gen++; flushUsage(true); } },
    _tick: tick,
    _tracked: tracked,
  };
}

module.exports = { createAimonService };
