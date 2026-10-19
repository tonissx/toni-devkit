// Testes do estado ao vivo informado pelo próprio agente (~/.claude/sessions): node --test scripts/test-aimon-live.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const claude = require('../electron/aimon/providers/claude.js');
const state = require('../electron/aimon/state.js');
const lanes = require('../electron/aimon/lanes.js');
const { createAimonService } = require('../electron/aimon/service.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tk-aimon-live-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (o) => JSON.stringify(o) + '\n';
const T0 = Date.parse('2026-10-19T10:00:00Z');

/* ─────────────── leitor de ~/.claude/sessions ─────────────── */

test('live: lê só processo vivo, ignora lixo e arquivos .key, e vale o mais recente por sessão', async () => {
  const dir = tmp();
  const w = (name, o) => fs.writeFileSync(path.join(dir, name), typeof o === 'string' ? o : JSON.stringify(o));
  w('10.json', { pid: 10, sessionId: 's-vivo', status: 'waiting', waitingFor: 'permissão: Bash', statusUpdatedAt: 5000, updatedAt: 5000 });
  w('11.json', { pid: 11, sessionId: 's-morto', status: 'busy' });
  w('12.json', 'isso não é json');
  w('13.json', { pid: 13, status: 'busy' }); // sem sessionId
  w('14.json', { pid: 14, sessionId: 's-dup', status: 'busy', updatedAt: 100 });
  w('15.json', { pid: 15, sessionId: 's-dup', status: 'waiting', updatedAt: 200 });
  w('10.abc123.key', 'SEGREDO-QUE-NUNCA-DEVE-SER-LIDO');
  w('16.json', { pid: 16, sessionId: 's-obj', status: 'waiting', waitingFor: { kind: 'permission', tool: 'Bash' } });
  const alive = (pid) => pid !== 11;
  const m = await claude.live(dir, alive);
  assert.deepEqual([...m.keys()].sort(), ['s-dup', 's-obj', 's-vivo']);
  assert.deepEqual([m.get('s-vivo').status, m.get('s-vivo').waitingFor, m.get('s-vivo').statusUpdatedAt], ['waiting', 'permissão: Bash', 5000]);
  assert.equal(m.get('s-dup').status, 'waiting'); // o mais recente
  assert.equal(m.get('s-obj').waitingFor, 'Aguardando a sua permissão'); // objeto vira texto e é traduzido
  assert.ok(![...m.values()].some((v) => JSON.stringify(v).includes('SEGREDO')));
  assert.equal((await claude.live(path.join(dir, 'nao-existe'), alive)).size, 0);
});

/* ─────────────── estado: o sinal do agente vale mais que a estimativa ─────────────── */

const openTurn = (lastTs = T0) => { const s = state.createSessionState(); state.apply(s, { ts: lastTs, kind: 'prompt' }); state.apply(s, { ts: lastTs, kind: 'text', summary: 'x' }); return s; };

test('estado: waiting do agente vira Esperando mesmo sem chamada pendente no transcript', () => {
  const s = openTurn(T0); // o transcript só tem texto: a chamada pendente nunca é gravada
  assert.equal(state.statusOf(s, T0 + 5 * 60_000), 'working'); // sem o sinal, ficaria "Trabalhando"
  assert.equal(state.statusOf(s, T0 + 5 * 60_000, { status: 'waiting' }), 'waiting');
  const sum = state.summary(s, T0 + 5 * 60_000, { status: 'waiting', waitingFor: 'permissão: Bash' });
  assert.deepEqual([sum.status, sum.statusSource, sum.waitingFor], ['waiting', 'live', 'permissão: Bash']);
});

test('estado: busy não vira "sem sinal"; idle/shell encerram; desconhecido volta à estimativa; erro continua mandando', () => {
  const s = openTurn(T0);
  const late = T0 + state.STALE_MS * 3;
  assert.equal(state.statusOf(s, late), 'stale');
  assert.equal(state.statusOf(s, late, { status: 'busy' }), 'working');
  assert.equal(state.statusOf(s, T0 + 1000, { status: 'idle' }), 'idle'); // a pessoa interrompeu: o turno não fecha no transcript
  assert.equal(state.statusOf(s, T0 + 1000, { status: 'shell' }), 'idle');
  assert.equal(state.statusOf(s, late, { status: 'coisa-nova' }), 'stale'); // não conhece: usa a estimativa
  assert.equal(state.summary(s, late, { status: 'coisa-nova' }).statusSource, 'transcript');
  assert.equal(state.summary(s, late).statusSource, 'transcript');
  const err = openTurn(T0); state.apply(err, { ts: T0 + 1, kind: 'error', code: 'x', summary: 'falhou' });
  assert.equal(state.statusOf(err, T0 + 2, { status: 'busy' }), 'error');
});

/* ─────────────── raias ─────────────── */

const S = (a, b, st = 'working') => ({ from: T0 + a, to: T0 + b, state: st });
const plain = (l) => l.map(({ from, to, state: st }) => [from - T0, to - T0, st]);

test('raias: o intervalo de espera recorta o bloco de trabalho e acrescenta o que faltar', () => {
  assert.deepEqual(plain(lanes.overlayWaiting([S(0, 100)], [{ from: T0 + 40, to: T0 + 70 }], 0, T0 + 100)), [[0, 40, 'working'], [40, 70, 'waiting'], [70, 100, 'working']]);
  assert.deepEqual(plain(lanes.overlayWaiting([S(0, 100)], [{ from: T0 + 60, to: null }], 0, T0 + 100)), [[0, 60, 'working'], [60, 100, 'waiting']]); // ainda esperando
  assert.deepEqual(plain(lanes.overlayWaiting([], [{ from: T0 + 10, to: T0 + 30 }], 0, T0 + 100)), [[10, 30, 'waiting']]); // transcript sem bloco aberto
  assert.deepEqual(plain(lanes.overlayWaiting([S(0, 50)], [{ from: T0 + 50, to: T0 + 80 }], 0, T0 + 100)), [[0, 50, 'working'], [50, 80, 'waiting']]);
  assert.deepEqual(plain(lanes.overlayWaiting([S(0, 100)], [{ from: T0 - 500, to: T0 - 400 }, { from: T0 + 20, to: T0 + 10 }], T0, T0 + 100)), [[0, 100, 'working']]); // fora da janela ou invertido
  assert.deepEqual(lanes.overlayWaiting([S(0, 10)], undefined, 0, T0 + 10).length, 1);
  const two = lanes.overlayWaiting([S(0, 100)], [{ from: T0 + 10, to: T0 + 20 }, { from: T0 + 50, to: T0 + 60 }], 0, T0 + 100);
  assert.equal(two.filter((x) => x.state === 'waiting').length, 2);
});

/* ─────────────── serviço ─────────────── */

function mkSession(base, id, ts) {
  const dir = path.join(base, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, id + '.jsonl'),
    j({ type: 'user', timestamp: ts, cwd: '/x', message: { role: 'user', content: 'faz' } })
    + j({ type: 'assistant', timestamp: ts, message: { model: 'm', content: [{ type: 'text', text: 'vou fazer' }] } }));
}

