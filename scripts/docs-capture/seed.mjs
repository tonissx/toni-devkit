// Gera dados 100% fictícios (notas, links, cofre, DevCore e repositórios git) numa pasta isolada.
// Uso: node scripts/docs-capture/seed.mjs <pasta-raiz>
// Cria <raiz>/userData, <raiz>/notes e <raiz>/repos. Nada toca os dados reais do usuário.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createNotesService } = require('../../electron/notes/service.js');
const { createVaultService } = require('../../electron/vault/service.js');
const { simulate, PROFILES } = require('../../src/devcore/sim.js');

import { VAULT_PASSWORD } from './config.mjs';
const root = path.resolve(process.argv[2] || 'capture-data');
const dirs = { userData: path.join(root, 'userData'), notes: path.join(root, 'notes'), repos: path.join(root, 'repos') };
rmSync(root, { recursive: true, force: true });
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

/* ─────────────── Notas ─────────────── */
const NOTES = [
  { title: 'Índices no PostgreSQL', tags: ['sql', 'postgres', 'performance'], pinned: true, folder: 'Banco de dados', content:
`# Índices no PostgreSQL

Quando um índice ajuda de verdade — e quando só atrapalha a escrita.

- **B-tree** é o padrão e serve para \`=\`, \`<\`, \`>\`, \`BETWEEN\` e \`ORDER BY\`
- **GIN** para \`jsonb\` e busca de texto · **BRIN** para tabelas enormes ordenadas por data
- Índice parcial quando só uma fatia é consultada

\`\`\`sql
CREATE INDEX CONCURRENTLY idx_pedidos_aberto
  ON pedidos (cliente_id, criado_em DESC)
  WHERE status = 'aberto';
\`\`\`

Veja o plano antes e depois: [[EXPLAIN ANALYZE sem medo]]. Para migrações seguras: [[Migrações sem downtime]].

- [ ] Revisar índices não usados em \`pg_stat_user_indexes\` @${day(1)} !2
` },
  { title: 'EXPLAIN ANALYZE sem medo', tags: ['sql', 'postgres'], folder: 'Banco de dados', content:
`# EXPLAIN ANALYZE sem medo

Ler de dentro para fora. Os números que mais importam:

1. **rows** estimado × real: se divergem muito, as estatísticas estão velhas (\`ANALYZE\`)
2. **Seq Scan** em tabela grande com filtro seletivo: falta índice (ver [[Índices no PostgreSQL]])
3. **Buffers: shared read**: o que veio do disco

\`\`\`sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM pedidos WHERE cliente_id = 42 AND status = 'aberto';
\`\`\`
` },
  { title: 'Migrações sem downtime', tags: ['sql', 'deploy'], folder: 'Banco de dados', content:
`# Migrações sem downtime

Regra de ouro: **expandir, migrar, contrair**.

1. Adiciona a coluna nova (nullable) e faz o código escrever nos dois lados
2. Faz o *backfill* em lotes pequenos
3. Troca a leitura para a coluna nova
4. Só depois remove a antiga

> Nunca \`ALTER TABLE ... ADD COLUMN ... DEFAULT\` em tabela gigante sem checar a versão do banco.

Relacionado: [[Checklist de deploy]], [[Índices no PostgreSQL]].
` },
  { title: 'Checklist de deploy', tags: ['deploy', 'checklist'], pinned: true, folder: 'Trabalho', content:
`# Checklist de deploy

- [x] Testes verdes na CI
- [x] Changelog atualizado
- [ ] Migrações revisadas ([[Migrações sem downtime]]) @${day(0)} !1
- [ ] Avisar o time no canal de releases @${day(0)}
- [ ] Conferir métricas 15 min depois do deploy @${day(0)} !2
- [ ] Plano de rollback anotado ([[Rollback em 5 minutos]]) @${day(2)}
` },
  { title: 'Rollback em 5 minutos', tags: ['deploy', 'incidente'], folder: 'Trabalho', content:
`# Rollback em 5 minutos

1. Reverter o artefato para a versão anterior (tag \`vX.Y.Z-1\`)
2. Se houve migração, **não** reverter o schema: a versão antiga precisa conviver com ele
3. Confirmar o *health check* e abrir o incidente

\`\`\`bash
kubectl rollout undo deployment/loja-api
kubectl rollout status deployment/loja-api --timeout=120s
\`\`\`

Quem faz o quê: [[Checklist de deploy]] e [[Runbook de incidentes]].
` },
  { title: 'Runbook de incidentes', tags: ['incidente', 'processo'], folder: 'Trabalho', content:
`# Runbook de incidentes

- **Primeiros 5 min**: confirmar o impacto, abrir o canal, nomear quem lidera
- **Comunicar** a cada 30 min, mesmo que seja "sem novidades"
- **Depois**: post-mortem sem culpados em até 3 dias úteis

Veja também [[Rollback em 5 minutos]].

- [ ] Atualizar a lista de plantão @${day(3)}
` },
  { title: 'Git: rebase interativo', tags: ['git'], type: 'snippet', folder: 'Snippets', content:
`Juntar os últimos 3 commits em um só:

\`\`\`bash
git rebase -i HEAD~3
# troque "pick" por "squash" (ou "s") nos commits que quer juntar
\`\`\`

Para recuperar depois de errar: \`git reflog\` e \`git reset --hard HEAD@{1}\`. Mais em [[Git: desfazendo coisas]].
` },
  { title: 'Git: desfazendo coisas', tags: ['git'], folder: 'Snippets', content:
`# Git: desfazendo coisas

| Quero... | Comando |
| --- | --- |
| Desfazer o último commit mantendo as mudanças | \`git reset --soft HEAD~1\` |
| Trazer um arquivo de outra branch | \`git restore --source=outra -- arquivo\` |
| Achar um commit "perdido" | \`git reflog\` |

Ver também [[Git: rebase interativo]].
` },
  { title: 'Regex: validar e-mail (pragmático)', tags: ['regex'], type: 'snippet', folder: 'Snippets', content:
'```js\nconst EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;\nEMAIL.test("ana@exemplo.com"); // true\n```\n\nNão tente cobrir a RFC inteira: valide o formato e **confirme por e-mail**.\n' },
  { title: 'Docker: limpar espaço', tags: ['docker'], type: 'snippet', folder: 'Snippets', content:
'```bash\ndocker system df\ndocker image prune -a --filter "until=720h"\ndocker builder prune\n```\n' },
  { title: 'curl: testar API com token', tags: ['http', 'api'], type: 'snippet', folder: 'Snippets', content:
'```bash\ncurl -s -H "Authorization: Bearer $TOKEN" \\\n  https://api.exemplo.com/v1/pedidos?limit=5 | jq .\n```\n\nO token fica no Vault, na entrada **API do GitHub (demo)**.\n\n```secret API do GitHub (demo)\n```\n' },
  { title: 'Reunião de planejamento', tags: ['reuniao'], folder: 'Trabalho', content:
`# Reunião de planejamento

**Decisões**
- Congelar o escopo da release na sexta
- Migrar o relatório mensal para jobs assíncronos ([[Migrações sem downtime]])

**Tarefas**
- [ ] Estimar o job de relatório @${day(1)}
- [ ] Marcar a revisão de arquitetura @${day(-1)} !1
- [x] Compartilhar o resumo com o time
` },
  { title: 'Ideias de ferramentas', tags: ['ideias'], folder: 'Pessoal', content:
`# Ideias de ferramentas

- Conversor de cron em português ("todo dia útil às 8h")
- Gerador de dados fictícios para testes
- Visualizador de logs com filtro por nível

Ver como organizo estudos em [[Plano de estudos]].
` },
  { title: 'Plano de estudos', tags: ['estudos'], folder: 'Pessoal', content:
`# Plano de estudos

- [ ] Terminar o curso de SQL avançado @${day(5)}
- [ ] Ler o capítulo de transações em *Designing Data-Intensive Applications* @${day(7)}
- [x] Praticar *rebase* ([[Git: rebase interativo]])
` },
  { title: 'Leituras para o fim de semana', tags: ['estudos', 'leitura'], folder: 'Pessoal', content:
'# Leituras\n\n- Artigo sobre *connection pooling*\n- Post-mortem de uma queda de DNS\n\nVai para o [[Plano de estudos]].\n' },
  { title: 'Convenção de commits', tags: ['git', 'processo'], folder: 'Trabalho', content:
`# Convenção de commits

\`tipo(escopo): resumo no imperativo\`

- **feat**, **fix**, **docs**, **refactor**, **test**, **chore**
- Primeira linha com até 72 caracteres
- Corpo explica o *porquê*, não o *como*

Usado no [[Checklist de deploy]] para gerar o changelog.
` },
];

