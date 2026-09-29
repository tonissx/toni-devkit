# Toni Devkit

Aplicativo desktop (Electron) que reúne ferramentas para devs.

## Objetivo

O Toni Devkit é uma caixa de ferramentas offline para o dia a dia de desenvolvimento — cada ferramenta roda
localmente, sem depender de sites externos.

## Instalação

Requisitos: **Node 20+**.

```bash
git clone https://github.com/tonissx/toni-devkit.git
cd toni-devkit
npm install
npm start          # compila o renderer e abre o app
```

Outros comandos úteis:

```bash
npm run dev        # como o start, mas com DevTools abertas
npm test           # testa os motores SQL e XML no Node (sem Electron)
npm run dist       # gera instalador Windows (NSIS) + portable em dist/
npm run dist:mac   # gera .dmg (macOS)
npm run dist:linux # gera AppImage (Linux)
```

## Ferramentas

| Ferramenta | Status |
| --- | --- |
| **SQL Formatter**: formata no mesmo padrão do sqlformat.org | ✅ |
| **XML Formatter**: formata nos moldes do vscode-xml (LemMinX) | ✅ |
| **Diff Checker**: compara dois textos nos moldes do diffchecker.com | ✅ |
| **Notes**: memória técnica em Markdown, snippets e busca, integrada à palette | ✅ |
| **DevCore**: infraestrutura idle com DevPets, descobertas pelo uso do DevKit | ✅ |

### SQL Formatter

