// Testes do status "Erro" do Monitor de IA (erro grave da sessão): node --test scripts/test-aimon-errors.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const util = require('../electron/aimon/util.js');
const state = require('../electron/aimon/state.js');
const claude = require('../electron/aimon/providers/claude.js');
const codex = require('../electron/aimon/providers/codex.js');
const lanes = require('../electron/aimon/lanes.js');
const agents = require('../src/tools/aimon/agents.js');
const { createAimonService } = require('../electron/aimon/service.js');

const T0 = Date.parse('2026-10-19T10:00:00Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const line = (o) => JSON.stringify(o);
const apiErr = (s, error, text) => ({ type: 'assistant', timestamp: iso(s), isApiErrorMessage: true, error, message: { model: 'm', content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } } });
const userPrompt = (s, text) => ({ type: 'user', timestamp: iso(s), message: { role: 'user', content: text } });
const toolUse = (s, id) => ({ type: 'assistant', timestamp: iso(s), message: { model: 'm', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'ls' } }] } });
const toolRes = (s, id, content, isError) => ({ type: 'user', timestamp: iso(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });
const feed = (objs, ctx = {}) => objs.flatMap((o) => claude.parseLine(line(o), ctx));

/* ─────────────── o que é erro ─────────────── */

test('util: só erro de verdade da API conta ("No response requested." não)', () => {
  assert.equal(util.isRealApiError(apiErr(0, 'authentication_failed', 'Login expired · Please run /login')), true);
  assert.equal(util.isRealApiError(apiErr(0, '', 'API Error: 529 overloaded')), true); // sem código, mas o texto é de erro
  assert.equal(util.isRealApiError(apiErr(0, '', 'No response requested.')), false);
  assert.equal(util.isRealApiError({ ...apiErr(0, 'x', 'y'), isApiErrorMessage: false }), false);
  for (const junk of [null, undefined, 1, 'x', {}, { isApiErrorMessage: true }]) assert.equal(util.isRealApiError(junk), false);
});

test('util: mensagens curtas em português e fallback seguro', () => {
  assert.equal(util.describeError('authentication_failed', 'Login expired'), 'Login expirado — rode /login');
  assert.equal(util.describeError('', 'Please run /login'), 'Login expirado — rode /login');
  assert.match(util.describeError('rate_limit', ''), /Limite de uso/);
  assert.match(util.describeError('', 'API Error: 529 overloaded_error'), /indisponível ou sobrecarregado/);
  assert.match(util.describeError('', 'Credit balance is too low'), /Saldo/);
  assert.equal(util.describeError('coisa_nova', 'algo diferente aconteceu'), 'algo diferente aconteceu');
  assert.equal(util.describeError('coisa_nova', ''), 'coisa_nova');
  assert.equal(util.describeError('', ''), 'Erro da API');
  assert.ok(util.describeError('x', 'a'.repeat(500)).length <= 160);
});

test('util: a recusa da própria pessoa a uma permissão não é falha de ferramenta', () => {
  assert.equal(util.isRejection("The user doesn't want to proceed with this tool use."), true);
  assert.equal(util.isRejection([{ type: 'text', text: 'The tool use was rejected' }]), true);
  assert.equal(util.isRejection('command not found'), false);
  assert.equal(util.isRejection(null), false);
});

/* ─────────────── adaptadores ─────────────── */

test('claude: linha de erro vira evento "error" e não texto do agente', () => {
  const ev = feed([apiErr(5, 'authentication_failed', 'Login expired · Please run /login')]);
  const e = ev.find((x) => x.kind === 'error');
  assert.deepEqual([e.code, e.summary], ['authentication_failed', 'Login expirado — rode /login']);
  assert.ok(!ev.some((x) => x.kind === 'text'));
  assert.deepEqual(feed([apiErr(6, '', 'No response requested.')]).filter((x) => x.kind === 'error'), []);
});

test('claude: falha de ferramenta marca error; recusa da pessoa não', () => {
  const ev = feed([toolRes(1, 'a', 'boom', true), toolRes(2, 'b', "The user doesn't want to proceed with this tool use.", true), toolRes(3, 'c', 'ok')]);
  assert.deepEqual(ev.map((e) => [e.error, !!e.rejected]), [[true, false], [false, true], [false, false]]);
});

test('codex: evento de erro é reconhecido (defensivo) e o resto segue igual', () => {
  const L = (type, payload, s = 0) => line({ timestamp: iso(s), type, payload });
  const ev = ['event_msg'].flatMap(() => [codex.parseLine(L('event_msg', { type: 'stream_error', message: 'Usage limit reached' }, 3), {}), codex.parseLine(L('event_msg', { type: 'task_complete' }, 4), {})]).flat();
  assert.equal(ev[0].kind, 'error');
  assert.match(ev[0].summary, /Limite de uso/);
  assert.equal(ev[1].kind, 'turn_end');
});

/* ─────────────── estado ─────────────── */

const run = (objs) => { const ctx = {}; const s = state.createSessionState(); for (const e of feed(objs, ctx)) state.apply(s, e); return s; };

test('estado: erro vira status "error" (sobre ocioso e sem sinal) e nova atividade limpa', () => {
  const s = run([userPrompt(0, 'faz'), apiErr(5, 'authentication_failed', 'Login expired')]);
  assert.equal(state.statusOf(s, T0 + 6_000), 'error');
  assert.equal(state.statusOf(s, T0 + state.STALE_MS * 3), 'error'); // não vira "sem sinal"
  const sum = state.summary(s, T0 + 6_000);
  assert.equal(sum.error.message, 'Login expirado — rode /login');
  for (const next of [userPrompt(20, 'de novo'), toolUse(20, 't1')]) {
    const s2 = run([userPrompt(0, 'faz'), apiErr(5, 'authentication_failed', 'Login expired'), next]);
    assert.notEqual(state.statusOf(s2, T0 + 21_000), 'error');
    assert.equal(state.summary(s2, T0 + 21_000).error, null);
  }
});

test('estado: falha de ferramenta NÃO é status; só avisa até a próxima ferramenta dar certo', () => {
  const s = run([userPrompt(0, 'faz'), toolUse(1, 'a'), toolRes(2, 'a', 'boom', true)]);
  assert.equal(state.statusOf(s, T0 + 3_000), 'working');
  assert.equal(state.summary(s, T0 + 3_000).lastToolFailed, true);
  const ok = run([userPrompt(0, 'faz'), toolUse(1, 'a'), toolRes(2, 'a', 'boom', true), toolUse(3, 'b'), toolRes(4, 'b', 'ok')]);
  assert.equal(state.summary(ok, T0 + 5_000).lastToolFailed, false);
  const refused = run([userPrompt(0, 'faz'), toolUse(1, 'a'), toolRes(2, 'a', "The user doesn't want to proceed", true)]);
  assert.equal(state.summary(refused, T0 + 3_000).lastToolFailed, false);
});

/* ─────────────── raias ─────────────── */

test('raias: o erro fecha o bloco de trabalho (não estica até agora)', () => {
  const ev = feed([userPrompt(0, 'faz'), toolUse(2, 'a'), apiErr(10, 'authentication_failed', 'Login expired')]);
  const segs = lanes.segments(ev, T0 + 600_000);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].to, T0 + 10_000);
});

