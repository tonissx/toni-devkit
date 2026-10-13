'use strict';
/**
 * Banco — servidor e credencial → configuração do tedious; e ler uma connection string colada (ADO.NET ou JDBC).
 * Puro. A senha só passa por aqui no processo principal, na hora de conectar.
 */

const APP_NAME = 'Toni Devkit Monitor';

const truthy = (v) => /^(true|yes|1|mandatory|strict|sim)$/i.test(String(v || '').trim());

/** "tcp:srv\\inst,1433" | "srv,1433" | "srv\\inst" | "(local)" → { host, instance, port } */
function splitServer(v) {
  let s = String(v || '').trim().replace(/^(tcp|np|lpc|admin):/i, '');
  let port = null; let instance = '';
  const comma = s.lastIndexOf(',');
  if (comma > 0) { const p = Number(s.slice(comma + 1)); if (p > 0 && p < 65536) port = p; s = s.slice(0, comma); }
  const bs = s.indexOf('\\');
  if (bs > 0) { instance = s.slice(bs + 1); s = s.slice(0, bs); }
  if (/^(\(local\)|\.|localhost)$/i.test(s)) s = 'localhost';
  return { host: s, instance, port };
}

/** Pares chave=valor de uma connection string ADO.NET, com valores entre aspas ou chaves. */
function adoPairs(str) {
  const out = {};
  const re = /\s*([^=;]+?)\s*=\s*("([^"]*(?:""[^"]*)*)"|'([^']*(?:''[^']*)*)'|\{([^}]*(?:\}\}[^}]*)*)\}|[^;]*)\s*(?:;|$)/g;
  let m;
  while ((m = re.exec(str)) && m[0]) {
    const key = m[1].trim().toLowerCase().replace(/\s+/g, ' ');
    const val = m[3] != null ? m[3].replace(/""/g, '"') : m[4] != null ? m[4].replace(/''/g, "'") : m[5] != null ? m[5].replace(/\}\}/g, '}') : m[2].trim();
    out[key] = val;
  }
  return out;
}

/**
 * Connection string ADO.NET ("Server=…;Database=…;User Id=…;Password=…") ou JDBC ("jdbc:sqlserver://host:1433;…").
 * → { host, instance, port, database, user, password, encrypt, trustCert, integrated } (campos ausentes ficam '')
 */
function parseConnectionString(s) {
  const str = String(s || '').trim();
  const out = { host: '', instance: '', port: null, database: '', user: '', password: '', encrypt: true, trustCert: false, integrated: false };
  if (!str) return out;
  const jdbc = /^jdbc:sqlserver:\/\/([^;]*)(;.*)?$/i.exec(str);
  if (jdbc) {
    let hp = jdbc[1];
    const props = adoPairs((jdbc[2] || '').replace(/^;/, ''));
    const colon = hp.lastIndexOf(':');
    if (colon > 0 && /^\d+$/.test(hp.slice(colon + 1))) { out.port = Number(hp.slice(colon + 1)); hp = hp.slice(0, colon); }
    const sp = splitServer(hp);
    out.host = sp.host; out.instance = props.instancename || sp.instance;
    if (props.portnumber) out.port = Number(props.portnumber) || out.port;
    out.database = props.databasename || props.database || '';
    out.user = props.user || props.username || '';
    out.password = props.password || '';
    if (props.encrypt != null) out.encrypt = truthy(props.encrypt);
    if (props.trustservercertificate != null) out.trustCert = truthy(props.trustservercertificate);
    out.integrated = truthy(props.integratedsecurity);
    return out;
  }
  const p = adoPairs(str);
  const pick = (...keys) => { for (const k of keys) if (p[k] != null) return p[k]; return ''; };
  const sp = splitServer(pick('server', 'data source', 'address', 'addr', 'network address'));
  Object.assign(out, sp);
  out.database = pick('database', 'initial catalog');
  out.user = pick('user id', 'uid', 'user', 'username');
  out.password = pick('password', 'pwd');
  const enc = pick('encrypt');
  if (enc) out.encrypt = !/^(false|no|0|optional)$/i.test(enc);
  const tsc = pick('trustservercertificate', 'trust server certificate');
  if (tsc) out.trustCert = truthy(tsc);
  const integ = pick('integrated security', 'trusted_connection');
  out.integrated = !!integ && /^(true|yes|sspi)$/i.test(integ);
  return out;
}

// Mesmos nomes de campo que o Vault reconhece (src/vault/entry.js).
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const FIELD = {
  host: /^(servidor|server|host|hostname|endereco|data source)$/, port: /^(porta|port)$/, db: /^(banco|database|base|db|catalogo)$/,
  user: /^(usuario|user|username|login|user id)$/, pass: /^(senha|password|pass|pwd)$/,
};

/** Campos de uma entrada do Vault ({ name, value }) → { host, instance, port, database, user, password }. */
function fromVaultFields(fields) {
  const get = (k) => { const f = (fields || []).find((x) => FIELD[k].test(norm(x.name))); return f ? String(f.value == null ? '' : f.value) : ''; };
  const sp = splitServer(get('host'));
  const port = Number(get('port')) || sp.port || null;
  return { host: sp.host, instance: sp.instance, port, database: get('db'), user: get('user'), password: get('pass') };
}

/**
 * Configuração do tedious. server: { host, instance, port, database, encrypt, trustCert }; cred: { user, password }.
 * Instância nomeada sem porta usa o SQL Browser (UDP 1434) para achar a porta.
 */
function tediousConfig(server, cred, { requestTimeout = 5000, connectTimeout = 8000 } = {}) {
  if (!server || !server.host) throw new Error('Servidor sem endereço');
  if (!cred || !cred.user) throw new Error('Credencial sem usuário');
  const options = {
    appName: APP_NAME,
    encrypt: server.encrypt !== false,
    trustServerCertificate: !!server.trustCert,
    requestTimeout, connectTimeout,
    database: server.database || 'master',
    rowCollectionOnRequestCompletion: true,
    useColumnNames: false,
    abortTransactionOnError: true,
    enableArithAbort: true,
    // Datas como estão no servidor (o monitor trata como hora local do servidor).
    useUTC: false,
  };
  if (server.port) options.port = Number(server.port);
  else if (server.instance) options.instanceName = server.instance;
  else options.port = 1433;
  return { server: server.host, options, authentication: { type: 'default', options: { userName: cred.user, password: cred.password || '' } } };
}

/** Rótulo legível: "srv01\\SQL2019,1433 · Fluig". */
const serverLabel = (s) => `${s.host}${s.instance ? '\\' + s.instance : ''}${s.port && s.port !== 1433 ? ',' + s.port : ''}`;

module.exports = { APP_NAME, splitServer, parseConnectionString, fromVaultFields, tediousConfig, serverLabel };
