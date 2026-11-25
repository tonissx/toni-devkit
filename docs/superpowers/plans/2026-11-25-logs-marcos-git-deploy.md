# Logs: marcos de deploy (Fluig) e merge (Git) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar na ferramenta de Logs os deploys do Fluig (lidos do log ou marcados à mão) e os merges da main do
repositório ligado, e dizer em cada problema "apareceu N min depois de <marco>", com destaque quando o commit mexeu no
arquivo do erro.

**Architecture:** Regras puras em `src/logs/milestones.js` (detectar deploy, agrupar rajadas, atribuir marco a um
problema, commits de um deploy, sugerir repositório). O worker de logs expõe `deploys` (varredura incremental); o
serviço de logs guarda por log o repositório ligado e os marcos manuais (`logs.json`); o serviço Git ganha a leitura
`milestones` (commits da main com arquivos). Na tela, um hook junta tudo e alimenta a Linha do tempo e Problemas.

**Tech Stack:** Electron (processo principal + worker thread), React global com `DS`, `node --test`, git do sistema
via `execFile`.

**Spec:** `docs/superpowers/specs/2026-11-25-logs-marcos-git-deploy-design.md`

## Global Constraints

- Lógica pura em `src/logs/` e `src/git/` (CommonJS, `'use strict'`, `module.exports`), sem fs/DOM.
- Git só leitura, `execFile` sem shell, `ref` validado com `validRev`; sem rede (usa refs locais).
- Persistência em `%APPDATA%\Toni Devkit\logs.json`, por `keyOf(spec)` do serviço de logs.
- Nunca afirmar causa: textos dizem "depois de", "suspeito", "estimativa".
- Rajada: deploys com menos de **2 min** (`120000` ms) entre si viram um marco.
- Margem do git: buscar desde `tsMin - 7 dias` (`7 * 86400e3`).
- Atribuição só se o marco é posterior ao início do log **e** a primeira ocorrência está ≥ **1 min** (`60000` ms)
  depois do início do log; senão `preexisting`.
- Intervalo > **24 h** (`86400e3`): mostra sem destaque.
- Limite de **500** commits por chamada de `milestones`.
- Textos e comentários em português; mensagens de commit no estilo `Logs: …` / `Git: …`, terminando com
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Nunca `git commit -q`.**
- Navegação para o Git: `window.devkit.app.command({ type: 'go', route: 'git', params: { repo, tab: 'history', hash } })`
  (já existe; o `GitScreen` abre o commit pelo `hash`).

## Review Focus

1. **Log rotacionado/reaberto (evento `reset`)** — a varredura de deploys deve recomeçar do zero, não somar marcos
   do arquivo antigo (Task 3: teste `deploys: reset recomeça a varredura`).
2. **Repositório ligado que sumiu** (removido da lista ou pasta apagada) — sem erro na tela: merges vazios e o
   seletor mostra "Repositório não encontrado" (Task 5: teste `milestones: repo inexistente devolve erro claro`;
   Task 6 trata `{ error }`).
3. **Repo sem `origin/main` nem `main`** (só `master`, ou recém-criado sem commits) — cai para `master`, depois para
   `HEAD`; sem commits → `[]` (Task 5: teste `milestones: sem origin usa main/master; vazio devolve []`).
4. **Restart do servidor com dezenas de `.war`** — um marco só, com a lista de artefatos e kind `restart` quando há
   `WFLYSRV0025` na rajada (Task 1: teste `groupBursts: restart com 38 deploys vira um marco`).
5. **JBoss sem data na linha (só hora)** — os deploys usam o `ts` do índice (dia do arquivo), nunca reparseiam a hora
   do texto (Task 3: teste `deploys: usa o ts do índice`).

---

### Task 1: Detectar deploys e agrupar rajadas (puro)

**Files:**
- Create: `src/logs/milestones.js`
- Create: `scripts/test-logs-milestones.mjs`
- Modify: `package.json` (acrescentar `scripts/test-logs-milestones.mjs` ao `node --test` do script `test`, depois de `scripts/test-logs-service.mjs`)

**Interfaces:**
- Produces:
  - `DEPLOY_RULES: Array<{ re: RegExp, kind: 'deploy'|'undeploy'|'restart' }>`
  - `matchDeploy(text: string) → { kind, artifact: string|null } | null` — `artifact` sem a extensão (`wgPortalRH`).
    Teste barato antes do regex: `text.includes('WFLYSRV00')`.
  - `groupBursts(events: Array<{ kind, artifact, ts, i }>, gapMs = 120000) → Milestone[]`
  - `Milestone = { id: string, kind: 'deploy'|'undeploy'|'restart'|'merge'|'manual', ts: number, i?: number, artifacts?: string[], label: string, hash?: string, pr?: number|null, author?: string, files?: string[] }`
    — `id` estável: `kind + ':' + ts` (manual: o id salvo).

