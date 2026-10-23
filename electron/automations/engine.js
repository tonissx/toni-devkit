'use strict';
/**
 * Automações — motor. O "tick" (a cada 30 s) decide QUANDO; o runner de passos decide O QUÊ: cada passo roda isolado, com tempo
 * limite, vê o que os anteriores produziram ({{s1.text}}) e devolve { ok, text, data, error, costUsd }. Falhou → a automação para (onError: stop).
 *
 * Herdado do motor das Rotinas (já testado): spawn/relógio injetáveis; a vaga de paralelismo conta desde o INÍCIO da execução;
 * horário perdido (devkit fechado > MISS_MS) vira registro "perdida" em vez de rodar atrasado; a execução é gravada ao começar
 * (se o devkit fechar no meio, a próxima abertura marca como interrompida); cancelamento.
 *
 * Estado: automations.json ({ automations }) e automations-runs.json ({ runs }, limitado). Na primeira abertura importa as Rotinas
 * antigas de agents-schedule.json (o arquivo antigo fica intacto).
 */
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { nextRun } = require('../../src/tools/agents/recurrence.js');
const { STEP_TYPES } = require('../../src/tools/automations/steps.js');
const { resolve } = require('../../src/tools/automations/template.js');
const { cleanAutomation, migrateLegacy } = require('./model');
const { createRunners } = require('./runners');

const TICK_MS = 30000;
const MISS_MS = 10 * 60000;
const MAX_RUNS = 200;
const MAX_PARALLEL = 2;
const STEP_TIMEOUT_MS = 30 * 60000;
const KEEP_TEXT = 8000;
const KEEP_INPUT = 4000;

const id = () => crypto.randomUUID();
const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? t.slice(0, n) + '\n… (cortado)' : t; };
const pad = (n) => String(n).padStart(2, '0');

