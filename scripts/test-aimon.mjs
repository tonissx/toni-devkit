// Testes do Monitor de IA (adaptadores, estado e serviço) com arquivos de verdade, sem Electron: node --test scripts/test-aimon.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const claude = require('../electron/aimon/providers/claude.js');
const codex = require('../electron/aimon/providers/codex.js');
const state = require('../electron/aimon/state.js');
const { createAimonService } = require('../electron/aimon/service.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tk-aimon-'));
const j = (o) => JSON.stringify(o) + '\n';
const T0 = Date.parse('2026-10-19T10:00:00Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();

const cUser = (s, text) => j({ type: 'user', timestamp: iso(s), cwd: 'C:\\x\\proj', gitBranch: 'main', message: { role: 'user', content: text } });
const cTool = (s, id, name, input) => j({ type: 'assistant', timestamp: iso(s), message: { model: 'claude-x', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } } });
const cResult = (s, id, text) => j({ type: 'user', timestamp: iso(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
const cEnd = (s) => j({ type: 'assistant', timestamp: iso(s), message: { model: 'claude-x', stop_reason: 'end_turn', content: [{ type: 'text', text: 'pronto' }], usage: { input_tokens: 1, output_tokens: 3 } } });

test('claude: linhas inválidas e tipos desconhecidos viram nada, nunca erro', () => {
  for (const l of ['', 'não é json', '{', 'null', '42', '{"type":"coisa-nova","x":1}', '{"type":"assistant"}', '{"type":"user","message":{"content":null}}']) {
    assert.deepEqual(claude.parseLine(l, {}), []);
  }
});

test('claude: prompt, ferramenta, resultado, tokens e fim de turno', () => {
  const ctx = {};
  const ev = [cUser(0, 'faz X'), cTool(1, 'tu1', 'Bash', { command: 'ls -la' }), cResult(2, 'tu1', 'ok'), cEnd(3)].flatMap((l) => claude.parseLine(l, ctx));
  assert.deepEqual(ev.map((e) => e.kind), ['prompt', 'tool_use', 'usage', 'tool_result', 'text', 'usage', 'turn_end']);
  assert.equal(ev[1].tool, 'Bash');
  assert.equal(ev[1].summary, 'ls -la');
  assert.equal(ev[1].ref, ev[3].ref);
  assert.deepEqual(ev[2].tokens, { input: 2, output: 10, cacheRead: 100, cacheWrite: 5 });
  assert.equal(ctx.cwd, 'C:\\x\\proj');
  assert.equal(ctx.branch, 'main');
});

test('claude: subagente que entrega o relatório (SubagentHandback) encerra o turno', () => {
  const ev = claude.parseLine(cTool(3, 'tu9', 'SubagentHandback', { report: 'ok' }), {});
  assert.deepEqual(ev.map((e) => e.kind), ['tool_use', 'usage', 'turn_end']);
});

test('claude: resumos são curtos e sem quebra de linha', () => {
  const [e] = claude.parseLine(cUser(0, 'a\n'.repeat(500)), {});
  assert.ok(e.summary.length <= 400);
  assert.ok(!e.summary.includes('\n'));
});

test('codex: turno, ferramenta e tokens (cache separado da entrada)', () => {
  const ctx = {};
  const L = (type, payload, s = 0) => j({ timestamp: iso(s), type, payload });
  const ev = [
    L('session_meta', { id: 'abc', cwd: 'C:\\y\\app', cli_version: '1.2.3' }),
    L('turn_context', { cwd: 'C:\\y\\app', model: 'gpt-x' }),
    L('event_msg', { type: 'task_started' }, 1),
    L('event_msg', { type: 'user_message', message: 'oi' }, 1),
    L('response_item', { type: 'function_call', name: 'shell', call_id: 'c1', arguments: '{"command":"dir"}' }, 2),
    L('response_item', { type: 'function_call_output', call_id: 'c1', output: 'x' }, 3),
    L('event_msg', { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 7 } } }, 4),
    L('event_msg', { type: 'task_complete' }, 5),
  ].flatMap((l) => codex.parseLine(l, ctx));
  assert.deepEqual(ev.map((e) => e.kind), ['turn_start', 'prompt', 'tool_use', 'tool_result', 'usage', 'turn_end']);
  assert.equal(ev[2].summary, 'dir');
  assert.deepEqual(ev[4].tokens, { input: 40, output: 7, cacheRead: 60, cacheWrite: 0 });
  assert.equal(ev[4].model, 'gpt-x');
  assert.equal(ctx.cwd, 'C:\\y\\app');
  for (const l of ['', 'lixo', '{"type":"novo","payload":1}', '{"type":"event_msg","payload":{"type":"???"}}']) assert.deepEqual(codex.parseLine(l, {}), []);
});

test('state: working → waiting (ferramenta sem resultado) → stale; idle quando o turno acaba', () => {
  const s = state.createSessionState();
  state.apply(s, { ts: 1000, kind: 'prompt' });
  assert.equal(state.statusOf(s, 1000 + 5_000), 'working');
  state.apply(s, { ts: 2000, kind: 'tool_use', ref: 'a', tool: 'Bash' });
  assert.equal(state.statusOf(s, 2000 + state.WAIT_MS + 1), 'waiting');
  state.apply(s, { ts: 3000, kind: 'tool_result', ref: 'a' });
  assert.equal(state.statusOf(s, 3000 + state.WAIT_MS + 1), 'working'); // modelo pensando, nada pendente
  assert.equal(state.statusOf(s, 3000 + state.STALE_MS + 1), 'stale');
  state.apply(s, { ts: 4000, kind: 'turn_end' });
  assert.equal(state.statusOf(s, 4000 + state.STALE_MS * 2), 'idle');
});

test('state: tokens somam por modelo', () => {
  const s = state.createSessionState();
  state.apply(s, { ts: 1, kind: 'usage', model: 'm1', tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } });
  state.apply(s, { ts: 2, kind: 'usage', model: 'm2', tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 } });
  assert.deepEqual(s.tokens, { input: 11, output: 2, cacheRead: 3, cacheWrite: 4 });
  assert.equal(s.byModel.m1.output, 2);
});