/* ─────────────── subagentes e cabeçalho ─────────────── */

const K = (status) => ({ status, tools: 1, tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, lastTs: 1 });

test('subagentes: contam erro, aparecem no resumo e o grupo com erro nunca recolhe', () => {
  const sum = agents.summarizeAgents([K('idle'), K('error'), K('working')]);
  assert.equal(sum.error, 1);
  assert.deepEqual(agents.agentParts(sum), ['3 agentes', '1 trabalhando', '1 com erro']);
  const onlyErr = agents.summarizeAgents([K('idle'), K('error')]);
  assert.deepEqual(agents.agentParts(onlyErr), ['2 agentes', '1 com erro']); // não diz "todos concluídos"
  assert.equal(agents.isCollapsed(onlyErr, {}, 'a'), false);
  assert.equal(agents.isCollapsed(onlyErr, { a: true }, 'a'), true); // a escolha da pessoa continua valendo
});

/* ─────────────── serviço ─────────────── */

test('serviço: sessão em erro aparece na lista e a raia devolve o marcador do erro', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-aimon-err-'));
  const dir = path.join(base, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const stamp = (ms) => new Date(now - ms).toISOString();
  fs.writeFileSync(path.join(dir, 's1.jsonl'),
    line({ ...userPrompt(0, 'faz'), timestamp: stamp(20_000), cwd: '/x' }) + '\n'
    + line({ ...apiErr(0, 'authentication_failed', 'Login expired · Please run /login'), timestamp: stamp(10_000) }) + '\n');
  const svc = createAimonService({ providers: [{ ...claude, listSessions: (since) => claude.listSessions(since, base) }], windowMs: 3600e3 });
  await svc._tick();
  const row = svc.list()[0];
  assert.equal(row.status, 'error');
  assert.equal(row.error.message, 'Login expirado — rode /login');
  const r = svc.lanes({ since: now - 3600e3 });
  assert.equal(r.lanes[0].errors.length, 1);
  assert.equal(r.lanes[0].errors[0].code, 'authentication_failed');
  assert.ok(r.lanes[0].segments.length >= 1);
});

test('estado: a entrega do relatório do subagente (SubagentHandback) não apaga o aviso da falha anterior', () => {
  const handback = (s, id) => ({ type: 'assistant', timestamp: iso(s), message: { model: 'm', content: [{ type: 'tool_use', id, name: 'SubagentHandback', input: { report: 'ok' } }] } });
  const s = run([userPrompt(0, 'faz'), toolUse(1, 'a'), toolRes(2, 'a', 'boom', true), handback(3, 'h'), toolRes(3.5, 'h', 'ok')]);
  assert.equal(state.statusOf(s, T0 + 5_000), 'idle'); // terminou
  assert.equal(state.summary(s, T0 + 5_000).lastToolFailed, true); // e o aviso continua
  const ok = run([userPrompt(0, 'faz'), toolUse(1, 'a'), toolRes(2, 'a', 'boom', true), toolUse(3, 'b'), toolRes(4, 'b', 'ok')]);
  assert.equal(state.summary(ok, T0 + 5_000).lastToolFailed, false); // ferramenta de verdade que deu certo continua limpando
});
