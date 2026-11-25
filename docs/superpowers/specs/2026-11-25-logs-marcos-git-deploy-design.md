# Logs: marcos de deploy (Fluig) e de merge (Git) — design

Data: 2026-11-25 · Status: rascunho para aprovação

## Intenção

Quem abre um log quer responder rápido: **"a partir de qual mudança isso começou a acontecer?"**. Hoje a ferramenta de
Logs mostra quando cada erro apareceu pela primeira vez (aba Problemas, `first`), mas não mostra o que mudou no código
ou no servidor naquele momento. A ideia é colocar no próprio log os **momentos em que algo novo entrou**:

- **deploys no Fluig** (widgets/layouts publicados — lidos do próprio `server.log`);
- **merges na main** (do repositório Git ligado ao log).

E, a partir disso, apontar em cada problema **o marco que veio logo antes** — com destaque quando o commit mexeu no
arquivo onde o erro acontece.

Tem que ser **fácil e claro de enxergar**: o antes/depois visível na Linha do tempo sem ler nada, e a frase
"apareceu 14 min depois do deploy de wgPortalRH" direto na linha do problema.

## Metas

1. Marcos na Linha do tempo: deploy (Fluig) e merge (main), distinguíveis por cor/forma, com detalhes no hover.
2. Na aba Problemas, para cada grupo: o marco imediatamente anterior à primeira ocorrência, com o intervalo.
3. "Suspeito forte" quando um commit do marco alterou o arquivo do `frame` do erro.
4. Deploy detectado sem configuração nenhuma (linhas do WildFly); marco manual como reserva (datasets, formulários,
   eventos de processo publicados pelo Studio, que podem não deixar linha no log).
5. No marco de deploy: os commits na main que mexeram naquela widget desde o deploy anterior (estimativa).
6. Clique no marco ou no commit leva à ferramenta Git, no commit (e no diff do arquivo, quando houver).

## Não-metas

- Não consultar o servidor Fluig (API, login, banco). Tudo vem do log, do git local e do que o usuário marca.
- Não fazer deploy pelo Devkit.
- Não afirmar causa. É sempre **suspeita** ("começou depois de"), nunca "causado por".
- Não buscar na rede: usa as refs que o repositório já tem (o fetch automático de 15 min já mantém `origin/main`).

## Anti-metas (falharia mesmo "funcionando")

- Dizer "começou depois do #126" para um erro que já existia antes — porque o log começa depois do merge, ou o erro
  aparece nas primeiras linhas. Isso destrói a confiança na funcionalidade.
- Linha do tempo poluída: dezenas de linhas verticais tapando as colunas de erro.
- Exigir configuração antes de mostrar qualquer coisa: os marcos de deploy aparecem sem repositório ligado.
- Deixar a abertura/filtragem do log mais lenta (o git roda à parte, com cache; o log aparece antes dos marcos).

## Restrições do projeto

- Lógica pura em `src/logs/` (testável com `node --test`, como `scripts/test-logs.mjs`); fs/git no processo principal
  (`electron/logs/service.js`, `electron/git/service.js`); tela em `src/tools/logs/*.jsx` (React global, `DS`).
- Git sempre via `execFile` sem shell, só leitura, argumentos validados (`validRev`, `validPath`).
- Persistência em `%APPDATA%\Toni Devkit\logs.json` (já existe `overrides` por caminho de log).
- Textos e comentários em português, no tom do resto do código.

## Abordagens consideradas

| | Como obtém o deploy | Troca | Decisão |
|---|---|---|---|
| **A. Ler do log + marco manual** | Linhas `WFLYSRV0010 Deployed`/`WFLYSRV0009 Undeployed` no `server.log`; o resto, marcado à mão | Zero configuração; cobre widgets/layouts; datasets/forms dependem do marco manual | **Escolhida** (com marcos de merge do Git) |
| B. Só marcos manuais | Usuário marca | Simples, mas ninguém marca log antigo/de produção | Descartada |
| C. API do Fluig | Consulta o servidor | Exige login e o Fluig não tem histórico de deploy confiável | Descartada |

## Como funciona

### 1. Marcos de deploy (do log)

Módulo puro novo `src/logs/milestones.js`:

