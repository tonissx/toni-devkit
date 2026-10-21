// Compila src/**/*.jsx → renderer/dist/app.js (janela principal), renderer/dist/palette.js (command palette)
// e renderer/dist/sticky.js (sticky notes)
// e copia React UMD para renderer/vendor.
// React/ReactDOM e o DS são globais (window.React, window.ReactDOM, window.ToniDevkitDesignSystem_*).
import * as esbuild from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { excalidrawOptions } from './excalidraw-build.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'renderer', 'vendor');
// dist/ é todo gerado aqui: limpar evita que um bundle que saiu do projeto (ex.: o antigo mermaid.js) continue indo
// para o instalador, já que o electron-builder empacota renderer/**.
rmSync(path.join(root, 'renderer', 'dist'), { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });
const pkgDir = (name) => path.dirname(require.resolve(name + '/package.json'));
copyFileSync(path.join(pkgDir('react'), 'umd', 'react.production.min.js'), path.join(vendor, 'react.production.min.js'));
copyFileSync(path.join(pkgDir('react-dom'), 'umd', 'react-dom.production.min.js'), path.join(vendor, 'react-dom.production.min.js'));

const opts = {
  entryPoints: {
    app: path.join(root, 'src', 'main.jsx'),
    palette: path.join(root, 'src', 'palette.jsx'),
    sticky: path.join(root, 'src', 'sticky.jsx'),
  },
  outdir: path.join(root, 'renderer', 'dist'),
  bundle: true,
  format: 'iife',
  target: 'chrome130',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  sourcemap: 'linked',
  logLevel: 'info',
};

// Excalidraw (Diagramas): bundle à parte com o PRÓPRIO React, minificado, carregado sob demanda (src/diagrams/excalidraw.js).
// A configuração (stub do mermaid-to-excalidraw, fallback de CDN) fica em scripts/excalidraw-build.mjs.
const excalidrawOpts = excalidrawOptions(root, opts);
// Fontes do Excalidraw: sem isto ele as baixa de um CDN (o app é offline). O caminho é window.EXCALIDRAW_ASSET_PATH.
// (o pacote tem "exports" restrito, então o caminho vem de node_modules e não de require.resolve)
// A Liberation Sans fica de fora de propósito: o Excalidraw só a usa para exportar no servidor, ela não aparece no
// seletor de fontes e a cópia do pacote é a 1.x, sob GPL + exceção (a OFL só vem na 2.00). Sem ela, a licença some do
// que distribuímos; um desenho que a peça cai numa fonte sem serifa do sistema. As demais estão em licenses/.
const excalidrawAssets = path.join(vendor, 'excalidraw-assets');
rmSync(excalidrawAssets, { recursive: true, force: true }); // senão uma fonte retirada continuaria sendo copiada daqui
cpSync(path.join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts'), path.join(excalidrawAssets, 'fonts'), {
  recursive: true,
  filter: (src) => !/[\\/]Liberation([\\/]|$)/.test(src),
});

// pdf.js (miniatura da 1ª página de um PDF nas Notes): bundle à parte, minificado, carregado sob demanda
// (src/notes/pdfthumb.js). O worker vai dentro dele — ver src/notes/pdfthumb-entry.js.
const pdfThumbOpts = {
  ...opts,
  entryPoints: { pdfthumb: path.join(root, 'src', 'notes', 'pdfthumb-entry.js') },
  minify: true,
  sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"' },
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  const ectx = await esbuild.context(excalidrawOpts);
  await ectx.watch();
  const pctx = await esbuild.context(pdfThumbOpts);
  await pctx.watch();
} else {
  await esbuild.build(opts);
  await esbuild.build(excalidrawOpts);
  await esbuild.build(pdfThumbOpts);
}