Regras (regex exatas):
- `/WFLYSRV0010: Deployed "([^"]+?)(?:\.(?:war|ear|jar))?"/` → `deploy`
- `/WFLYSRV0009: Undeployed "([^"]+?)(?:\.(?:war|ear|jar))?"/` → `undeploy`
- `/WFLYSRV0025:/` e `/WFLYSRV0026:/` → `restart` (artifact `null`)

Agrupamento: eventos ordenados por `ts`; um evento a menos de `gapMs` do **anterior** entra no mesmo grupo. Grupo com
algum `restart` → `kind: 'restart'`, `label: 'restart · N apps'` (N = artefatos distintos de deploy). Senão
`kind` do primeiro evento, `artifacts` distintos na ordem, `label`: 1 artefato → `deploy wgPortalRH`; mais →
`deploy wgA, wgB +3` (no máximo 2 nomes). `ts`/`i` do primeiro evento.

- [ ] **Step 1: Write the failing tests**

```js
// scripts/test-logs-milestones.mjs — cabeçalho igual ao de test-logs.mjs (test, assert, createRequire)
const M = require('../src/logs/milestones.js');

test('matchDeploy: deploy, undeploy, restart e linha comum', () => {
  assert.deepEqual(M.matchDeploy('WFLYSRV0010: Deployed "wgPortalRH.war" (runtime-name : "wgPortalRH.war")'), { kind: 'deploy', artifact: 'wgPortalRH' });
  assert.deepEqual(M.matchDeploy('WFLYSRV0009: Undeployed "wgPortalRH.war" (runtime-name: "wgPortalRH.war")'), { kind: 'undeploy', artifact: 'wgPortalRH' });
  assert.deepEqual(M.matchDeploy('WFLYSRV0025: Fluig iniciado em 45123ms'), { kind: 'restart', artifact: null });
  assert.equal(M.matchDeploy('Widget sem permissão: 42'), null);
});

test('groupBursts: deploys separados viram marcos separados', () => {
  const r = M.groupBursts([{ kind: 'deploy', artifact: 'wgA', ts: 0, i: 1 }, { kind: 'deploy', artifact: 'wgB', ts: 10 * 60e3, i: 9 }]);
  assert.equal(r.length, 2);
  assert.equal(r[0].label, 'deploy wgA');
  assert.deepEqual(r[1].artifacts, ['wgB']);
});

test('groupBursts: restart com 38 deploys vira um marco', () => {
  const ev = Array.from({ length: 38 }, (_, k) => ({ kind: 'deploy', artifact: 'app' + k, ts: 1000 + k * 500, i: k }));
  ev.push({ kind: 'restart', artifact: null, ts: 30000, i: 99 });
  const r = M.groupBursts(ev);
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, 'restart');
  assert.equal(r[0].label, 'restart · 38 apps');
  assert.equal(r[0].ts, 1000);
});

test('groupBursts: rajada sem restart junta nomes', () => {
  const r = M.groupBursts(['wgA', 'wgB', 'wgC', 'wgD'].map((a, k) => ({ kind: 'deploy', artifact: a, ts: k * 1000, i: k })));
  assert.equal(r[0].label, 'deploy wgA, wgB +2');
});
```

- [ ] **Step 2: Run and see it fail** — `node --test scripts/test-logs-milestones.mjs` → FAIL (`Cannot find module '../src/logs/milestones.js'`).
- [ ] **Step 3: Implement `DEPLOY_RULES`, `matchDeploy`, `groupBursts` in `src/logs/milestones.js`** (comentário de cabeçalho no estilo dos outros módulos de `src/logs/`).
- [ ] **Step 4: Run** — `node --test scripts/test-logs-milestones.mjs` → PASS.
- [ ] **Step 5: Commit** — `git add src/logs/milestones.js scripts/test-logs-milestones.mjs package.json` e `git commit -m "Logs: detectar deploys do WildFly e agrupar rajadas"` (com a linha Co-Authored-By).

---

### Task 2: Atribuir marco a problema, commits de um deploy, juntar e sugerir repo (puro)

**Files:**
- Modify: `src/logs/milestones.js`
- Modify: `scripts/test-logs-milestones.mjs`