function claudeTree() {
  const home = tmp();
  const proj = path.join(home, 'projects', 'C--x-proj');
  fs.mkdirSync(path.join(proj, 'sess1', 'subagents'), { recursive: true });
  const main = path.join(proj, 'sess1.jsonl');
  fs.writeFileSync(main, cUser(0, 'faz X') + cTool(1, 'tu1', 'Bash', { command: 'ls' }));
  fs.writeFileSync(path.join(proj, 'sess1', 'subagents', 'agent-a1.jsonl'), cUser(1, 'sub') + cEnd(2));
  fs.writeFileSync(path.join(proj, 'sess1', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ description: 'Explorar o código' }));
  const old = path.join(proj, 'velha.jsonl');
  fs.writeFileSync(old, cUser(0, 'antiga'));
  const past = new Date(Date.now() - 5 * 24 * 3600e3);
  fs.utimesSync(old, past, past);
  return { home, main, base: path.join(home, 'projects') };
}

const mkSvc = (base, extra = {}) => createAimonService({
  providers: [{ ...claude, root: () => base, listSessions: (since) => claude.listSessions(since, base) }],
  now: () => T0 + 60_000 + (extra.dt || 0),
  windowMs: 10 * 365 * 24 * 3600e3,
  ...extra,
});

test('serviço: acha sessão e subagente, ignora o que saiu da janela', async () => {
  const { base } = claudeTree();
  const svc = createAimonService({ providers: [{ ...claude, listSessions: (since) => claude.listSessions(since, base) }], windowMs: 24 * 3600e3 });
  await svc._tick();
  const l = svc.list();
  assert.equal(l.length, 2);
  const sub = l.find((s) => s.parentId);
  assert.equal(sub.parentId, 'sess1');
  assert.equal(sub.label, 'Explorar o código');
  assert.ok(!l.some((s) => s.sessionId === 'velha'));
});

