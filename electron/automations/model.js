'use strict';
/**
 * Automações — modelo: validação do que vem da tela e migração das Rotinas antigas (agents-schedule.json).
 * Automação = gatilho + passos em sequência; cada passo enxerga o que os anteriores produziram ({{s1.text}}).
 */
const path = require('node:path');
const crypto = require('node:crypto');
const { cleanRecurrence } = require('../../src/tools/agents/recurrence.js');
const { STEP_TYPES, TYPE_LIST, RESERVED_IDS, ID } = require('../../src/tools/automations/steps.js');
const { refs } = require('../../src/tools/automations/template.js');
const { NAME } = require('../agents/store');

const MAX_STEPS = 20;
const uuid = () => crypto.randomUUID();
const str = (v, n) => String(v == null ? '' : v).slice(0, n);

function cleanAgentConfig(c) {
  const agent = String(c.agent || '');
  if (!NAME.test(agent)) throw new Error('Escolha o agente.');
  const cwd = String(c.cwd || '').trim();
  if (!cwd || !path.isAbsolute(cwd)) throw new Error('Informe a pasta de trabalho (caminho completo).');
  const prompt = String(c.prompt || '').trim();
  if (!prompt) throw new Error('Escreva o que o agente deve fazer.');
  if (prompt.length > 4000) throw new Error('O pedido do agente passa de 4000 caracteres.');
  const mode = c.mode === 'agent' ? 'agent' : 'read';
  // Quem pode alterar coisas precisa ter sido aprovado de forma explícita ao criar a automação.
  if (mode === 'agent' && c.allowWrite !== true) throw new Error('Este passo usa as ferramentas do agente (pode alterar arquivos). Confirme a aprovação para salvar.');
  const budget = Number(c.maxBudgetUsd);
  return { agent, cwd, prompt, mode, allowWrite: mode === 'agent', maxBudgetUsd: Number.isFinite(budget) && budget > 0 ? Math.min(budget, 50) : 1 };
}

function cleanNotifyConfig(c) {
  const text = String(c.text || '').trim();
  if (!text) throw new Error('Escreva o texto do aviso.');
  return { title: str(c.title, 120).trim() || 'Automação', text: text.slice(0, 1000) };
}

const CLEANERS = { agent: cleanAgentConfig, notify: cleanNotifyConfig };

function cleanTrigger(raw) {
  const t = raw && typeof raw === 'object' ? raw : {};
  if (t.type === 'schedule') return { type: 'schedule', recurrence: cleanRecurrence(t.recurrence) };
  return { type: 'manual' };
}

/** Valida o que veio da tela. Lança Error (em português). */
function cleanAutomation(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const steps = Array.isArray(r.steps) ? r.steps : [];
  if (!steps.length) throw new Error('Adicione pelo menos um passo.');
  if (steps.length > MAX_STEPS) throw new Error(`No máximo ${MAX_STEPS} passos por automação.`);
  const seen = new Set();
  const outSteps = steps.map((s, i) => {
    const st = s && typeof s === 'object' ? s : {};
    const n = i + 1;
    if (!TYPE_LIST.includes(st.type)) throw new Error(`Passo ${n}: tipo desconhecido.`);
    const sid = String(st.id || '');
    if (!ID.test(sid) || RESERVED_IDS.has(sid)) throw new Error(`Passo ${n}: identificador inválido.`);
    if (seen.has(sid)) throw new Error(`Passo ${n}: identificador repetido (${sid}).`);
    let config;
    try { config = CLEANERS[st.type](st.config && typeof st.config === 'object' ? st.config : {}); } catch (e) { throw new Error(`Passo ${n}: ${e.message}`); }
    for (const field of STEP_TYPES[st.type].templated) {
      for (const ref of refs(config[field])) {
        if (!ref.path) throw new Error(`Passo ${n}: referência inválida {{${ref.raw}}}.`);
        const root = ref.path[0];
        if (root !== 'trigger' && !seen.has(root)) throw new Error(`Passo ${n}: {{${ref.raw}}} usa algo que não vem antes deste passo.`);
      }
    }
    seen.add(sid);
    return { id: sid, type: st.type, name: str(st.name, 80).trim() || STEP_TYPES[st.type].label, config };
  });
  return {
    id: typeof r.id === 'string' && r.id ? r.id : uuid(),
    name: str(r.name, 80).trim() || 'Automação sem nome',
    enabled: r.enabled !== false,
    notify: r.notify !== false,
    trigger: cleanTrigger(r.trigger),
    steps: outSteps,
    onError: 'stop',
  };
}

/** Rotina antiga (agents-schedule.json) → automação com gatilho de horário + 1 passo Agente. */
function migrateSchedule(s) {
  return {
    id: s.id, name: s.name || s.agent, enabled: s.enabled !== false, notify: s.notify !== false, onError: 'stop',
    trigger: { type: 'schedule', recurrence: s.recurrence },
    steps: [{ id: 's1', type: 'agent', name: s.agent, config: { agent: s.agent, cwd: s.cwd, prompt: s.prompt, mode: s.mode === 'agent' ? 'agent' : 'read', allowWrite: s.mode === 'agent', maxBudgetUsd: s.maxBudgetUsd || 1 } }],
    lastRunAt: s.lastRunAt || null, lastStatus: s.lastStatus || null, nextRunAt: s.nextRunAt == null ? null : s.nextRunAt,
    createdAt: s.createdAt || 0, updatedAt: s.updatedAt || 0,
  };
}

/** Execução antiga → execução com um passo. */
function migrateRun(r) {
  const dur = r.endedAt && r.startedAt ? r.endedAt - r.startedAt : null;
  return {
    id: r.id, automationId: r.scheduleId, name: r.name, startedAt: r.startedAt, endedAt: r.endedAt, status: r.status, trigger: r.trigger || 'schedule',
    costUsd: r.costUsd == null ? null : r.costUsd, error: r.error || '',
    steps: [{ id: 's1', type: 'agent', name: r.agent, status: r.status === 'missed' ? 'skipped' : r.status === 'canceled' ? 'canceled' : r.status === 'ok' ? 'ok' : 'error', startedAt: r.startedAt, endedAt: r.endedAt, durationMs: dur, costUsd: r.costUsd == null ? null : r.costUsd, sessionId: r.sessionId || null, turns: r.turns == null ? null : r.turns, input: '', output: r.result || '', data: null, error: r.error || '' }],
  };
}

function migrateLegacy(legacy) {
  const l = legacy && typeof legacy === 'object' ? legacy : {};
  return {
    automations: (Array.isArray(l.schedules) ? l.schedules : []).map(migrateSchedule),
    runs: (Array.isArray(l.runs) ? l.runs : []).map(migrateRun),
  };
}

module.exports = { cleanAutomation, migrateLegacy, migrateSchedule, migrateRun, MAX_STEPS };