**Interfaces:**
- Consumes: `Milestone` (Task 1).
- Produces:
  - `prNumber(subject: string) → number|null` — `/^Merge pull request #(\d+)\b/`, ou `/\(#(\d+)\)\s*$/` (squash).
  - `frameBase(frame: string) → string` — `com.x.WorkflowService$Inner.start` → `WorkflowService` (penúltimo segmento sem `$…`); `''` se vazio.
  - `touchesFrame(files: string[], frame: string) → boolean` — algum arquivo cujo nome sem extensão é `frameBase(frame)`.
  - `previousMilestone(sorted: Milestone[], t: number) → Milestone|null` — busca binária, maior `ts <= t`.
  - `commitsInDeploy(deploy: Milestone, prev: Milestone|null, commits: Commit[]) → Commit[]` onde
    `Commit = { hash, ts, subject, title, author, pr, files: string[] }` (Task 5); commits com
    `prev.ts < c.ts <= deploy.ts` (sem `prev`: todos `<= deploy.ts` nos 7 dias anteriores) e algum arquivo com
    segmento de pasta igual a um dos `deploy.artifacts` (comparação sem diferenciar maiúsculas).
  - `attribute(group: { first, frame }, sorted: Milestone[], logStart: number, related: (m) => string[]) → { milestone, gapMs, strong: boolean, faded: boolean } | { preexisting: true } | null`
    — `related(m)` devolve os arquivos ligados ao marco (merge: `m.files`; deploy: arquivos de `commitsInDeploy`;
    manual/restart: `[]`). `null` quando não há marco antes. `faded` = `gapMs > 86400e3`.
  - `mergeMilestones(deploys: Milestone[], manual: Milestone[], merges: Milestone[], enabled = { deploy: true, merge: true, manual: true }) → Milestone[]` — ordenado por `ts`; `enabled.deploy` cobre `deploy|undeploy|restart`.
  - `suggestRepo(artifacts: string[], repos: Array<{ path, folders: string[] }>) → string|null` — primeiro repo com pasta igual (sem maiúsculas) a algum artefato.
  - `previousSameArtifact(sorted: Milestone[], deploy: Milestone) → Milestone|null` — deploy anterior com algum artefato em comum.

- [ ] **Step 1: Write the failing tests** (no mesmo arquivo):

```js
const ms = [
  { id: 'deploy:1000', kind: 'deploy', ts: 1000, artifacts: ['wgPortalRH'], label: 'deploy wgPortalRH' },
  { id: 'merge:5000', kind: 'merge', ts: 5000, files: ['src/com/x/WorkflowService.java'], label: '#126', pr: 126 },
];
const rel = (m) => m.files || [];

test('prNumber: merge do GitHub e squash', () => {
  assert.equal(M.prNumber('Merge pull request #126 from tonissx/x'), 126);
  assert.equal(M.prNumber('Logs: abrir outro log (#127)'), 127);
  assert.equal(M.prNumber('ajuste'), null);
});

test('frameBase e touchesFrame', () => {
  assert.equal(M.frameBase('com.fluig.workflow.WorkflowService$1.start'), 'WorkflowService');
  assert.equal(M.touchesFrame(['src/com/x/WorkflowService.java'], 'com.x.WorkflowService.start'), true);
  assert.equal(M.touchesFrame(['src/Outro.java'], 'com.x.WorkflowService.start'), false);
  assert.equal(M.touchesFrame(['a.js'], ''), false);
});

test('attribute: marco anterior, intervalo e suspeito forte', () => {
  const r = M.attribute({ first: 5000 + 14 * 60e3, frame: 'com.x.WorkflowService.start' }, ms, 0, rel);
  assert.equal(r.milestone.id, 'merge:5000');
  assert.equal(r.gapMs, 14 * 60e3);
  assert.equal(r.strong, true);
  assert.equal(r.faded, false);
});

test('attribute: erro no começo do log é pré-existente', () => {
  assert.deepEqual(M.attribute({ first: 30e3, frame: '' }, ms, 0, rel), { preexisting: true });
});

test('attribute: log que começa depois do marco não atribui', () => {
  assert.deepEqual(M.attribute({ first: 10 * 60e3, frame: '' }, ms, 6000, rel), { preexisting: true });
});

test('attribute: mais de 24 h fica sem destaque', () => {
  assert.equal(M.attribute({ first: 5000 + 2 * 86400e3, frame: '' }, ms, 0, rel).faded, true);
});

test('commitsInDeploy: só commits na pasta do artefato entre os dois deploys', () => {
  const dep = { kind: 'deploy', ts: 10000, artifacts: ['wgPortalRH'] };
  const prev = { kind: 'deploy', ts: 2000, artifacts: ['wgPortalRH'] };
  const commits = [
    { hash: 'a', ts: 1500, files: ['wgPortalRH/src/main/a.js'] },
    { hash: 'b', ts: 3000, files: ['wgportalrh/src/b.js'] },
    { hash: 'c', ts: 4000, files: ['outra/c.js'] },
    { hash: 'd', ts: 12000, files: ['wgPortalRH/d.js'] },
  ];
  assert.deepEqual(M.commitsInDeploy(dep, prev, commits).map((c) => c.hash), ['b']);
});

test('mergeMilestones respeita os tipos ligados', () => {
  const d = [{ id: 'restart:3', kind: 'restart', ts: 3 }];
  const m = [{ id: 'merge:2', kind: 'merge', ts: 2 }];
  const u = [{ id: 'x', kind: 'manual', ts: 1 }];
  assert.deepEqual(M.mergeMilestones(d, u, m).map((x) => x.ts), [1, 2, 3]);
  assert.deepEqual(M.mergeMilestones(d, u, m, { deploy: false, merge: true, manual: true }).map((x) => x.kind), ['manual', 'merge']);
});

test('suggestRepo pela pasta da widget', () => {
  assert.equal(M.suggestRepo(['wgPortalRH'], [{ path: 'C:/a', folders: ['docs'] }, { path: 'C:/b', folders: ['WGPortalRH'] }]), 'C:/b');
  assert.equal(M.suggestRepo(['x'], [{ path: 'C:/a', folders: ['docs'] }]), null);
});
```

