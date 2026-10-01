'use strict';
/**
 * Modelo das entradas do Vault — compartilhado pelo processo principal (electron/vault/service.js) e pela tela.
 *
 * Entrada: { id, name, kind, tags: [], fields: [{ name, value, secret }], notes, created, updated }
 * - `name` é único (sem diferenciar maiúsculas/acentos) e é o que as notas referenciam: ```secret <name>```.
 * - Campos com `secret: true` nunca saem do processo principal em listas: viram `value: null` + `set: bool`.
 */

const KINDS = [
  { id: 'db', label: 'Banco de dados', icon: 'database', fields: [['Servidor'], ['Porta'], ['Banco'], ['Usuário'], ['Senha', true]] },
  { id: 'login', label: 'Login', icon: 'key-round', fields: [['URL'], ['Usuário'], ['Senha', true]] },
  { id: 'api', label: 'API / token', icon: 'webhook', fields: [['URL'], ['Chave', true]] },
  { id: 'other', label: 'Outro', icon: 'lock', fields: [['Valor', true]] },
];
const KIND_IDS = KINDS.map((k) => k.id);
const kindOf = (id) => KINDS.find((k) => k.id === id) || KINDS[KINDS.length - 1];

const MAX_FIELDS = 30;
const MAX_VALUE = 20000;

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const sameName = (a, b) => norm(a) === norm(b);

/** Nome válido para referência em nota: uma linha, sem crases. */
function cleanName(name) {
  return String(name || '').replace(/[`\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function newId() {
  const rnd = Math.random().toString(36).slice(2, 8);
  return 'v' + Date.now().toString(36) + rnd;
}

/** Entrada nova a partir de um modelo (campos vazios). */
function blankEntry(kind = 'db') {
  const k = kindOf(kind);
  return { id: null, name: '', kind: k.id, tags: [], notes: '', fields: k.fields.map(([name, secret]) => ({ name, value: '', secret: !!secret })) };
}

/**
 * Limpa uma entrada vinda da UI. `prev` (a versão gravada) permite manter um segredo não alterado:
 * campo secreto com `value === null` (a UI nunca recebeu o valor) mantém o valor anterior do campo de mesmo índice
 * de origem (`from`) ou de mesmo nome.
 */
function normalizeEntry(raw, prev = null, now = new Date()) {
  if (!raw || typeof raw !== 'object') throw new Error('Entrada inválida');
  const name = cleanName(raw.name);
  if (!name) throw new Error('Dê um nome à entrada');
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).slice(0, MAX_FIELDS).map((f, i) => {
    const fname = String((f && f.name) || '').trim().slice(0, 60) || 'Campo ' + (i + 1);
    const secret = !!(f && f.secret);
    let value = f && f.value;
    if (value === null || value === undefined) {
      const src = prev && (Number.isInteger(f && f.from) ? prev.fields[f.from] : prev.fields.find((p) => p.name === fname));
      value = src ? src.value : '';
    }
    return { name: fname, value: String(value).slice(0, MAX_VALUE), secret };
  });
  const stamp = now.toISOString();
  return {
    id: prev ? prev.id : (typeof raw.id === 'string' && raw.id) || newId(),
    name,
    kind: KIND_IDS.includes(raw.kind) ? raw.kind : 'other',
    tags: [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((t) => String(t).replace(/^#/, '').trim().toLowerCase()).filter(Boolean))].slice(0, 20),
    notes: String(raw.notes || '').slice(0, MAX_VALUE),
    fields,
    created: prev ? prev.created : stamp,
    updated: stamp,
  };
}

/** Versão segura para a UI/palette: segredos viram null (+ `set` diz se há valor). */
function metaOf(e) {
  return {
    id: e.id, name: e.name, kind: e.kind, tags: e.tags, notes: e.notes, created: e.created, updated: e.updated,
    fields: e.fields.map((f) => (f.secret ? { name: f.name, secret: true, value: null, set: !!f.value } : { name: f.name, secret: false, value: f.value })),
  };
}

/** Índice do campo principal: o 1º secreto com valor (senha/chave). -1 se não houver. */
function primaryIndex(e) {
  const i = e.fields.findIndex((f) => f.secret && (f.set || f.value));
  return i !== -1 ? i : e.fields.findIndex((f) => f.secret);
}

const FIELD_RE = {
  host: /^(servidor|server|host|hostname|endereco)$/,
  port: /^(porta|port)$/,
  db: /^(banco|database|base|db|catalogo)$/,
  user: /^(usuario|user|username|login)$/,
  pass: /^(senha|password|pass|pwd)$/,
  url: /^(url|site|endpoint|link)$/,
};
const fieldBy = (e, kind) => e.fields.find((f) => FIELD_RE[kind].test(norm(f.name)));
const valueBy = (e, kind) => { const f = fieldBy(e, kind); return f ? String(f.value || '') : ''; };

/** Linha de apoio sem segredos, para a palette e a lista: "usuario@servidor". */
function summary(e) {
  const user = valueBy(e, 'user');
  const host = valueBy(e, 'host') || valueBy(e, 'url');
  if (user && host) return user + '@' + host;
  return user || host || '';
}

/** Connection strings de banco (precisam do valor real da senha — só no processo principal). */
function connectionString(e, flavor = 'sqlserver') {
  const host = valueBy(e, 'host'), port = valueBy(e, 'port'), db = valueBy(e, 'db'), user = valueBy(e, 'user'), pass = valueBy(e, 'pass');
  if (!host) throw new Error('A entrada não tem o campo Servidor');
  if (flavor === 'jdbc') {
    return `jdbc:sqlserver://${host}${port ? ':' + port : ''};databaseName=${db};user=${user};password=${pass};encrypt=true;trustServerCertificate=true`;
  }
  // Valores com ; ou aspas vão entre aspas (regra das connection strings do ADO.NET).
  const q = (v) => (/[;'"]/.test(v) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  return `Server=${q(host)}${port ? ',' + port : ''};Database=${q(db)};User Id=${q(user)};Password=${q(pass)};TrustServerCertificate=True;`;
}

const isDbLike = (e) => !!fieldBy(e, 'host') && !!fieldBy(e, 'user');

/* ─────────────── Referências nas notas: ```secret <nome>``` ─────────────── */
const SECRET_FENCE_RE = /^(`{3,}|~{3,})[ \t]*secret\b[ \t]*([^\n`]*)\n([\s\S]*?)^\1[ \t]*$/gim;

/** Nome referenciado por um bloco de código (info string "secret <nome>" ou o corpo do bloco). */
function secretNameFromBlock(lang, text) {
  const info = String(lang || '').trim();
  if (!/^secret\b/i.test(info)) return null;
  return cleanName(info.replace(/^secret\b/i, '') || String(text || '').split('\n')[0]) || null;
}

/** Nomes referenciados num markdown (sem repetir). */
function secretRefs(md) {
  const out = [];
  for (const m of String(md || '').matchAll(SECRET_FENCE_RE)) {
    const name = cleanName(m[2] || m[3].split('\n')[0]);
    if (name && !out.some((n) => sameName(n, name))) out.push(name);
  }
  return out;
}

/** Texto para colar numa nota. */
const secretBlock = (name) => '```secret ' + cleanName(name) + '\n```';

module.exports = {
  KINDS, KIND_IDS, kindOf, norm, sameName, cleanName, blankEntry, normalizeEntry, metaOf, primaryIndex, summary,
  connectionString, isDbLike, secretNameFromBlock, secretRefs, secretBlock,
};
