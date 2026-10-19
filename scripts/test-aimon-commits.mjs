// Testes dos commits feitos pela sessão (a partir do transcript): node --test scripts/test-aimon-commits.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const commits = require('../electron/aimon/commits.js');
const claude = require('../electron/aimon/providers/claude.js');

const T = '2026-10-19T12:00:00.000Z';
const use = (id, command, name = 'Bash', type = 'assistant') => ({ type, timestamp: T, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input: { command } }] } });
const res = (id, content) => ({ type: 'user', timestamp: T, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const line = (o) => JSON.stringify(o);

test('commits: reconhece git commit e não reconhece comandos parecidos', () => {
  for (const ok of ['git commit -m "x"', 'git add . && git commit -m x', 'git -C /tmp/r commit -m x', 'git -c user.name=a commit -m x', 'cd r; git commit --amend --no-edit', 'git commit']) assert.equal(commits.isGitCommitUse({ command: ok }), true, ok);
  for (const no of ['git status', 'git log --grep=commit', 'git commit-tree abc', 'gitcommit', 'git push origin main', '', undefined, null]) assert.equal(commits.isGitCommitUse({ command: no }), false, String(no));
});

test('commits: lê a linha que o git imprime (comum, root-commit, detached, vários, com ruído)', () => {
  assert.deepEqual(commits.parseCommitResult('[main abc1234] DevCore: modo performance\n 2 files changed, 5 insertions(+)'), [{ branch: 'main', hash: 'abc1234', subject: 'DevCore: modo performance' }]);
  assert.deepEqual(commits.parseCommitResult('[feat/x (root-commit) 0123456789abcdef0123456789abcdef01234567] primeiro'), [{ branch: 'feat/x', hash: '0123456789abcdef0123456789abcdef01234567', subject: 'primeiro' }]);
  assert.equal(commits.parseCommitResult('[detached HEAD 9f8e7d6] solto')[0].branch, 'detached HEAD');
  assert.equal(commits.parseCommitResult('hook: lint ok\n[main aaaaaaa] um\n[main bbbbbbb] dois').length, 2);
  for (const none of ['', null, undefined, 'nothing to commit, working tree clean', 'error: pathspec', '[main] sem hash', 'texto [main abc1234] no meio da linha']) assert.deepEqual(commits.parseCommitResult(none), []);
});

test('rastreador: pedido e resposta em linhas separadas; ignora comando que não é commit, cópia e id desconhecido', () => {
  const t = commits.createCommitTracker();
  assert.deepEqual(t.feed(use('a', 'git commit -m x')), []);
  assert.deepEqual(t.pending(), ['a']);
  assert.deepEqual(t.feed(res('a', '[main abc1234] feito')), [{ ts: Date.parse(T), branch: 'main', hash: 'abc1234', subject: 'feito' }]);
  assert.deepEqual(t.pending(), []);
  assert.deepEqual(t.feed(use('b', 'git status')), []);
  assert.deepEqual(t.feed(res('b', '[main abc1234] não é commit')), []);
  assert.deepEqual(t.feed(use('c', 'git commit -m x', 'Bash', 'api-request-blob')), []); // cópia do pedido
  assert.deepEqual(t.pending(), []);
  assert.deepEqual(t.feed(res('zzz', '[main abc1234] id desconhecido')), []);
  assert.deepEqual(t.feed(use('d', 'git commit -m x', 'Read')), []); // só ferramentas de shell
  for (const junk of [null, undefined, 1, 'x', {}, { type: 'user' }, { type: 'assistant', message: { content: 'texto' } }]) assert.deepEqual(t.feed(junk), []);
});

test('rastreador: commit que falhou não vira commit; pendência volta de um trecho anterior', () => {
  const t = commits.createCommitTracker();
  t.feed(use('a', 'git commit -m x'));
  assert.deepEqual(t.feed(res('a', 'nothing to commit, working tree clean')), []);
  t.feed(use('b', 'git commit -m y'));
  const t2 = commits.createCommitTracker(t.pending()); // próximo trecho do arquivo
  assert.equal(t2.feed(res('b', '[main fedcba9] y'))[0].hash, 'fedcba9');
  const many = commits.createCommitTracker();
  for (let i = 0; i < 80; i++) many.feed(use('id' + i, 'git commit -m x'));
  assert.ok(many.pending().length <= 50);
});

test('adaptador Claude: emite o evento commit com a mensagem, depois da resposta', () => {
  const ctx = {};
  const evs = [use('a', 'git commit -m "feat: x"'), res('a', '[main abc1234] feat: x\n 1 file changed')].flatMap((o) => claude.parseLine(line(o), ctx));
  const c = evs.filter((e) => e.kind === 'commit');
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].hash, c[0].branch, c[0].summary], ['abc1234', 'main', 'feat: x']);
  assert.ok(evs.some((e) => e.kind === 'tool_result')); // a timeline de sempre continua igual
});