- [ ] **Step 2: Run** — `node --test scripts/test-logs-milestones.mjs` → FAIL (funções não definidas).
- [ ] **Step 3: Implement** as funções acima em `src/logs/milestones.js` e exporte.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Logs: atribuir marcos aos problemas e commits de cada deploy"`.

---

### Task 3: Operação `deploys` no worker (incremental)

**Files:**
- Modify: `electron/logs/engine.js` (estado da sessão `s.deployScan`, função `deploys`, entrada em `OPS` na linha ~528)
- Modify: `electron/main.js:1224` (acrescentar `'deploys'` a `LOGS_WORKER_API`)
- Modify: `electron/preload.js` (bloco `logs:` ~linha 504: `deploys: (args) => ipcRenderer.invoke('logs:deploys', args),`)
- Test: `scripts/test-logs-service.mjs`

**Interfaces:**
- Consumes: `matchDeploy`, `groupBursts` (Task 1).
- Produces: worker op `deploys({ id }) → { milestones: Milestone[], scanned: number }`.
  - `s.deployScan = { upto: 0, events: [] }`; cada chamada percorre `upto..ix.n-1`, só entradas com
    `ix.level[i] === 3` (INFO) ou 0, texto `ix.firstLine(i, 400)`, `ts = ix.ts[i]` (ignora não finitos);
    guarda `events` e devolve `groupBursts(events)`.
  - Quando o índice é recriado (reabrir/`reset`/reformat), `s.deployScan` volta a `{ upto: 0, events: [] }` —
    zere no mesmo ponto em que o engine cria `s.index` novo.

- [ ] **Step 1: Write the failing tests** em `scripts/test-logs-service.mjs` (use `setup()`, `line()` e o fluxo de abertura dos testes existentes do engine; o arquivo de log é gravado no `dir` temporário):

