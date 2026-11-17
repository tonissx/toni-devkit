// Testes dos Agentes (frontmatter, permissões, pasta ~/.claude/agents e abrir o agente no terminal):
//   node --test scripts/test-agents.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createAgentStore, parseAgent, serializeAgent } = require('../electron/agents/store.js');
const form = require('../src/tools/agents/agentForm.js');
const resume = require('../electron/aimon/resume.js');
const scope = require('../src/tools/agents/agentScope.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tk-agents-'));

test('parseAgent lê o frontmatter e o corpo', () => {
  const a = parseAgent('---\nname: revisor\ndescription: Revisa código\ntools: Read, Grep\nmodel: sonnet\n---\n\nVocê revisa.\n');
  assert.equal(a.name, 'revisor');
  assert.equal(a.description, 'Revisa código');
  assert.deepEqual(a.tools, ['Read', 'Grep']);
  assert.equal(a.model, 'sonnet');
  assert.equal(a.prompt, 'Você revisa.\n');
});

test('parseAgent aceita CRLF, BOM e arquivo sem frontmatter', () => {
  const a = parseAgent('﻿---\r\nname: x\r\ndescription: "a: b"\r\n---\r\ncorpo');
  assert.equal(a.name, 'x');
  assert.equal(a.description, 'a: b');
  assert.equal(a.prompt, 'corpo');
  assert.equal(parseAgent('só texto').prompt, 'só texto');
});

test('chaves desconhecidas e blocos de várias linhas são preservados', () => {
  const src = '---\nname: x\ndescription: d\ncolor: blue\nskills:\n  - fluig\n  - totvs-rm\n---\nprompt\n';
  const a = parseAgent(src);
  assert.equal(a.extra, 'color: blue\nskills:\n  - fluig\n  - totvs-rm');
  const out = serializeAgent({ ...a, description: 'novo' });
  assert.match(out, /color: blue\nskills:\n {2}- fluig\n {2}- totvs-rm\n---/);
  assert.equal(parseAgent(out).description, 'novo');
});

test('serializar e ler de volta mantém os valores, mesmo com ":" e aspas', () => {
  const a = { name: 'a', description: 'Use quando: algo # importante', tools: ['Read', 'Edit'], model: '', extra: '', prompt: 'Linha 1\n\nLinha 2' };
  const b = parseAgent(serializeAgent(a));
  assert.equal(b.description, a.description);
  assert.deepEqual(b.tools, a.tools);
  assert.equal(b.prompt, 'Linha 1\n\nLinha 2\n');
  assert.equal(parseAgent(serializeAgent({ ...a, tools: null })).tools, null);
});

test('permissões: sem lista herda tudo; leitura, edição e comandos', () => {
  assert.equal(form.permissions(null).all, true);
  assert.equal(form.permissions(null).level, 'exec');
  assert.equal(form.permissions(form.READ).level, 'read');
  assert.equal(form.permissions(['Read', 'Edit']).level, 'edit');
  assert.equal(form.permissions(['Read', 'Bash(git:*)']).level, 'exec');
  assert.equal(form.permissions(['Read', 'mcp__x__y']).level, 'edit'); // ferramenta desconhecida não conta como leitura
  assert.equal(form.describePermissions(form.permissions(form.READ)).tone, 'ok');
  assert.equal(form.describePermissions(form.permissions(null)).tone, 'danger');
});

test('presets de permissão', () => {
  assert.equal(form.presetOf(null), 'all');
  assert.equal(form.presetOf([...form.READ].reverse()), 'read');
  assert.equal(form.presetOf(form.EDIT), 'edit');
  assert.equal(form.presetOf(['Read', 'Bash']), 'custom');
  assert.equal(form.toolsForPreset('all', ['Read']), null);
  assert.deepEqual(form.toolsForPreset('custom', ['Bash']), ['Bash']);
  assert.deepEqual(form.toolsForPreset('custom', null), form.READ);
});

