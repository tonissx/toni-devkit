'use strict';
/**
 * Monitor de IA — planos das sessões do Claude Code. Cada plano pedido para aprovação fica no transcript da sessão
 * (ExitPlanMode com o texto do plano) junto com a resposta (aprovado, ou recusado com o motivo). Os transcripts são
 * apagados com o tempo pelo próprio Claude Code, então aqui há um arquivo local com os planos já vistos:
 * %APPDATA%\Toni Devkit\aimon-plans.json. Nada sai da máquina; "Esquecer" e "Limpar" apagam do arquivo.
 *
 * - extractPlans(texto): puro; lê as linhas do .jsonl e devolve os planos (só linhas "assistant"/"user": o transcript
 *   também guarda cópias em "api-request-blob" e elas não podem contar em dobro).
 * - createPlansArchive(): varre os transcripts, relê só o que cresceu (arquivo só cresce: guarda o deslocamento) e
 *   mantém o plano mesmo depois que o transcript some (orphan).
 */
const fs = require('node:fs/promises');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { clip } = require('./util');
const { createCommitTracker } = require('./commits');

const TOOL = 'ExitPlanMode';
const MAX_REASON = 800;

const titleOf = (plan) => {
  const m = /^#{1,3}\s+(.+)$/m.exec(plan);
  return clip(m ? m[1] : plan.split('\n').find((l) => l.trim()) || 'Plano sem título', 140);
};

/** Resposta do usuário ao pedido de aprovação. → { status, reason?, plan? } */
function parseResult(block, toolUseResult) {
  const text = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map((x) => x && x.text).filter(Boolean).join('\n') : '';
  if (/^\s*User has approved/i.test(text)) {
    const edited = toolUseResult && typeof toolUseResult === 'object' && typeof toolUseResult.plan === 'string' ? toolUseResult.plan : null;
    return { status: 'approved', ...(edited ? { plan: edited } : {}) };
  }
  if (/doesn't want to proceed|was rejected|rejected/i.test(text) || block.is_error) {
    const m = /the user said:\s*\n?([\s\S]*)$/i.exec(text);
    // O harness acrescenta uma "Note: …" depois do que o usuário escreveu; não faz parte do motivo.
    const reason = m ? m[1].replace(/\n+\s*Note: The user's next message[\s\S]*$/i, '').trim() : '';
    return { status: 'rejected', ...(reason ? { reason: reason.slice(0, MAX_REASON) } : {}) };
  }
  return null; // outro tipo de resposta (ex.: erro de ferramenta): não decide nada
}

/**
 * Planos de um trecho de transcript. → { plans: [...], sessionTitle }
 * Um plano: { id, ts, status: 'approved'|'rejected'|'pending', reason?, title, plan, planFile, cwd, branch }.
 * Resposta cujo pedido veio num trecho anterior (leitura incremental) sai como { id, resultOnly: true, status, … }.
 */
function extractPlans(text, _opts) {
  const uses = new Map();
  const results = new Map();
  let sessionTitle = null;
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    const useHit = line.includes(TOOL);
    const resHit = line.includes('"tool_result"');
    const titleHit = line.includes('"ai-title"');
    if (!useHit && !resHit && !titleHit) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'ai-title' && o.aiTitle) { sessionTitle = clip(o.aiTitle, 120); continue; }
    if (o.type !== 'assistant' && o.type !== 'user') continue;
    const content = o.message && o.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b) continue;
      if (b.type === 'tool_use' && b.name === TOOL && b.id && b.input && typeof b.input.plan === 'string' && !uses.has(b.id)) {
        const t = Date.parse(o.timestamp);
        uses.set(b.id, { id: b.id, ts: Number.isFinite(t) ? t : 0, status: 'pending', title: titleOf(b.input.plan), plan: b.input.plan, planFile: b.input.planFilePath || null, cwd: o.cwd || null, branch: o.gitBranch || null });
      } else if (b.type === 'tool_result' && b.tool_use_id && !results.has(b.tool_use_id)) {
        const r = parseResult(b, o.toolUseResult);
        const at = Date.parse(o.timestamp);
        if (r) results.set(b.tool_use_id, { ...r, ...(Number.isFinite(at) ? { answeredAt: at } : {}) }); // quando o usuário respondeu (a linha do resultado)
      }
    }
  }
  const plans = [];
  for (const [id, p] of uses) {
    const r = results.get(id);
    if (r) { p.status = r.status; if (r.answeredAt) p.answeredAt = r.answeredAt; if (r.reason) p.reason = r.reason; if (r.plan) { p.plan = r.plan; p.title = titleOf(r.plan); } }
    plans.push(p);
  }
  for (const [id, r] of results) if (!uses.has(id)) plans.push({ id, resultOnly: true, ...r });
  return { plans, sessionTitle };
}

