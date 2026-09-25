// Compila src/**/*.jsx → renderer/dist/app.js e copia React UMD para renderer/vendor.
// React/ReactDOM e o DS são globais (window.React, window.ReactDOM, window.ToniDevkitDesignSystem_*).
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'renderer', 'vendor');
mkdirSync(vendor, { recursive: true });
const pkgDir = (name) => path.dirname(require.resolve(name + '/package.json'));
copyFileSync(path.join(pkgDir('react'), 'umd', 'react.production.min.js'), path.join(vendor, 'react.production.min.js'));
copyFileSync(path.join(pkgDir('react-dom'), 'umd', 'react-dom.production.min.js'), path.join(vendor, 'react-dom.production.min.js'));

const opts = {
  entryPoints: [path.join(root, 'src', 'main.jsx')],
  outfile: path.join(root, 'renderer', 'dist', 'app.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome130',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  sourcemap: 'linked',
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
} else {
  await esbuild.build(opts);
}