test('serviço: o estado informado pelo agente aparece na lista, vira bloco âmbar nas raias e fecha quando volta a trabalhar', async () => {
  const base = tmp();
  const nowIso = new Date().toISOString();
  mkSession(base, 'sess1', nowIso);
  let liveMap = new Map();
  const provider = { ...claude, listSessions: (since) => claude.listSessions(since, base), live: async () => liveMap };
  const svc = createAimonService({ providers: [provider], pollMs: 20, windowMs: 3600e3 });
  await svc._tick();
  assert.equal(svc.list()[0].status, 'working');
  assert.equal(svc.list()[0].statusSource, 'transcript');

  const since = Date.now() - 30_000;
  liveMap = new Map([['sess1', { status: 'waiting', waitingFor: 'permissão: Bash', statusUpdatedAt: Date.now() - 5_000, pid: 1 }]]);
  await svc._tick();
  const row = svc.list()[0];
  assert.deepEqual([row.status, row.statusSource, row.waitingFor], ['waiting', 'live', 'permissão: Bash']);
  assert.ok(svc.lanes({ since }).lanes[0].segments.some((x) => x.state === 'waiting'));

  liveMap = new Map([['sess1', { status: 'busy', waitingFor: null, statusUpdatedAt: Date.now(), pid: 1 }]]);
  await svc._tick();
  assert.equal(svc.list()[0].status, 'working');
  const segs = svc.lanes({ since }).lanes[0].segments;
  assert.ok(segs.some((x) => x.state === 'waiting' && x.to <= Date.now())); // o trecho esperado ficou registrado e acabou

  liveMap = new Map(); // o processo acabou
  await svc._tick();
  assert.equal(svc.list()[0].statusSource, 'transcript');
});

test('serviço: subagente não usa o estado ao vivo da sessão principal', async () => {
  const base = tmp();
  const nowIso = new Date().toISOString();
  mkSession(base, 'main1', nowIso);
  const sub = path.join(base, 'proj', 'main1', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), j({ type: 'user', timestamp: nowIso, message: { role: 'user', content: 'sub' } }));
  const provider = { ...claude, listSessions: (since) => claude.listSessions(since, base), live: async () => new Map([['main1', { status: 'waiting', waitingFor: 'x', statusUpdatedAt: Date.now(), pid: 1 }]]) };
  const svc = createAimonService({ providers: [provider], windowMs: 3600e3 });
  await svc._tick();
  const rows = svc.list();
  assert.equal(rows.find((r) => !r.parentId).status, 'waiting');
  assert.notEqual(rows.find((r) => r.parentId).status, 'waiting');
});

test('serviço: um provedor sem estado ao vivo (ou que falha) não atrapalha', async () => {
  const base = tmp();
  mkSession(base, 'sess1', new Date().toISOString());
  const boom = { ...claude, listSessions: (since) => claude.listSessions(since, base), live: async () => { throw new Error('x'); } };
  const svc = createAimonService({ providers: [boom], windowMs: 3600e3 });
  await svc._tick();
  assert.equal(svc.list()[0].statusSource, 'transcript');
  const plain = { ...claude, listSessions: (since) => claude.listSessions(since, base) };
  delete plain.live;
  const svc2 = createAimonService({ providers: [plain], windowMs: 3600e3 });
  await svc2._tick();
  assert.equal(svc2.list().length, 1);
  await sleep(1);
});

test('waitingFor: "input needed" (o valor real do Claude Code) e pedidos de permissão viram português; o resto passa como veio', () => {
  const util = require('../electron/aimon/util.js');
  assert.equal(util.describeWaiting('input needed'), 'Aguardando a sua resposta');
  assert.equal(util.describeWaiting('Input Needed'), 'Aguardando a sua resposta');
  assert.equal(util.describeWaiting('permission needed'), 'Aguardando a sua permissão');
  assert.equal(util.describeWaiting('approval required for Bash'), 'Aguardando a sua permissão');
  assert.equal(util.describeWaiting('permissão: Bash'), 'permissão: Bash'); // já em português
  assert.equal(util.describeWaiting('algo novo'), 'algo novo');
  assert.equal(util.describeWaiting(''), null);
  assert.equal(util.describeWaiting(null), null);
  assert.match(util.describeWaiting({ kind: 'x' }), /kind/);
  assert.ok(util.describeWaiting('x'.repeat(300)).length <= 80);
});
