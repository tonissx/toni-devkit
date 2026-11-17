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
const catalog = require('../electron/agents/catalog.js');

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

test('chaves desconhecidas e blocos complexos são preservados; campos conhecidos viram estruturados', () => {
  const src = '---\nname: x\ndescription: d\ncolor: blue\nskills:\n  - fluig\n  - totvs-rm\nhooks:\n  PreToolUse:\n    - matcher: Bash\nfuturo: 1\nmcpServers:\n  - github: {command: x}\n---\nprompt\n';
  const a = parseAgent(src);
  assert.equal(a.color, 'blue');
  assert.deepEqual(a.skills, ['fluig', 'totvs-rm']);
  assert.deepEqual(a.mcpServers, []); // mapa inline não é uma lista simples: fica no extra
  assert.equal(a.extra, 'hooks:\n  PreToolUse:\n    - matcher: Bash\nfuturo: 1\nmcpServers:\n  - github: {command: x}');
  const out = serializeAgent({ ...a, description: 'novo' });
  assert.match(out, /skills:\n {2}- fluig\n {2}- totvs-rm\ncolor: blue\nhooks:/);
  assert.equal(parseAgent(out).description, 'novo');
  assert.equal(parseAgent(out).extra, a.extra);
});

test('campos novos: escreve só o que está preenchido e lê de volta igual', () => {
  const vazio = serializeAgent({ name: 'a', description: 'd', prompt: 'p' });
  assert.equal(vazio, '---\nname: a\ndescription: d\n---\n\np\n');
  const full = {
    name: 'a', description: 'd', prompt: 'p', model: 'claude-opus-5-5', tools: ['Read', 'mcp__gh__issue'], disallowedTools: ['Bash', 'PowerShell'],
    permissionMode: 'acceptEdits', maxTurns: '12', skills: ['fluig', 'superpowers:brainstorming'], mcpServers: ['github'], memory: 'project',
    background: true, effort: 'high', isolation: 'worktree', color: 'purple', extra: '',
  };
  const text = serializeAgent(full);
  assert.match(text, /disallowedTools: Bash, PowerShell\nmodel: claude-opus-5-5\npermissionMode: acceptEdits\nmaxTurns: 12\n/);
  const b = parseAgent(text);
  for (const k of Object.keys(full)) if (k !== 'prompt') assert.deepEqual(b[k], full[k], k);
  // listas em várias formas de YAML
  const y = parseAgent('---\nname: a\ndescription: d\ntools: [Read, Grep]\nskills: fluig, totvs-rm\ndisallowedTools:\n  - Bash\n---\n');
  assert.deepEqual([y.tools, y.skills, y.disallowedTools], [['Read', 'Grep'], ['fluig', 'totvs-rm'], ['Bash']]);
});

test('validação dos campos novos', async () => {
  const store = createAgentStore({ dir: tmp() });
  await assert.rejects(store.save({ name: 'a', description: 'd', maxTurns: 'dez' }), /número inteiro/);
  await assert.rejects(store.save({ name: 'a', description: 'd', maxTurns: '0' }), /número inteiro/);
  await assert.rejects(store.save({ name: 'a', description: 'd', skills: ['a, b'] }), /Skills/);
  const a = await store.save({ name: 'a', description: 'd', skills: ['x', 'x', ' y '], maxTurns: '5', color: 'red' });
  assert.deepEqual(a.skills, ['x', 'y']);
  assert.equal(a.maxTurns, '5');
});

test('permissões: disallowedTools tira o "pode rodar comandos" de quem herda tudo', () => {
  assert.equal(form.permissions(null, ['Bash']).level, 'exec');
  const p = form.permissions(null, ['Bash', 'PowerShell']);
  assert.equal(p.level, 'edit');
  assert.equal(form.describePermissions(p).tone, 'warn');
  assert.equal(form.permissions(['Agent', 'TodoWrite']).level, 'read');
  assert.equal(form.colorHex('purple'), '#a855f7');
  assert.equal(form.colorHex('#fff'), null);
  assert.equal(form.isStdModel('opus'), true);
  assert.equal(form.isStdModel('claude-opus-5-5'), false);
  assert.ok(form.PERMISSION_MODES.some((m) => m.value === 'bypassPermissions'));
});