/* ─────────────── commits nos planos ─────────────── */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const plansMod = require('../electron/aimon/plans.js');
const iso = (m) => new Date(Date.parse(T) + m * 60_000).toISOString();
const jl = (o) => JSON.stringify(o) + '\n';
const planUse = (id, m, plan) => jl({ type: 'assistant', timestamp: iso(m), cwd: '/x/proj', message: { content: [{ type: 'tool_use', id, name: 'ExitPlanMode', input: { plan, planFilePath: 'p.md' } }] } });
const planOk = (id, m) => jl({ type: 'user', timestamp: iso(m), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'User has approved your plan.' }] } });
const sh = (id, m, cmd) => jl({ ...use(id, cmd), timestamp: iso(m) });
const shRes = (id, m, out) => jl({ ...res(id, out), timestamp: iso(m) });

function env(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-aimon-cm-'));
  const paths = {};
  for (const [name, text] of Object.entries(files)) { paths[name] = path.join(dir, name); fs.writeFileSync(paths[name], text); }
  const list = (extra = {}) => Object.entries(paths).map(([name, file]) => { const st = fs.statSync(file); return { file, sessionId: name.replace('.jsonl', ''), parentId: extra[name] || null, size: st.size, mtime: st.mtimeMs, project: 'p' }; });
  const mk = () => plansMod.createPlansArchive({ file: path.join(dir, 'a.json'), listFiles: async () => list(env.extra) });
  return { dir, paths, mk };
}
env.extra = {};

test('planos: commits da sessão depois do plano aprovado e antes do próximo', async () => {
  const e = env({ 's1.jsonl':
    sh('c0', 0, 'git commit -m antes') + shRes('c0', 0, '[main 0000000] antes')
    + planUse('p1', 1, '# Plano 1\nx') + planOk('p1', 2)
    + sh('c1', 3, 'git commit -m um') + shRes('c1', 3, '[main 1111111] um')
    + planUse('p2', 10, '# Plano 2\ny') + planOk('p2', 11)
    + sh('c2', 12, 'git commit -m dois') + shRes('c2', 12, '[main 2222222] dois') });
  const a = e.mk(); await a.init(); await a.scan();
  assert.deepEqual(a.get('p1').commits.map((c) => c.hash), ['1111111']); // o de antes do plano e o do plano seguinte ficam de fora
  assert.deepEqual(a.get('p2').commits.map((c) => c.hash), ['2222222']);
});

test('planos: recusado não lista commits; resposta do commit em outro trecho do arquivo; subagente conta para a sessão', async () => {
  const e = env({ 's1.jsonl': planUse('p1', 1, '# P\nx') + planOk('p1', 2) + sh('c1', 3, 'git commit -m um'), 'agent-a.jsonl': sh('c9', 4, 'git commit -m sub') + shRes('c9', 4, '[w 9999999] sub') });
  env.extra = { 'agent-a.jsonl': 's1' };
  const a = e.mk(); await a.init(); await a.scan();
  assert.deepEqual(a.get('p1').commits.map((c) => c.hash), ['9999999']); // o commit de s1 ainda espera a resposta
  fs.appendFileSync(e.paths['s1.jsonl'], shRes('c1', 5, '[main 1111111] um'));
  await a.scan();
  assert.deepEqual(a.get('p1').commits.map((c) => c.hash), ['9999999', '1111111']);
  env.extra = {};
});

test('planos: arquivo guardado antes dos commits (versão 1) é relido uma vez', async () => {
  const e = env({ 's1.jsonl': planUse('p1', 1, '# P\nx') + planOk('p1', 2) + sh('c1', 3, 'git commit -m um') + shRes('c1', 3, '[main 1111111] um') });
  fs.writeFileSync(path.join(e.dir, 'a.json'), JSON.stringify({ files: { [e.paths['s1.jsonl']]: { size: fs.statSync(e.paths['s1.jsonl']).size, mtime: 0, offset: fs.statSync(e.paths['s1.jsonl']).size } }, plans: {} }));
  const a = e.mk(); await a.init(); await a.scan();
  assert.equal(a.get('p1').commits.length, 1);
});
