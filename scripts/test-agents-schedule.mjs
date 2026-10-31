// Testes das rotinas agendadas dos Agentes (recorrência, política de permissões, execução e histórico) com um `claude` falso:
//   node --test scripts/test-agents-schedule.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const rec = require('../src/tools/agents/recurrence.js');
const form = require('../src/tools/agents/agentForm.js');
const { createAgentStore } = require('../electron/agents/store.js');
const { createScheduler, cleanSchedule, buildArgs, parseOutput, MISS_MS } = require('../electron/agents/schedule.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tk-agsched-'));
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

/* ─────────────── recorrência ─────────────── */
test('nextRun: diário, dias úteis, semanal e intervalo', () => {
  const t = local(2026, 3, 4, 9, 0); // quarta-feira 09:00
  assert.equal(rec.nextRun({ kind: 'daily', time: '08:00' }, t), local(2026, 3, 5, 8, 0));
  assert.equal(rec.nextRun({ kind: 'daily', time: '10:30' }, t), local(2026, 3, 4, 10, 30));
  assert.equal(rec.nextRun({ kind: 'daily', time: '09:00' }, t), local(2026, 3, 5, 9, 0)); // estritamente depois
  assert.equal(rec.nextRun({ kind: 'weekdays', time: '08:00' }, local(2026, 3, 6, 9, 0)), local(2026, 3, 9, 8, 0)); // sexta → segunda
  assert.equal(rec.nextRun({ kind: 'weekly', time: '07:00', days: [0] }, t), local(2026, 3, 8, 7, 0)); // domingo
  assert.equal(rec.nextRun({ kind: 'interval', everyMin: 30 }, t), t + 30 * 60000);
});

test('cleanRecurrence valida', () => {
  assert.throws(() => rec.cleanRecurrence({ kind: 'x' }), /frequência/);
  assert.throws(() => rec.cleanRecurrence({ kind: 'daily', time: '25:00' }), /HH:MM/);
  assert.throws(() => rec.cleanRecurrence({ kind: 'weekly', time: '08:00', days: [] }), /dia da semana/);
  assert.throws(() => rec.cleanRecurrence({ kind: 'interval', everyMin: 1 }), /mínimo/);
  assert.deepEqual(rec.cleanRecurrence({ kind: 'weekly', time: '08:00', days: ['3', 1, 1, 9] }), { kind: 'weekly', time: '08:00', days: [1, 3] });
  assert.equal(rec.describeRecurrence({ kind: 'weekdays', time: '08:00' }), 'Dias úteis às 08:00');
  assert.equal(rec.describeRecurrence({ kind: 'interval', everyMin: 120 }), 'A cada 2 h');
});

/* ─────────────── política de permissões ─────────────── */
test('runPolicy: modo leitura corta o que o agente tem além de ler', () => {
  const p = form.runPolicy({ tools: ['Read', 'Edit', 'Bash', 'Grep'] }, 'read');
  assert.deepEqual(p.tools, ['Read', 'Grep']);
  assert.equal(p.permissionMode, 'dontAsk');
  assert.deepEqual(form.runPolicy({ tools: null }, 'read').tools, form.READ);
  assert.equal(form.runPolicy({ tools: ['Edit'] }, 'read').ok, false);
});

test('runPolicy: "como o agente" exige lista de ferramentas; edição libera acceptEdits', () => {
  assert.equal(form.runPolicy({ tools: null }, 'agent').ok, false);
  assert.equal(form.runPolicy({ tools: ['Read', 'Edit'] }, 'agent').permissionMode, 'acceptEdits');
  assert.equal(form.runPolicy({ tools: ['Read', 'Bash(git log:*)'] }, 'agent').permissionMode, 'dontAsk');
});

test('buildArgs: sem shell, prompt fora dos argumentos', () => {
  const s = cleanSchedule({ agent: 'revisor', cwd: os.tmpdir(), prompt: '--perigoso; rm -rf', recurrence: { kind: 'daily', time: '08:00' } });
  const { args } = buildArgs({ tools: ['Read', 'Grep'] }, s, 'sid-1');
  assert.deepEqual(args, ['-p', '--agent', 'revisor', '--output-format', 'json', '--permission-mode', 'dontAsk', '--allowedTools', 'Read,Grep', '--max-budget-usd', '1', '--session-id', 'sid-1']);
  assert.ok(!args.some((a) => a.includes('perigoso')));
  assert.ok(buildArgs({ tools: null }, { ...s, mode: 'agent' }, 'x').problem);
});