test('modelos prontos são agentes válidos', async () => {
  const dir = tmp();
  const store = createAgentStore({ dir });
  for (const t of form.TEMPLATES) await store.save({ ...t.agent, name: t.agent.name || 'em-branco', description: t.agent.description || 'x' });
  assert.equal((await store.list()).length, form.TEMPLATES.length);
});

test('pasta: criar, listar, editar, renomear, duplicar e excluir', async () => {
  const dir = path.join(tmp(), 'agents'); // ainda não existe
  const store = createAgentStore({ dir });
  assert.deepEqual(await store.list(), []);

  const a = await store.save({ name: 'revisor', description: 'Revisa', tools: ['Read'], prompt: 'oi' });
  assert.equal(a.permissions.level, 'read');
  assert.ok(fs.existsSync(path.join(dir, 'revisor.md')));
  await assert.rejects(store.save({ name: 'revisor', description: 'outro' }, null), /Já existe/);

  const e = await store.save({ ...a, description: 'Revisa mais', tools: null }, 'revisor');
  assert.equal(e.description, 'Revisa mais');
  assert.equal(e.permissions.all, true);

  const r = await store.save({ ...e, name: 'revisor-fluig' }, 'revisor');
  assert.equal(r.name, 'revisor-fluig');
  assert.ok(!fs.existsSync(path.join(dir, 'revisor.md')));

  const d1 = await store.duplicate('revisor-fluig');
  const d2 = await store.duplicate('revisor-fluig');
  assert.equal(d1.name, 'revisor-fluig-copia');
  assert.equal(d2.name, 'revisor-fluig-copia-2');
  assert.deepEqual((await store.list()).map((x) => x.name), ['revisor-fluig', 'revisor-fluig-copia', 'revisor-fluig-copia-2']);

  await store.remove('revisor-fluig-copia');
  assert.equal((await store.list()).length, 2);
});

test('validação e segurança dos nomes', async () => {
  const dir = tmp();
  const store = createAgentStore({ dir });
  await assert.rejects(store.save({ name: 'Nome Ruim', description: 'x' }), /letras minúsculas/);
  await assert.rejects(store.save({ name: '../fora', description: 'x' }), /letras minúsculas/);
  await assert.rejects(store.save({ name: 'ok', description: '  ' }), /Descreva/);
  await assert.rejects(store.get('../x'), /inválido/);
  await assert.rejects(store.remove('..\\x'), /inválido/);
});

test('edição fora do devkit: salvar detecta que o disco mudou e só sobrescreve com confirmação', async () => {
  const dir = tmp();
  const store = createAgentStore({ dir });
  const a = await store.save({ name: 'x', description: 'd', prompt: 'um' });
  assert.ok(a.rev);
  fs.writeFileSync(path.join(dir, 'x.md'), '---\nname: x\ndescription: editado fora\n---\ntexto externo, mais longo\n');
  const r = await store.save({ ...a, description: 'minha' }, 'x', { rev: a.rev });
  assert.equal(r.conflict, true);
  assert.match(fs.readFileSync(path.join(dir, 'x.md'), 'utf8'), /editado fora/); // nada foi gravado
  const f = await store.save({ ...a, description: 'minha' }, 'x', { rev: a.rev, force: true });
  assert.equal(f.description, 'minha');
  assert.equal((await store.rawSave('x', 'novo', { rev: 'velho' })).conflict, true);
});