test('serviço: leitura incremental, linha cortada espera a próxima volta', async () => {
  const { base, main } = claudeTree();
  const svc = mkSvc(base);
  await svc._tick();
  const key = 'claude:sess1';
  assert.equal(svc.timeline(key).total, 2); // prompt + tool_use (usage e título não entram na timeline)
  const before = svc.timeline(key).total;
  const line = cResult(2, 'tu1', 'resultado');
  fs.appendFileSync(main, line.slice(0, 40)); // metade da linha
  await svc._tick();
  assert.equal(svc.timeline(key).total, before);
  fs.appendFileSync(main, line.slice(40));
  await svc._tick();
  assert.equal(svc.timeline(key).total, before + 1);
  assert.equal(svc.list().find((s) => s.key === key).pending, 0);
});

test('serviço: arquivo truncado é relido do começo', async () => {
  const { base, main } = claudeTree();
  const svc = mkSvc(base);
  await svc._tick();
  fs.writeFileSync(main, cUser(0, 'recomeço'));
  await svc._tick();
  const t = svc.timeline('claude:sess1');
  assert.equal(t.events.length, 1);
  assert.equal(t.events[0].summary, 'recomeço');
});

test('serviço: lixo no arquivo e adaptador que lança não derrubam o monitor', async () => {
  const { base, main } = claudeTree();
  fs.appendFileSync(main, 'lixo\n{"type":"xyz"}\n');
  const bad = { id: 'ruim', name: 'Ruim', icon: 'x', root: () => base, listSessions: async () => [{ provider: 'ruim', sessionId: 's', file: main, project: null, mtime: Date.now(), parentId: null }], parseLine() { throw new Error('boom'); } };
  const svc = createAimonService({ providers: [{ ...claude, listSessions: (since) => claude.listSessions(since, base) }, bad], windowMs: 10 * 365 * 24 * 3600e3 });
  await svc._tick();
  assert.ok(svc.list().length >= 3);
});

test('serviço: provedor ausente aparece como não instalado', async () => {
  const svc = createAimonService({ providers: [{ ...claude, root: () => path.join(tmp(), 'nao-existe'), listSessions: async () => [] }] });
  const [p] = await svc.providers();
  assert.equal(p.installed, false);
  assert.deepEqual(svc.list(), []);
});

test('serviço: setActive liga e desliga o relógio', async () => {
  const { base } = claudeTree();
  const events = [];
  const svc = createAimonService({ providers: [{ ...claude, listSessions: (since) => claude.listSessions(since, base) }], broadcast: (e) => events.push(e), pollMs: 20, windowMs: 10 * 365 * 24 * 3600e3 });
  assert.equal(svc.setActive(true), true);
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(svc.setActive(false), false);
  assert.ok(events.length >= 1);
  const n = events.length;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(events.length, n);
});

/* ─────────────── Raias ─────────────── */
const lanes = require('../electron/aimon/lanes.js');
const E = (s, kind, extra = {}) => ({ ts: T0 + s * 1000, kind, ...extra });
const S = (a, b, state) => ({ from: T0 + a * 1000, to: T0 + b * 1000, state });
const plain = (segs) => segs.map(({ from, to, state }) => ({ from, to, state }));

test('raias: turno simples vira um bloco; o ocioso é o vazio', () => {
  const segs = lanes.segments([E(0, 'prompt'), E(5, 'text'), E(10, 'turn_end'), E(100, 'prompt'), E(110, 'turn_end')], T0 + 200_000);
  assert.deepEqual(plain(segs), [S(0, 10, 'working'), S(100, 110, 'working')]);
});

test('raias: ferramenta sem resultado vira esperando e volta a trabalhar', () => {
  const segs = lanes.segments([E(0, 'prompt'), E(2, 'tool_use', { ref: 'a', tool: 'Bash' }), E(62, 'tool_result', { ref: 'a' }), E(65, 'turn_end')], T0 + 100_000);
  assert.deepEqual(plain(segs), [S(0, 2 + state.WAIT_MS / 1000, 'working'), S(2 + state.WAIT_MS / 1000, 62, 'waiting'), S(62, 65, 'working')]);
  assert.equal(segs[0].tool, 'Bash');
});

