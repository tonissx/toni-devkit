// Testes dos recursos de IA do Monitor de IA (tarefas, entradas e garantias de privacidade): node --test scripts/test-aimon-ai.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { TASKS } = require('../src/ai/tasks.js');
const { sessionDigest } = require('../src/tools/aimon/aiInput.js');
const { createGitInfo } = require('../electron/aimon/gitinfo.js');

const EMAIL = 'ana.silva@empresa.com.br';
const CPF = '123.456.789-09';
const patch = (file, add) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1,2 @@\n a\n+${add}\n`;

/* ─────────────── tarefas ─────────────── */

test('resumo: usa os dados da sessão, mascara segredos e mantém o que importa', () => {
  const r = TASKS.aimonSummary.build({ title: 'Monitor', project: 'devkit', branch: 'ai-monitor', status: 'idle',
    prompts: [`mande para ${EMAIL} o cpf ${CPF}`, 'agora o segundo pedido'], answers: ['feito'], tools: { Bash: 12, Edit: 4 }, files: ['src/a.js'], commits: [{ hash: 'abc1234567', subject: 'feat: x' }] });
  assert.doesNotMatch(r.user, /ana\.silva@empresa|123\.456\.789-09/);
  assert.match(r.user, /1\. mande para/);
  assert.match(r.user, /2\. agora o segundo pedido/);
  assert.match(r.user, /Bash ×12, Edit ×4/);
  assert.match(r.user, /Arquivos editados: src\/a\.js/);
  assert.match(r.user, /abc1234 feat: x/);
  assert.match(r.system, /SOMENTE os dados fornecidos/);
});

test('resumo e briefing: respeitam os tetos (12 pedidos de 400 caracteres, 3 respostas)', () => {
  const prompts = Array.from({ length: 30 }, (_, n) => `pedido ${n + 1} ` + 'x'.repeat(900));
  const r = TASKS.aimonSummary.build({ prompts, answers: ['a1', 'a2', 'a3', 'a4', 'a5'] });
  assert.match(r.user, /12\. pedido 12/);
  assert.doesNotMatch(r.user, /13\. pedido 13/);
  assert.ok(r.user.split('\n').every((l) => l.length < 600));
  assert.doesNotMatch(r.user, /- a1\b|- a2\b/);
  assert.match(r.user, /- a5\b/);
  assert.ok(TASKS.aimonBrief.build({ prompts }).user.length < 9000);
});

test('revisão: entra só o diff (sem segredos), arquivos de segredo e binários só pelo nome', () => {
  const diff = patch('src/a.js', `const dono = '${EMAIL}'; // cpf ${CPF}`) + 'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n';
  const r = TASKS.aimonReview.build({ diff, goal: `corrigir o login de ${EMAIL}`, branch: 'fix/x' });
  assert.doesNotMatch(r.user, /ana\.silva@empresa|123\.456\.789-09/);
  assert.match(r.user, /Objetivo do pedido: corrigir o login/);
  assert.match(r.user, /Branch: fix\/x/);
  assert.deepEqual(r.files, ['src/a.js', 'logo.png']);
  assert.deepEqual(r.omitted, ['logo.png']); // binário: só o nome vai na confirmação
  assert.doesNotMatch(r.user, /Binary files/);
  assert.equal(TASKS.aimonReview.cloudHint, true);
});

test('briefing: junta resumo, alterações pendentes e último plano', () => {
  const r = TASKS.aimonBrief.build({ title: 'Monitor', prompts: ['faz X'], answers: ['quase'], changes: [{ kind: 'modified', path: 'src/a.js' }, { kind: 'untracked', path: 'novo.txt' }], lastPlan: '# Plano\n- passo 1' });
  assert.match(r.user, /Alterações ainda não comitadas:\n- modified src\/a\.js\n- untracked novo\.txt/);
  assert.match(r.user, /Último plano aprovado:\n# Plano/);
  assert.match(r.system, /Objetivo, Já feito, Falta fazer, Arquivos tocados, Cuidados/);
});

test('entradas vazias viram erro em português, sem montar pedido', () => {
  assert.throws(() => TASKS.aimonSummary.build({}), /ainda não tem conteúdo/);
  assert.throws(() => TASKS.aimonSummary.build({ title: 'só título' }), /ainda não tem conteúdo/);
  assert.throws(() => TASKS.aimonBrief.build({ prompts: [] }), /ainda não tem conteúdo/);
  assert.throws(() => TASKS.aimonReview.build({ diff: '' }), /Não há alterações/);
  assert.throws(() => TASKS.aimonReview.build({ diff: 'texto sem diff' }), /Não há alterações/);
  for (const bad of [null, undefined, 42, 'x']) assert.throws(() => TASKS.aimonSummary.build(bad === null || bad === undefined ? {} : { prompts: bad }), /ainda não tem conteúdo/);
});

/* ─────────────── digest da sessão (no renderer) ─────────────── */

const E = (kind, extra = {}) => ({ ts: 1, kind, ...extra });

test('digest: pedidos, respostas, ferramentas, arquivos únicos e commits', () => {
  const events = [
    E('prompt', { summary: 'primeiro' }), E('prompt', { summary: '<task-notification> <task-id>x</task-id> ...' }), E('prompt', { summary: '<system-reminder> lembrete' }), E('tool_use', { tool: 'Edit', summary: 'C:\\x\\a.js' }), E('tool_use', { tool: 'Edit', summary: 'C:\\x\\a.js' }),
    E('tool_use', { tool: 'Write', summary: 'C:\\x\\b.js' }), E('tool_use', { tool: 'Bash', summary: 'ls' }), E('tool_result', { summary: 'resultado enorme que não deve entrar' }),
    E('text', { summary: 'resposta 1' }), E('commit', { hash: 'abc1234', branch: 'main', summary: 'feat: x' }), E('prompt', { summary: 'segundo' }), E('thinking', { summary: '' }), { kind: 'desconhecido' }, null,
  ];
  const d = sessionDigest({ title: 'T', status: 'idle', repo: { name: 'devkit', branch: 'main' }, cwd: 'C:\\x' }, events);
  assert.deepEqual(d.prompts, ['primeiro', 'segundo']);
  assert.deepEqual(d.answers, ['resposta 1']);
  assert.deepEqual(d.tools, { Edit: 2, Write: 1, Bash: 1 });
  assert.deepEqual(d.files, ['C:\\x\\a.js', 'C:\\x\\b.js']);
  assert.deepEqual(d.commits, [{ hash: 'abc1234', branch: 'main', subject: 'feat: x' }]);
  assert.equal(d.project, 'devkit');
  assert.ok(!JSON.stringify(d).includes('resultado enorme'));
  assert.deepEqual(sessionDigest({}, null).prompts, []);
});

/* ─────────────── entrada do Git para a IA ─────────────── */

const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'tk-aimon-ai-')));
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function mkRepo() {
  const dir = tmp();
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'um\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'feat: inicial');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'dois\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-q', '-m', 'fix: segundo');
  return dir;
}