test('catálogo: skills (usuário, projeto, plugins), MCP e proibição de worktree', async () => {
  const home = tmp(); const root = tmp();
  const mk = (d, name, desc) => { fs.mkdirSync(path.join(d, name), { recursive: true }); fs.writeFileSync(path.join(d, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\ncorpo`); };
  mk(path.join(home, '.claude', 'skills'), 'fluig', 'Dev no Fluig');
  mk(path.join(root, '.claude', 'skills'), 'do-projeto', 'Skill do projeto');
  const plug = path.join(home, 'plug'); mk(path.join(plug, 'skills'), 'brainstorming', 'Ideias');
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'superpowers@market': [{ installPath: plug }] } }));
  fs.writeFileSync(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: { github: {} } }));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { playwright: {} } }));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Regras\n- Não use worktrees neste repositório.\n');
  const c = await catalog.catalog({ root, home });
  assert.deepEqual(c.skills.map((s) => s.name), ['do-projeto', 'fluig', 'superpowers:brainstorming']);
  assert.equal(c.skills[1].description, 'Dev no Fluig');
  assert.deepEqual(c.mcp.map((m) => m.name), ['github', 'playwright']);
  assert.match(c.worktreeBan, /worktrees/);
  assert.equal((await catalog.catalog({ root: tmp(), home: tmp() })).worktreeBan, null);
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

test('validações: nome (formato, embutidos, duplicado no escopo) e descrição', async () => {
  const others = [{ name: 'revisor' }, { name: 'outro' }];
  const v = (n, c) => form.validateName(n, { others, current: c || null });
  assert.equal(v('novo-agente'), null);
  assert.match(v('').text, /Dê um nome/);
  assert.match(v('Revisor').text, /minúsculas/);
  assert.match(v('-x').text, /hífen/);
  assert.match(v('a:b').text, /“:”/);
  assert.match(v('a b').text, /letras minúsculas/);
  assert.match(v('x'.repeat(65)).text, /64/);
  for (const b of ['Explore', 'Plan', 'general-purpose', 'claude', 'statusline-setup', 'claude-code-guide', 'explore', 'plan']) assert.match(v(b).text, /embutido/, b);
  assert.match(v('revisor').text, /Já existe/);
  assert.equal(v('revisor', 'revisor'), null); // o próprio agente em edição não conta como duplicado
  assert.match(v('outro', 'revisor').text, /Já existe/); // renomear para um nome que já existe

  assert.equal(form.validateDescription('').length, 0);
  assert.equal(form.validateDescription('Revisa código do Fluig antes do deploy, apontando bugs, riscos e inconsistências. Use depois de mudanças relevantes.').length, 0);
  const curta = form.validateDescription('Revisa código');
  assert.equal(curta.length, 2); // curta e sem “quando”
  const semGatilho = form.validateDescription('Agente que revisa o código alterado procurando bugs, riscos de segurança e inconsistências com o código ao redor.');
  assert.equal(semGatilho.length, 1);
  assert.match(semGatilho[0], /QUANDO/);
  assert.equal(form.validateDescription('Use para revisar.').length, 1); // gatilho ok, mas curta

  assert.deepEqual(form.promptStats(''), { chars: 0, tokens: 0 });
  assert.deepEqual(form.promptStats('a'.repeat(401)), { chars: 401, tokens: 101 });
  for (const t of form.TEMPLATES.filter((t) => t.agent.name)) assert.equal(form.validateDescription(t.agent.description).length, 0, t.id);

  const store = createAgentStore({ dir: tmp() });
  await assert.rejects(store.save({ name: 'explore', description: 'x' }), /embutido/);
  await assert.rejects(store.save({ name: 'plan', description: 'x' }), /embutido/);
});

test('modelos prontos: cobrem revisor, pesquisador, SQL somente leitura e planejador, e passam nas validações', async () => {
  const ids = form.TEMPLATES.map((t) => t.id);
  for (const id of ['blank', 'reviewer', 'researcher', 'sql-readonly', 'planner']) assert.ok(ids.includes(id), id);
  const store = createAgentStore({ dir: tmp() });
  for (const t of form.TEMPLATES.filter((t) => t.agent.name)) {
    assert.equal(form.validateName(t.agent.name), null, t.id);
    assert.equal(form.validateDescription(t.agent.description).length, 0, t.id);
    const saved = await store.save(t.agent); // grava e lê de volta com os campos novos
    assert.equal(saved.color || '', t.agent.color || '', t.id);
    assert.deepEqual(saved.skills, t.agent.skills || [], t.id);
  }
  const sql = form.TEMPLATES.find((t) => t.id === 'sql-readonly').agent;
  assert.equal(form.describePermissions(form.permissions(sql.tools)).tone, 'danger'); // roda comandos: o alerta vermelho aparece
  assert.equal(form.TEMPLATES.find((t) => t.id === 'planner').agent.permissionMode, 'plan');
  assert.equal(form.describePermissions(form.permissions(form.TEMPLATES.find((t) => t.id === 'researcher').agent.tools)).tone, 'ok');
});

test('IA: tarefa agentDraft monta o pedido e interpreta o rascunho, filtrando ferramentas desconhecidas', () => {
  const { TASKS, slugAgent } = require('../src/ai/tasks.js');
  const t = TASKS.agentDraft;
  assert.throws(() => t.build({ goal: 'curto' }), /uma frase/);
  const req = t.build({ goal: 'confere o XML da nota com o pedido de compra', skills: ['totvs-rm', 'fluig'] });
  assert.match(req.system, /SOMENTE com um bloco/);
  assert.match(req.system, /QUANDO/);
  assert.match(req.user, /confere o XML/);
  assert.match(req.user, /totvs-rm, fluig/);
  const d = t.parse('Aqui está:\n```json\n{"name":"Conferidor de NF","description":"  Confere   a nota. Use quando chegar uma NF.  ","tools":["Read","Grep","Hack","Read"],"prompt":"Você confere notas.\\r\\nPasso 1."}\n```');
  assert.deepEqual(d, { name: 'conferidor-de-nf', description: 'Confere a nota. Use quando chegar uma NF.', tools: ['Read', 'Grep'], prompt: 'Você confere notas.\nPasso 1.\n' });
  assert.deepEqual(t.parse('sem json nenhum'), { name: '', description: '', tools: [], prompt: '' });
  assert.equal(slugAgent('Revisão  de Código!!'), 'revisao-de-codigo');
});

test('preview do arquivo: o mesmo texto que será gravado, ou o erro que impede', async () => {
  const dir = tmp();
  const store = createAgentStore({ dir });
  const draft = { name: 'x', description: 'Use quando precisar.', tools: ['Read'], skills: ['fluig'], color: 'red', prompt: 'Oi' };
  const p = store.preview(draft);
  assert.match(p.text, /^---\nname: x\n/);
  const saved = await store.save(draft);
  assert.equal(fs.readFileSync(path.join(dir, 'x.md'), 'utf8'), p.text);
  assert.ok(saved.name);
  assert.match(store.preview({ name: 'Ruim', description: 'd' }).error, /letras minúsculas/);
  assert.equal(fs.readdirSync(dir).length, 1); // preview não grava
});

test('histórico: uma cópia local por salvamento, com limite, que acompanha o renomear e permite restaurar', async () => {
  const dir = tmp(); const historyDir = tmp();
  const store = createAgentStore({ dir, historyDir });
  const a = await store.save({ name: 'rev', description: 'Use quando v1.', prompt: 'um' });
  assert.deepEqual(await store.history('rev'), []); // o primeiro salvamento não tem "anterior"
  await store.save({ ...a, description: 'Use quando v2.', prompt: 'dois' }, 'rev');
  await store.save({ ...a, description: 'Use quando v3.', prompt: 'tres' }, 'rev');
  await store.save({ ...a, description: 'Use quando v3.', prompt: 'tres' }, 'rev'); // idêntico: não cria versão
  const h = await store.history('rev');
  assert.equal(h.length, 2);
  assert.ok(h[0].at >= h[1].at); // da mais nova para a mais antiga
  assert.match((await store.historyGet('rev', h[1].id)).text, /v1/);
  assert.match((await store.historyGet('rev', h[0].id)).text, /v2/);

  const r = await store.restore('rev', h[1].id); // volta para a v1
  assert.equal(r.description, 'Use quando v1.');
  assert.equal((await store.history('rev')).length, 3); // a v3 de antes virou uma versão
  assert.match((await store.historyGet('rev', (await store.history('rev'))[0].id)).text, /v3/);

  // renomear: o histórico vai junto e as versões antigas ganham o nome novo (é o que a restauração grava)
  await store.save({ ...r, name: 'rev-novo' }, 'rev');
  const hn = await store.history('rev-novo');
  assert.ok(hn.length >= 3);
  assert.deepEqual(await store.history('rev'), []);
  assert.match((await store.historyGet('rev-novo', hn[hn.length - 1].id)).text, /name: rev-novo/);

  // texto cru também gera versão; ids e nomes inválidos são recusados; sem pasta de histórico nada quebra
  await store.rawSave('rev-novo', '---\nname: rev-novo\ndescription: Use quando raw.\n---\nx\n');
  assert.equal((await store.history('rev-novo')).length, hn.length + 1);
  await assert.rejects(store.historyGet('rev-novo', '../x'), /inválida/);
  await assert.rejects(store.history('../x'), /inválido/);
  const semHist = createAgentStore({ dir: tmp() });
  await semHist.save({ name: 'a', description: 'd' }); await semHist.save({ name: 'a', description: 'd2' }, 'a');
  assert.deepEqual(await semHist.history('a'), []);

  // limite de versões
  const lim = createAgentStore({ dir: tmp(), historyDir: tmp() });
  await lim.save({ name: 'l', description: 'd0' });
  for (let i = 1; i <= 25; i++) await lim.save({ name: 'l', description: 'd' + i }, 'l');
  assert.equal((await lim.history('l')).length, 20);
});

test('histórico: diff entre versões resume trechos iguais', () => {
  const { diffRows } = require('../src/tools/agents/agentHistory.js');
  const base = Array.from({ length: 30 }, (_, i) => 'linha ' + i).join('\n');
  const mudou = base.replace('linha 15', 'linha QUINZE');
  const d = diffRows(base, mudou);
  assert.equal(d.added, 1); assert.equal(d.removed, 1);
  assert.ok(d.rows.some((r) => r.k === 'gap' && r.n > 0)); // trechos iguais longos são colapsados
  assert.ok(d.rows.length < 20);
  const iguais = diffRows(base, base);
  assert.deepEqual([iguais.added, iguais.removed], [0, 0]);
  assert.equal(diffRows('a', 'a\nb').added, 1);
});
