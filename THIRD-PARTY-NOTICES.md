# Avisos de terceiros

O Toni Devkit é distribuído sob a licença MIT (ver `LICENSE`). Ele inclui ou carrega os componentes abaixo, cada um
com a sua própria licença.

| Componente | Uso | Licença |
| --- | --- | --- |
| [Electron](https://www.electronjs.org) | Runtime do app | MIT |
| [React](https://react.dev) e React DOM | Interface | MIT |
| [Pyodide](https://pyodide.org) | CPython em WebAssembly (SQL Formatter) | MPL-2.0 |
| [sqlparse](https://github.com/andialbrecht/sqlparse) | Motor de formatação do SQL Formatter (`vendor/python`) | BSD-3-Clause |
| [Lucide](https://lucide.dev) | Ícones (`renderer/vendor/lucide.min.js`) | ISC |
| [Geist e Geist Mono](https://vercel.com/font) | Fontes (`renderer/ds/fonts`) | SIL OFL 1.1 |
| [marked](https://github.com/markedjs/marked) | Markdown das notas | MIT |
| [electron-updater](https://www.electron.build) | Atualização automática | MIT |
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | IA opcional na nuvem | MIT |
| [esbuild](https://esbuild.github.io) e [electron-builder](https://www.electron.build) | Build e empacotamento (desenvolvimento) | MIT |

Os textos completos das licenças acompanham cada pacote em `node_modules/<pacote>/` e, no caso do sqlparse, dentro do
arquivo `.whl`. O Ollama, usado só quando o usuário escolhe a IA local, é um programa separado, instalado à parte e
sob a licença dele.