test('cleanSchedule valida', () => {
  const ok = { agent: 'a', cwd: os.tmpdir(), prompt: 'oi', recurrence: { kind: 'daily', time: '08:00' } };
  assert.throws(() => cleanSchedule({ ...ok, agent: '../x' }), /agente/);
  assert.throws(() => cleanSchedule({ ...ok, cwd: 'relativo' }), /caminho completo/);
  assert.throws(() => cleanSchedule({ ...ok, prompt: ' ' }), /Escreva/);
  assert.equal(cleanSchedule({ ...ok, maxBudgetUsd: 999 }).maxBudgetUsd, 50);
  assert.equal(cleanSchedule({ ...ok, maxBudgetUsd: 'x' }).maxBudgetUsd, 1);
  assert.equal(cleanSchedule(ok).mode, 'read');
});

/* ─────────────── saída do claude ─────────────── */
test('parseOutput lê objeto, lista de eventos e lixo antes do JSON', () => {
  const obj = { type: 'result', subtype: 'success', is_error: false, result: 'feito', total_cost_usd: 0.0123, num_turns: 3, session_id: 'abc' };
  assert.equal(parseOutput(JSON.stringify(obj)).result, 'feito');
  assert.equal(parseOutput(JSON.stringify([{ type: 'system' }, obj])).costUsd, 0.0123);
  assert.equal(parseOutput('aviso\n' + JSON.stringify(obj)).turns, 3);
  assert.equal(parseOutput(JSON.stringify({ ...obj, subtype: 'error_max_budget_usd', is_error: true })).isError, true);
  assert.equal(parseOutput(''), null);
  assert.equal(parseOutput('não é json'), null);
});

/* ─────────────── agenda ─────────────── */
function setup({ start = local(2026, 3, 4, 9, 0), tools = ['Read', 'Grep'] } = {}) {
  const dir = tmp();
  const agentsDir = path.join(dir, 'agents');
  const agents = createAgentStore({ dir: agentsDir });
  const cwd = path.join(dir, 'proj');
  fs.mkdirSync(cwd);
  const clock = { t: start };
  const spawned = [];
  const finished = [];
  const spawn = (bin, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end: (text) => { child.prompt = text; } };
    child.kill = () => setImmediate(() => child.emit('close', null));
    child.args = args; child.opts = opts; child.bin = bin;
    child.finish = (code, out, err) => { if (out) child.stdout.emit('data', out); if (err) child.stderr.emit('data', err); child.emit('close', code); };
    spawned.push(child);
    return child;
  };
  const sched = createScheduler({ file: path.join(dir, 'sched.json'), agents, spawn, now: () => clock.t, onFinish: (run, s) => finished.push({ run, s }) });
  const ready = (async () => { await agents.save({ name: 'revisor', description: 'Revisa', tools, prompt: 'x' }); await sched.init(); })();
  const base = { agent: 'revisor', cwd, prompt: 'Revise ontem', recurrence: { kind: 'daily', time: '10:00' } };
  return { sched, clock, spawned, finished, ready, base, cwd, dir };
}
const ok = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'tudo certo', total_cost_usd: 0.05, num_turns: 2, session_id: 'S1' });
const tick = () => new Promise((r) => setImmediate(r));
const until = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5)); assert.ok(cond(), 'a condição não aconteceu'); };

test('salvar calcula a próxima execução; desligada não tem', async () => {
  const t = setup(); await t.ready;
  const s = await t.sched.save(t.base);
  assert.equal(s.nextRunAt, local(2026, 3, 4, 10, 0));
  const off = await t.sched.setEnabled(s.id, false);
  assert.equal(off.nextRunAt, null);
});

test('na hora marcada roda o claude com os argumentos certos e guarda o resultado', async () => {
  const t = setup(); await t.ready;
  const s = await t.sched.save(t.base);
  await t.sched.tick(local(2026, 3, 4, 9, 59));
  assert.equal(t.spawned.length, 0); // ainda não
  t.clock.t = local(2026, 3, 4, 10, 0, 5);
  await t.sched.tick(t.clock.t);
  await until(() => t.spawned.length === 1);
  const c = t.spawned[0];
  assert.equal(c.bin, 'claude');
  assert.equal(c.prompt, 'Revise ontem');
  assert.equal(c.opts.cwd, t.cwd);
  assert.ok(c.args.includes('dontAsk'));
  assert.equal(t.sched.list().schedules[0].nextRunAt, local(2026, 3, 5, 10, 0));
  assert.equal(t.sched.list().runs[0].status, 'running');
  c.finish(0, ok);
  await tick();
  const run = t.sched.list().runs[0];
  assert.equal(run.status, 'ok');
  assert.equal(run.costUsd, 0.05);
  assert.equal(run.sessionId, 'S1');
  assert.equal(t.sched.run(run.id).result, 'tudo certo');
  assert.equal(t.finished.length, 1);
  assert.equal(t.sched.list().schedules[0].lastStatus, 'ok');
  void s;
});

