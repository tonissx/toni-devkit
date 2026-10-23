// Testes das Automações (templating, validação, motor de passos, histórico por passo e migração das Rotinas) com um `claude` falso:
//   node --test scripts/test-automations.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const tpl = require('../src/tools/automations/template.js');
const steps = require('../src/tools/automations/steps.js');
const { cleanAutomation, migrateLegacy } = require('../electron/automations/model.js');
const { createEngine, MISS_MS } = require('../electron/automations/engine.js');
const { createAgentStore } = require('../electron/agents/store.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tk-auto-'));
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

/* ─────────────── templating ─────────────── */
test('resolve troca caminhos simples, índices e serializa objetos', () => {
  const ctx = { s1: { text: 'oi', data: { rows: [{ pedido: 7 }, { pedido: 8 }] } }, trigger: { time: '08:00' } };
  assert.equal(tpl.resolve('a {{s1.text}} b {{ trigger.time }}', ctx), 'a oi b 08:00');
  assert.equal(tpl.resolve('{{s1.data.rows[1].pedido}}', ctx), '8');
  assert.equal(tpl.resolve('{{s1.data.rows[0]}}', ctx), '{"pedido":7}');
  assert.equal(tpl.resolve('sem chaves', ctx), 'sem chaves');
});

test('resolve falha com valor ausente ou caminho inválido (nunca manda "undefined")', () => {
  assert.throws(() => tpl.resolve('{{s9.text}}', {}), /Valor ausente/);
  assert.throws(() => tpl.resolve('{{s1.data.rows[3]}}', { s1: { data: { rows: [] } } }), /Valor ausente/);
  assert.throws(() => tpl.resolve('{{s1.text}}', { s1: { text: null } }), /Valor ausente/);
  assert.throws(() => tpl.resolve('{{1+1}}', {}), /inválida/);
  assert.throws(() => tpl.resolve('{{s1.text.length}}', { s1: { text: 'abc' } }), /Valor ausente/); // propriedade de string não vale
});

test('resolve não alcança protótipo nem executa código', () => {
  assert.throws(() => tpl.resolve('{{constructor.name}}', {}), /inválida/);
  assert.throws(() => tpl.resolve('{{s1.__proto__}}', { s1: {} }), /inválida/);
  assert.throws(() => tpl.resolve('{{s1.toString}}', { s1: {} }), /Valor ausente/);
  assert.throws(() => tpl.resolve('{{process.exit()}}', {}), /inválida/);
  // o valor resolvido não é re-interpretado
  assert.equal(tpl.resolve('{{s1.text}}', { s1: { text: '{{s2.text}}' } }), '{{s2.text}}');
});

/* ─────────────── validação ─────────────── */
const agentStep = (over = {}) => ({ id: 's1', type: 'agent', name: 'Resumo', config: { agent: 'revisor', cwd: os.tmpdir(), prompt: 'Resuma', ...over } });
const notifyStep = (over = {}) => ({ id: 's2', type: 'notify', config: { text: '{{s1.text}}', ...over } });

test('cleanAutomation: exige passos, ids únicos e referências só para trás', () => {
  assert.throws(() => cleanAutomation({ steps: [] }), /pelo menos um passo/);
  assert.throws(() => cleanAutomation({ steps: [agentStep(), agentStep()] }), /repetido/);
  assert.throws(() => cleanAutomation({ steps: [{ ...agentStep(), id: 'trigger' }] }), /identificador/);
  assert.throws(() => cleanAutomation({ steps: [notifyStep({ text: '{{s2.text}}' })] }), /antes deste passo/);
  assert.throws(() => cleanAutomation({ steps: [agentStep({ prompt: '{{s2.text}}' }), notifyStep()] }), /antes deste passo/);
  assert.throws(() => cleanAutomation({ steps: [agentStep({ prompt: '{{ x y }}' })] }), /inválida/);
  const a = cleanAutomation({ name: ' Teste ', steps: [agentStep(), notifyStep()], trigger: { type: 'schedule', recurrence: { kind: 'daily', time: '08:00' } } });
  assert.equal(a.name, 'Teste');
  assert.equal(a.steps[1].config.title, 'Automação');
  assert.equal(a.trigger.type, 'schedule');
  assert.equal(cleanAutomation({ steps: [agentStep()], trigger: { type: 'qualquer' } }).trigger.type, 'manual');
});