/** Commits que a sessão fez num trecho do transcript. → { commits: [{ ts, hash, branch, subject }], pending } */
function scanCommits(text, pending) {
  const tracker = createCommitTracker(pending);
  const commits = [];
  for (const line of String(text || '').split('\n')) {
    if (!line || !(line.includes('commit') || (line.includes('"tool_result"') && tracker.pending().length))) continue; // pré-filtro barato
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    for (const c of tracker.feed(o)) commits.push(c);
  }
  return { commits, pending: tracker.pending() };
}

const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

function createPlansArchive({ file, listFiles, readChunk, now = () => Date.now() }) {
  const VERSION = 2; // 2: passou a guardar os commits das sessões — arquivos lidos antes disso são relidos uma vez
  let state = { v: VERSION, files: {}, plans: {}, commits: {} };
  const queue = createQueue();
  let scanning = null;

  const defaultRead = async (path, from) => {
    const fh = await fs.open(path, 'r');
    try {
      const { size } = await fh.stat();
      if (size <= from) return '';
      const buf = Buffer.alloc(size - from);
      await fh.read(buf, 0, buf.length, from);
      return buf.toString('utf8');
    } finally { await fh.close(); }
  };
  const read = readChunk || defaultRead;
  const persist = () => queue.run('save', () => atomicWrite(file, JSON.stringify(state)));

  async function init() {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      state = { v: VERSION, files: raw.v === VERSION && raw.files && typeof raw.files === 'object' ? raw.files : {}, plans: raw.plans && typeof raw.plans === 'object' ? raw.plans : {}, commits: raw.commits && typeof raw.commits === 'object' ? raw.commits : {} };
    } catch { /* primeira vez */ }
  }

  function merge(f, found) {
    let changed = false;
    for (const p of found.plans) {
      const cur = state.plans[p.id];
      if (p.resultOnly) {
        if (!cur) continue; // resposta sem pedido conhecido: nada a guardar
        const next = { ...cur, status: p.status, ...(p.answeredAt ? { answeredAt: p.answeredAt } : {}), ...(p.reason ? { reason: p.reason } : {}), ...(p.plan ? { plan: p.plan, title: titleOf(p.plan) } : {}) };
        if (JSON.stringify(next) !== JSON.stringify(cur)) { state.plans[p.id] = next; changed = true; }
        continue;
      }
      const next = { ...(cur || {}), ...p, file: f.file, sessionId: f.sessionId, project: f.project || null, orphan: false, seenAt: cur ? cur.seenAt : now() };
      if (!cur || JSON.stringify(next) !== JSON.stringify(cur)) { state.plans[p.id] = next; changed = true; }
    }
    if (found.sessionTitle) {
      for (const p of Object.values(state.plans)) if (p.file === f.file && p.sessionTitle !== found.sessionTitle) { p.sessionTitle = found.sessionTitle; changed = true; }
    }
    return changed;
  }

  async function doScan() {
    let files = [];
    try { files = await listFiles(); } catch { files = []; }
    const seen = new Set();
    let changed = false;
    for (const f of files) {
      seen.add(f.file);
      const known = state.files[f.file];
      if (known && known.size === f.size && known.mtime === f.mtime) continue;
      const from = known && f.size >= known.offset ? known.offset : 0; // só cresce; se encolheu, relê tudo
      let text;
      try { text = await read(f.file, from); } catch { continue; }
      const cut = text.lastIndexOf('\n');
      const chunk = cut < 0 ? '' : text.slice(0, cut + 1); // a última linha pode estar sendo gravada
      const offset = from + Buffer.byteLength(chunk, 'utf8');
      let pending = known && from > 0 ? known.pending || [] : [];
      if (chunk) {
        if (merge(f, extractPlans(chunk))) changed = true;
        const sc = scanCommits(chunk, pending);
        pending = sc.pending;
        // Commits de subagentes contam para a sessão que os lançou.
        const sid = f.parentId || f.sessionId;
        const list = state.commits[sid] || (state.commits[sid] = []);
        for (const c of sc.commits) if (!list.some((x) => x.hash === c.hash)) { list.push(c); changed = true; }
      }
      state.files[f.file] = { size: f.size, mtime: f.mtime, offset, ...(pending.length ? { pending } : {}) };
      changed = true;
    }
    // Transcript que sumiu: os planos ficam, marcados.
    for (const [path, meta] of Object.entries(state.files)) {
      if (seen.has(path)) continue;
      for (const p of Object.values(state.plans)) if (p.file === path && !p.orphan) { p.orphan = true; changed = true; }
      if (meta) { delete state.files[path]; changed = true; }
    }
    if (changed) await persist();
    return changed;
  }

  const row = (p, q) => {
    const body = String(p.plan || '').replace(/^#.*$/m, '').replace(/\s+/g, ' ').trim();
    let snippet = clip(body, 160);
    if (q) {
      const i = body.toLowerCase().indexOf(q);
      if (i >= 0) snippet = (i > 50 ? '…' : '') + body.slice(Math.max(0, i - 50), i + 110).trim() + '…';
    }
    return { id: p.id, ts: p.ts, answeredAt: p.answeredAt || null, status: p.status, reason: p.reason || null, title: p.title, project: base(p.cwd) || p.project || '', cwd: p.cwd, branch: p.branch, sessionTitle: p.sessionTitle || null, sessionId: p.sessionId || null, orphan: !!p.orphan, snippet };
  };

  return {
    init,
    /** Procura planos novos nos transcripts (barato quando nada mudou: só compara tamanho e data). */
    scan: () => (scanning = scanning || doScan().finally(() => { scanning = null; })),
    list({ status, q, project } = {}) {
      const needle = String(q || '').trim().toLowerCase();
      return Object.values(state.plans)
        .filter((p) => (!status || status === 'all' || p.status === status)
          && (!project || project === 'all' || (base(p.cwd) || p.project || '') === project)
          && (!needle || [p.title, p.plan, p.reason, p.sessionTitle].some((s) => String(s || '').toLowerCase().includes(needle))))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .map((p) => row(p, needle));
    },
    get(id) {
      const p = state.plans[id];
      if (!p) return null;
      // Commits feitos pela sessão depois deste plano e antes do próximo plano dela.
      const sid = p.sessionId;
      const next = Object.values(state.plans).filter((x) => x.sessionId === sid && x.ts > p.ts).reduce((m, x) => Math.min(m, x.ts), Infinity);
      const commits = p.status === 'rejected' || p.status === 'pending' ? [] : (state.commits[sid] || []).filter((c) => c.ts >= p.ts && c.ts < next).sort((a, b) => a.ts - b.ts);
      return { ...row(p), plan: p.plan, planFile: p.planFile || null, commits };
    },
    async forget(id) { if (state.plans[id]) { delete state.plans[id]; await persist(); } return true; },
    /** Esquece os planos guardados; o que já foi lido dos transcripts não volta (só planos novos). */
    async clear() { state.plans = {}; state.commits = {}; await persist(); return true; },
    projects() { return [...new Set(Object.values(state.plans).map((p) => base(p.cwd) || p.project || '').filter(Boolean))].sort(); },
    flush: () => queue.flush(),
    _state: () => state,
  };
}

module.exports = { extractPlans, scanCommits, createPlansArchive, titleOf };