const notes = createNotesService({ dir: dirs.notes });
await notes.init();
for (const n of NOTES) {
  if (n.folder) { for (const p of n.folder.split('/').reduce((a, s) => [...a, [...(a.at(-1)?.split('/') || []), s].join('/')], [])) await notes.createFolder(p).catch(() => {}); }
  await notes.create(n);
}
await notes.create({ title: 'Ligar para o contador', content: 'Perguntar sobre o prazo do imposto.', quick: true, tags: ['quick'] });

/* ─────────────── Links rápidos ─────────────── */
mkdirSync(path.join(dirs.notes, '.devkit'), { recursive: true });
const link = (alias, name, url, param) => ({ id: 'l-' + alias, alias, name, url, param: param || '', recent: [], created: new Date().toISOString(), updated: new Date().toISOString() });
writeFileSync(path.join(dirs.notes, '.devkit', 'links.json'), JSON.stringify({ v: 1, links: [
  { ...link('ticket', 'Chamado do tracker', 'https://tracker.example.com/tickets?id={q}', 'Número do chamado'), recent: ['4821', '4790'] },
  { ...link('pr', 'Pull request', 'https://github.com/exemplo/loja-api/pull/{q}', 'Número da PR'), recent: ['312'] },
  link('docs', 'Documentação interna', 'https://docs.example.com'),
  link('grafana', 'Painel de métricas', 'https://metrics.example.com/d/api'),
] }, null, 2));