test('cleanAutomation: passo que altera arquivos só salva com aprovação explícita', () => {
  assert.throws(() => cleanAutomation({ steps: [agentStep({ mode: 'agent' })] }), /aprovação/);
  const a = cleanAutomation({ steps: [agentStep({ mode: 'agent', allowWrite: true })] });
  assert.equal(steps.riskOf(a.steps[0]), 'write');
  assert.equal(steps.describeAutomation(a).risk, 'write');
  assert.equal(steps.describeAutomation(cleanAutomation({ steps: [agentStep()] })).risk, 'read');
  assert.equal(cleanAutomation({ steps: [agentStep({ maxBudgetUsd: 999 })] }).steps[0].config.maxBudgetUsd, 50);
});

/* ─────────────── motor ─────────────── */
function setup({ start = local(2026, 3, 4, 9, 0), legacy = null } = {}) {
  const dir = tmp();
  const agents = createAgentStore({ dir: path.join(dir, 'agents') });
  const cwd = path.join(dir, 'proj');
  fs.mkdirSync(cwd);
  const clock = { t: start };
  const spawned = []; const finished = []; const notices = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end: (text) => { child.prompt = text; } };
    child.kill = () => setImmediate(() => child.emit('close', null));
    child.args = args; child.opts = opts;
    child.finish = (code, out, err) => { if (out) child.stdout.emit('data', out); if (err) child.stderr.emit('data', err); child.emit('close', code); };
    spawned.push(child);
    return child;
  };
  let legacyFile = null;
  if (legacy) { legacyFile = path.join(dir, 'agents-schedule.json'); fs.writeFileSync(legacyFile, JSON.stringify(legacy)); }
  const mk = () => createEngine({ file: path.join(dir, 'auto.json'), runsFile: path.join(dir, 'runs.json'), legacyFile, agents, spawn, now: () => clock.t, notify: (t, b) => notices.push({ t, b }), onFinish: (run, a) => finished.push({ run, a }) });
  const eng = mk();
  const ready = (async () => { await agents.save({ name: 'revisor', description: 'Revisa', tools: ['Read', 'Grep'], prompt: 'x' }); await eng.init(); })();
  const base = { name: 'Pedidos', trigger: { type: 'schedule', recurrence: { kind: 'daily', time: '10:00' } }, steps: [agentStep({ cwd }), notifyStep()] };
  return { eng, mk, clock, spawned, finished, notices, ready, base, cwd, dir };
}
const out = (result, extra = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.05, num_turns: 2, session_id: 'S1', ...extra });
const until = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(cond(), 'a condição não aconteceu'); };

test('rodar agora: o texto do agente alimenta o passo seguinte e o histórico guarda cada passo', async () => {
  const t = setup(); await t.ready;
  const a = await t.eng.save({ ...t.base, trigger: { type: 'manual' } });
  assert.equal(a.nextRunAt, null);
  const p = t.eng.runNow(a.id);
  await until(() => t.spawned.length === 1);
  const c = t.spawned[0];
  assert.equal(c.prompt, 'Resuma');
  assert.ok(c.args.includes('dontAsk'));
  assert.equal(t.eng.list().runs[0].steps[0].status, 'running');
  c.finish(0, out('3 pedidos atrasados'));
  const run = await p;
  assert.equal(run.status, 'ok');
  assert.deepEqual(run.steps.map((s) => s.status), ['ok', 'ok']);
  assert.equal(run.steps[0].output, '3 pedidos atrasados');
  assert.equal(run.steps[0].costUsd, 0.05);
  assert.equal(run.steps[0].sessionId, 'S1');
  assert.equal(run.steps[0].input, 'Resuma');
  assert.equal(run.steps[1].input, 'Automação\n---\n3 pedidos atrasados');
  assert.deepEqual(t.notices, [{ t: 'Automação', b: '3 pedidos atrasados' }]);
  assert.equal(run.costUsd, 0.05);
  assert.ok(run.steps.every((s) => s.durationMs != null));
  assert.equal(t.finished.length, 1);
  assert.equal(t.eng.list().automations[0].lastStatus, 'ok');
});