```js
const DEP = (s, a) => line(s, 'INFO', `WFLYSRV0010: Deployed "${a}.war" (runtime-name : "${a}.war")`);

test('deploys: acha os deploys, agrupa e continua do ponto onde parou', async () => {
  const dir = tmp();
  const f = path.join(dir, 'server.log');
  fs.writeFileSync(f, DEP(1, 'wgA') + line(2, 'ERROR', 'falha'));
  const e = createEngine();
  await e.call('open', { id: 'a', files: [{ path: f, name: 'server.log' }], tail: false });
  let r = e.call('deploys', { id: 'a' });
  assert.equal(r.milestones.length, 1);
  assert.equal(r.milestones[0].label, 'deploy wgA');
  fs.appendFileSync(f, line(3, 'INFO', 'ok') + DEP(59, 'wgB') + line(59, 'INFO', 'fim'));
  // wgB a 58 s do wgA: mesma rajada (< 2 min)
  await e.call('grow', { id: 'a' });
  r = e.call('deploys', { id: 'a' });
  assert.equal(r.milestones.length, 1);
  assert.deepEqual(r.milestones[0].artifacts, ['wgA', 'wgB']);
  assert.equal(r.scanned, e.call('info', { id: 'a' }).n);
});

test('deploys: usa o ts do índice', async () => {
  const dir = tmp();
  const f = path.join(dir, 'server.log');
  fs.writeFileSync(f, '10:00:01,000 INFO  [org.jboss.as.server] (MSC) WFLYSRV0010: Deployed "wgA.war" (runtime-name : "wgA.war")\n');
  const e = createEngine();
  await e.call('open', { id: 'a', files: [{ path: f, name: 'server.log' }], tail: false });
  e.call('query', { id: 'a', qid: 1, q: '' });
  const ts = e.call('rows', { id: 'a', qid: 1, from: 0, count: 1 }).rows[0].ts;
  assert.ok(Number.isFinite(ts));
  assert.equal(e.call('deploys', { id: 'a' }).milestones[0].ts, ts);
});

test('deploys: reset recomeça a varredura', async () => {
  const dir = tmp();
  const f = path.join(dir, 'server.log');
  fs.writeFileSync(f, DEP(1, 'wgA'));
  const e = createEngine();
  await e.call('open', { id: 'a', files: [{ path: f, name: 'server.log' }], tail: false });
  assert.equal(e.call('deploys', { id: 'a' }).milestones.length, 1);
  fs.writeFileSync(f, line(1, 'INFO', 'sem deploy'));
  await e.call('open', { id: 'a', files: [{ path: f, name: 'server.log' }], tail: false }); // o serviço reabre assim no reset
  assert.equal(e.call('deploys', { id: 'a' }).milestones.length, 0);
});
```

- [ ] **Step 2: Run** — `node --test scripts/test-logs-service.mjs` → os 3 novos FAIL (`op desconhecida: deploys` ou equivalente).
- [ ] **Step 3: Implement** `deploys` no engine, a entrada em `LOGS_WORKER_API` e no preload.
- [ ] **Step 4: Run** — `node --test scripts/test-logs-service.mjs` → PASS (todos, inclusive os antigos).
- [ ] **Step 5: Commit** — `git commit -m "Logs: operação deploys no worker, incremental"`.

---

### Task 4: Repositório ligado e marcos manuais por log (serviço)

**Files:**
- Modify: `electron/logs/service.js` (`state.meta = {}` lido/gravado em `init`/`persist`; funções `meta`, `saveMeta`; exportar)
- Modify: `electron/main.js:1219` (`'meta', 'saveMeta'` em `LOGS_SVC_API`)
- Modify: `electron/preload.js` (`meta: (spec) => …invoke('logs:meta', spec)`, `saveMeta: (spec, m) => …invoke('logs:saveMeta', spec, m)`)
- Test: `scripts/test-logs-service.mjs`

**Interfaces:**
- Produces:
  - `meta(spec) → { repo: string|null, manual: Milestone[], show: { deploy: boolean, merge: boolean, manual: boolean } }`
    (padrão `{ repo: null, manual: [], show: { deploy: true, merge: true, manual: true } }`), chave `keyOf(spec)`.
  - `saveMeta(spec, patch) → meta` — mescla `patch`; normaliza: `repo` string ≤ 500 ou `null`; `manual` até 200
    itens `{ id (≤40, gera se faltar), kind: 'manual', ts (finito), label (≤200, obrigatório) }`, inválidos
    descartados; `show` só booleanos. Grava com `persist()`.

- [ ] **Step 1: Write the failing tests**

```js
test('meta: padrão, salvar repo e marcos manuais, e reabrir o serviço', async () => {
  const t = setup();
  await t.svc.init();
  const spec = { kind: 'file', path: path.join(t.dir, 'server.log') };
  assert.deepEqual(t.svc.meta(spec), { repo: null, manual: [], show: { deploy: true, merge: true, manual: true } });
  await t.svc.saveMeta(spec, { repo: 'C:/repos/fluig', manual: [{ ts: 1000, label: 'dsPedido' }, { ts: 'x', label: '' }] });
  await t.svc.flush?.();
  const again = createLogsService({ file: path.join(t.dir, 'logs.json'), callWorker: async () => ({}), watch: () => ({ close() {}, on() {} }), pollMs: 3600e3 });
  await again.init();
  const m = again.meta(spec);
  assert.equal(m.repo, 'C:/repos/fluig');
  assert.equal(m.manual.length, 1);
  assert.equal(m.manual[0].kind, 'manual');
  assert.ok(m.manual[0].id);
});
```

(Se o serviço não tiver `flush`, aguarde a gravação do jeito que os testes de `savePresets` existentes fazem.)