/* ─────────────── Vault ─────────────── */
const vault = createVaultService({ file: path.join(dirs.userData, 'vault.json'), kdfParams: { N: 2 ** 14 } });
await vault.init();
await vault.create(VAULT_PASSWORD);
const F = (name, value, secret = false) => ({ name, value, secret });
await vault.save({ name: 'Banco de homologação (demo)', kind: 'db', tags: ['homolog'], notes: 'Somente leitura fora do horário comercial.', fields: [F('Servidor', 'db-homolog.example.com'), F('Porta', '5432'), F('Banco', 'loja'), F('Usuário', 'app_leitura'), F('Senha', 'senha-de-exemplo-1', true)] });
await vault.save({ name: 'API do GitHub (demo)', kind: 'api', tags: ['github'], fields: [F('URL', 'https://api.github.com'), F('Chave', 'ghp_exemplo_nao_e_um_token_real', true)] });
await vault.save({ name: 'Painel de métricas (demo)', kind: 'login', tags: ['observabilidade'], fields: [F('URL', 'https://metrics.example.com'), F('Usuário', 'ana.souza'), F('Senha', 'senha-de-exemplo-2', true)] });
await vault.save({ name: 'Servidor de staging (demo)', kind: 'login', tags: ['staging'], fields: [F('URL', 'ssh://staging.example.com'), F('Usuário', 'deploy'), F('Senha', 'senha-de-exemplo-3', true)] });
await vault.flush();

/* ─────────────── DevCore ─────────────── */
const sim = simulate({ ...PROFILES.casual, days: 9, strategy: 'prepared' });
// O relógio da simulação é de janeiro: reancora no presente para não abrir "você ficou fora por 6391 h".
const dc = sim.state;
const nowMs = Date.now();
dc.clock = { lastUpdate: nowMs - 60e3, startedAt: nowMs - 9 * 86400e3, lastOfflineMs: 0 };
dc.pending = { welcome: null };
dc.run.incidents = { seq: 0, next: null, active: null, history: [] };
writeFileSync(path.join(dirs.userData, 'devcore.json'), JSON.stringify(dc));

/* ─────────────── Repositórios git ─────────────── */
const people = [['Ana Souza', 'ana@exemplo.com'], ['Bruno Lima', 'bruno@exemplo.com'], ['Carla Menezes', 'carla@exemplo.com']];
function makeRepo(name, build) {
  const dir = path.join(dirs.repos, name);
  mkdirSync(dir, { recursive: true });
  let t = Date.now() - 30 * 86400e3;
  let who = 0;
  const git = (...args) => {
    const [n, e] = people[who % people.length];
    const d = new Date(t).toISOString();
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: n, GIT_AUTHOR_EMAIL: e, GIT_COMMITTER_NAME: n, GIT_COMMITTER_EMAIL: e, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } });
  };
  const ctx = {
    dir, git,
    as: (i) => { who = i; },
    tick: (h = 18) => { t = Math.min(t + (h + Math.random() * 8) * 3600e3, Date.now() - 3600e3); },
    write: (file, text, append) => { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); (append ? appendFileSync : writeFileSync)(path.join(dir, file), text); },
    commit(msg, file, text, append = true) { ctx.tick(); ctx.write(file, text, append); git('add', '-A'); git('commit', '-q', '-m', msg); },
  };
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  build(ctx);
  return dir;
}

