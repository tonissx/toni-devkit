# Toni Devkit

Aplicativo desktop (Electron) que reúne ferramentas para devs, construído sobre o **Toni Devkit Design System**
(tokens, fontes Geist, ícones Lucide e componentes React do kit).

## Objetivo

O Toni Devkit é uma caixa de ferramentas offline para o dia a dia de desenvolvimento — cada ferramenta roda
localmente, sem depender de sites externos, mantendo a mesma identidade visual e a mesma UX (sidebar, command
palette, atalhos de teclado) em todas elas.

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
npm test           # testa o motor SQL no Node (sem Electron)
npm run dist       # gera instalador Windows (NSIS) + portable em dist/
npm run dist:mac   # gera .dmg (macOS)
npm run dist:linux # gera AppImage (Linux)
```

## Ferramentas

| Ferramenta | Status |
| --- | --- |
| **SQL Formatter**: formata no mesmo padrão do sqlformat.org | ✅ |

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

## Estrutura

```
electron/
  main.js            janela, IPC (arquivos, clipboard, tema, controles de janela)
  preload.js         API segura exposta ao renderer: window.devkit
  sql/engine.js      Pyodide + sqlparse (mapeia opções da UI → sqlparse.format)
  sql/worker.js      worker thread que hospeda o engine
renderer/
  index.html         carrega React UMD, Lucide, o DS e dist/app.js
  ds/                Toni Devkit DS: toni-devkit.css (tokens + componentes), toni-devkit.js (bundle), fonts/
  app.css            ajustes de layout do app (somente tokens do DS)
src/                 código do app (JSX → renderer/dist/app.js via esbuild)
  main.jsx           shell: TitleBar, Sidebar, command palette, toasts, roteamento
  tools/registry.js  registro de ferramentas
  tools/sql-formatter/SqlFormatter.jsx
  screens/Home.jsx, screens/Settings.jsx
vendor/python/       wheel do sqlparse (offline)
```

## Adicionando uma nova ferramenta

1. Crie `src/tools/<id>/<Nome>.jsx` exportando um componente que recebe `{ toast }`.
2. Registre em `src/tools/registry.js` (`id`, `name`, `icon` Lucide, `group`, `desc`, `shortcutKey`, `component`).
3. Pronto: ela aparece na sidebar, no Início e na command palette (`Ctrl+K`).

Se a ferramenta precisar de Node/sistema (arquivos, rede, processos), exponha só o necessário em `electron/preload.js`
e trate no `electron/main.js`. O renderer roda com `contextIsolation` + `sandbox`.

## Atualizando o sqlparse

Troque o `.whl` em `vendor/python/` (`pip download sqlparse --no-deps -d vendor/python`) e remova o antigo.