O formatador usa **o mesmo motor do sqlformat.org**: o módulo Python [`sqlparse`](https://github.com/andialbrecht/sqlparse)
rodando em [Pyodide](https://pyodide.org) (CPython em WebAssembly), que é justamente o que o sqlformat.org usa hoje.
Por isso a saída é idêntica à do site. Roda 100% offline, num *worker thread* do processo principal.

Opções (persistidas localmente):

- **Palavras-chave**: UPPER · lower · Capitalize · Manter (padrão: UPPER)
- **Identificadores**: UPPER · lower · Capitalize · Manter (padrão: Manter)
- **Indentação**: 1, 2, 3, 4 ou 8 espaços, ou Tab (padrão: 2 espaços)
- **Remover comentários**, **Compacto**, **Saída** em SQL / Python / PHP (as mesmas opções do site)
- **Formatar ao digitar** (debounce), ou manual com `Ctrl+Enter`
- Botão **Padrão sqlformat.org** restaura os padrões do site

Atalhos: `Ctrl+Enter` formatar · `Ctrl+Shift+C` copiar saída · `Ctrl+O` abrir .sql · `Ctrl+S` salvar saída ·
`Ctrl+K` command palette · `Ctrl+\` recolher sidebar · `Ctrl+,` configurações · `Ctrl+1` SQL Formatter.

### XML Formatter

Formatador de XML próprio, em JS puro (sem dependências, roda direto no renderer). As opções seguem os moldes
do **[LemMinX](https://github.com/eclipse-lemminx/lemminx)** — o motor de formatação Java por trás da extensão
[vscode-xml](https://github.com/redhat-developer/vscode-xml) — mas a formatação em si é reimplementada em JS
(o LemMinX é um language server Java, inviável de embutir num app Electron offline). Valida apenas boa-formação
(tags fechadas, aspas terminadas etc.), não contra XSD/DTD.

Opções (persistidas localmente, padrões = padrões do LemMinX):

- **Indentação**: 1, 2, 3, 4 ou 8 espaços, ou Tab (padrão: 4 espaços)
- **Largura máx.**: 80 / 100 / 120 colunas ou sem limite — atributos que estourarem quebram em várias linhas
- **Elementos vazios**: Manter · `<a/>` · `<a></a>` (padrão: Manter)
- **Aspas**: Manter · `"` · `'` (padrão: Manter)
- **Dividir atributos** (um por linha sempre), **Fechamento em nova linha**, **Espaço antes de `/>`**,
  **Juntar linhas de texto/comentário/CDATA**, **Formatar ao digitar**
- Elementos com `xml:space="preserve"` e conteúdo misto (texto + tags juntos) não são reindentados por dentro
- Botão **Padrão VS Code XML** restaura os padrões do LemMinX

Atalhos: `Ctrl+Enter` formatar · `Ctrl+Shift+C` copiar saída · `Ctrl+O` abrir .xml · `Ctrl+S` salvar saída · `Ctrl+2` XML Formatter.

### Diff Checker

Comparador de textos inspirado no [diffchecker.com](https://www.diffchecker.com/pt/). Motor próprio em JS puro
(algoritmo de Myers O(ND) em espaço linear, sem dependências), roda direto no renderer.

- **Visualização**: Lado a lado (com scroll sincronizado) ou Unificado (estilo git)
- **Destaque dentro da linha**: Inteligente (caractere para mudanças pequenas, palavra para as maiores) · Palavra · Caractere
- **Sintaxe**: automática (pela extensão do arquivo ou pelo conteúdo) ou JSON / JavaScript / SQL / XML / Texto
- **Ignorar espaços**, **Ignorar maiúsculas**, **Recolher iguais** (mantém 3 linhas de contexto), **Comparar ao digitar**
- **Mesclar**: os botões `→` / `←` entre os lados aplicam um bloco de mudança no outro texto
- Abrir arquivo em cada lado pelo diálogo ou arrastando o arquivo para o editor (até 20 MB)
- **Recolher editores** deixa a tela toda para o resultado

Atalhos: `Ctrl+Enter` comparar · `Alt+↓` / `Alt+↑` próxima/anterior mudança · `Ctrl+O` abrir no Original ·
`Ctrl+Shift+O` abrir no Alterado · `Ctrl+Shift+S` trocar lados · `Ctrl+3` Diff Checker.

## Command Palette

O centro de interação do Devkit. **`Ctrl+Alt+Space`** é o único atalho global: abre a palette de qualquer lugar —
com o app minimizado, em segundo plano ou só na bandeja — flutuando sobre o app atual, no monitor do cursor,
sem restaurar a janela principal. Dentro do Devkit, `Ctrl+K` abre a mesma palette.

- **Digitou, buscou**: letras são sempre texto. A tela inicial busca em tudo de uma vez: comandos, notas e
  snippets, o texto dos rascunhos das ferramentas e, no fim, a web com o texto digitado (Google, MDN,
  Stack Overflow, GitHub, npm, TDN TOTVS)
- **Categorias com Alt**: `Alt+T` **Tools** · `Alt+A` **Actions** · `Alt+N` **Notes** · `Alt+Q` **Quick Note**
  (em qualquer lugar da palette). `Backspace` com o campo vazio volta um nível. Como o atalho global já tem Alt,
  `Ctrl+Alt+Space` e depois `Q` sem soltar o Alt abre direto a Quick Note
- **Tools**: abre qualquer ferramenta. **Actions**: formatar SQL/XML da área de transferência (sem abrir a janela),
  temas, sidebar, configurações, sair
- Busca por nome, keywords/aliases, descrição e categoria, sem acento e sem maiúsculas; comandos recentes sobem
- `↑`/`↓` navegar · `↵` executar · `Esc` fechar. Sem resultados, oferece buscar na web; erros aparecem na própria
  palette sem fechá-la
- **Bandeja**: fechar a janela mantém o Devkit rodando (o atalho continua valendo). Em Configurações:
  **Iniciar com o Windows** (sobe em segundo plano) e o status do atalho (avisa se outro app já usa `Ctrl+Alt+Space`)

### Adicionando um comando

Inclua um objeto em `src/commands/registry.js`:

```js
{
  id: 'clipboard:json',
  name: 'Formatar JSON da área de transferência',
  description: 'Formata o JSON copiado e copia o resultado',
  category: 'actions',            // 'search' | 'tools' | 'actions'
  icon: 'braces',                 // ícone Lucide
  shortcut: undefined,            // só exibição (ex.: 'Ctrl+1')
  keywords: ['clipboard', 'pretty'],
  run: async (ctx, query) => {    // ctx: openApp, appCommand, openUrl, clipboard, sql, storage, quit
    const text = await ctx.clipboard.read();
    await ctx.clipboard.write(JSON.stringify(JSON.parse(text), null, 2));
    return 'JSON formatado e copiado'; // opcional: confirmação antes de fechar; throw → erro na palette
  },
}
```

Ferramentas novas entram na palette sozinhas a partir de `src/tools/meta.js`.

## Notes

A memória técnica do Devkit: um scratchpad mais uma biblioteca pessoal pesquisável, integrada à Command Palette.
**Capturar leva segundos; organizar fica para depois.**

- **Quick Note**: `Ctrl+Alt+Space` → `Alt+Q` (ou só `Q`, sem soltar o Alt), escreva, `Esc`. Não pede título, pasta nem tipo: o título sai da
  1ª linha, `#tag` no texto vira tag e o auto-save grava enquanto você digita. Não abre a janela principal
- **Recuperar**: `Ctrl+Alt+Space` e digite o que você lembra. A busca geral da palette já traz notas e snippets
  (título, conteúdo, tags, aliases e tipo; sem acento; tolera 1 erro de digitação) com o trecho que casou
- **Categoria Notes na palette** (`Alt+N`): digitar busca só nas notas · `Alt+Q` Quick Note · `Alt+N` New Note ·
  `Alt+P` Pinned · `Alt+R` Recentes
- **Snippets**: na palette, `Enter` **copia** o código e `Ctrl+Enter` abre. No editor, cartão com [Copiar] e
  `Ctrl+Shift+C`
- **Editor** (ferramenta Notes, `Ctrl+4`): Markdown com modos Editar / Lado a lado / Visualizar (`Ctrl+E`),
  headings, listas, tabelas, citações, código com realce, checklists clicáveis e links internos `[[Título]]`
  (clicar abre a nota; se ela não existe, cria). Tags, aliases, pinned e favoritas; filtros Quick · Pinned ·
  Snippets · Favoritas · Recentes (editadas e vistas)
- **Links entre notas**: digitar `[[` abre sugestões de notas (↑/↓, `Enter`/`Tab` completa, `Esc` fecha; "Nova nota: …"
  quando nada casa). Abaixo do editor, **Mencionada em (N)** lista as notas que apontam para a aberta (por título ou
  alias), com a linha do link. Ao trocar o título, o Devkit oferece atualizar os `[[links]]` que usavam o nome antigo
- **Colar e formatar**, no editor e na Quick Note:
  - Imagem (print com `Win+Shift+S`, "Copiar imagem" do navegador) ou arquivo de imagem arrastado → gravada em
    `Devkit Notes\.assets\` e inserida como `![imagem](.assets/…)`; o preview mostra a imagem e o clique abre no
    visualizador do sistema (PNG/JPG/GIF/WebP até 20 MB)
  - Células do Excel, resultado do SSMS ou tabela do navegador → **tabela Markdown** alinhada (colunas numéricas à
    direita). URL colada com texto selecionado → `[texto](url)`. `Ctrl+Shift+V` cola sem transformar
  - `Ctrl+B` negrito · `Ctrl+I` itálico · `Ctrl+K` com texto selecionado vira link (sem seleção, abre a palette) ·
    `Ctrl+Shift+K` vira `` `código` `` (trecho de uma linha) ou bloco ```` ``` ```` (sem seleção / várias linhas). Tudo
    alterna e pode ser desfeito com `Ctrl+Z`
- **Pastas** (subpastas ilimitadas): árvore **Pastas** na lateral, com `+` para criar. Cada pasta é um diretório
  de verdade dentro de `Documentos\Devkit Notes`. A lista vira um explorador em cascata: clicar numa pasta abre as
  subpastas e as notas dela, recuadas e com uma linha-guia leve (as notas soltas ficam no fim, em "Sem pasta"). A
  última pasta clicada — ou a da nota aberta — é onde nascem as notas novas (aparece na barra acima da lista).
  Com busca, filtro ou tag ativos a lista volta a ser plana. Mover: campo **Pasta** no editor, arrastar a nota (ou uma
  pasta) até a pasta de destino, ou botão direito → **Mover para…**. Botão direito na pasta: Nova subpasta ·
  Renomear · Excluir (as notas vão para `.trash\` e dá para desfazer)
- **Tarefas** (`- [ ] texto`), sem digitar a sintaxe à mão:
  - No editor, `Enter` numa tarefa continua a lista (em tarefa vazia, sai dela) · `Ctrl+L` alterna a linha (ou as
    linhas selecionadas) entre texto → `- [ ]` → `- [x]` → texto · `[]` ou `todo` + espaço no começo da linha vira `- [ ] `
  - Prazo e prioridade no texto: `@2026-10-02` (ou `@hoje` / `@amanha` + espaço, que viram a data) e `!1` `!2` `!3`;
    aparecem como chips no preview (prazo vencido em vermelho)
  - Filtro **Tarefas** na ferramenta: todas as tarefas de todas as notas, agrupadas em Vencidas · Hoje · Próximas ·
    Sem data (aba Concluídas à parte); marcar ali grava na nota de origem, clicar no texto abre a nota. A lista
    de notas mostra o progresso (`☑ 3/7`)
  - Na palette: `task: revisar PR #42` (também `tarefa:` e `t:`) acrescenta `- [ ] revisar PR #42` à nota **Inbox**
    (criada se não existir) · comando **Tarefas** abre o filtro
- **Auto-save** em todo lugar, sem botão Salvar: grava ao digitar, ao perder o foco, ao trocar de nota, no `Esc`
  e antes de o app sair. Se o disco falhar, o texto continua no editor e num backup local, com "Tentar de novo"

### Armazenamento

Um arquivo `.md` por nota em **`Documentos\Devkit Notes`** ou numa subpasta dela (as pastas do app são diretórios
reais), com metadados simples no topo (front matter). Dá para abrir em qualquer editor, fazer backup copiando a
pasta, versionar com git e sincronizar pelo OneDrive. A gravação é atômica (arquivo temporário + rename). Excluir
move o arquivo para `.trash\` (mantendo a subpasta), nada é apagado de verdade. Os recentes vistos ficam em
`.devkit\state.json`. Pastas e arquivos cujo nome começa com `.` (`.trash`, `.devkit`, `.git`…) são ignorados. O
processo principal carrega todas as notas em memória na inicialização; a busca roda aí em milissegundos.

> Não há monitoramento de arquivos: criar, mover ou renomear pastas e notas **pelo Explorer** com o app aberto só
> aparece depois de reiniciar o Devkit. Prefira organizar pelo próprio app.

```md
---
id: 20260926-142100-x7k2
title: "SQL — NULL handling"
type: "snippet"
tags: ["sql","rm"]
aliases: ["coalesce"]
pinned: false
favorite: false
created: 2026-09-26T14:21:00.000Z
updated: 2026-09-26T14:25:03.000Z
---
Use `COALESCE(a, b)` …
```

### Integração com outras ferramentas

O serviço de Notes roda no processo principal e é a fonte única da verdade para todas as janelas. Qualquer tela
cria ou consulta notas pela mesma API:

```js
await window.devkit.notes.create({ title: 'Resultado da análise', content: '...', tags: ['sql'], type: 'note', source: 'sql' });
const hits = await window.devkit.notes.search('coalesce', { limit: 5 });
window.devkit.notes.open({ id: hits[0].id }); // abre no editor
```

## DevCore

Uma camada idle opcional: uma pequena infraestrutura de desenvolvimento que cresce sozinha, inclusive com o app
fechado, com **DevPets** trabalhando nela. O DevKit continua sendo o produto; quem não quiser jogar ignora. Fora da
tela do DevCore aparece, no máximo, um ponto discreto no item da sidebar quando há descoberta ou upgrade novo.

- **Compute** é produzido por geradores (Terminal Worker → Local Cluster) em 3 tiers. Cada tier traz uma mecânica
  nova: **T1** produção e upgrades · **T2** sinergias, habilidades dos pets, **estações** (1 vaga: pet na própria
  especialidade rende ×2) e **incidentes** · **T3** mais uma vaga de estação e agentes que orquestram as categorias
- **Incidentes ("pets do mal")**: de tempos em tempos um vilão original invade uma estação — **Leaky** (Memory Leak),
  **Flicker** (Flaky Pipeline), **Swarm** (Traffic Spike), **Forky** (Merge Conflict) e o chefe **Zero** (Zero-day).
  A estratégia é de *preparação*: o próximo incidente aparece na previsão 2 h antes e é **contido** se o DevPet
  certo estiver em estação quando ele começar (contido = sem efeito + 1 consumível + 1 peça de Blueprint). Se escapar, só reduz a
  produção de uma categoria por um tempo (piso ×0,8) — **nunca tira progresso** e acaba sozinho. Com o app fechado
  suas defesas agem por você e o resumo de retorno conta o que aconteceu. **Modo tranquilo** desliga tudo
- **Consumíveis**: Coffee (×1,5 por 10 min), Hotfix (derrota o vilão ativo), Rollback (o próximo incidente já nasce
  contido) e Cache Warmer (zera uma recarga). Vêm de incidentes contidos, de achados dos pets e de **fabricação**
  com Compute (custo = minutos da produção atual); estoque com teto, nunca à venda. Aba **Ops**: previsão, incidente
  ativo, inventário, **bestiário** dos vilões e histórico
- **Marcos por quantidade**: ao chegar em 25/50/100/150/200/250/300 unidades, a produção daquele gerador sobe
  (×1,5 nos dois primeiros, ×2 nos demais). Cada linha da aba Generators mostra o próximo ("×2 em 100 · faltam 15")
- **Blueprints (Mk II / Mk III)**: cada gerador tem um conjunto de 4 peças temáticas por nível. Com o conjunto
  completo, **Refactor** consome as peças e evolui o gerador: Mk II = produção ×3 e próximas unidades ÷4;
  Mk III = mais ×5 (×15 no total) e custo ÷10 (÷40). A estação da categoria muda na cena (moldura e 2ª fileira de
  LEDs no Mk II; brilho e selo "III" no Mk III). Peças vêm de vilões contidos (um gerador da categoria atacada),
  do **Zero** (Mk III), de achados dos pets (30%) ou são **compradas** com Compute (2 h de produção por peça Mk II,
  6 h por Mk III). Peça repetida vira **sucata**: 5 trocam por uma peça Mk II que falta, 8 por uma Mk III
- **DevPets** (criaturas SVG originais), um para cada categoria: Byte (Shell), Noxi (Automation), Query e Memo
  (Data), Relay (Agents) e Armo (Infra) — os dois últimos chegam no Tier 3. Cada um tem especialização, nível (treino),
  bônus e uma habilidade com cooldown (Compile Burst, Parallelize, Index, Recall, Orchestrate, Scale Out)
- **Aparência dos DevPets**: evoluem sozinhos com o nível (**Veterano** no 5 ganha um acessório da espécie;
  **Mestre** no 10 ganha outro e uma aura) e têm **visuais** (Monokai, Neon, Midnight, Solarized, Gold) que você
  desbloqueia por marcos e descobertas — nunca por compra — e escolhe no card do pet. Visuais ficam desbloqueados
  para sempre (`src/devcore/content/appearance.js`)
- **Descobertas**: o uso real do DevKit *desbloqueia* conteúdo (pets, tiers, bônus pequenos com teto), nunca vira
  moeda. Contam **dias distintos** e **ferramentas distintas**: 100 notas num dia valem o mesmo que 1
- **Offline**: sem ticks; o ganho é calculado pelo tempo (taxa × Δt, em trechos a cada evento: habilidade, Coffee, incidente), com
  teto de 8 h (12 h com upgrade). Ao voltar, o resumo "Welcome back" aparece só ao abrir o DevCore
- **Palette**: "devcore" lista Open DevCore / View Generators / Blueprints / DevPets / Upgrades / Discoveries / Ops / Collect
  Offline Progress; habilidades prontas ("Ativar Compile Burst (Byte)") e consumíveis ("Usar Coffee") executam sem
  abrir a janela

### Arquitetura

```
Features (ferramentas, palette, Notes) ── emit ──► Event Bus (electron/events.js: whitelist + throttle)
                                                          │
                                                          ▼
      UI (src/tools/devcore) ◄── IPC ──► DevCore service (electron/devcore/service.js: estado, heartbeat, devcore.json)
                                                          │  dispatch(state, action, now) — puro
                                                          ▼
                                          engine (src/devcore/engine) ◄── content (src/devcore/content: só dados)
```

- **Balanceamento**: todos os números estão em `src/devcore/content/*.js`. `npm run devcore:sim` simula um
  jogador em perfis de uso e imprime a linha do tempo; um teste garante as faixas de ritmo (T2 em 15–60 min de
  sessão ativa, T3 em 1–3 dias de uso casual, 1º Mk II em ~2–4 dias e Mk III em até 2 semanas)
- **Estado** em `%APPDATA%/Toni Devkit/devcore.json` (escrita atômica, versão + migração), separado em `run`
  (o que um futuro *Rebuild* zeraria), `meta` (prestige), `usage`, `discoveries` e `pending`
- **Testes**: `npm run test:devcore` (economia, modificadores, integral por trechos, teto offline, descobertas
  anti-spam, estado, bus, serviço com relógio falso, ritmo)

### Próximos passos: Batalhas (roadmap)

Ideia registrada para depois; **ainda não implementada**. Pré-requisito: usar o DevCore alguns dias e ajustar o ritmo
atual, porque a batalha depende desse balanceamento.

- **Conceito**: inimigos são problemas de infraestrutura (Bugs, Memory Leaks, Race Conditions, Flaky Tests), em ondas
  cada vez mais fortes, com **chefes** a cada N ondas (*Legacy Monolith*, *Production Outage*, *The Merge Conflict*).
  Os DevPets formam o esquadrão e o papel vem da especialização: Byte ataca, Query defende/resiste, Noxi dá
  velocidade e combos, Memo cura e dá suporte
- **Princípios** (os mesmos do DevCore): combate automático/idle, sem reflexo nem atenção constante; ondas comuns
  avançam sozinhas (inclusive offline); chefes são tentativas opcionais disparadas pelo jogador; derrota nunca tira
  progresso; a economia de Compute não depende de batalhas; o uso do DevKit só desbloqueia conteúdo, nunca vira
  força de combate
- **Arquitetura prevista (reuso)**:
  - resultado por fórmula determinística (DPS do esquadrão × vida do inimigo), igual ao cálculo offline por Δt; a
    cena só anima um resultado já calculado (reaproveitando o `director.js`)
  - atributos dos pets (ataque, defesa, vida) derivados do sistema de efeitos/modificadores: nível, estágio,
    especialização; sinergias viram combinações de esquadrão
  - `content/enemies.js` e `content/bosses.js` como dados; ritmo validado pelo `devcore:sim`
  - nova seção de estado `battle` (decidir se fica fora de `run` ou é resetada por um futuro *Rebuild*)
- **Recompensas**: um recurso novo (ex.: *Patches*) pela arquitetura de múltiplos recursos, gasto em melhorias de
  combate e visuais exclusivos; pode virar a porta de entrada para o *Rebuild* (prestige)

## Atualizações

Cada merge na `main` publica uma release. O app instalado (Windows NSIS e Linux AppImage) confere o GitHub 15 s após
abrir, a cada 4 h e quando a janela é aberta/focada (no máximo a cada 10 min); em **Configurações** dá para
verificar na hora. **Baixar** e **Reiniciar e instalar** sempre conferem de novo antes de agir: se saiu uma versão
mais nova que a última verificação, é ela que é baixada/instalada — atualiza uma vez só, direto na última. No macOS e
no Windows portátil o app só avisa e abre a página da última release.

## Estrutura

```
electron/
  main.js            janela principal (sob demanda), bandeja, login item, IPC
  palette.js         janela da command palette + atalho global Ctrl+Alt+Space
  notes/             store.js (arquivos .md, gravação atômica, lixeira) e service.js (cache, busca, IPC)
  events.js          Event Bus (features → módulos, sem acoplamento)
  devcore/service.js estado do DevCore, heartbeat, IPC
  lib/fsx.js         escrita atômica e fila por arquivo (Notes e DevCore)
  preload.js         API segura exposta ao renderer: window.devkit
  sql/engine.js      Pyodide + sqlparse (mapeia opções da UI → sqlparse.format)
  sql/worker.js      worker thread que hospeda o engine
renderer/
  index.html         carrega React UMD, Lucide, o DS e dist/app.js
  palette.html       janela da command palette (dist/palette.js + palette.css)
  ds/                Toni Devkit DS: toni-devkit.css (tokens + componentes), toni-devkit.js (bundle), fonts/
  app.css            ajustes de layout do app (somente tokens do DS)
src/                 código do app (JSX → renderer/dist/app.js via esbuild)
  main.jsx           shell: TitleBar, Sidebar, toasts, roteamento
  palette.jsx        entrada da command palette → palette/Palette.jsx
  commands/          registry.js (comandos), search.js (busca), providers.js (resultados dinâmicos)
  notes/             domínio: note.js (modelo), format.js (.md ⇄ nota), search.js, markdown.js, client.js (auto-save)
  tools/notes/       tela Notes: NotesScreen, NoteEditor, NotePreview (+ SnippetCard)
  devcore/           content/ (dados e balanceamento), engine/ (regras puras), director.js (cena), sim.js
  tools/devcore/     tela DevCore: DevCoreScreen, Scene, PetSprite (SVG), Panels
  palette/           Palette.jsx e QuickNote.jsx
  tools/meta.js      metadados das ferramentas (sidebar, Início, palette)
  tools/registry.js  associa cada ferramenta ao seu componente
  tools/sql-formatter/SqlFormatter.jsx
  tools/xml-formatter/XmlFormatter.jsx, engine.js (parser/serializer XML, JS puro)
  tools/diff-checker/DiffChecker.jsx, DiffView.jsx, engine.js (Myers + diff na linha), syntax.js
  screens/Home.jsx, screens/Settings.jsx
vendor/python/       wheel do sqlparse (offline)
```

## Adicionando uma nova ferramenta

1. Crie `src/tools/<id>/<Nome>.jsx` exportando um componente que recebe `{ toast }`.
2. Descreva em `src/tools/meta.js` (`id`, `name`, `icon` Lucide, `group`, `desc`, `shortcutKey`, `keywords`) e associe
   o componente em `COMPONENTS` (`src/tools/registry.js`).
3. Pronto: ela aparece na sidebar, no Início e na command palette.

Se a ferramenta precisar de Node/sistema (arquivos, rede, processos), exponha só o necessário em `electron/preload.js`
e trate no `electron/main.js`. O renderer roda com `contextIsolation` + `sandbox`.

## Atualizando o sqlparse

Troque o `.whl` em `vendor/python/` (`pip download sqlparse --no-deps -d vendor/python`) e remova o antigo.