- `detectDeploys(index)` percorre as entradas (só as de nível INFO do formato `jboss`, mensagem curta — barato) e
  reconhece:
  - `WFLYSRV0010: Deployed "<nome>.war"` → `{ kind: 'deploy', ts, i, artifact: '<nome>' }`
  - `WFLYSRV0009: Undeployed "<nome>.war"` → `{ kind: 'undeploy', … }`
  - `WFLYSRV0025`/`WFLYSRV0026` (servidor iniciou) → `{ kind: 'restart', ts, i }` — reinício também é um marco
    útil ("começou depois que o servidor subiu").
  - O padrão é uma lista de regras (regex + kind) para acrescentar depois as linhas de dataset/formulário quando
    houver um exemplo real.
- **Agrupar rajadas**: um restart publica dezenas de `.war` em segundos. Deploys a menos de 2 min uns dos outros
  viram **um marco** com a lista de artefatos ("restart · 38 apps"), para não poluir.
- Roda no worker junto com a indexação (incremental no modo ao vivo: só as entradas novas).

### 2. Marcos manuais

- Botão direito na Linha do tempo (ou numa linha da lista) → **"Marcar deploy aqui…"**: pede o que foi publicado
  (texto livre: `dsPedidoCompra`, `formulário RH`) e grava `{ kind: 'manual', ts, label }`.
- Guardado em `logs.json`, por caminho do log (mesmo lugar de `overrides`), para reaparecer ao reabrir.
- Pode editar o texto e excluir pelo botão direito no marco.

### 3. Marcos de merge (Git)

- **Ligar o log a um repositório**: um seletor pequeno no cabeçalho do log ("Repositório: —") com os repositórios de
  `git-repos.json`. Escolha lembrada por caminho do log em `logs.json`.
  - Sugestão automática: se algum deploy detectado tem nome de artefato igual a uma pasta de primeiro/segundo nível de
    um repositório da lista (`wgPortalRH.war` ↔ `wgPortalRH/`), sugerir esse repositório ("Ligar a toni-fluig?").
- Função nova (leitura) em `electron/git/service.js`: `milestones(repo, { since, until, ref })`
  - `ref` padrão: `origin/main` se existir, senão `main`/`master` local.
  - `git log --first-parent <ref> --since --until --format=%H%x1f%ct%x1f%s%x1f%an --name-only -m` (os arquivos de cada
    commit da linha principal contra o 1º pai — num merge de PR, é tudo que a PR trouxe).
  - Margem: busca desde `tsMin - 7 dias` para achar o "marco anterior" mesmo quando o log começa depois dele, e o
    deploy anterior a cada deploy.
  - Número da PR tirado do assunto (`Merge pull request #126 from …`) quando houver; o título da PR é o corpo/segunda
    linha — mostrar o título se tiver, senão o assunto.
  - Limite de 500 commits por chamada; resultado em cache por `(repo, ref, cabeça do ref, intervalo)`.
- Hora do commit: **hora do commit** (`%ct`), que num merge pelo GitHub é a hora do merge.

### 4. Ligações entre marcos e erros (puro, em `milestones.js`)

- `previousMilestone(milestones, t)`: o marco mais recente com `ts <= t` (busca binária).
- `attribute(group, milestones, logStart)` → `{ milestone, gapMs, confidence }` para cada grupo de Problemas:
  - **Só atribui** se `milestone.ts > logStart` **e** a primeira ocorrência do grupo está pelo menos 1 min depois do
    início do log. Se não, o resultado é `{ preexisting: true }` → texto "já existia quando o log começa".
  - `first` é a primeira ocorrência no log inteiro (não só no filtro), então o marco escolhido nunca tem ocorrência
    daquele erro antes dele.
  - `confidence: 'strong'` quando algum commit ligado ao marco alterou o arquivo do `frame`
    (`Pedido.java:42` → procurar caminho terminado em `/Pedido.java` nos arquivos do commit; para JS de widget, o
    nome do arquivo `.js`). Senão `'time'`.
  - Intervalo muito grande (> 24 h) → mostra, mas sem destaque ("3 dias depois do …").
- `commitsInDeploy(deploy, prevDeploySameArtifact, commits, repoFolders)` → commits na main entre os dois deploys que
  mexeram em arquivos sob a pasta do artefato. Mostrado como **estimativa**: "commits na main que mexeram em
  wgPortalRH desde o deploy anterior".
