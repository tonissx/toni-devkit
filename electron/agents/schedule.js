'use strict';
/**
 * Agentes — rotinas agendadas. Só rodam com o devkit aberto: a cada 30 s olha quais estão no horário e dispara
 * `claude -p --agent <nome>` em segundo plano (sem shell: o prompt vai pela entrada padrão, nada vira linha de comando).
 *
 * Segurança: ninguém responde perguntas de permissão em segundo plano, então o que a rotina pode fazer é decidido antes
 * (runPolicy): `dontAsk` nega tudo que não foi liberado; só quem declarou edição ganha `acceptEdits`. Cada execução tem teto de
 * custo (--max-budget-usd) e de tempo. Rotina que ficou para trás por mais de MISS_MS (app fechado, PC dormindo) não roda
 * atrasada: vira um registro "perdida" no histórico.
 *
 * Estado em %APPDATA%\Toni Devkit\agents-schedule.json: { schedules, runs }. A sessão do claude fica em disco como qualquer outra,
 * então o Monitor de IA a mostra (chave claude:<sessionId>).
 */
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { cleanRecurrence, nextRun } = require('../../src/tools/agents/recurrence.js');
const { runPolicy } = require('../../src/tools/agents/agentForm.js');
const { NAME } = require('./store');

const TICK_MS = 30000;
const MISS_MS = 10 * 60000;
const MAX_RUNS = 200;
const MAX_PARALLEL = 2;
const TIMEOUT_MS = 30 * 60000;
const KEEP_RESULT = 8000;
const MAX_OUT = 2 * 1024 * 1024;

const id = () => crypto.randomUUID();
const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n) + '\n… (cortado)' : t; };

/** Valida o que veio da tela. Lança Error (em português). */
function cleanSchedule(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const agent = String(r.agent || '');
  if (!NAME.test(agent)) throw new Error('Escolha o agente da rotina.');
  const cwd = String(r.cwd || '').trim();
  if (!cwd || !path.isAbsolute(cwd)) throw new Error('Informe a pasta de trabalho (caminho completo).');
  const prompt = String(r.prompt || '').trim();
  if (!prompt) throw new Error('Escreva o que o agente deve fazer a cada execução.');
  if (prompt.length > 4000) throw new Error('O pedido da rotina passa de 4000 caracteres.');
  const budget = Number(r.maxBudgetUsd);
  return {
    id: typeof r.id === 'string' && r.id ? r.id : id(),
    name: String(r.name || '').trim().slice(0, 80) || agent,
    agent, cwd, prompt,
    mode: r.mode === 'agent' ? 'agent' : 'read',
    recurrence: cleanRecurrence(r.recurrence),
    maxBudgetUsd: Number.isFinite(budget) && budget > 0 ? Math.min(budget, 50) : 1,
    notify: r.notify !== false,
    enabled: r.enabled !== false,
  };
}

/** → { args } ou { problem } */
function buildArgs(agent, schedule, sessionId) {
  const pol = runPolicy(agent, schedule.mode);
  if (!pol.ok) return { problem: pol.problem };
  return {
    args: ['-p', '--agent', schedule.agent, '--output-format', 'json', '--permission-mode', pol.permissionMode,
      '--allowedTools', pol.tools.join(','), '--max-budget-usd', String(schedule.maxBudgetUsd), '--session-id', sessionId],
  };
}

/** Lê a resposta `--output-format json` (um objeto; pode vir uma lista de eventos em versões novas). */
function parseOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  let v = null;
  try { v = JSON.parse(text); } catch {
    const line = text.split('\n').reverse().find((l) => l.trim().startsWith('{'));
    try { v = line ? JSON.parse(line) : null; } catch { v = null; }
  }
  if (Array.isArray(v)) v = [...v].reverse().find((e) => e && e.type === 'result') || null;
  if (!v || typeof v !== 'object') return null;
  return {
    isError: v.is_error === true || (typeof v.subtype === 'string' && v.subtype.startsWith('error')),
    result: typeof v.result === 'string' ? v.result : '',
    costUsd: Number.isFinite(v.total_cost_usd) ? v.total_cost_usd : (Number.isFinite(v.cost_usd) ? v.cost_usd : null),
    turns: Number.isFinite(v.num_turns) ? v.num_turns : null,
    sessionId: typeof v.session_id === 'string' ? v.session_id : null,
    subtype: v.subtype || null,
  };
}

