// Testes das tarefas da IA (src/ai/tasks.js): o que cada uma monta e como interpreta a resposta. node --test scripts/test-ai-tasks.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../src/ai/tasks.js');
const { TASKS } = T;

const patch = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+b\n';

test('todas as tarefas montam system + user em texto', () => {
  const inputs = {
    commitMessage: { diff: patch }, explainCommit: { message: 'x', patch }, conflictHelp: { ours: ['a'], theirs: ['b'] },
    branchName: { description: 'corrigir login' }, prSummary: { base: 'main', head: 'feat/x', commits: ['a'], patch },
    sqlExplain: { sql: 'select 1' }, sqlFromText: { description: 'clientes' }, jsonNames: { lang: 'TypeScript', code: 'interface Root {}', sample: '{}' },
    jsonError: { error: 'x', line: 1, col: 1, excerpt: '1 | {' }, diffSummary: { patch }, noteMeta: { content: 'texto' },
    noteSummary: { content: 'texto' }, noteChecklist: { text: 'fazer a e b' }, notesAsk: { question: 'q', notes: [{ title: 'N', excerpt: 'e' }] },
    paletteAsk: { question: 'q', commands: [{ id: 'go:git', name: 'Git' }] }, clipExplain: { text: 'select 1', kind: 'sql' },
  };
  for (const [id, t] of Object.entries(TASKS)) {
    assert.ok(inputs[id], 'falta entrada de teste para ' + id);
    const r = t.build(inputs[id]);
    assert.equal(typeof r.system, 'string', id);
    assert.ok(r.user.length > 0, id);
    assert.ok(t.label && t.maxTokens > 0, id);
  }
});

test('entradas vazias viram erro em português', () => {
  assert.throws(() => TASKS.commitMessage.build({ diff: '' }), /Nada preparado/);
  assert.throws(() => TASKS.branchName.build({ description: ' ' }), /Descreva/);
  assert.throws(() => TASKS.notesAsk.build({ question: 'q', notes: [] }), /Nenhuma nota/);
  assert.throws(() => TASKS.clipExplain.build({ text: '' }), /vazia/);
});

test('clip anota o corte', () => {
  assert.equal(T.clip('abc', 10), 'abc');
  assert.match(T.clip('x'.repeat(30), 10), /20 caracteres cortados/);
});

test('conflito: explicação + último bloco; marcadores são recusados', () => {
  const r = TASKS.conflictHelp.parse('Um lado renomeia, o outro valida.\n\n```js\nconst a = valida(b);\n```');
  assert.equal(r.code, 'const a = valida(b);');
  assert.equal(r.explanation, 'Um lado renomeia, o outro valida.');
  assert.equal(TASKS.conflictHelp.parse('```\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> x\n```').code, null);
  assert.equal(TASKS.conflictHelp.parse('sem código').code, null);
});