- Para um marco de deploy, os "commits ligados" (usados no 'strong') são esses `commitsInDeploy`; para um marco de
  merge, os arquivos do próprio merge.

### 5. Tela

**Linha do tempo** (`Timeline.jsx`): faixa de marcos logo acima das colunas (não por cima delas):

```
  ▲wgPortalRH        ◆#126            ▲restart·38
 ▂▂▁▂▁▂│▁▂▁▂▂▅▇█▇▆▅│▃▂▂▁▂▁▂│▂▁▂
```

- `▲` deploy/restart (cor de destaque), `◆` merge (cor neutra/roxa do Git), `✎` manual. Linha vertical tracejada e
  fina atravessando as colunas, com baixa opacidade.
- Marcos muito próximos (mesma coluna) se juntam num só com contador; hover lista todos.
- Hover: tipo, hora, artefato(s) ou PR/título/autor e, no deploy, "3 commits na main desde o deploy anterior".
- Clique: menu com "Ir para esta linha no log" (deploy/restart), "Abrir no Git" (merge/commit), "Filtrar a partir
  daqui" (range = do marco ao fim).
- Liga/desliga por tipo num botãozinho "Marcos" no cabeçalho da Linha do tempo (lembrado). Com a Linha do tempo
  recolhida, a faixa fina mostra "2 deploys · 5 merges".

**Problemas** (`Problems.jsx`): nova etiqueta na linha `lg-prob__meta`:

- `▲ 14 min depois do deploy de wgPortalRH` / `◆ 2 h depois do #126 Logs: abrir outro…`
- `confidence: 'strong'` → etiqueta preenchida + ícone de alvo e tooltip "O #126 alterou Pedido.java, onde este erro
  acontece".
- `preexisting` → texto discreto "já existia no início do log".
- Clique na etiqueta: mesmo menu do marco.
- Nova ordem "Depois do último marco" (os que surgiram depois do marco mais recente vêm primeiro).

**Investigação**: "Adicionar à investigação" também aceita um marco (vira item com tag `suspeita` e o texto do marco),
para o relatório trazer "começou depois do deploy X".

**Ir para o Git**: hoje não existe navegação entre ferramentas. Criar uma peça mínima: um evento
(`devkit:open-tool` com `{ tool: 'git', repo, commit, path? }`) que a casca troca de ferramenta e o `GitScreen`
consome ao montar/receber (abre o repo, aba Histórico, seleciona o commit e, com `path`, o diff do arquivo).

### 6. Desempenho

- Detecção de deploy dentro da indexação no worker: um teste de prefixo (`WFLYSRV00`) antes do regex.
- Git roda depois que o log aparece, em segundo plano; marcos de merge chegam depois e a tela se atualiza.
- No ao vivo: deploys novos entram com a leitura incremental; o git é consultado de novo só quando o ref muda
  (o watcher do Git já avisa) ou a cada fetch automático.

## Testes

- `scripts/test-logs-milestones.mjs` (novo, entra no `npm test`): detecção (linhas reais do WildFly, rajada de restart
  vira um marco), `previousMilestone`, `attribute` (pré-existente, log começando depois do marco, ocorrência antes do
  marco, 'strong' por arquivo do frame), `commitsInDeploy`, parse do número da PR.
- `scripts/test-logs-service.mjs`: marcos manuais e repositório ligado persistem por caminho.
- `scripts/test-git.mjs`: `milestones()` num repositório de teste com merges `--no-ff`.

## Deixado para quem construir

- Cores exatas dos marcos (usar tokens dos temas existentes, conferir contraste nos temas escuros).
- Onde exatamente fica o seletor de repositório no cabeçalho do log.
- Texto final dos tooltips.
- Fuso: assumir que o log e o git estão no mesmo fuso do computador (o parser já trata datas locais). Se aparecer
  divergência real, um ajuste de fuso por log fica para depois.

## Pendente de exemplo real

- Linhas de log de publicação de **dataset**, **formulário** e **evento de processo** pelo Fluig Studio. Com um trecho
  de `server.log`, viram regras novas em `detectDeploys` e o marco manual vira exceção.
