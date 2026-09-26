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

- **Categorias**: com o campo vazio, `S` → **Search**, `T` → **Tools**, `A` → **Actions**. Depois do 1º caractere,
  tudo é texto normal; `Backspace` com o campo vazio volta para o início
- **Search**: buscas na web com o texto digitado (Google, MDN, Stack Overflow, GitHub, npm, TDN TOTVS) e busca
  dentro do app (comandos, ferramentas, configurações e o texto dos rascunhos das ferramentas)
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

## Estrutura

```
electron/
  main.js            janela principal (sob demanda), bandeja, login item, IPC
  palette.js         janela da command palette + atalho global Ctrl+Alt+Space
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