test('valor ausente num template falha o passo com mensagem clara e pula o resto', async () => {
  const t = setup(); await t.ready;
  const a = await t.eng.save({ ...t.base, trigger: { type: 'manual' }, steps: [notifyStep({ text: 'oi {{trigger.nada}}' })] });
  const run = await t.eng.runNow(a.id);
  assert.equal(run.status, 'error');
  assert.match(run.error, /Passo 1.*Valor ausente/);
  assert.equal(t.notices.length, 0); // nunca mandou "undefined"
});

test('falha no meio: a automação para, o resto fica "pulado"', async () => {
  const t = setup(); await t.ready;
  const a = await t.eng.save({ ...t.base, trigger: { type: 'manual' } });
  const p = t.eng.runNow(a.id);
  await until(() => t.spawned.length === 1);
  t.spawned[0].finish(1, '', 'deu ruim');
  const run = await p;
  assert.equal(run.status, 'error');
  assert.deepEqual(run.steps.map((s) => s.status), ['error', 'skipped']);
  assert.match(run.error, /Passo 1/);
  assert.equal(t.notices.length, 0);
});

test('teto de custo atingido vira erro claro', async () => {
  const t = setup(); await t.ready;
  const a = await t.eng.save({ ...t.base, trigger: { type: 'manual' } });
  const p = t.eng.runNow(a.id);
  await until(() => t.spawned.length === 1);
  t.spawned[0].finish(1, out('', { subtype: 'error_max_budget_usd', is_error: true }));
  assert.match((await p).steps[0].error, /teto de US\$ 1/);
});

test('cancelar mata o processo e marca passo e execução como cancelados', async () => {
  const t = setup(); await t.ready;
  const a = await t.eng.save({ ...t.base, trigger: { type: 'manual' } });
  const p = t.eng.runNow(a.id);
  await until(() => t.spawned.length === 1);
  assert.equal(t.eng.cancel(t.eng.list().runs[0].id), true);
  const run = await p;
  assert.equal(run.status, 'canceled');
  assert.deepEqual(run.steps.map((s) => s.status), ['canceled', 'skipped']);
  assert.equal(t.notices.length, 0);
});

test('tick: roda na hora marcada, reagenda e não roda duas vezes a mesma automação', async () => {
  const t = setup(); await t.ready;
  await t.eng.save(t.base);
  await t.eng.tick(local(2026, 3, 4, 9, 59));
  assert.equal(t.spawned.length, 0);
  t.clock.t = local(2026, 3, 4, 10, 0, 5);
  await t.eng.tick(t.clock.t);
  await until(() => t.spawned.length === 1);
  assert.equal(t.eng.list().automations[0].nextRunAt, local(2026, 3, 5, 10, 0));
  assert.equal(t.eng.list().runs[0].trigger, 'schedule');
  t.spawned[0].finish(0, out('ok'));
  await until(() => t.finished.length === 1);
});

test('horário perdido vira "perdida" e não roda atrasado', async () => {
  const t = setup(); await t.ready;
  await t.eng.save(t.base);
  const late = local(2026, 3, 4, 10, 0) + MISS_MS + 60000;
  t.clock.t = late;
  await t.eng.tick(late);
  assert.equal(t.spawned.length, 0);
  const r = t.eng.list().runs[0];
  assert.equal(r.status, 'missed');
  assert.ok(r.steps.every((s) => s.status === 'skipped'));
  assert.equal(t.eng.list().automations[0].nextRunAt, local(2026, 3, 5, 10, 0));
});

