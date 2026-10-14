# Imagens do README

Geradas por script, com **dados 100% fictícios** (notas, cofre, links, repositórios git e DevCore criados do zero numa
pasta temporária, com um Electron isolado do app instalado). Para refazer depois de mudar a interface:

```bash
npm run docs:capture     # precisa do ffmpeg no PATH
```

O script (`scripts/docs-capture/`) cria os dados (`seed.mjs`), abre o app com o protocolo de depuração do Chromium
(`cdp.mjs`) e tira as capturas e monta os GIFs (`capture.mjs`). Nada toca em `%APPDATA%\Toni Devkit` nem em
`Documentos\Devkit Notes`.

| Arquivo | O que mostra |
| --- | --- |
| `palette.gif` | Palette abrindo, busca de notas e link rápido com alias (`ticket` + Tab + número) |
| `palette-search.png` | Palette com resultados de notas e da web |
| `git-graph.gif` | Visão geral, mudanças por trecho, grafo do histórico, branches e rebase visual |
| `json-graph.png` | JSON Visualizer com um pedido de exemplo em grafo |
| `notes.png` / `notes-graph.png` | Notes no editor lado a lado / grafo de `[[links]]` |
| `vault.png` | Vault desbloqueado (segredo mascarado) |
| `devcore.png` | DevCore com os DevPets |
