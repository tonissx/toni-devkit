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
| [Excalidraw](https://excalidraw.com) | Quadro de desenho da ferramenta Diagramas, empacotado em `renderer/dist/excalidraw.js` (com o próprio React) e carregado só quando ela é aberta | MIT | `licenses/LICENSE.excalidraw.txt` |
| [electron-updater](https://www.electron.build) | Atualização automática | MIT | no `app.asar` |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | IA opcional na nuvem | MIT | no `app.asar` |
| [esbuild](https://esbuild.github.io) e [electron-builder](https://www.electron.build) | Build e empacotamento (desenvolvimento) | MIT | — |

## Dependências indiretas

O `tedious`, o `electron-updater` e o `@anthropic-ai/sdk` trazem outras bibliotecas (por exemplo `@azure/*`,
`jsonwebtoken`, `ws`, `js-yaml`, `iconv-lite`, `semver`, `tslib`, `argparse`, `sax`, `fast-sha256`). Todas são
permissivas: MIT, ISC, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, Unlicense e Python-2.0. O texto de cada uma
acompanha o pacote em `node_modules/<pacote>/` dentro do `app.asar`.

O Excalidraw empacota 82 pacotes, incluindo React e React DOM (radix-ui, roughjs, jotai, pako, perfect-freehand, entre outros). Todos
são permissivos: MIT, Apache-2.0, CC0-1.0, 0BSD e MIT AND Zlib. Como ficam dentro do bundle, os textos estão em
`licenses/LICENSE.excalidraw-deps.txt`, gerado por `scripts/gen-excalidraw-licenses.mjs` a partir do que o esbuild de
fato inclui (rode de novo ao atualizar o pacote). Os pacotes `@radix-ui/*` não trazem o arquivo no npm; vale o texto
oficial em `licenses/LICENSE.radix-ui.txt`.

**Pendente:** as fontes que acompanham o Excalidraw (Excalifont, Virgil, Cascadia Code, Comic Shanns, Nunito, Lilita One,
Liberation Sans, Xiaolai e Assistant) são de terceiros, cada uma com a licença do seu autor, e o pacote não traz esses
textos. Eles ainda precisam ser conferidos nas origens e reunidos em `licenses/` antes de distribuir o instalador.

O Ollama, usado só quando o usuário escolhe a IA local, é um programa separado, instalado à parte e sob a licença
dele. A IA na nuvem usa a chave de API do próprio usuário e está sujeita aos termos do serviço escolhido.
