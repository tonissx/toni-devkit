// Configuração do esbuild do bundle do Excalidraw (renderer/dist/excalidraw.js). Compartilhada por
// scripts/build-renderer.mjs e scripts/gen-excalidraw-licenses.mjs (que precisa do MESMO grafo de módulos).
import { readFileSync } from 'node:fs';
import path from 'node:path';

// O pacote faz import() do mermaid-to-excalidraw (diálogo "Mermaid → Excalidraw"), que traria o Mermaid inteiro
// para dentro do bundle; o Devkit não usa esse diálogo, então o módulo vira um stub.
const stubMermaidToExcalidraw = {
  name: 'stub-mermaid-to-excalidraw',
  setup(b) {
    b.onResolve({ filter: /^@excalidraw\/mermaid-to-excalidraw$/ }, () => ({ path: 'mermaid-to-excalidraw', namespace: 'devkit-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'devkit-stub' }, () => ({
      loader: 'js',
      contents: "export async function parseMermaidToExcalidraw() { throw new Error('Mermaid não está disponível no Devkit'); }\nexport default {};",
    }));
  },
};

// O pacote monta a lista de fontes com um fallback https://esm.sh/…; a CSP do app (offline) o bloqueia e cada montagem
// despeja ~230 violações no console. Com o caminho local (EXCALIDRAW_ASSET_PATH) as fontes carregam normalmente, então o
// prefixo do fallback vira um file:/// que nunca é buscado. Se o pacote mudar e o trecho sumir, o build falha em vez de
// voltar a poluir o console em silêncio.
const noCdnFallback = {
  name: 'no-cdn-fallback',
  setup(b) {
    let replaced = 0;
    b.onLoad({ filter: /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/][^\\/]+\.js$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      if (!src.includes('https://esm.sh/')) return null;
      replaced++;
      return { loader: 'js', contents: src.replaceAll('https://esm.sh/', 'file:///devkit-sem-cdn/') };
    });
    b.onEnd(() => { if (!replaced) throw new Error('no-cdn-fallback: o fallback https://esm.sh/ não foi encontrado em @excalidraw/excalidraw; revise este plugin'); });
  },
};

/** Opções do esbuild para o bundle do Excalidraw, sobre as opções-base do app (`base`). */
export function excalidrawOptions(root, base) {
  return {
    ...base,
    entryPoints: { excalidraw: path.join(root, 'src', 'diagrams', 'excalidraw-entry.jsx') },
    minify: true,
    sourcemap: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    conditions: ['production'], // o "exports" do pacote só define index.js/index.css para production|development
    loader: { '.woff2': 'file' }, // o CSS referencia a fonte da interface (Assistant); vai para dist/excalidraw-assets/
    assetNames: 'excalidraw-assets/[name]-[hash]',
    plugins: [stubMermaidToExcalidraw, noCdnFallback],
  };
}
