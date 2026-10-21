// Gera licenses/LICENSE.excalidraw-deps.txt: o texto de licença de cada pacote que ENTRA no bundle do Excalidraw
// (lido do metafile do esbuild, não de uma estimativa pela árvore de dependências). Rode de novo ao atualizar o pacote:
//   node scripts/gen-excalidraw-licenses.mjs
import * as esbuild from 'esbuild';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { excalidrawOptions } from './excalidraw-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = { bundle: true, format: 'iife', target: 'chrome130', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment', logLevel: 'silent' };
const result = await esbuild.build({ ...excalidrawOptions(root, base), write: false, metafile: true, outdir: path.join(os.tmpdir(), 'devkit-excalidraw-licenses') });

/** Pasta do pacote dono de um arquivo dentro de node_modules (suporta escopo e pacotes aninhados). */
function packageDir(file) {
  let dir = path.dirname(path.join(root, file));
  while (dir.includes('node_modules')) {
    if (existsSync(path.join(dir, 'package.json')) && path.basename(path.dirname(dir)) !== '.bin') {
      const pj = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pj.name) return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

const dirs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (input.includes('node_modules')) { const d = packageDir(input); if (d) dirs.add(d); }
}

const pkgs = [...dirs].map((d) => {
  const pj = JSON.parse(readFileSync(path.join(d, 'package.json'), 'utf8'));
  const file = readdirSync(d).find((f) => /^(licen[sc]e|copying)(\.|$)/i.test(f));
  const license = typeof pj.license === 'string' ? pj.license : pj.license && pj.license.type ? pj.license.type : (pj.licenses || []).map((l) => l.type).join(' OR ') || 'desconhecida';
  // Os pacotes @radix-ui/* declaram MIT mas o tarball do npm não traz o arquivo; vale o texto oficial do repositório
  // (licenses/LICENSE.radix-ui.txt, copiado de github.com/radix-ui/primitives).
  const radix = !file && pj.name.startsWith('@radix-ui/') ? readFileSync(path.join(root, 'licenses', 'LICENSE.radix-ui.txt'), 'utf8').replace(/\r\n/g, '\n').trim() : null;
  return { name: pj.name, version: pj.version, license, text: file ? readFileSync(path.join(d, file), 'utf8').replace(/\r\n/g, '\n').trim() : radix };
}).filter((p) => p.name !== '@excalidraw/excalidraw') // coberto por licenses/LICENSE.excalidraw.txt
  // o mesmo pacote@versão pode existir em várias pastas aninhadas; um texto basta (fica o que tem arquivo de licença)
  .sort((a, b) => (b.text ? 1 : 0) - (a.text ? 1 : 0))
  .filter((p, i, all) => all.findIndex((q) => q.name === p.name && q.version === p.version) === i)
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const out = [
  'Licenças das bibliotecas empacotadas junto com o Excalidraw (renderer/dist/excalidraw.js).',
  'Gerado por scripts/gen-excalidraw-licenses.mjs a partir do que o esbuild de fato inclui no bundle; uma seção por pacote.',
  'As fontes que acompanham o Excalidraw NÃO estão aqui (ver THIRD-PARTY-NOTICES.md).',
  '',
];
const semArquivo = [];
for (const p of pkgs) {
  out.push('='.repeat(78), `${p.name}@${p.version} — ${p.license}`, '='.repeat(78));
  if (p.text) out.push(p.text); else { out.push(`(o pacote não traz arquivo de licença; declara ${p.license} no package.json)`); semArquivo.push(`${p.name}@${p.version} (${p.license})`); }
  out.push('');
}
writeFileSync(path.join(root, 'licenses', 'LICENSE.excalidraw-deps.txt'), out.join('\n'));

const porLicenca = {};
for (const p of pkgs) (porLicenca[p.license] = porLicenca[p.license] || []).push(p.name);
console.log(`${pkgs.length} pacotes no bundle`);
for (const [l, n] of Object.entries(porLicenca)) console.log(`  ${l}: ${n.length}${/^(MIT|ISC)$/.test(l) ? '' : ' → ' + n.join(', ')}`);
console.log('sem arquivo de licença:', semArquivo.length ? '\n  ' + semArquivo.join('\n  ') : 'nenhum');