function triggerCtx(kind, at) {
  const d = new Date(at);
  return { type: kind, at: d.toISOString(), date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function createEngine({ file, runsFile, legacyFile = null, agents, spawn, bin, now = Date.now, notify = () => {}, onFinish = () => {}, broadcast = () => {} }) {
  let state = { automations: [] };
  let runs = [];
  const queue = createQueue();
  const saveAutomations = () => queue.run('automations', () => atomicWrite(file, JSON.stringify(state, null, 2)));
  const saveRuns = () => queue.run('runs', () => atomicWrite(runsFile, JSON.stringify({ runs }, null, 2)));
  const runners = createRunners({ agents, spawn, bin, notify });
  const live = new Map();   // runId → { kill, canceled, timedOut }
  const held = new Set();   // execuções que ocupam uma vaga, contadas desde o início
  let timer = null;
  const changed = () => { try { broadcast({ type: 'changed' }); } catch { /* tela fechada */ } };

  const automation = (aid) => state.automations.find((a) => a.id === aid);
  const runOf = (rid) => runs.find((r) => r.id === rid);
  const running = (aid) => runs.some((r) => r.automationId === aid && r.status === 'running');
  const trim = () => { if (runs.length > MAX_RUNS) runs = runs.slice(0, MAX_RUNS); };
  const view = (a) => ({ ...a, running: running(a.id) });

  function record(a, partial) {
    const run = {
      id: id(), automationId: a.id, name: a.name, startedAt: now(), endedAt: null, status: 'running', trigger: 'schedule', costUsd: null, error: '',
      steps: a.steps.map((s) => ({ id: s.id, type: s.type, name: s.name, status: 'pending', startedAt: null, endedAt: null, durationMs: null, costUsd: null, sessionId: null, turns: null, input: '', output: '', error: '' })),
      ...partial,
    };
    runs.unshift(run);
    trim();
    return run;
  }
  function finish(run, patch) {
    held.delete(run.id);
    Object.assign(run, { endedAt: now(), ...patch });
    run.error = clip(run.error, 2000);
    const costs = run.steps.map((s) => s.costUsd).filter((c) => c != null);
    run.costUsd = costs.length ? costs.reduce((x, y) => x + y, 0) : null;
    const a = automation(run.automationId);
    if (a) { a.lastRunAt = run.startedAt; a.lastStatus = run.status; saveAutomations().catch(() => {}); }
    saveRuns().catch(() => {});
    changed();
    try { onFinish(run, a || null); } catch { /* aviso é opcional */ }
  }

  /** Dispara uma execução. → o registro (já gravado). Nunca lança: erros viram uma execução "error". */
  async function execute(a, trigger) {
    const run = record(a, { trigger });
    held.add(run.id);
    saveRuns().catch(() => {}); // grava "rodando" já: se o devkit fechar no meio, a próxima abertura marca como interrompida
    changed();
    const entry = { kill: null, canceled: false, timedOut: false };
    live.set(run.id, entry);
    const ctx = { trigger: triggerCtx(trigger, run.startedAt) };
    let failure = '';
    try {
      for (let i = 0; i < a.steps.length; i++) {
        const step = a.steps[i]; const rec = run.steps[i];
        if (entry.canceled) break;
        rec.status = 'running'; rec.startedAt = now();
        saveRuns().catch(() => {}); changed();
        let cfg;
        try {
          cfg = { ...step.config };
          for (const f of STEP_TYPES[step.type].templated) cfg[f] = resolve(cfg[f], ctx);
        } catch (e) { Object.assign(rec, { status: 'error', endedAt: now(), durationMs: 0, error: e.message }); failure = `Passo ${i + 1} (${step.name}): ${e.message}`; break; }
        rec.input = clip(STEP_TYPES[step.type].templated.map((f) => cfg[f]).join('\n---\n'), KEEP_INPUT);
        entry.kill = null; entry.timedOut = false;
        const h = { setKill: (fn) => { entry.kill = fn; }, isCanceled: () => entry.canceled };
        const tm = setTimeout(() => { entry.timedOut = true; if (entry.kill) entry.kill(); }, STEP_TIMEOUT_MS);
        if (tm.unref) tm.unref();
        let out;
        try { out = await runners[step.type](cfg, h); } catch (e) { out = { ok: false, error: String(e.message || e) }; }
        clearTimeout(tm);
        rec.endedAt = now(); rec.durationMs = rec.endedAt - rec.startedAt;
        rec.costUsd = out.costUsd == null ? null : out.costUsd; rec.sessionId = out.sessionId || null; rec.turns = out.turns == null ? null : out.turns;
        rec.output = clip(out.text, KEEP_TEXT);
        if (entry.canceled) { Object.assign(rec, { status: 'canceled', error: 'Cancelada por você.' }); break; }
        if (entry.timedOut) { Object.assign(rec, { status: 'error', error: `Passou de ${STEP_TIMEOUT_MS / 60000} min e foi encerrado.` }); failure = `Passo ${i + 1} (${step.name}): ${rec.error}`; break; }
        if (!out.ok) { Object.assign(rec, { status: 'error', error: clip(out.error || 'O passo falhou.', 2000) }); failure = `Passo ${i + 1} (${step.name}): ${rec.error}`; break; }
        rec.status = 'ok';
        ctx[step.id] = { text: out.text == null ? '' : String(out.text), data: out.data === undefined ? null : out.data, ok: true };
      }
    } catch (e) { failure = failure || String(e.message || e); }
    live.delete(run.id);
    for (const s of run.steps) if (s.status === 'pending' || s.status === 'running') { if (s.status === 'running') Object.assign(s, { status: 'error', endedAt: now(), error: failure || 'Interrompido.' }); else s.status = 'skipped'; }
    if (entry.canceled) finish(run, { status: 'canceled', error: 'Cancelada por você.' });
    else if (failure) finish(run, { status: 'error', error: failure });
    else finish(run, { status: 'ok' });
    return run;
  }

  async function tick(at = now()) {
    let dirty = false;
    for (const a of state.automations) {
      if (!a.enabled || a.trigger.type !== 'schedule' || a.nextRunAt == null || a.nextRunAt > at) continue;
      if (running(a.id)) { a.nextRunAt = nextRun(a.trigger.recurrence, at); dirty = true; continue; }
      if (at - a.nextRunAt > MISS_MS) {
        const run = record(a, { status: 'missed', startedAt: a.nextRunAt, endedAt: at, error: 'O devkit estava fechado (ou o PC dormindo) na hora marcada; esta execução foi pulada.' });
        for (const s of run.steps) s.status = 'skipped';
        a.lastRunAt = run.startedAt; a.lastStatus = 'missed';
        a.nextRunAt = nextRun(a.trigger.recurrence, at); dirty = true;
        saveRuns().catch(() => {});
        continue;
      }
      if (held.size >= MAX_PARALLEL) continue; // espera uma vaga; tenta no próximo tick
      a.nextRunAt = nextRun(a.trigger.recurrence, at); dirty = true;
      execute(a, 'schedule');
    }
    if (dirty) { await saveAutomations(); changed(); }
  }

  const schedNext = (a, from) => (a.enabled && a.trigger.type === 'schedule' ? nextRun(a.trigger.recurrence, from) : null);

  return {
    async init() {
      let loaded = false;
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8'));
        state = { automations: Array.isArray(raw.automations) ? raw.automations : [] };
        loaded = true;
      } catch { /* primeira vez */ }
      try {
        const raw = JSON.parse(await fs.readFile(runsFile, 'utf8'));
        runs = Array.isArray(raw.runs) ? raw.runs : [];
      } catch { runs = []; }
      if (!loaded && legacyFile) {
        try {
          const m = migrateLegacy(JSON.parse(await fs.readFile(legacyFile, 'utf8')));
          state = { automations: m.automations };
          runs = m.runs.slice(0, MAX_RUNS);
          await saveAutomations(); await saveRuns();
        } catch { /* sem Rotinas antigas */ }
      }
      for (const r of runs) if (r.status === 'running') {
        Object.assign(r, { status: 'error', endedAt: r.endedAt || now(), error: 'O devkit foi fechado durante a execução.' });
        for (const s of r.steps || []) if (s.status === 'running') Object.assign(s, { status: 'error', endedAt: now(), error: 'O devkit foi fechado durante a execução.' }); else if (s.status === 'pending') s.status = 'skipped';
      }
      return this.list();
    },
    list: () => ({ automations: state.automations.map(view), runs: runs.map((r) => ({ ...r, steps: r.steps.map(({ input, output, ...s }) => s) })) }),
    run: (rid) => { const r = runOf(rid); return r ? JSON.parse(JSON.stringify(r)) : null; },
    async save(raw) {
      const a = cleanAutomation(raw);
      const old = automation(a.id);
      const same = old && old.enabled && JSON.stringify(old.trigger) === JSON.stringify(a.trigger);
      const next = { ...a, lastRunAt: old ? old.lastRunAt : null, lastStatus: old ? old.lastStatus : null, nextRunAt: same ? old.nextRunAt : schedNext(a, now()), createdAt: old ? old.createdAt : now(), updatedAt: now() };
      if (old) Object.assign(old, next); else state.automations.push(next);
      await saveAutomations(); changed();
      return view(automation(a.id));
    },
    async remove(aid) {
      for (const [rid, e] of live) { const r = runOf(rid); if (r && r.automationId === aid) { e.canceled = true; if (e.kill) e.kill(); } }
      state.automations = state.automations.filter((a) => a.id !== aid);
      await saveAutomations(); changed();
      return true;
    },
    async setEnabled(aid, on) {
      const a = automation(aid);
      if (!a) throw new Error('Automação não encontrada.');
      a.enabled = !!on;
      a.nextRunAt = schedNext(a, now());
      await saveAutomations(); changed();
      return view(a);
    },
    /** "Rodar agora": ignora o horário, mas respeita uma execução já em andamento. */
    async runNow(aid) {
      const a = automation(aid);
      if (!a) throw new Error('Automação não encontrada.');
      if (running(aid)) throw new Error('Esta automação já está rodando.');
      const r = await execute(a, 'manual');
      return JSON.parse(JSON.stringify(r));
    },
    cancel(rid) {
      const e = live.get(rid);
      if (!e) return false;
      e.canceled = true;
      if (e.kill) e.kill();
      return true;
    },
    async clearHistory() { runs = runs.filter((r) => r.status === 'running'); await saveRuns(); changed(); },
    start() { if (!timer) { timer = setInterval(() => tick().catch(() => {}), TICK_MS); if (timer.unref) timer.unref(); tick().catch(() => {}); } },
    /** Ao fechar o devkit: encerra o que está rodando (o histórico marca como cancelada). */
    async stop() {
      if (timer) { clearInterval(timer); timer = null; }
      for (const e of live.values()) { e.canceled = true; if (e.kill) e.kill(); }
      await new Promise((r) => setTimeout(r, 50));
      await queue.flush();
    },
    tick,
  };
}

module.exports = { createEngine, TICK_MS, MISS_MS };