test('nome de branch: slug, validação e sem repetir as existentes', () => {
  assert.equal(T.slugBranch('1. feat/Corrigir Login com Senha!'), 'feat/corrigir-login-com-senha');
  assert.equal(T.slugBranch('`fix/ação_rápida`'), 'fix/acao-rapida');
  assert.ok(T.validBranch('feat/x'));
  for (const bad of ['-x', 'a..b', 'a/', 'a.lock', 'a b', '/a', 'a//b']) assert.ok(!T.validBranch(bad), bad);
  const out = TASKS.branchName.parse('feat/login-senha\nfix/login\n\nfeat/login-senha\n- docs/readme', { existing: ['fix/login'] });
  assert.deepEqual(out, ['feat/login-senha', 'docs/readme']);
  assert.deepEqual(T.branchPrefixes(['feat/a', 'feat/b', 'fix/c', 'main']), ['feat', 'fix']);
  assert.match(TASKS.branchName.build({ description: 'x', existing: ['release/lote-1'] }).system, /release\//);
});

test('PR: título e corpo', () => {
  assert.deepEqual(TASKS.prSummary.parse('TÍTULO: Painel de início\n\n## O que muda\n- a'), { title: 'Painel de início', body: '## O que muda\n- a' });
  assert.deepEqual(TASKS.prSummary.parse('**Título:** X\n\ncorpo'), { title: 'X', body: 'corpo' });
  assert.equal(TASKS.prSummary.parse('# Só um título\nresto').title, 'Só um título');
});

test('SQL a partir de texto: tira a cerca', () => {
  assert.equal(TASKS.sqlFromText.parse('```sql\nSELECT 1\n```'), 'SELECT 1');
  assert.equal(TASKS.sqlFromText.parse('SELECT 2'), 'SELECT 2');
});

test('nota: título e tags limpos, sem repetir as que já tem', () => {
  const r = TASKS.noteMeta.parse('```json\n{"title": "\\"Deploy do Fluig\\"", "tags": ["#Fluig", "deploy", "Banco de Dados", "x!y", "deploy"]}\n```', { tags: ['deploy'] });
  assert.deepEqual(r, { title: 'Deploy do Fluig', tags: ['fluig', 'banco-de-dados'] });
  assert.deepEqual(TASKS.noteMeta.parse('nada de json'), { title: '', tags: [] });
});

test('checklist normalizado', () => {
  assert.equal(TASKS.noteChecklist.parse('1. Comprar café\n- [x] Ligar\n* revisar PR\n\n[ ] testar'), '- [ ] Comprar café\n- [x] Ligar\n- [ ] revisar PR\n- [ ] testar');
});

test('citações: [[cmd:id]] só da lista; [[nota]]', () => {
  const p = TASKS.paletteAsk.parse('Use [[cmd:go:git]] ou [[cmd:inventado]] e [[cmd:go:git]].', { commands: [{ id: 'go:git', name: 'Git' }] });
  assert.deepEqual(p.cmds, ['go:git']);
  assert.deepEqual(TASKS.notesAsk.parse('Veja [[Deploy]] e [[Proxy|o proxy]] e [[cmd:x]].').refs, ['Deploy', 'Proxy']);
});

test('sniffKind', () => {
  assert.equal(T.sniffKind('{"a":1}'), 'json');
  assert.equal(T.sniffKind('<?xml version="1.0"?><a/>'), 'xml');
  assert.equal(T.sniffKind('  SELECT * FROM t'), 'sql');
  assert.equal(T.sniffKind('TypeError: x is undefined\n    at f (a.js:1:2)'), 'error');
  assert.equal(T.sniffKind('const a = 1;'), 'code');
  assert.equal(T.sniffKind('olá mundo'), 'text');
});

test('conflito: contexto repetido pelo modelo é removido', () => {
  const before = ['import x;', 'export const soma = (a, b) => a + b;'];
  const after = ['', 'export default soma;'];
  assert.equal(T.trimContext('export const soma = (a, b) => a + b;\nexport const media = 1;\nexport default soma;', before, after), 'export const media = 1;');
  assert.equal(T.trimContext('a\nb', [], []), 'a\nb');
  // nunca esvazia: sobra ao menos uma linha
  assert.equal(T.trimContext('export const soma = (a, b) => a + b;', before, []), 'export const soma = (a, b) => a + b;');
  const r = TASKS.conflictHelp.parse('Explicação.\n```js\nexport const soma = (a, b) => a + b;\nexport const media = 2;\n```', { before });
  assert.equal(r.code, 'export const media = 2;');
});

test('nome de branch sem prefixo ganha um', () => {
  assert.equal(T.guessPrefix('corrigir o login', ['feat']), 'fix');
  assert.equal(T.guessPrefix('corrigir o login', ['feat', 'hotfix']), 'hotfix');
  assert.equal(T.guessPrefix('tela de relatórios', ['release', 'feature']), 'feature');
  assert.equal(T.guessPrefix('tela', []), 'feat');
  assert.deepEqual(TASKS.branchName.parse('calculo-media-vazia\nfix/media', { description: 'corrigir média', existing: ['main', 'feat/relatorio'] }), ['fix/calculo-media-vazia', 'fix/media']);
});

test('melhorar nomes: só os tipos mudam, propriedades nunca', () => {
  const orig = 'export interface Root {\n  empresa: string;\n  itens: Item[];\n  "Root": number;\n}\n\nexport interface Item {\n  qtd: number;\n}\n';
  // o modelo trocou também a propriedade "empresa" — isso é ignorado
  const resp = '```ts\nexport interface Empresa {\n  nome: string;\n  itens: Produto[];\n}\n\nexport interface Produto {\n  qtd: number;\n}\n```';
  assert.equal(TASKS.jsonNames.parse(resp, { code: orig }), 'export interface Empresa {\n  empresa: string;\n  itens: Produto[];\n  "Root": number;\n}\n\nexport interface Produto {\n  qtd: number;\n}\n');
  assert.equal(T.renameTypes(orig, 'interface A {}'), null); // contagem diferente
  assert.equal(T.renameTypes(orig, 'interface A {} interface A {}'), null); // repetido
  assert.equal(T.renameTypes(orig, orig), null); // nada mudou
  assert.match(T.renameTypes('public class Root\n{\n    public List<Item> Itens { get; set; }\n}\n\npublic class Item\n{\n}', 'class Pedido {} class Produto {}'), /public class Pedido[\s\S]*List<Produto> Itens/);
});

test('melhorar nomes: propriedade com o nome do tipo continua; C# sem membro com o nome da classe', () => {
  const ts = 'export interface Root {\n  Item: Item;\n  item?: Item[];\n}\n\nexport interface Item {\n  a: number;\n}\n';
  assert.equal(T.renameTypes(ts, 'interface Pedido {} interface Produto {}'), 'export interface Pedido {\n  Item: Produto;\n  item?: Produto[];\n}\n\nexport interface Produto {\n  a: number;\n}\n');
  const cs = 'public class Root\n{\n    [JsonPropertyName("empresa")]\n    public string Empresa { get; set; }\n\n    [JsonPropertyName("responsavel")]\n    public Responsavel Responsavel { get; set; }\n}\n\npublic class Responsavel\n{\n    public string Nome { get; set; }\n}';
  const out = T.renameTypes(cs, 'class Empresa {} class Pessoa {}');
  assert.match(out, /public class Empresa\n\{[\s\S]*public string EmpresaValue \{ get; set; \}/);
  assert.match(out, /public Pessoa Responsavel \{ get; set; \}/);
  assert.match(out, /public class Pessoa\n\{\n {4}public string Nome/);
});
