// Garante que tudo que o processo principal importa de src/ vai dentro do instalador (package.json → build.files).
// Em dev o src/ inteiro existe em disco e o erro só aparece no app instalado ("Cannot find module '../../src/...'").
//   node --test scripts/test-build-files.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const patterns = pkg.build.files;

const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const escape = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
/** Padrões simples do electron-builder: `pasta/**`, `pasta/*` e caminho exato; `!padrão` exclui. */
function packaged(file) {
  let yes = false;
  for (const raw of patterns) {
    const neg = raw.startsWith('!');
    const p = neg ? raw.slice(1) : raw;
    const re = new RegExp('^' + escape(p).replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
    if (re.test(file)) yes = !neg;
  }
  return yes;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

const REQUIRE = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
const exists = (base) => [base, base + '.js', base + '.json', path.join(base, 'index.js')].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());

test('todo require relativo do electron/ aponta para um arquivo que vai no instalador', () => {
  const missing = [];
  for (const file of walk(path.join(root, 'electron'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(REQUIRE)) {
      const target = exists(path.resolve(path.dirname(file), m[1]));
      if (!target) continue; // arquivo gerado ou opcional: outros testes cobrem
      const r = rel(target);
      if (r.startsWith('src/') && !packaged(r)) missing.push(`${rel(file)} → ${r}`);
    }
  }
  assert.deepEqual(missing, [], 'Acrescente estes arquivos em package.json → build.files:\n  ' + missing.join('\n  '));
});

test('o verificador reconhece os padrões do package.json', () => {
  assert.equal(packaged('electron/main.js'), true);
  assert.equal(packaged('src/ai/prompts.js'), true);
  assert.equal(packaged('src/tools/aimon/aiInput.js'), true);
  assert.equal(packaged('src/tools/aimon/Lanes.jsx'), false);
  assert.equal(packaged('src/tools/nao-existe/x.js'), false);
});