test('aiInput: diff de tudo que não foi comitado, com arquivos novos no formato que prepareDiff entende', async () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\nmudou\n');
  fs.writeFileSync(path.join(repo, 'novo.js'), 'const x = 1;\n');
  fs.writeFileSync(path.join(repo, '.env'), 'SEGREDO=abc\n');
  fs.writeFileSync(path.join(repo, 'chave.pem'), 'PRIVATE\n');
  fs.writeFileSync(path.join(repo, 'foto.bin'), Buffer.from([0, 1, 2, 0]));
  const r = await createGitInfo().aiInput(repo);
  assert.equal(r.branch, 'main');
  assert.deepEqual(r.recent, ['fix: segundo', 'feat: inicial']);
  assert.match(r.diff, /diff --git a\/a\.txt b\/a\.txt/);
  assert.match(r.diff, /\+mudou/);
  assert.match(r.diff, /diff --git a\/novo\.js b\/novo\.js[\s\S]*\+const x = 1;/);
  assert.doesNotMatch(r.diff, /SEGREDO|PRIVATE/);
  assert.deepEqual(r.omitted.map((o) => o.path).sort(), ['.env', 'chave.pem', 'foto.bin']);
  // A entrada é aceita pelas tarefas existentes, sem mudar nenhuma delas.
  const commit = TASKS.commitMessage.build({ diff: r.diff, recent: r.recent, branch: r.branch });
  assert.ok(commit.files.includes('a.txt') && commit.files.includes('novo.js'));
  assert.match(commit.user, /fix: segundo/);
  assert.ok(TASKS.aimonReview.build({ diff: r.diff }).files.includes('novo.js'));
});

test('aiInput: sem alterações o diff é vazio; pasta fora de repositório não dá erro', async () => {
  const repo = mkRepo();
  const gi = createGitInfo();
  assert.equal((await gi.aiInput(repo)).diff, '');
  assert.deepEqual(await gi.aiInput(tmp()), { diff: '', recent: [], branch: null, files: [], omitted: [] });
  assert.deepEqual(await gi.aiInput(path.join(repo, 'nao-existe')), { diff: '', recent: [], branch: null, files: [], omitted: [] });
});

test('garantia: nenhum recurso de IA do monitor escreve no Git ou comita', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  for (const f of ['src/tools/aimon/SessionAi.jsx', 'src/tools/aimon/aiInput.js', 'src/ai/tasks-aimon.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/git\.exec|\.exec\(|commit\(|execFile|child_process|writeFile/.test(src), f + ' não pode escrever no repositório');
  }
  const gi = fs.readFileSync(path.join(root, 'electron/aimon/gitinfo.js'), 'utf8');
  for (const verb of ['commit', 'add', 'checkout', 'reset', 'push', 'stash', 'merge', 'rebase']) assert.ok(!new RegExp(`\\['${verb}'`).test(gi), 'gitinfo não pode rodar git ' + verb);
});

test('sessão muito longa (lida só pelo final): o pedido avisa a IA para não inventar o começo', () => {
  assert.equal(sessionDigest({ partial: true }, []).partial, true);
  assert.equal(sessionDigest({}, []).partial, false);
  const r = TASKS.aimonSummary.build({ partial: true, prompts: ['faz X'] });
  assert.match(r.user, /só o final dela foi lido/);
  assert.doesNotMatch(TASKS.aimonSummary.build({ prompts: ['faz X'] }).user, /só o final dela foi lido/);
});
