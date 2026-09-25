'use strict';
/**
 * Motor de formatação SQL.
 *
 * Usa exatamente o mesmo motor do sqlformat.org: o módulo Python `sqlparse`
 * rodando sobre Pyodide (CPython compilado para WebAssembly). Tudo é carregado
 * offline, a partir de node_modules/pyodide e vendor/python/*.whl.
 */
const path = require('node:path');
const fs = require('node:fs');
const { unwrapJsConcat } = require('./jsConcat');

/** Em builds empacotados, arquivos nativos/wasm ficam em app.asar.unpacked. */
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

const ROOT = unpacked(path.join(__dirname, '..', '..'));
const PYODIDE_DIR = unpacked(path.dirname(require.resolve('pyodide/package.json')));
const WHEEL_DIR = path.join(ROOT, 'vendor', 'python');

const PY_BOOTSTRAP = `
import json
import sqlparse

def tk_format(sql, opts_json):
    opts = json.loads(opts_json)
    return sqlparse.format(sql, **opts)

def tk_version():
    return sqlparse.__version__
`;

const CASES = new Set(['upper', 'lower', 'capitalize']);
const OUTPUTS = new Set(['sql', 'python', 'php']);

/**
 * Converte as opções da UI para kwargs do sqlparse.format — os mesmos que
 * o sqlformat.org envia: reindent, indent_width, indent_tabs, keyword_case,
 * identifier_case, strip_comments, compact, output_format.
 */
function toSqlparseOptions(o = {}) {
  const out = { reindent: o.reindent !== false };
  if (CASES.has(o.keywordCase)) out.keyword_case = o.keywordCase;
  if (CASES.has(o.identifierCase)) out.identifier_case = o.identifierCase;
  if (o.indent === 'tab') {
    out.indent_tabs = true;
    out.indent_width = 1;
  } else {
    const w = Number.parseInt(o.indent, 10);
    out.indent_width = Number.isFinite(w) && w > 0 && w <= 16 ? w : 2;
  }
  if (o.stripComments) out.strip_comments = true;
  if (o.compact) out.compact = true;
  if (OUTPUTS.has(o.outputFormat) && o.outputFormat !== 'sql') out.output_format = o.outputFormat;
  return out;
}

let ready = null;

function init() {
  if (ready) return ready;
  ready = (async () => {
    const { loadPyodide } = require(path.join(PYODIDE_DIR, 'pyodide.js'));
    const py = await loadPyodide({ indexURL: PYODIDE_DIR + path.sep, stdout: () => {}, stderr: () => {} });
    const wheels = fs.readdirSync(WHEEL_DIR).filter((f) => f.endsWith('.whl'));
    if (!wheels.length) throw new Error('Wheel do sqlparse não encontrado em vendor/python');
    for (const w of wheels) {
      const buf = fs.readFileSync(path.join(WHEEL_DIR, w));
      py.unpackArchive(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), 'wheel');
    }
    py.runPython(PY_BOOTSTRAP);
    return {
      format: py.globals.get('tk_format'),
      version: py.globals.get('tk_version')(),
    };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

async function format(sql, options) {
  const eng = await init();
  const unwrapped = unwrapJsConcat(sql);
  const effectiveSql = unwrapped ? unwrapped.sql : String(sql ?? '');
  const opts = toSqlparseOptions(options);
  const t0 = performance.now();
  const result = eng.format(effectiveSql, JSON.stringify(opts));
  return {
    result,
    ms: performance.now() - t0,
    sqlparse: eng.version,
    options: opts,
    jsConcat: unwrapped ? { detected: true, vars: unwrapped.vars } : { detected: false, vars: [] },
  };
}

async function info() {
  const eng = await init();
  return { sqlparse: eng.version };
}

module.exports = { init, format, info, toSqlparseOptions };
