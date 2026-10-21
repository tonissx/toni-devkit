# Avisos de terceiros

O Toni Devkit é distribuído sob a licença MIT (ver `LICENSE`). Ele inclui ou carrega os componentes abaixo, cada um
com a sua própria licença. Os textos completos estão na pasta [`licenses/`](licenses) (que também acompanha o app
instalado, ao lado do `LICENSE`).

| Componente | Uso | Licença | Texto |
| --- | --- | --- | --- |
| [Electron](https://www.electronjs.org) | Runtime do app (inclui o Chromium; os avisos dele vão em `LICENSE.electron.txt` e `LICENSES.chromium.html`) | MIT | no app instalado |
| [React](https://react.dev) e React DOM | Interface | MIT | `licenses/LICENSE.react.txt` |
| [Pyodide](https://pyodide.org) | CPython em WebAssembly (SQL Formatter). Sem modificações; o código-fonte está em [github.com/pyodide/pyodide](https://github.com/pyodide/pyodide) | MPL-2.0 | `licenses/LICENSE.pyodide-MPL-2.0.txt` |
| [CPython](https://www.python.org) | Biblioteca padrão do Python (`python_stdlib.zip`, dentro do Pyodide) | PSF-2.0 | `licenses/LICENSE.cpython-PSF.txt` |
| [sqlparse](https://github.com/andialbrecht/sqlparse) | Motor de formatação do SQL Formatter (`vendor/python`) | BSD-3-Clause | `licenses/LICENSE.sqlparse.txt` e `licenses/AUTHORS.sqlparse.txt` |
| [tedious](https://github.com/tediousjs/tedious) | Conexão com o SQL Server (Banco e SQL Visualizer) | MIT | `licenses/LICENSE.tedious.txt` |
| [node-sql-parser](https://github.com/taozhi8833998/node-sql-parser) | Leitura de T-SQL no SQL Visualizer (lineage), empacotado no app | Apache-2.0 | `licenses/LICENSE.node-sql-parser.txt` |
| [big-integer](https://github.com/peterolson/BigInteger.js) | Dependência do node-sql-parser, empacotada no app | Unlicense | `licenses/LICENSE.big-integer.txt` |
| [Lucide](https://lucide.dev) | Ícones (`renderer/vendor/lucide.min.js`); parte deles vem do Feather (MIT), coberto no mesmo arquivo | ISC | `licenses/LICENSE.lucide.txt` |
| [Geist e Geist Mono](https://vercel.com/font) | Fontes (`renderer/ds/fonts`) | SIL OFL 1.1 | `licenses/LICENSE.geist-OFL-1.1.txt` e `renderer/ds/fonts/OFL.txt` |
| [marked](https://github.com/markedjs/marked) | Markdown das notas, empacotado no app | MIT | `licenses/LICENSE.marked.txt` |
| [Mermaid](https://mermaid.js.org) | Diagramas (ER, fluxo, sequência…), empacotado em `renderer/dist/mermaid.js` e carregado só quando a ferramenta Diagramas é aberta | MIT | `licenses/LICENSE.mermaid.txt` |
| [electron-updater](https://www.electron.build) | Atualização automática | MIT | no `app.asar` |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | IA opcional na nuvem | MIT | no `app.asar` |
| [esbuild](https://esbuild.github.io) e [electron-builder](https://www.electron.build) | Build e empacotamento (desenvolvimento) | MIT | — |

## Dependências indiretas

O `tedious`, o `electron-updater` e o `@anthropic-ai/sdk` trazem outras bibliotecas (por exemplo `@azure/*`,
`jsonwebtoken`, `ws`, `js-yaml`, `iconv-lite`, `semver`, `tslib`, `argparse`, `sax`, `fast-sha256`). Todas são
permissivas: MIT, ISC, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, Unlicense e Python-2.0. O texto de cada uma
acompanha o pacote em `node_modules/<pacote>/` dentro do `app.asar`.

O Mermaid também empacota bibliotecas próprias (d3, dagre-d3-es, cytoscape, chevrotain, langium, DOMPurify, khroma, KaTeX,
lodash-es e outras). Todas são permissivas: MIT, ISC, BSD-3-Clause, Apache-2.0 e Unlicense; o DOMPurify é oferecido em
MPL-2.0 ou Apache-2.0 e é usado aqui sob a Apache-2.0. Como ficam dentro do bundle, o texto de cada licença está em
`licenses/LICENSE.mermaid-deps.txt`.

O Ollama, usado só quando o usuário escolhe a IA local, é um programa separado, instalado à parte e sob a licença
dele. A IA na nuvem usa a chave de API do próprio usuário e está sujeita aos termos do serviço escolhido.
