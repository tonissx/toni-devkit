'use strict';
/**
 * Banco — lê o XML de um deadlock (xml_deadlock_report do system_health) e monta o grafo. Puro e sem DOM (roda no
 * processo principal): um leitor de XML mínimo, suficiente para este formato.
 *
 * → { victims: [processId], processes: [{ id, spid, login, host, app, db, isolation, lockMode, waitResource, waitMs,
 *      transaction, inputBuffer, frames: [{ proc, line, text }], victim }],
 *    resources: [{ id, type, object, index, mode, holders: [{ process, mode }], waiters: [{ process, mode, request }] }],
 *    edges: [{ from: processId, to: processId, resource, mode }]   // from espera to }
 */

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e] != null ? ENT[e] : m;
});

/** XML → árvore { name, attrs, children, text }. Ignora declaração, comentários e CDATA vira texto. */
function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const s = String(xml || '');
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const node = { name: m[3], attrs: {}, children: [], text: '' };
      const ar = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = ar.exec(m[4] || ''))) node.attrs[a[1]] = decode(a[2] != null ? a[2] : a[3]);
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] != null) top.text += decode(m[6]);
  }
  return root;
}

const kids = (n, name) => (n ? n.children.filter((c) => c.name === name) : []);
const kid = (n, name) => kids(n, name)[0] || null;
const textOf = (n) => (n ? (n.text + n.children.map(textOf).join('')).trim() : '');
const find = (n, name) => {
  if (!n) return null;
  if (n.name === name) return n;
  for (const c of n.children) { const r = find(c, name); if (r) return r; }
  return null;
};

// Tipos de recurso do relatório e um nome legível.
const RESOURCE_LABEL = {
  keylock: 'chave (linha de índice)', ridlock: 'linha (heap)', pagelock: 'página', objectlock: 'tabela/objeto',
  databaselock: 'banco', applicationlock: 'lock de aplicação', metadatalock: 'metadados', exchangeEvent: 'paralelismo',
  threadpool: 'threads', resourceWait: 'memória', hobtlock: 'partição', filelock: 'arquivo',
};

function parseDeadlock(xml) {
  const root = parseXml(xml);
  const dl = find(root, 'deadlock');
  if (!dl) throw new Error('XML sem <deadlock>');
  const victims = [];
  const vl = kid(dl, 'victim-list');
  for (const v of kids(vl, 'victimProcess')) if (v.attrs.id) victims.push(v.attrs.id);
  if (!victims.length && dl.attrs.victim) victims.push(dl.attrs.victim); // formato antigo (2008)

  const processes = kids(kid(dl, 'process-list'), 'process').map((p) => {
    const a = p.attrs;
    const frames = kids(kid(p, 'executionStack'), 'frame').map((f) => ({
      proc: f.attrs.procname && f.attrs.procname !== 'adhoc' && f.attrs.procname !== 'unknown' ? f.attrs.procname : '',
      line: Number(f.attrs.line) || null,
      // Lote ad hoc no 2019+: o frame vem como "unknown" — o texto de verdade está no inputbuf.
      text: /^unknown$/i.test(textOf(f)) ? '' : textOf(f).slice(0, 4000),
    }));
    return {
      id: a.id, spid: Number(a.spid) || null, login: a.loginname || '', host: a.hostname || '', app: a.clientapp || '',
      db: a.currentdbname || (a.currentdb ? `db ${a.currentdb}` : ''), isolation: a.isolationlevel || '', lockMode: a.lockMode || '',
      waitResource: a.waitresource || '', waitMs: Number(a.waittime) || 0, transaction: a.transactionname || '',
      tranCount: Number(a.trancount) || 0, lastBatchStarted: a.lastbatchstarted || '',
      inputBuffer: textOf(kid(p, 'inputbuf')).slice(0, 8000), frames, victim: victims.includes(a.id),
    };
  });

  const resources = [];
  const rl = kid(dl, 'resource-list');
  for (const r of rl ? rl.children : []) {
    const a = r.attrs;
    const holders = kids(kid(r, 'owner-list'), 'owner').map((o) => ({ process: o.attrs.id, mode: o.attrs.mode || '' }));
    const waiters = kids(kid(r, 'waiter-list'), 'waiter').map((w) => ({ process: w.attrs.id, mode: w.attrs.mode || '', request: w.attrs.requestType || '' }));
    resources.push({
      id: a.id || `${r.name}-${resources.length}`, type: r.name, label: RESOURCE_LABEL[r.name] || r.name,
      object: a.objectname || a.objectName || '', index: a.indexname || '', mode: a.mode || '', dbid: a.dbid || '',
      holders, waiters,
    });
  }

  // Aresta: quem espera → quem segura (por recurso).
  const edges = [];
  for (const r of resources) {
    for (const w of r.waiters) for (const h of r.holders) if (w.process !== h.process) edges.push({ from: w.process, to: h.process, resource: r.id, mode: w.mode });
  }
  return { victims, processes, resources, edges };
}

/** Uma linha para a lista: "2 processos · Pedido/IX_Status · vítima: sessão 63 (RM)". */
function deadlockSummary(g) {
  const v = g.processes.find((p) => p.victim);
  const objs = [...new Set(g.resources.map((r) => r.object.split('.').pop() + (r.index ? '/' + r.index : '')).filter((s) => s && s !== '/'))];
  return `${g.processes.length} processos${objs.length ? ' · ' + objs.slice(0, 3).join(', ') : ''}${v ? ` · vítima: sessão ${v.spid}${v.app ? ` (${v.app})` : ''}` : ''}`;
}

module.exports = { parseXml, parseDeadlock, deadlockSummary, RESOURCE_LABEL };