test('arquivo inválido não some da lista: aparece com o erro e dá para corrigir pelo texto cru; extras sobrevivem ao salvar', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'README.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'Nome Ruim.md'), '---\nname: x\ndescription: d\n---\n');
  fs.writeFileSync(path.join(dir, 'sem-front.md'), 'só texto');
  fs.writeFileSync(path.join(dir, 'aberto.md'), '---\nname: aberto\ndescription: d\nprompt sem fechar');
  fs.writeFileSync(path.join(dir, 'sem-desc.md'), '---\nname: sem-desc\n---\ncorpo');
  fs.writeFileSync(path.join(dir, 'meu.md'), '---\nname: meu\ndescription: d\ncolor: red\n---\nprompt\n');
  const store = createAgentStore({ dir });
  const rows = await store.list();
  assert.deepEqual(rows.map((x) => x.name), ['Nome Ruim', 'aberto', 'meu', 'sem-desc', 'sem-front']); // README.txt não é .md
  assert.deepEqual(rows.filter((x) => x.invalid).map((x) => x.name), ['Nome Ruim', 'aberto', 'sem-desc', 'sem-front']);
  assert.match(rows.find((x) => x.name === 'aberto').error, /não termina/);
  assert.match(rows.find((x) => x.name === 'sem-front').error, /não começa/);
  assert.match(rows.find((x) => x.name === 'sem-desc').error, /description/);
  assert.match(rows.find((x) => x.name === 'Nome Ruim').error, /nome do arquivo/);

  const raw = await store.rawGet('sem-front');
  assert.equal(raw.text, 'só texto');
  await store.rawSave('sem-front', '---\nname: sem-front\ndescription: agora vale\n---\nok\n', { rev: raw.rev });
  assert.equal((await store.list()).find((x) => x.name === 'sem-front').invalid, false);
  await assert.rejects(store.rawGet('../x'), /inválido/);
  await store.remove('Nome Ruim'); // inválido também pode ser excluído
  assert.ok(!fs.existsSync(path.join(dir, 'Nome Ruim.md')));

  const a = await store.get('meu');
  await store.save({ ...a, description: 'd2' }, 'meu');
  assert.match(fs.readFileSync(path.join(dir, 'meu.md'), 'utf8'), /color: red/);
});

test('abrir o agente no terminal: comando fixo com o nome validado', () => {
  const cwd = tmp();
  assert.deepEqual(resume.plan({ provider: 'claude', mode: 'agent', agent: 'revisor-fluig', cwd }), { bin: 'claude', args: ['--agent', 'revisor-fluig'], cwd });
  assert.throws(() => resume.plan({ provider: 'claude', mode: 'agent', agent: 'x; calc', cwd }), /Agente inválido/);
  assert.throws(() => resume.plan({ provider: 'claude', mode: 'agent', cwd }), /Agente inválido/);
  assert.throws(() => resume.plan({ provider: 'codex', mode: 'agent', agent: 'ok', cwd }), /Agente inválido/);
});

test('escopos: mesma lista junta usuário e projeto, e o do projeto prevalece quando o nome se repete', async () => {
  const user = path.join(tmp(), 'user-agents');
  const proj = path.join(tmp(), 'repo', '.claude', 'agents');
  const u = createAgentStore({ dir: user });
  const p = createAgentStore({ dir: proj });
  await u.save({ name: 'revisor', description: 'do usuário' });
  await u.save({ name: 'so-usuario', description: 'x' });
  await p.save({ name: 'revisor', description: 'do projeto' });
  fs.writeFileSync(path.join(proj, 'quebrado.md'), 'sem frontmatter');
  const rows = scope.mergeRows({ user: { rows: await u.list() }, project: { rows: await p.list() } });
  assert.deepEqual(rows.map((r) => scope.agentKey(r)), ['project:quebrado', 'project:revisor', 'user:revisor', 'user:so-usuario']);
  assert.deepEqual(scope.overlaps(rows), [{ name: 'revisor', winner: 'project', shadowed: 'user' }]);
  assert.equal(scope.mergeRows({ user: { rows: [] }, project: null }).length, 0);
  assert.equal((await p.get('revisor')).description, 'do projeto'); // cada escopo escreve na sua pasta
  assert.equal((await u.get('revisor')).description, 'do usuário');
  assert.equal(scope.scopeLabel('project'), 'Projeto');
});