test('raias: turno aberto até agora; esperando se há ferramenta pendente', () => {
  const now = T0 + 120_000;
  assert.deepEqual(plain(lanes.segments([E(0, 'prompt'), E(100, 'text')], now)), [S(0, 120, 'working')]);
  assert.deepEqual(plain(lanes.segments([E(0, 'prompt'), E(100, 'tool_use', { ref: 'a', tool: 'Edit' })], now)), [S(0, 100 + state.WAIT_MS / 1000, 'working'), S(100 + state.WAIT_MS / 1000, 120, 'waiting')]);
});

test('raias: turno sem sinal por STALE_MS é dado como encerrado, não estica até agora', () => {
  const stale = state.STALE_MS / 1000;
  const segs = lanes.segments([E(0, 'prompt'), E(10, 'text')], T0 + (10 + stale * 3) * 1000);
  assert.deepEqual(plain(segs), [S(0, 10, 'working')]);
  const waiting = lanes.segments([E(0, 'prompt'), E(10, 'tool_use', { ref: 'a' })], T0 + (10 + stale * 3) * 1000);
  assert.equal(waiting[waiting.length - 1].to, T0 + (10 + stale) * 1000);
  assert.equal(waiting[waiting.length - 1].state, 'waiting');
});

test('raias: recorta na janela, funde vizinhos e aceita eventos fora de ordem e lixo', () => {
  const evs = [E(10, 'turn_end'), E(0, 'prompt'), { ts: NaN, kind: 'prompt' }, null, E(3, 'text')];
  assert.deepEqual(plain(lanes.segments(evs, T0 + 60_000, { from: T0 + 4000 })), [S(4, 10, 'working')]);
  assert.deepEqual(lanes.segments([], T0), []);
  assert.deepEqual(lanes.segments(undefined, T0), []);
});

test('raias: indicadores — espera somada, pico e agora', () => {
  const now = T0 + 100_000;
  const l = (...segs) => ({ segments: segs });
  const st = lanes.stats([l(S(0, 50, 'working'), S(50, 80, 'waiting')), l(S(40, 100, 'working')), l(S(80, 90, 'working'))], now);
  assert.equal(st.waitingMs, 30_000);
  assert.equal(st.peak, 2);
  assert.equal(st.active, 1);
  assert.equal(lanes.stats([l(S(0, 10, 'working'), S(10, 20, 'working'))], now).peak, 1); // encostados, não paralelos
});

test('serviço: lanes() traz subagente com parentId e ignora quem não tem atividade na janela', async () => {
  const { base } = claudeTree();
  const svc = mkSvc(base);
  await svc._tick();
  const r = svc.lanes({ since: T0 - 3600e3 });
  const sub = r.lanes.find((x) => x.parentId);
  assert.equal(sub.parentId, 'sess1');
  assert.ok(r.lanes.every((x) => x.segments.length > 0));
  assert.equal(svc.lanes({ since: T0 + 3600e3 }).lanes.length, 0); // nada ativo depois de `since`
  assert.equal(svc.lanes({ provider: 'codex', since: 0 }).lanes.length, 0);
  assert.ok(r.stats.peak >= 1);
});