function createScheduler({ file, agents, spawn = require('node:child_process').spawn, bin = 'claude', now = Date.now, onFinish = () => {}, broadcast = () => {} }) {
  let state = { schedules: [], runs: [] };
  const queue = createQueue();
  const save = () => queue.run('save', () => atomicWrite(file, JSON.stringify(state, null, 2)));
  const live = new Map();     // runId → { child, timer, canceled }
  const held = new Set();     // execuções que ocupam uma vaga, contadas desde o início (antes de o processo nascer)
  let timer = null;
  const changed = () => { try { broadcast({ type: 'changed' }); } catch { /* tela fechada */ } };

  const schedule = (sid) => state.schedules.find((s) => s.id === sid);
  const runOf = (rid) => state.runs.find((r) => r.id === rid);
  const running = (sid) => state.runs.some((r) => r.scheduleId === sid && r.status === 'running');
  const trim = () => { if (state.runs.length > MAX_RUNS) state.runs = state.runs.slice(0, MAX_RUNS); };
  const view = (s) => ({ ...s, running: running(s.id) });

  function record(s, partial) {
    const run = { id: id(), scheduleId: s.id, name: s.name, agent: s.agent, cwd: s.cwd, startedAt: now(), endedAt: null, status: 'running', trigger: 'schedule', sessionId: null, costUsd: null, turns: null, result: '', error: '', ...partial };
    state.runs.unshift(run);
    trim();
    return run;
  }
  function finish(run, patch) {
    held.delete(run.id);
    Object.assign(run, { endedAt: now(), ...patch });
    run.result = clip(run.result, KEEP_RESULT);
    run.error = clip(run.error, 2000);
    const s = schedule(run.scheduleId);
    if (s) { s.lastRunAt = run.startedAt; s.lastStatus = run.status; }
    save().catch(() => {});
    changed();
    try { onFinish(run, s || null); } catch { /* aviso é opcional */ }
  }

  /** Dispara uma execução. → o registro da execução (já gravado). Nunca lança: erros viram um registro "error". */
  async function execute(s, trigger) {
    const run = record(s, { trigger });
    held.add(run.id);
    save().catch(() => {}); // já grava "rodando": se o devkit fechar no meio, a próxima abertura marca como interrompida
    changed();
    try {
      const dir = fsSync.statSync(s.cwd);
      if (!dir.isDirectory()) throw new Error('A pasta de trabalho não é uma pasta.');
    } catch (e) { finish(run, { status: 'error', error: e.code === 'ENOENT' ? 'A pasta de trabalho não existe mais: ' + s.cwd : String(e.message || e) }); return run; }
    let agent;
    try { agent = await agents.get(s.agent); } catch { finish(run, { status: 'error', error: `O agente “${s.agent}” não existe mais em ~/.claude/agents.` }); return run; }
    const sessionId = id();
    const built = buildArgs(agent, s, sessionId);
    if (built.problem) { finish(run, { status: 'error', error: built.problem }); return run; }
    run.sessionId = sessionId;
    let child;
    try { child = spawn(bin, built.args, { cwd: s.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { finish(run, { status: 'error', error: 'Não foi possível iniciar o claude: ' + (e.message || e) }); return run; }
    const entry = { child, canceled: false, timedOut: false, timer: null };
    live.set(run.id, entry);
    run.pid = child.pid || null;
    let out = ''; let err = '';
    child.stdout && child.stdout.on('data', (b) => { if (out.length < MAX_OUT) out += b; });
    child.stderr && child.stderr.on('data', (b) => { if (err.length < 16384) err += b; });
    entry.timer = setTimeout(() => { entry.timedOut = true; try { child.kill(); } catch { /* já saiu */ } }, TIMEOUT_MS);
    if (entry.timer.unref) entry.timer.unref();
    let ended = false;
    const done = (code, spawnError) => {
      if (ended) return;
      ended = true;
      clearTimeout(entry.timer);
      live.delete(run.id);
      delete run.pid;
      if (entry.canceled) return finish(run, { status: 'canceled', error: 'Cancelada por você.' });
      if (entry.timedOut) return finish(run, { status: 'error', error: `Passou de ${TIMEOUT_MS / 60000} min e foi encerrada.` });
      if (spawnError) return finish(run, { status: 'error', error: spawnError.code === 'ENOENT' ? 'O comando “claude” não foi encontrado. Instale o Claude Code ou ajuste o PATH.' : String(spawnError.message || spawnError) });
      const p = parseOutput(out);
      if (!p) return finish(run, { status: 'error', error: clip(err.trim() || `O claude terminou (código ${code}) sem resposta legível.`, 2000) });
      const failed = p.isError || code !== 0;
      finish(run, { status: failed ? 'error' : 'ok', result: p.result, costUsd: p.costUsd, turns: p.turns, sessionId: p.sessionId || sessionId, error: failed ? (p.subtype === 'error_max_budget_usd' ? `Parou ao atingir o teto de US$ ${s.maxBudgetUsd}.` : p.result || clip(err.trim(), 2000) || 'O claude relatou um erro.') : '' });
    };
    child.once('error', (e) => done(null, e));
    child.once('close', (code) => done(code));
    try { child.stdin.end(s.prompt); } catch { /* o close/error trata */ }
    return run;
  }

  /** Olha as rotinas no horário. `at` existe para os testes. */
  async function tick(at = now()) {
    let dirty = false;
    for (const s of state.schedules) {
      if (!s.enabled || s.nextRunAt == null || s.nextRunAt > at) continue;
      if (running(s.id)) { s.nextRunAt = nextRun(s.recurrence, at); dirty = true; continue; }
      if (at - s.nextRunAt > MISS_MS) {
        const run = record(s, { status: 'missed', startedAt: s.nextRunAt, endedAt: at, error: 'O devkit estava fechado (ou o PC dormindo) na hora marcada; esta execução foi pulada.' });
        s.lastRunAt = run.startedAt; s.lastStatus = 'missed';
        s.nextRunAt = nextRun(s.recurrence, at); dirty = true;
        continue;
      }
      if (held.size >= MAX_PARALLEL) continue; // espera uma vaga; tenta no próximo tick
      s.nextRunAt = nextRun(s.recurrence, at); dirty = true;
      execute(s, 'schedule');
    }
    if (dirty) { await save(); changed(); }
  }

  return {
    async init() {
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'));
        state = { schedules: Array.isArray(raw.schedules) ? raw.schedules : [], runs: Array.isArray(raw.runs) ? raw.runs : [] };
      } catch { /* primeira vez */ }
      for (const r of state.runs) if (r.status === 'running') Object.assign(r, { status: 'error', endedAt: r.endedAt || now(), error: 'O devkit foi fechado durante a execução.' });
      return this.list();
    },
    list: () => ({ schedules: state.schedules.map(view), runs: state.runs.map(({ result, ...r }) => ({ ...r, hasResult: !!result })) }),
    run: (rid) => { const r = runOf(rid); return r ? { ...r } : null; },
    async save(raw) {
      const s = cleanSchedule(raw);
      const old = schedule(s.id);
      const next = { ...s, lastRunAt: old ? old.lastRunAt : null, lastStatus: old ? old.lastStatus : null, nextRunAt: s.enabled ? (old && old.enabled && JSON.stringify(old.recurrence) === JSON.stringify(s.recurrence) ? old.nextRunAt : nextRun(s.recurrence, now())) : null };
      if (old) Object.assign(old, next); else state.schedules.push(next);
      await save(); changed();
      return view(schedule(s.id));
    },
    async remove(sid) {
      for (const [rid, e] of live) { const r = runOf(rid); if (r && r.scheduleId === sid) { e.canceled = true; try { e.child.kill(); } catch { /* já saiu */ } } }
      state.schedules = state.schedules.filter((s) => s.id !== sid);
      await save(); changed();
      return true;
    },
    async setEnabled(sid, on) {
      const s = schedule(sid);
      if (!s) throw new Error('Rotina não encontrada.');
      s.enabled = !!on;
      s.nextRunAt = on ? nextRun(s.recurrence, now()) : null;
      await save(); changed();
      return view(s);
    },
    /** "Rodar agora": ignora o horário, mas respeita uma execução já em andamento. */
    async runNow(sid) {
      const s = schedule(sid);
      if (!s) throw new Error('Rotina não encontrada.');
      if (running(sid)) throw new Error('Esta rotina já está rodando.');
      const r = await execute(s, 'manual');
      return { ...r };
    },
    cancel(rid) {
      const e = live.get(rid);
      if (!e) return false;
      e.canceled = true;
      try { e.child.kill(); } catch { /* já saiu */ }
      return true;
    },
    async clearHistory() { state.runs = state.runs.filter((r) => r.status === 'running'); await save(); changed(); },
    start() { if (!timer) { timer = setInterval(() => tick().catch(() => {}), TICK_MS); if (timer.unref) timer.unref(); tick().catch(() => {}); } },
    /** Ao fechar o devkit: encerra o que está rodando (o histórico marca como cancelada). */
    async stop() {
      if (timer) { clearInterval(timer); timer = null; }
      for (const e of live.values()) { e.canceled = true; try { e.child.kill(); } catch { /* já saiu */ } }
      await queue.flush();
    },
    tick,
  };
}

module.exports = { createScheduler, cleanSchedule, buildArgs, parseOutput, TICK_MS, MISS_MS };