test('no máximo 2 execuções em paralelo; a terceira espera uma vaga', async () => {
  const t = setup(); await t.ready;
  const ids = [];
  for (const n of ['A', 'B', 'C']) ids.push((await t.eng.save({ ...t.base, name: n })).id);
  t.clock.t = local(2026, 3, 4, 10, 0, 1);
  await t.eng.tick(t.clock.t);
  await until(() => t.spawned.length === 2);
  await t.eng.tick(t.clock.t);
  assert.equal(t.spawned.length, 2);
  t.spawned[0].finish(0, out('ok'));
  await until(() => t.finished.length >= 1);
  await t.eng.tick(t.clock.t);
  await until(() => t.spawned.length === 3);
});

test('desligar zera a próxima execução; gatilho manual nunca agenda', async () => {
  const t = setup(); await t.ready;
  const a = await t.eng.save(t.base);
  assert.equal(a.nextRunAt, local(2026, 3, 4, 10, 0));
  assert.equal((await t.eng.setEnabled(a.id, false)).nextRunAt, null);
  assert.equal((await t.eng.setEnabled(a.id, true)).nextRunAt, local(2026, 3, 4, 10, 0));
  const m = await t.eng.save({ ...t.base, id: undefined, trigger: { type: 'manual' } });
  assert.equal(m.nextRunAt, null);
});

test('execução gravada ao começar: reabrir marca como interrompida', async () => {
  const t = setup(); await t.ready;
  const a = await t.eng.save({ ...t.base, trigger: { type: 'manual' } });
  t.eng.runNow(a.id);
  await until(() => t.spawned.length === 1);
  await until(() => { try { return JSON.parse(fs.readFileSync(path.join(t.dir, 'runs.json'), 'utf8')).runs[0].status === 'running'; } catch { return false; } });
  const again = t.mk();
  await again.init();
  const r = again.list().runs[0];
  assert.equal(r.status, 'error');
  assert.match(r.error, /fechado/);
  assert.deepEqual(r.steps.map((s) => s.status), ['error', 'skipped']);
});

/* ─────────────── migração das Rotinas ─────────────── */
const legacy = {
  schedules: [{ id: 'r1', name: 'Revisão', agent: 'revisor', cwd: os.tmpdir(), prompt: 'Revise', mode: 'read', recurrence: { kind: 'daily', time: '08:00' }, maxBudgetUsd: 2, notify: false, enabled: true, lastRunAt: 5, lastStatus: 'ok', nextRunAt: 99 }],
  runs: [{ id: 'x1', scheduleId: 'r1', name: 'Revisão', agent: 'revisor', cwd: os.tmpdir(), startedAt: 10, endedAt: 4010, status: 'ok', trigger: 'manual', sessionId: 'S9', costUsd: 0.2, turns: 3, result: 'achei isto', error: '' }],
};

test('migrateLegacy: rotina vira gatilho de horário + 1 passo Agente, sem perder dados', () => {
  const m = migrateLegacy(legacy);
  const a = m.automations[0];
  assert.equal(a.id, 'r1');
  assert.deepEqual(a.trigger, { type: 'schedule', recurrence: { kind: 'daily', time: '08:00' } });
  assert.equal(a.notify, false);
  assert.equal(a.nextRunAt, 99);
  assert.deepEqual(a.steps[0].config, { agent: 'revisor', cwd: os.tmpdir(), prompt: 'Revise', mode: 'read', allowWrite: false, maxBudgetUsd: 2 });
  assert.doesNotThrow(() => cleanAutomation(a)); // passa pela mesma validação da tela
  const r = m.runs[0];
  assert.equal(r.automationId, 'r1');
  assert.equal(r.steps[0].output, 'achei isto');
  assert.equal(r.steps[0].sessionId, 'S9');
  assert.equal(r.steps[0].durationMs, 4000);
});

test('init importa as Rotinas antigas uma vez e deixa o arquivo antigo intacto', async () => {
  const t = setup({ legacy }); await t.ready;
  assert.equal(t.eng.list().automations.length, 1);
  assert.equal(t.eng.list().runs.length, 1);
  assert.ok(fs.existsSync(path.join(t.dir, 'auto.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(t.dir, 'agents-schedule.json'), 'utf8')).schedules.length, 1);
  // apagar a automação e reabrir não traz a rotina de volta
  await t.eng.remove('r1');
  const again = t.mk();
  await again.init();
  assert.equal(again.list().automations.length, 0);
});