- [ ] **Step 2: Run** — FAIL (`t.svc.meta is not a function`).
- [ ] **Step 3: Implement** `meta`/`saveMeta`, IPC e preload.
- [ ] **Step 4: Run** — `node --test scripts/test-logs-service.mjs` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Logs: repositório ligado e marcos manuais salvos por log"`.

---

### Task 5: Leitura `milestones` no serviço Git

**Files:**
- Modify: `src/git/parse.js` (`MILESTONE_FORMAT`, `parseMilestones`)
- Modify: `electron/git/service.js` (função `milestones`, perto de `activity` ~linha 380; exportar na linha ~881)
- Modify: `electron/main.js:855` (`'milestones'` em `GIT_API`)
- Modify: `electron/preload.js` (bloco `git:` `milestones: (repo, opts) => ipcRenderer.invoke('git:milestones', repo, opts),`)
- Test: `scripts/test-git.mjs`

**Interfaces:**
- Consumes: `prNumber` (Task 2) — `require('../logs/milestones.js')` dentro de `parse.js`.
- Produces:
  - `MILESTONE_FORMAT = '%x1e%H%x1f%ct%x1f%an%x1f%s%x1f%b%x1d'`
  - `parseMilestones(stdout) → Commit[]` onde `Commit = { hash, ts (ms), subject, title, author, pr, files: string[] }`;
    `title` = primeira linha não vazia do corpo se o assunto é `Merge pull request …`, senão o assunto; arquivos =
    linhas não vazias depois do `%x1d`.
  - `milestones(repo, { since, until, ref } = {}) → { ref: string, commits: Commit[] } | { error: string }`
    - ref: `ref` (validado com `validRev`) ou o primeiro que existir entre `origin/main`, `main`, `origin/master`,
      `master`, `HEAD` (`git rev-parse --verify --quiet <r>^{commit}`, `ok: [0, 1]`).
    - sem HEAD (`hasHead`) → `{ ref: '', commits: [] }`; repo fora da lista/inexistente → `{ error: 'Repositório não encontrado' }` (capture o erro de `repoOf`).
    - comando: `log --first-parent -m --name-only --max-count=500 --format=<MILESTONE_FORMAT> [--since=ISO] [--until=ISO] <ref>`.
    - commits mais antigos primeiro (inverta a saída do git).

- [ ] **Step 1: Write the failing tests** em `scripts/test-git.mjs` (use `setup()`, `makeRepo`, `sh`, `write`):

```js
test('milestones: merges da main com arquivos da PR e número', async () => {
  const t = await setup();
  try {
    const dir = makeRepo(t.root);
    await t.svc.add(dir);
    sh(dir, 'checkout', '-q', '-b', 'feat');
    write(dir, 'wgPortalRH/src/a.js', 'x');
    sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'mexe na widget');
    sh(dir, 'checkout', '-q', 'main');
    sh(dir, 'merge', '--no-ff', '-q', '-m', 'Merge pull request #7 from x/feat\n\nWidget nova', 'feat');
    const r = await t.svc.milestones(dir, {});
    assert.equal(r.ref, 'main');
    const m = r.commits[r.commits.length - 1];
    assert.equal(m.pr, 7);
    assert.equal(m.title, 'Widget nova');
    assert.deepEqual(m.files, ['wgPortalRH/src/a.js']);
    assert.equal(r.commits.length, 2); // inicial + merge (first-parent: o commit da feat não aparece)
  } finally { t.done(); }
});

test('milestones: sem origin usa main/master; vazio devolve []', async () => {
  const t = await setup();
  try {
    const empty = makeRepo(t.root, 'vazio', { empty: true });
    await t.svc.add(empty);
    assert.deepEqual(await t.svc.milestones(empty, {}), { ref: '', commits: [] });
    const m = makeRepo(t.root, 'velho');
    sh(m, 'branch', '-m', 'main', 'master');
    await t.svc.add(m);
    assert.equal((await t.svc.milestones(m, {})).ref, 'master');
  } finally { t.done(); }
});

test('milestones: repo inexistente devolve erro claro', async () => {
  const t = await setup();
  try {
    assert.deepEqual(await t.svc.milestones(path.join(t.root, 'nada'), {}), { error: 'Repositório não encontrado' });
  } finally { t.done(); }
});
```

(O `git commit -q` só aparece dentro do teste, para montar o repositório. A regra "sem `-q`" vale para os commits
deste trabalho.)

