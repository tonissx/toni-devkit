'use strict';
/**
 * Banco — uma conexão (tedious) com fila: o tedious só aceita um comando por vez em cada conexão, então os pedidos
 * esperam a vez. A conexão que cai (KILL, rede, serviço parado) avisa por onDead e rejeita o que estava na fila —
 * sem o tratador de 'error', a queda derrubaria o processo principal inteiro.
 *
 * Linhas viram objetos { coluna: valor }; datas viram milissegundos (o histórico grava números).
 */
const { Connection, Request } = require('tedious');

/** Erros do tedious/SQL Server explicados em português. */
function friendlyError(e) {
  const m = String((e && e.message) || e || '');
  const code = e && e.code;
  if (code === 'ELOGIN' || /Login failed/i.test(m)) return 'Usuário ou senha recusados pelo SQL Server (ou o login não tem acesso ao banco escolhido).';
  if (/self[- ]signed|certificate|UNABLE_TO_VERIFY|CERT_/i.test(m)) return 'O certificado do servidor não é confiável. Marque "Confiar no certificado do servidor" (comum em servidores internos).';
  if (code === 'ETIMEOUT' && /connect/i.test(m)) return 'O servidor não respondeu a tempo — confira endereço, porta, firewall e VPN.';
  if (code === 'ESOCKET' || /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|getaddrinfo/i.test(m)) return 'Não deu para falar com o servidor — confira endereço, porta (TCP habilitado no SQL Server?), firewall e VPN.';
  if (/instance/i.test(m) && /Port for/i.test(m)) return 'Instância nomeada não encontrada — o SQL Browser está parado? Informe a porta da instância.';
  if (code === 'ETIMEOUT' || /Timeout: Request failed/i.test(m)) return 'A consulta passou do tempo limite (o servidor está muito ocupado?).';
  if (/VIEW SERVER STATE/i.test(m)) return 'Falta a permissão VIEW SERVER STATE para ver as sessões dos outros.';
  return m.replace(/^RequestError: /, '');
}

/**
 * Datas do SQL Server chegam como "hora de parede" do servidor; o tedious (useUTC: false) monta o Date como se fosse
 * a hora local deste PC. Com o fuso do servidor (utc_offset_min, lido ao conectar), corrige para o instante certo —
 * servidor e PC em fusos diferentes continuam mostrando a hora certa.
 */
const toMs = (d, serverOffsetMin) => {
  if (serverOffsetMin == null) return d.getTime();
  const clientOffsetMin = -d.getTimezoneOffset();
  return d.getTime() + (clientOffsetMin - serverOffsetMin) * 60000;
};

/**
 * Abre a conexão. config: de src/db/connstr.js tediousConfig. → { query(sql) → [conjuntos de linhas], close(), alive,
 * onDead(cb) }
 */
function openConnection(config, { create = (cfg) => new Connection(cfg) } = {}) {
  return new Promise((resolve, reject) => {
    const conn = create(config);
    let alive = false;
    let deadCbs = [];
    let chain = Promise.resolve();
    let settled = false;
    let serverOffsetMin = null;
    const die = (e) => {
      if (!alive && settled) return;
      alive = false;
      const cbs = deadCbs; deadCbs = [];
      for (const cb of cbs) { try { cb(e); } catch { /* ignora */ } }
    };
    conn.on('error', (e) => { if (!settled) { settled = true; reject(new Error(friendlyError(e))); } die(e); });
    conn.on('end', () => die(new Error('Conexão encerrada')));
    conn.on('connect', (err) => {
      if (settled) return;
      settled = true;
      if (err) { reject(Object.assign(new Error(friendlyError(err)), { code: err.code })); return; }
      alive = true;
      resolve(api);
    });
    const exec = (sql) => new Promise((res, rej) => {
      if (!alive) { rej(new Error('Sem conexão com o servidor')); return; }
      const sets = [];
      let cur = null;
      const req = new Request(sql, (err) => (err ? rej(Object.assign(new Error(friendlyError(err)), { code: err.code, number: err.number })) : res(sets)));
      req.on('columnMetadata', (cols) => { cur = { columns: cols.map((c) => c.colName), rows: [] }; sets.push(cur); });
      req.on('row', (cols) => {
        if (!cur) return;
        const o = {};
        for (const c of cols) o[c.metadata.colName] = c.value instanceof Date ? toMs(c.value, serverOffsetMin) : c.value;
        cur.rows.push(o);
      });
      // Lote simples (sem sp_executesql): o monitor não usa parâmetros — os números são validados em queries.js.
      conn.execSqlBatch(req);
    });
    const api = {
      /** Fila: um comando por vez. → [{ columns, rows }] por conjunto de resultados. */
      query(sql) { const p = chain.then(() => exec(sql)); chain = p.catch(() => {}); return p; },
      close() { alive = false; try { conn.close(); } catch { /* já fechada */ } },
      get alive() { return alive; },
      onDead(cb) { deadCbs.push(cb); },
      /** Fuso do servidor em minutos (DATEDIFF(MINUTE, GETUTCDATE(), GETDATE())) para converter as datas. */
      setServerOffset(min) { serverOffsetMin = Number.isFinite(Number(min)) ? Number(min) : null; },
    };
    try { conn.connect(); } catch (e) { settled = true; reject(new Error(friendlyError(e))); }
  });
}

module.exports = { openConnection, friendlyError, toMs };