test('execução com erro, sem resposta e sem o comando viram "error" com motivo', async () => {
  const t = setup(); await t.ready;
  const s = await t.sched.save(t.base);
  let r = t.sched.runNow(s.id); await until(() => t.spawned.length === 1);
  t.spawned[0].finish(1, '', 'Invalid API key');
  r = await r; await tick();
  assert.equal(t.sched.list().runs[0].status, 'error');
  assert.match(t.sched.list().runs[0].error, /Invalid API key/);

  const p = t.sched.runNow(s.id); await until(() => t.spawned.length === 2);
  t.spawned[1].emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
  await p; await tick();
  assert.match(t.sched.list().runs[0].error, /não foi encontrado/);
  void r;
});

test('estourar o teto de custo aparece como erro explicado', async () => {
  const t = setup(); await t.ready;
  const s = await t.sched.save(t.base);
  const p = t.sched.runNow(s.id); await until(() => t.spawned.length === 1);
  t.spawned[0].finish(1, JSON.stringify({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, result: '', total_cost_usd: 1.01 }));
  await p; await tick();
  assert.match(t.sched.list().runs[0].error, /teto de US\$ 1/);
});

test('horário perdido (app fechado) não roda atrasado: vira "perdida"', async () => {
  const t = setup(); await t.ready;
  await t.sched.save(t.base);
  t.clock.t = local(2026, 3, 4, 10, 0) + MISS_MS + 60000;
  await t.sched.tick(t.clock.t);
  assert.equal(t.spawned.length, 0);
  assert.equal(t.sched.list().runs[0].status, 'missed');
  assert.equal(t.sched.list().schedules[0].nextRunAt, local(2026, 3, 5, 10, 0));
});

test('não roda duas vezes ao mesmo tempo, e limita a 2 em paralelo', async () => {
  const t = setup(); await t.ready;
  const a = await t.sched.save(t.base);
  const b = await t.sched.save({ ...t.base, name: 'B' });
  const c = await t.sched.save({ ...t.base, name: 'C' });
  const p = t.sched.runNow(a.id); await until(() => t.spawned.length === 1);
  await assert.rejects(t.sched.runNow(a.id), /já está rodando/);
  t.clock.t = local(2026, 3, 4, 10, 0, 1);
  await t.sched.tick(t.clock.t); // a está rodando (pula), b e c disputam a 2ª vaga
  await until(() => t.spawned.length === 2);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(t.spawned.length, 2);
  void p; void b; void c;
});

test('cancelar encerra o processo e registra "cancelada"', async () => {
  const t = setup(); await t.ready;
  const s = await t.sched.save(t.base);
  const p = t.sched.runNow(s.id); await until(() => t.spawned.length === 1);
  const run = t.sched.list().runs[0];
  assert.equal(t.sched.cancel(run.id), true);
  await p; await tick(); await tick();
  assert.equal(t.sched.list().runs[0].status, 'canceled');
  assert.equal(t.finished.length, 1);
});

test('agente apagado, pasta inexistente e agente que herda tudo em modo "como o agente" falham sem abrir o claude', async () => {
  const t = setup({ tools: null }); await t.ready;
  const s = await t.sched.save({ ...t.base, mode: 'agent' });
  let r = await t.sched.runNow(s.id);
  assert.match(r.error, /herda todas as ferramentas/);

  const s2 = await t.sched.save({ ...t.base, id: s.id, mode: 'read', cwd: path.join(t.dir, 'sumiu') });
  r = await t.sched.runNow(s2.id);
  assert.match(r.error, /pasta de trabalho não existe/);

  const s3 = await t.sched.save({ ...t.base, id: s.id, agent: 'fantasma' });
  r = await t.sched.runNow(s3.id);
  assert.match(r.error, /não existe mais/);
  assert.equal(t.spawned.length, 0);
});

test('estado persiste; execução que estava rodando ao fechar vira erro; histórico é limitado e limpável', async () => {
  const t = setup(); await t.ready;
  const s = await t.sched.save(t.base);
  t.sched.runNow(s.id); await until(() => t.spawned.length === 1); // fica "rodando"
  await new Promise((r) => setTimeout(r, 30)); // deixa a gravação terminar
  const agents = createAgentStore({ dir: path.join(t.dir, 'agents') });
  const again = createScheduler({ file: path.join(t.dir, 'sched.json'), agents, now: () => t.clock.t });
  const l = await again.init();
  assert.equal(l.schedules.length, 1);
  assert.equal(l.runs[0].status, 'error');
  assert.match(l.runs[0].error, /fechado durante/);
  await again.clearHistory();
  assert.equal(again.list().runs.length, 0);
  await again.remove(s.id);
  assert.equal(again.list().schedules.length, 0);
});