- [ ] **Step 2: Run** — `node --test scripts/test-git.mjs` → os 3 novos FAIL.
- [ ] **Step 3: Implement** `MILESTONE_FORMAT`, `parseMilestones`, `milestones`, IPC e preload.
- [ ] **Step 4: Run** — `node --test scripts/test-git.mjs` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Git: leitura dos marcos da main (merges com arquivos e PR)"`.

---

### Task 6: Hook `useMilestones` e seletor de repositório

**Files:**
- Create: `src/tools/logs/useMilestones.js`
- Modify: `src/tools/logs/LogView.jsx` (chamar o hook; seletor no cabeçalho do log)
- Modify: `renderer/logs.css` (estilos do seletor e da sugestão)

**Interfaces:**
- Consumes: `logsApi().deploys/meta/saveMeta` (Tasks 3–4), `window.devkit.git.list/milestones/files` (Task 5 e existentes),
  `mergeMilestones`, `suggestRepo`, `commitsInDeploy`, `previousSameArtifact` (Tasks 1–2).
- Produces: `useMilestones({ id, spec, tsMin, tsMax, appendedNonce }) → { list: Milestone[] (filtrado por show), all: Milestone[], meta, setMeta(patch), repos: Array<{ path, name }>, suggestion: string|null, repoError: string|null, related(m) → string[], commitsOf(m) → Commit[], loading: boolean }`
  - Deploys: busca ao abrir e a cada evento `appended`/`reset` do log (o `LogView` já escuta `onChanged`; passe um
    contador que muda nesses eventos como `appendedNonce`).
  - Merges: `git.milestones(meta.repo, { since: tsMin - 7*86400e3, until: tsMax + 3600e3 })` quando `meta.repo`,
    `tsMin` ou `tsMax` (arredondado para a hora) mudam; `{ error }` → `repoError`, merges vazios.
  - Merge vira `Milestone { id: 'merge:' + hash, kind: 'merge', ts, hash, pr, label: pr ? '#' + pr + ' ' + title : title, author, files }`.
  - `related(m)`: merge → `m.files`; deploy/undeploy/restart → arquivos de `commitsInDeploy(m, previousSameArtifact(all, m), commits)`; manual → `[]`.
  - Sugestão: sem `meta.repo` e com deploys, monta `folders` de cada repo da lista com `git.files(repo)` (só os
    primeiros dois segmentos de pasta, uma vez por sessão do hook) e chama `suggestRepo`.
- Seletor (cabeçalho do log, ao lado do formato): `Repositório: <nome> ▾` com os repos de `git.list()` e "Nenhum";
  com `suggestion`: botão "Ligar a <nome>?"; com `repoError`: texto "Repositório não encontrado" em tom de aviso.

- [ ] **Step 1: Implement** `useMilestones.js` e o seletor.
- [ ] **Step 2: Verify in the app** — usando o skill `run`: abrir um `server.log` com linhas `WFLYSRV0010`, ligar um
  repositório, conferir no DevTools (`await window.devkit.logs.deploys({ id })` e
  `await window.devkit.git.milestones(repo, {})`) que os dados chegam, e que trocar para "Nenhum" some com os merges.
- [ ] **Step 3: Run** `npm test` → PASS.
- [ ] **Step 4: Commit** — `git commit -m "Logs: juntar marcos de deploy, manuais e da main; ligar log a um repositório"`.

---

### Task 7: Marcos na Linha do tempo

**Files:**
- Modify: `src/tools/logs/Timeline.jsx` (props novas `milestones`, `show`, `onShow`, `onMilestone`, `onMarkHere`)
- Modify: `src/tools/logs/LogView.jsx:426` (passar as props)
- Modify: `renderer/logs.css`

**Interfaces:**
- Consumes: `useMilestones().list/meta/setMeta/commitsOf` (Task 6).
- Produces: comportamento na tela (sem API nova para outras tasks).

Comportamento (do spec, seção 5):
- Faixa de 14px acima das colunas: ícones `▲` (deploy/undeploy/restart, `var(--tk-accent)`), `◆` (merge, cor do Git
  já usada em `git.css`), `✎` (manual). Linha vertical tracejada de 1px atravessando as colunas, opacidade 0.35.
- Marcos na mesma coluna (`Math.floor((ts - hist.start) / hist.step)`) viram um ícone com contador.
- Hover: tooltip com tipo, hora (`fmtTime`), artefatos ou `#PR título · autor`; deploy com repo ligado:
  "N commits na main desde o deploy anterior (estimativa)".