/* ─────────────── Planos ─────────────── */
const plansMod = require('../electron/aimon/plans.js');
const PLAN = '# Monitor de IA\n\n## Context\nTexto do plano com `código` e [[link]].\n';
const pUse = (id, plan = PLAN, s = 0, type = 'assistant') => j({ type, timestamp: iso(s), cwd: 'C:\\x\\proj', gitBranch: 'main', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'ExitPlanMode', input: { plan, planFilePath: 'C:\\p.md' } }] } });
const pOk = (id, s = 1, edited) => j({ type: 'user', timestamp: iso(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'User has approved your plan. You can now start coding.' }] }, ...(edited ? { toolUseResult: { plan: edited, isAgent: false } } : {}) });
const pNo = (id, reason, s = 1) => j({ type: 'user', timestamp: iso(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.\nTo tell you how to proceed, the user said:\n" + reason }] }, toolUseResult: 'Error: rejected' });
const title = (t) => j({ type: 'ai-title', aiTitle: t, sessionId: 's' });

test('planos: aprovado, recusado com motivo, sem resposta e título da sessão', () => {
  const { plans, sessionTitle } = plansMod.extractPlans(title('Antigo') + pUse('a') + pOk('a') + pUse('b', '# Outro\nx') + pNo('b', 'faz mais genérico') + pUse('c', '# Sem resposta\ny', 5) + title('Monitor'));
  assert.equal(sessionTitle, 'Monitor');
  assert.deepEqual(plans.map((p) => [p.id, p.status]), [['a', 'approved'], ['b', 'rejected'], ['c', 'pending']]);
  assert.equal(plans[0].title, 'Monitor de IA');
  assert.equal(plans[1].reason, 'faz mais genérico');
  const noted = plansMod.extractPlans(pUse('n') + pNo('n', "quero outro\n\nNote: The user's next message may contain a correction or preference.")).plans[0];
  assert.equal(noted.reason, 'quero outro'); // a nota do harness não entra no motivo
  assert.equal(plans[0].cwd, 'C:\\x\\proj');
  assert.equal(plans[0].planFile, 'C:\\p.md');
});

test('planos: cópia em api-request-blob não conta em dobro; plano editado pelo usuário vale o final', () => {
  const { plans } = plansMod.extractPlans(pUse('a') + pUse('a', PLAN, 0, 'api-request-blob') + pUse('a') + pOk('a', 1, '# Editado\nnovo'));
  assert.equal(plans.length, 1);
  assert.equal(plans[0].title, 'Editado');
  assert.equal(plans[0].plan, '# Editado\nnovo');
});

test('planos: linha inválida, tipo desconhecido e texto vazio não viram erro', () => {
  for (const t of ['', null, undefined, 'lixo ExitPlanMode', '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"ExitPlanMode"}]}}', '{"type":"x"}\n{']) assert.deepEqual(plansMod.extractPlans(t).plans, []);
});

test('planos: resposta de outro pedido é sinalizada para a leitura incremental', () => {
  const { plans } = plansMod.extractPlans(pOk('zzz'));
  assert.deepEqual(plans.map((p) => [p.id, p.resultOnly, p.status]), [['zzz', true, 'approved']]);
});

function plansEnv() {
  const dir = tmp();
  const proj = path.join(dir, 'C--x-proj');
  fs.mkdirSync(proj, { recursive: true });
  const t1 = path.join(proj, 's1.jsonl');
  const t2 = path.join(proj, 's2.jsonl');
  fs.writeFileSync(t1, title('Sessão 1') + pUse('a') + pOk('a'));
  fs.writeFileSync(t2, pUse('b', '# Recusado\nz') + pNo('b', 'não'));
  const listFiles = async () => (await Promise.all([t1, t2].filter((f) => fs.existsSync(f)).map(async (f) => { const st = fs.statSync(f); return { file: f, sessionId: path.basename(f, '.jsonl'), project: 'C--x-proj', size: st.size, mtime: st.mtimeMs }; })));
  let reads = 0;
  const readChunk = async (f, from) => { reads++; const b = fs.readFileSync(f); return b.subarray(from).toString('utf8'); };
  const mk = () => plansMod.createPlansArchive({ file: path.join(dir, 'aimon-plans.json'), listFiles, readChunk });
  return { dir, t1, t2, mk, reads: () => reads };
}

test('arquivo de planos: varre, não relê o que não mudou, lê só o que cresceu', async () => {
  const env = plansEnv();
  const a = env.mk(); await a.init();
  assert.equal(await a.scan(), true);
  assert.deepEqual(a.list().map((p) => p.id).sort(), ['a', 'b']);
  assert.deepEqual(a.list({ status: 'rejected' }).map((p) => p.id), ['b']);
  const n = env.reads();
  assert.equal(await a.scan(), false);
  assert.equal(env.reads(), n); // nada mudou: nem leu
  fs.appendFileSync(env.t1, pUse('c', '# Novo\nw', 9));
  await a.scan();
  assert.equal(a.get('c').status, 'pending');
  assert.deepEqual(a.list({ status: 'pending' }).map((p) => p.id), ['c']); // o filtro "Sem resposta" da aba
  fs.appendFileSync(env.t1, pOk('c', 10));
  await a.scan();
  assert.equal(a.get('c').status, 'approved'); // a resposta chegou num trecho depois do pedido
  assert.deepEqual(a.list({ status: 'pending' }), []); // e o mesmo plano sai de "Sem resposta" (sem duplicar)
  assert.equal(a.list().filter((p) => p.id === 'c').length, 1);
  assert.equal(a.get('a').sessionTitle, 'Sessão 1');
});

test('arquivo de planos: transcript apagado vira órfão e o plano continua; sobrevive a reinício; busca e esquecer', async () => {
  const env = plansEnv();
  let a = env.mk(); await a.init(); await a.scan(); await a.flush();
  fs.unlinkSync(env.t2);
  await a.scan(); await a.flush();
  a = env.mk(); await a.init(); // outro processo
  const b = a.get('b');
  assert.equal(b.orphan, true);
  assert.match(b.plan, /Recusado/);
  assert.deepEqual(a.list({ q: 'monitor de ia' }).map((p) => p.id), ['a']);
  assert.deepEqual(a.list({ q: 'não' }).map((p) => p.id), ['b']); // procura também no motivo
  await a.forget('b');
  assert.equal(a.get('b'), null);
  await a.scan();
  assert.equal(a.get('b'), null); // esquecido não volta sozinho
  await a.clear();
  assert.deepEqual(a.list(), []);
  await a.flush();
});

/* ─────────────── Resumo dos subagentes ─────────────── */
const agents = require('../src/tools/aimon/agents.js');
const K = (status, tools, out, lastTs = 0) => ({ status, tools, tokens: { input: 1, output: out, cacheRead: 0, cacheWrite: 0 }, lastTs });

test('subagentes: totais e texto do resumo', () => {
  const sum = agents.summarizeAgents([K('working', 5, 10, 100), K('idle', 3, 20, 300), K('stale', 2, 5, 200), K('waiting', 1, 1, 50), null]);
  assert.deepEqual(sum, { n: 4, working: 1, waiting: 1, error: 0, idle: 2, tools: 11, tokens: 40, lastTs: 300 });
  assert.deepEqual(agents.agentParts(sum), ['4 agentes', '1 trabalhando', '1 esperando']);
  assert.deepEqual(agents.agentParts(agents.summarizeAgents([K('idle', 1, 1), K('idle', 1, 1)])), ['2 agentes', 'todos concluídos']);
  assert.deepEqual(agents.agentParts(agents.summarizeAgents([K('idle', 1, 1)])), ['1 agente', 'concluído']);
  assert.deepEqual(agents.agentParts(agents.summarizeAgents([])), []);
  assert.deepEqual(agents.agentParts(agents.summarizeAgents(undefined)), []);
});

test('subagentes: grupo recolhido por padrão só quando tudo terminou; a escolha da pessoa sempre vale', () => {
  const idle = agents.summarizeAgents([K('idle', 1, 1), K('stale', 1, 1)]);
  const live = agents.summarizeAgents([K('idle', 1, 1), K('working', 1, 1)]);
  const wait = agents.summarizeAgents([K('waiting', 1, 1)]);
  assert.equal(agents.isCollapsed(idle, {}, 'a'), true);
  assert.equal(agents.isCollapsed(live, {}, 'a'), false);
  assert.equal(agents.isCollapsed(wait, undefined, 'a'), false);
  assert.equal(agents.isCollapsed(idle, { a: false }, 'a'), false); // abriu à mão
  assert.equal(agents.isCollapsed(live, { a: true }, 'a'), true); // recolheu à mão, mesmo com agente ativo
  assert.equal(agents.isCollapsed(idle, { outra: false }, 'a'), true); // escolha de outra sessão não vale aqui
  assert.equal(agents.isCollapsed(null, {}, 'a'), false); // sem subagentes não há o que recolher
  assert.equal(agents.isCollapsed(agents.summarizeAgents([]), { a: true }, 'a'), false);
});
