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
const { zero, sumTokens, costByModel } = require('./pricing');
const { searchSessions } = require('./search');
const { summarize: summarizeCtx, suggest: suggestCtx } = require('./context');
const { createGitInfo } = require('./gitinfo');
const { pulse } = require('./vitals');
const { redact } = require('../../src/logs/redact.js');
const { sessionDigest } = require('../../src/tools/aimon/aiInput.js');

const WINDOW_MS = 24 * 3600e3;
const MAX_EVENTS = 3000;     // por sessão, na memória
const MAX_LANE_TOOLS = 600;  // ticks de ferramenta por raia
const FIRST_READ_MAX = 6 * 1024 * 1024; // arquivo maior que isso: lê só o final (a contagem de turnos/tokens fica parcial)
const USAGE_FLUSH_MS = 30_000;         // de quanto em quanto tempo as métricas diárias vão para o disco
const CONFLICT_MS = 30 * 60_000;       // dois agentes no mesmo arquivo: só conta edição dessa janela
const IDLE_DIRTY_MS = 6 * 3600e3;      // sessão parada há mais que isso não tem o git consultado
const FIVE_H = 5 * 3600e3;             // janela do limite de uso
const BURN_CACHE_MS = 20_000;
const LIMIT_WARN_MS = 30 * 60_000;     // avisa quando, no ritmo atual, o limite chega em menos que isso
const countable = (t) => ((t && t.input) || 0) + ((t && t.output) || 0) + ((t && t.cacheWrite) || 0); // leitura de cache quase não conta no limite
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : 0; };
const LIMIT_HIT = /rate_limit|usage limit|limite de uso/i;
const WORDS = (s) => new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
const base = (p) => String(p || '').split('\\').join('/').split('/').filter(Boolean).pop() || '';

