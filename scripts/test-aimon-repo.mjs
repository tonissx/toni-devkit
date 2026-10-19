// Testes da ligação sessão ↔ repositório do Monitor de IA (serviço + preferências), com git de verdade:
// node --test scripts/test-aimon-repo.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const claude = require('../electron/aimon/providers/claude.js');
const { createAimonService } = require('../electron/aimon/service.js');
const { createPrefs } = require('../electron/aimon/prefs.js');

const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-aimon-repo-')));
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (o) => JSON.stringify(o) + '\n';

function mkRepo() {
  const dir = tmp();
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'um\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'inicial');
  return dir;
}
/** Transcript de uma sessão "trabalhando agora" (ferramenta sem resultado) cujo cwd é `cwd`. */
function session(base, id, cwd, parent) {
  const dir = parent ? path.join(base, 'proj', parent, 'subagents') : path.join(base, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString();
  fs.writeFileSync(path.join(dir, (parent ? 'agent-' : '') + id + '.jsonl'),
    j({ type: 'user', timestamp: ts, cwd, gitBranch: 'main', message: { role: 'user', content: 'faz' } })
    + j({ type: 'assistant', timestamp: ts, message: { model: 'm', content: [{ type: 'tool_use', id: 't' + id, name: 'Bash', input: { command: 'ls' } }] } }));
}
const mk = (base) => createAimonService({ providers: [{ ...claude, listSessions: (since) => claude.listSessions(since, base) }], pollMs: 30, windowMs: 3600e3 });
const waitFor = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(40); } return fn(); };

test('serviço: a sessão sabe o repositório e o worktree; repoActivity agrupa pelo repo principal', async () => {
  const repo = mkRepo();
  const wt = path.join(repo, '.claude', 'worktrees', 'agente-1');
  sh(repo, 'worktree', 'add', '-q', '-b', 'feat', wt);
  const base = tmp();
  session(base, 'main1', repo);
  session(base, 'a1', wt, 'main1');
  const svc = mk(base);
  svc.setActive(true);
  try {
    const rows = await waitFor(() => { const l = svc.list(); return l.length === 2 && l.every((r) => r.repo) ? l : null; });
    assert.ok(rows, 'as duas sessões resolveram o repositório');
    const root = rows.find((r) => !r.parentId);
    const sub = rows.find((r) => r.parentId);
    assert.equal(root.repo.name, path.basename(repo));
    assert.equal(root.repo.worktree, null);
    assert.equal(sub.repo.worktree, 'agente-1');
    assert.equal(path.normalize(sub.repo.main).toLowerCase(), path.normalize(repo).toLowerCase()); // subagente em worktree conta no repo principal
    const act = svc.repoActivity();
    const entry = Object.values(act)[0];
    assert.equal(Object.keys(act).length, 1);
    assert.equal(entry.active, 1);
    assert.equal(entry.agents, 1);
    assert.equal(Object.keys(entry.worktrees).length, 1);
  } finally { svc.stop(); }
});

test('serviço: sem acompanhamento ligado, repoActivity é vazio e consultar não liga nada', async () => {
  const repo = mkRepo();
  const base = tmp();
  session(base, 'x', repo);
  const svc = mk(base);
  assert.deepEqual(svc.repoActivity(), {});
  assert.equal(svc._tracked.size, 0); // nada foi lido
  svc.setActive(true);
  await waitFor(() => svc.list().length === 1 && svc.list()[0].repo); // o repositório é descoberto em segundo plano
  assert.equal(Object.keys(svc.repoActivity()).length, 1);
  svc.setActive(false);
  assert.deepEqual(svc.repoActivity(), {}); // fechou: o que está em memória é velho e não é mostrado
  svc.stop();
});

test('serviço: pasta fora de repositório ou apagada não gera repo nem erro', async () => {
  const base = tmp();
  session(base, 'a', tmp());
  session(base, 'b', path.join(tmp(), 'nao-existe'));
  const svc = mk(base);
  svc.setActive(true);
  try {
    await waitFor(() => svc.list().length === 2);
    await sleep(300);
    assert.ok(svc.list().every((r) => r.repo === null));
    assert.deepEqual(svc.repoActivity(), {});
  } finally { svc.stop(); }
});

test('preferências: segundo plano e avisos são desligados por padrão e persistem', async () => {
  const file = path.join(tmp(), 'aimon.json');
  let p = createPrefs({ file });
  assert.deepEqual(await p.init(), { background: false, notify: false, prices: {}, limitTokens: null, autoReview: false });
  assert.equal(await p.setBackground(true), true);
  assert.equal(await p.setNotify(true), true);
  assert.equal(await p.setLimit(2_500_000.4), 2_500_000);
  assert.equal(await p.setAutoReview(true), true);
  assert.deepEqual(await p.setPrices({ 'meu-modelo': { input: 2, output: 8 }, ruim: { input: -1, output: 3 }, texto: 'x' }), { 'meu-modelo': { input: 2, output: 8 } });
  await p.flush();
  p = createPrefs({ file });
  assert.deepEqual(await p.init(), { background: true, notify: true, prices: { 'meu-modelo': { input: 2, output: 8 } }, limitTokens: 2_500_000, autoReview: true });
  assert.equal(await p.setLimit('lixo'), null);   // limite inválido volta a "estimado"
  assert.equal(await p.setLimit(-5), null);
  fs.writeFileSync(file, 'lixo');
  p = createPrefs({ file });
  assert.deepEqual(await p.init(), { background: false, notify: false, prices: {}, limitTokens: null, autoReview: false }); // arquivo estragado volta ao padrão
});

test('garantia: a ferramenta Git só consulta o Monitor de IA — nunca liga o acompanhamento', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  for (const f of ['src/tools/git/GitScreen.jsx', 'src/tools/git/Maintenance.jsx']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/setActive|setBackground|plansScan|planForget|plansClear|gitChanges|gitDiff/.test(src), f + ' não pode ligar o acompanhamento nem escrever nada');
  }
  // E o electron/git inteiro continua sem saber que o monitor existe.
  for (const f of fs.readdirSync(path.join(root, 'electron/git'))) assert.ok(!/aimon/i.test(fs.readFileSync(path.join(root, 'electron/git', f), 'utf8')), 'electron/git/' + f);
});