- Clique no marco: menu "Ir para esta linha no log" (tem `i` → `onSeek(ts)`), "Abrir no Git" (merge ou commit do
  deploy → `window.devkit.app.command({ type: 'go', route: 'git', params: { repo, tab: 'history', hash } })`),
  "Filtrar a partir daqui" (`onRange({ from: ts, to: null })`), e, se manual, "Editar…"/"Excluir".
- Botão direito na área das colunas: "Marcar deploy aqui…" → pede o texto (use o mesmo componente de prompt/diálogo
  que o `LogView` já usa para nomes, ou um `input` inline no menu) → `setMeta({ manual: [...manual, { ts, label }] })`.
- Botão "Marcos" no cabeçalho da Linha do tempo com três toggles (Deploys, Merges, Manuais) → `setMeta({ show })`.
- Recolhida: ao lado dos picos, "N deploys · M merges" (contagem do `list` no intervalo do histograma).

- [ ] **Step 1: Implement** a faixa, o menu, o botão direito e os toggles.
- [ ] **Step 2: Verify in the app** — com o mesmo log da Task 6: os marcos aparecem nas colunas certas; um restart
  com muitos `.war` mostra um ícone só; "Marcar deploy aqui…" cria um marco que continua lá depois de fechar e reabrir
  o log; "Abrir no Git" abre o commit no Histórico; desligar "Merges" esconde os ◆. Conferir nos temas claro e escuro.
- [ ] **Step 3: Commit** — `git commit -m "Logs: marcos de deploy e merge na linha do tempo"`.

---

### Task 8: Etiqueta "depois de…" em Problemas e marco na Investigação

**Files:**
- Modify: `src/tools/logs/Problems.jsx` (props `milestones`, `logStart`, `related`, `onMilestone`; etiqueta; ordem nova)
- Modify: `src/tools/logs/LogView.jsx:495` (passar props; `logStart = sum.tsMin`)
- Modify: `src/tools/logs/Investigation.jsx` / `src/logs/investigation.js` só se "adicionar marco" precisar de campo novo — preferir item comum `{ text: 'Marco: ' + label, ts, level: 3, tag: 'suspeita' }` (sem mudar o modelo)
- Modify: `renderer/logs.css`

**Interfaces:**
- Consumes: `attribute` (Task 2), `useMilestones().all/related` (Task 6), o menu de marco da Task 7 (extraia o menu para um componente `MilestoneMenu` em `src/tools/logs/MilestoneMenu.jsx` e use nas duas telas).

Comportamento:
- Em `lg-prob__meta`, para cada grupo: `attribute(g, all, logStart, related)`:
  - `{ milestone, gapMs }` → `▲ 14 min depois do deploy de wgPortalRH` / `◆ 2 h depois do #126 Logs: abrir…`
    (intervalo com o formatador de duração que `shared.jsx` já tem; se não tiver, `ago`), título truncado em 40.
  - `strong` → etiqueta preenchida, ícone `crosshair`, tooltip `O #126 alterou WorkflowService.java, onde este erro acontece`.
  - `faded` → etiqueta só em texto discreto.
  - `preexisting` → `já existia no início do log` discreto.
  - `null` → nada.
  - Clique na etiqueta → `MilestoneMenu` + "Adicionar à investigação".
- Nova ordem em `SORTS`: `{ id: 'milestone', label: 'Depois do último marco' }` — grupos com `first` depois do marco
  mais recente primeiro, depois por `count`.

- [ ] **Step 1: Implement** a etiqueta, `MilestoneMenu`, a ordem nova e o "Adicionar à investigação".
- [ ] **Step 2: Verify in the app** — log de teste com: deploy de `wgPortalRH` às 10:00 e um erro com frame numa
  classe alterada pelo commit da widget surgindo às 10:14 (etiqueta forte "14 min depois do deploy de wgPortalRH"); um
  erro presente desde a primeira linha ("já existia no início do log"); a ordem "Depois do último marco" coloca o
  primeiro no topo; "Adicionar à investigação" cria o item com a tag Suspeita.
- [ ] **Step 3: Run** `npm test` → PASS.
- [ ] **Step 4: Commit** — `git commit -m "Logs: problemas mostram o marco que veio antes"`.

---

### Task 9: Fechamento

- [ ] **Step 1:** Atualizar `docs/FEATURES.md` (seção de Logs) com os marcos: o que aparece, de onde vem e o aviso de
  "suspeita/estimativa".
- [ ] **Step 2:** `npm test` → tudo PASS; rodar o app e repetir a verificação das Tasks 7 e 8.
- [ ] **Step 3:** Commit `git commit -m "Docs: marcos de deploy e merge nos Logs"` e push.