const lojaApi = makeRepo('loja-api', (c) => {
  c.as(0); c.commit('chore: inicia o projeto', 'README.md', '# Loja API\n', false);
  c.commit('feat: endpoint de listagem de produtos', 'src/produtos.js', 'export const listar = () => [];\n', false);
  c.as(1); c.commit('feat: cadastro de clientes', 'src/clientes.js', 'export const criar = (c) => c;\n', false);
  c.as(2); c.commit('chore: configura a CI', '.github/ci.yml', 'name: ci\n', false);
  c.as(0); c.git('tag', 'v0.1.0');
  for (const [b, who, files] of [
    ['feature/carrinho', 0, [['feat: adiciona o carrinho', 'src/carrinho.js', 'export const add = () => {};\n'], ['test: cobre o carrinho vazio', 'test/carrinho.test.js', '// vazio\n']]],
    ['feature/pagamento', 1, [['feat: integra o gateway de pagamento', 'src/pagamento.js', 'export const pagar = () => {};\n'], ['fix: arredonda centavos no total', 'src/pagamento.js', '// arredondamento\n']]],
  ]) {
    c.git('checkout', '-q', '-b', b);
    c.as(who);
    for (const [m, f, x] of files) c.commit(m, f, x);
    c.as(2); c.tick(); c.commit('docs: atualiza o guia de contribuição', 'CONTRIBUTING.md', 'Abra uma PR pequena.\n');
    c.git('checkout', '-q', 'main');
    c.commit('fix: valida CPF no cadastro', 'src/clientes.js', '// valida CPF\n');
    c.tick(); c.git('merge', '--no-ff', '-q', '-m', `Merge branch '${b}'`, b);
  }
  c.as(2); c.git('tag', '-a', 'v0.2.0', '-m', 'Carrinho e pagamento');
  c.as(0); c.commit('perf: índice parcial em pedidos abertos', 'db/indices.sql', 'CREATE INDEX idx_aberto ON pedidos (cliente_id) WHERE status = \'aberto\';\n', false);
  c.git('checkout', '-q', '-b', 'feature/cupons');
  c.as(1); c.commit('feat: cupom de desconto percentual', 'src/cupons.js', 'export const aplicar = (t, p) => t * (1 - p);\n', false);
  c.commit('feat: limita o cupom por cliente', 'src/cupons.js', '// limite por cliente\n');
  c.git('checkout', '-q', 'main');
  c.as(2); c.commit('fix: corrige a paginação da listagem', 'src/produtos.js', '// paginação\n');
  c.as(0); c.commit('docs: documenta os endpoints', 'README.md', '\n## Endpoints\n- GET /produtos\n- POST /clientes\n');
  c.git('checkout', '-q', '-b', 'fix/timeout-relatorio');
  c.as(1); c.commit('fix: aumenta o timeout do relatório', 'src/relatorio.js', 'export const TIMEOUT = 30000;\n', false);
  c.git('checkout', '-q', 'main');
  // Trabalho em andamento: um arquivo preparado, um modificado, um novo.
  c.write('src/produtos.js', '\nexport const buscar = (q) => listar().filter((p) => p.nome.includes(q));\n', true);
  c.write('src/clientes.js', '\nexport const remover = (id) => id;\n', true);
  c.git('add', 'src/clientes.js');
  c.write('src/estoque.js', 'export const baixar = (sku, qtd) => ({ sku, qtd });\n');
  c.write('README.md', '\n## Rodando local\n`npm start`\n', true);
});

makeRepo('docs-site', (c) => {
  c.as(2); c.commit('chore: inicia o site', 'index.md', '# Docs\n', false);
  c.as(0); c.commit('docs: página de instalação', 'instalacao.md', '# Instalação\n', false);
  c.as(1); c.commit('docs: guia de contribuição', 'contribuir.md', '# Contribuir\n', false);
  c.write('instalacao.md', '\nPasso 2.\n', true);
});

makeRepo('scripts-infra', (c) => {
  c.as(1); c.commit('chore: scripts iniciais', 'backup.sh', '#!/bin/sh\necho backup\n', false);
  c.as(1); c.commit('feat: rotação de logs', 'logs.sh', '#!/bin/sh\necho logs\n', false);
});

writeFileSync(path.join(dirs.userData, 'git-repos.json'), JSON.stringify({ v: 1, last: path.join(dirs.repos, 'loja-api'), repos: ['docs-site', 'loja-api', 'scripts-infra'].map((n) => ({ path: path.join(dirs.repos, n), name: n, added: new Date().toISOString() })) }, null, 2));

console.log(JSON.stringify({ root, ...dirs, lojaApi }));