function createAimonService({ providers, broadcast = () => {}, now = () => Date.now(), pollMs = 1500, rescanMs = 6000, windowMs = WINDOW_MS, gitinfo = null,
  usage = null, getPrices = () => ({}), getLimit = () => null, getReview = () => null, onAttention = () => {}, onSettled = () => {} }) {
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
  let burnCache = null;
  let lastLimitNotice = 0;
  const settledAt = new Map();   // "provedor:sessão" → quando avisou que ficou ociosa (evita repetir)

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
          if (ev.kind !== 'usage' && ev.kind !== 'title' && ev.kind !== 'ctx_attach') { t.events.push(ev); changed = true; }
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
    t.st = state.createSessionState(); t.ctx = {}; t.events = []; t.offset = 0; t.partial = false; t.skipFirst = false; t.daily = {}; t.minutes = new Map();
  }

  /** Tokens do evento de uso, no dia dele (as métricas diárias; ver usage.js). */
  function addDaily(t, ev) {
    if (!ev.ts) return;
    const day = dayKey(ev.ts);
    const d = t.daily[day] || (t.daily[day] = { tokens: zero(), byModel: {}, hours: new Array(24).fill(0) });
    d.tokens = sumTokens(d.tokens, ev.tokens || {});
    const minute = Math.floor(ev.ts / 60000);
    const used = countable(ev.tokens);
    t.minutes.set(minute, (t.minutes.get(minute) || 0) + used);
    d.hours[new Date(ev.ts).getHours()] += used; // hora local, como o dia (mapa de calor da aba Uso)
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
      for (const day of new Set([...Object.keys(t.daily), ...Object.keys(split), ...Object.keys(t.st.toolDaily), ...Object.keys(t.st.turnDaily)])) {
        const d = t.daily[day] || { tokens: zero(), byModel: {}, hours: null };
        const sp = split[day] || { workMs: 0, waitMs: 0, waitCount: 0 };
        const tools = t.st.toolDaily[day] || {};
        const turn = (t.st.turnDaily[day] || {}).turn || null;
        const tok = d.tokens.input + d.tokens.output + d.tokens.cacheRead + d.tokens.cacheWrite;
        if (!tok && !sp.workMs && !sp.waitMs && !Object.keys(tools).length && !turn) continue;
        (out[day] || (out[day] = {}))[key] = { project, agent, tokens: d.tokens, byModel: d.byModel, hours: d.hours, workMs: sp.workMs, waitMs: sp.waitMs, waitCount: sp.waitCount, tools, turn };
      }
    }
    return out;
  }

  function flushUsage(force) {
    if (!usage) return;
    if (!force && now() - lastUsageFlush < USAGE_FLUSH_MS) return;
    lastUsageFlush = now();
    try {
      usage.merge(usageContribution());
      usage.recordHits(limitHits());
      burnCache = null; // os estouros mudam o limite estimado
      usage.persist().catch(() => {});
    } catch { /* métrica nunca derruba o monitor */ }
  }

  /** Tokens "contáveis" (entrada + saída + gravação de cache) consumidos entre dois instantes, em todas as sessões acompanhadas. */
  function usedBetween(from, to) {
    const a = Math.floor(from / 60000); const b = Math.floor(to / 60000);
    let n = 0;
    for (const t of tracked.values()) for (const [m, v] of t.minutes) if (m >= a && m <= b) n += v;
    return n;
  }

  /** Vezes em que o limite de uso estourou (erro do agente) e quanto se havia consumido nas 5 h anteriores. */
  function limitHits() {
    const out = [];
    for (const t of tracked.values()) {
      for (const e of t.events) if (e.kind === 'error' && e.ts && (LIMIT_HIT.test(e.code || '') || LIMIT_HIT.test(e.summary || ''))) out.push({ ts: e.ts, used: usedBetween(e.ts - FIVE_H, e.ts) });
    }
    return out;
  }

  /**
   * Ritmo de consumo e projeção do limite de uso. O limite vem da preferência (manual) ou da mediana das últimas vezes em
   * que o limite estourou (automático: quanto havia sido consumido nas 5 h anteriores). A projeção simula a janela de 5 h
   * andando: o que sai dela libera espaço e o ritmo da última hora continua. É uma estimativa, não um dado do provedor.
   */
  function burn() {
    const at = now();
    if (burnCache && at - burnCache.at < BURN_CACHE_MS) return burnCache.value;
    const a = Math.floor(at / 60000);
    const buf = new Array(300).fill(0); // buf[i] = tokens no minuto (a - 299 + i)
    for (const t of tracked.values()) for (const [m, v] of t.minutes) { const i = m - (a - 299); if (i >= 0 && i < 300) buf[i] += v; }
    const sum = (arr) => arr.reduce((x, y) => x + y, 0);
    const used5h = sum(buf);
    const lastHour = sum(buf.slice(240));
    const hits = usage ? usage.hits() : [];
    const manual = Number(getLimit()) > 0 ? Number(getLimit()) : null;
    const auto = hits.length ? Math.round(median(hits.slice(-5).map((h) => h.used))) : null;
    const limit = manual || auto || null;
    let etaMs = null;
    if (limit) {
      if (used5h >= limit) etaMs = 0;
      else if (lastHour > 0) {
        const perMin = lastHour / 60;
        let used = used5h;
        for (let k = 1; k <= 300; k++) { used += perMin - buf[k - 1]; if (used >= limit) { etaMs = k * 60000; break; } }
      }
    }
    const value = { at, used5h, lastHour, ratePerHour: lastHour, limit, limitSource: manual ? 'manual' : auto ? 'auto' : null, hits: hits.slice(-5), etaMs };
    burnCache = { at, value };
    return value;
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
      // Terminou o trabalho (voltou a ficar ociosa): quem quiser (ex.: revisão automática) reage.
      if ((prev === 'working' || prev === 'waiting') && status === 'idle' && at - (settledAt.get(key) || 0) > 60_000) {
        settledAt.set(key, at);
        try { onSettled({ key, ts: at }); } catch { /* gancho nunca derruba o monitor */ }
      }
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
    // Perto do limite de uso: avisa uma vez por hora.
    const b = burn();
    if (b.etaMs != null && b.etaMs > 0 && b.etaMs <= LIMIT_WARN_MS && at - lastLimitNotice > 3600e3) {
      lastLimitNotice = at;
      try { onAttention({ kind: 'limit', key: null, project: '', title: 'Perto do limite de uso', detail: `No ritmo atual, em cerca de ${Math.max(1, Math.round(b.etaMs / 60000))} min`, ts: at }); } catch { /* idem */ }
    }
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
          if (!t) { t = { meta: m, ctx: {}, st: state.createSessionState(), events: [], offset: 0, partial: false, skipFirst: false, busy: false, version: 0, daily: {}, minutes: new Map() }; tracked.set(k, t); }
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
    flushUsage(false); // antes dos avisos: grava os estouros de limite que a projeção usa
    checkAttention();
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
    review: t.meta.parentId ? null : getReview(keyOf(t.meta)),
    pulse: pulse(t.minutes, now()), // tokens por minuto nos últimos 30 min (o desenho do card); null sem consumo na janela
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
        const tools = t.events.filter((e) => e.kind === 'tool_use' && e.ts >= since).map((e) => e.ts).slice(-MAX_LANE_TOOLS); // ticks de ferramenta (só o instante)
        out.push({ key: r.key, provider: r.provider, sessionId: r.sessionId, parentId: r.parentId, label: r.label, title: r.title, project: r.project, cwd: r.cwd, status: r.status, partial: r.partial, repo: r.repo, commits, errors, tools, segments: segs });
      }
      return { now: at, since, lanes: out, stats: lanesStats(out, at) };
    },
    /** Métricas de uso dos últimos `days` dias (custo estimado, tokens, tempo trabalhando e esperando). `plans`: [{ ts, status }]. */
    async usage(days, plans) {
      if (!usage) return null;
      flushUsage(true);
      return usage.range(days, { prices: getPrices(), plans });
    },
    /** Ritmo de consumo (tokens/h) e projeção do limite de uso das 5 h. */
    burn,
    /** Do que é feito o contexto de uma sessão (composição, base fixa, maiores consumidores e sugestões). Estimativa; só números. */
    context(key) {
      const t = tracked.get(key);
      if (!t) return { has: false, partial: false, found: false };
      // Arquivo grande: só o final foi lido, então o começo (anexos da base fixa) pode não ter passado por aqui.
      const sm = summarizeCtx(t.st.cx, { partial: t.partial });
      return { ...sm, found: true, suggestions: suggestCtx(sm) };
    },
    /** Primeiro pedido da sessão (o objetivo), para a revisão automática. */
    goal(key) { const t = tracked.get(key); return t ? t.st.firstPrompt : ''; },
    /** Métricas lado a lado de sessões (para comparar Claude × Codex na mesma tarefa). */
    compare(keys) {
      const prices = getPrices();
      const at = now();
      return (Array.isArray(keys) ? keys : []).slice(0, 4).map((k) => tracked.get(String(k))).filter(Boolean).map((t) => {
        const key = keyOf(t.meta);
        const segs = overlayWaiting(segments(t.events, at, { from: 0 }), waits.get(key), 0, at);
        const sum = (st) => segs.filter((x) => x.state === st).reduce((n, x) => n + (x.to - x.from), 0);
        const tk = t.st.tokens;
        const c = costByModel(t.st.byModel, prices);
        return {
          key, provider: t.meta.provider, title: t.meta.label || t.st.title || t.st.firstPrompt || 'Sessão sem título', model: t.st.model, project: projectOf(t), branch: t.st.branch, partial: t.partial,
          firstPrompt: t.st.firstPrompt, durationMs: t.st.firstTs && t.st.lastTs ? t.st.lastTs - t.st.firstTs : 0, workMs: sum('working'), waitMs: sum('waiting'),
          turns: t.st.turns, tools: t.st.tools, toolErrors: t.st.toolErrors, corrections: t.st.corrections,
          tokens: tk, total: tk.input + tk.output + tk.cacheRead + tk.cacheWrite, cost: c.unpriced.length && !c.cost ? null : c.cost, files: t.st.edits.size,
          commits: t.events.filter((e) => e.kind === 'commit').length,
        };
      });
    },
    /** Pares de sessões de provedores diferentes com pedidos parecidos (candidatas a comparação). */
    pairs() {
      const mains = [...tracked.values()].filter((t) => !t.meta.parentId && t.st.firstPrompt).map((t) => ({ t, w: WORDS(t.st.firstPrompt) })).filter((x) => x.w.size >= 3);
      const out = [];
      for (let i = 0; i < mains.length; i++) for (let j = i + 1; j < mains.length; j++) {
        const a = mains[i]; const b = mains[j];
        if (a.t.meta.provider === b.t.meta.provider) continue;
        let inter = 0; for (const w of a.w) if (b.w.has(w)) inter++;
        const score = inter / (a.w.size + b.w.size - inter);
        if (score >= 0.35) out.push({ a: keyOf(a.t.meta), b: keyOf(b.t.meta), score: Math.round(score * 100) / 100, prompt: a.t.st.firstPrompt.slice(0, 140) });
      }
      return out.sort((x, y) => y.score - x.score).slice(0, 5);
    },
    /** Base da análise de padrões de prompt: o primeiro pedido de cada sessão recente e sinais de retrabalho. */
    patterns() {
      const rows = [...tracked.values()].filter((t) => !t.meta.parentId && t.st.firstPrompt)
        .sort((x, y) => (y.st.lastTs || 0) - (x.st.lastTs || 0)).slice(0, 25)
        .map((t) => ({ provider: t.meta.provider, prompt: t.st.firstPrompt, turns: t.st.turns, corrections: t.st.corrections, toolErrors: t.st.toolErrors, tools: t.st.tools, commits: t.events.filter((e) => e.kind === 'commit').length }));
      return { sessions: rows };
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
    /** Encerra o processo de uma sessão principal viva. Usa o que o monitor leu (pid + início do processo), não o que a tela mandou. */
    async closeSession(key) {
      const t = tracked.get(key);
      if (!t) throw new Error('Sessão desconhecida.');
      if (t.meta.parentId) throw new Error('Subagente não se encerra sozinho: encerre a sessão principal.');
      const prov = byId.get(t.meta.provider);
      const info = liveBy.get(key);
      if (!prov || typeof prov.close !== 'function' || !info) throw new Error('Esta sessão não está aberta (ou o agente não permite encerrar).');
      const r = await prov.close(t.meta.sessionId, { pid: info.pid, procStart: info.procStart });
      dirty = true;
      return r;
    },
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
