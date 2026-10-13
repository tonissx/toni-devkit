'use strict';
/**
 * Banco — árvore de bloqueio a partir das linhas de NOW (src/db/queries.js). Puro.
 *
 * - Cabeça: sessão que bloqueia outras e não está esperando ninguém. Pode estar rodando ou **ociosa** (sleeping com
 *   transação aberta — vem do 2º conjunto de NOW, sem request).
 * - blocking_session_id = a própria sessão (paralelismo, CXPACKET) não é bloqueio: ignorado.
 * - Ciclo (A espera B que espera A — deadlock que o SQL Server ainda não resolveu): vira uma árvore com a menor
 *   sessão como cabeça e marca `cycle`.
 */

/**
 * requests: linhas do 1º conjunto de NOW; idle: linhas do 2º. now: Date do servidor (para "há quanto tempo").
 * → { trees: [node], blocked: Set(session_id), heads: [node], byId: Map }
 *   node = { id, row, idle, children: [node], depth, blockedCount (descendentes), maxWaitMs (maior espera abaixo),
 *            waitMs (própria), cycle }
 */
function blockingTree(requests = [], idle = []) {
  const byId = new Map();
  for (const r of requests) byId.set(Number(r.session_id), { id: Number(r.session_id), row: r, idle: false, children: [], blocker: blockerOf(r) });
  for (const s of idle) {
    const id = Number(s.session_id);
    if (!byId.has(id)) byId.set(id, { id, row: s, idle: true, children: [], blocker: 0 });
  }
  // Quem bloqueia alguém que não está na lista (a sessão sumiu entre as consultas): vira nó "desconhecido".
  for (const n of [...byId.values()]) {
    if (n.blocker && !byId.has(n.blocker)) byId.set(n.blocker, { id: n.blocker, row: null, idle: true, children: [], blocker: 0, unknown: true });
  }
  for (const n of byId.values()) {
    if (n.blocker) byId.get(n.blocker).children.push(n);
  }
  const blocked = new Set([...byId.values()].filter((n) => n.blocker).map((n) => n.id));
  // Cabeças: bloqueiam alguém e não são bloqueadas.
  let heads = [...byId.values()].filter((n) => n.children.length && !n.blocker);
  // Ciclos: nós bloqueados que nunca chegam numa cabeça.
  const reach = new Set();
  const mark = (n) => { if (reach.has(n.id)) return; reach.add(n.id); n.children.forEach(mark); };
  heads.forEach(mark);
  const orphans = [...blocked].filter((id) => !reach.has(id)).map((id) => byId.get(id)).sort((a, b) => a.id - b.id);
  for (const n of orphans) {
    if (reach.has(n.id)) continue;
    // Anda pelos bloqueadores até repetir: o nó repetido está no ciclo.
    const seen = new Set();
    let cur = n;
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.blocker); }
    if (!cur) continue;
    const cyc = [];
    let c = cur;
    do { cyc.push(c.id); c = byId.get(c.blocker); } while (c && c.id !== cur.id);
    const head = byId.get(Math.min(...cyc));
    head.cycle = true;
    // Corta a aresta que fecha o ciclo para a árvore ser árvore.
    const back = byId.get(head.blocker);
    if (back) back.children = back.children.filter((x) => x.id !== head.id);
    heads.push(head);
    mark(head);
  }
  const visit = (n, depth, seen) => {
    n.depth = depth;
    n.waitMs = n.row && Number(n.row.wait_time) ? Number(n.row.wait_time) : 0;
    let count = 0; let maxW = 0;
    for (const c of n.children) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      visit(c, depth + 1, seen);
      count += 1 + c.blockedCount;
      maxW = Math.max(maxW, c.waitMs, c.maxWaitMs);
    }
    n.blockedCount = count;
    n.maxWaitMs = maxW;
    n.children.sort((a, b) => b.blockedCount - a.blockedCount || b.waitMs - a.waitMs);
  };
  for (const h of heads) visit(h, 0, new Set([h.id]));
  heads = heads.sort((a, b) => b.blockedCount - a.blockedCount || b.maxWaitMs - a.maxWaitMs || a.id - b.id);
  return { trees: heads, heads, blocked, byId };
}

const blockerOf = (r) => {
  const b = Number(r.blocking_session_id) || 0;
  return b && b !== Number(r.session_id) ? b : 0;
};

/** Lista plana (cabeça → filhos, em ordem) para mostrar a árvore como linhas indentadas. */
function flatten(trees) {
  const out = [];
  const walk = (n) => { out.push(n); n.children.forEach(walk); };
  trees.forEach(walk);
  return out;
}

/** Resumo de uma cabeça para incidente/Início: "sessão 57 (Fluig · sa) segura 12 sessões há 45 s". */
function headSummary(h) {
  const r = h.row || {};
  const who = [r.program_name, r.login_name].filter(Boolean).join(' · ');
  const n = h.blockedCount;
  return `Sessão ${h.id}${who ? ` (${who})` : ''}${h.idle ? ' ociosa com transação aberta' : ''} segura ${n} ${n === 1 ? 'sessão' : 'sessões'} — maior espera ${Math.round(h.maxWaitMs / 1000)} s`;
}

module.exports = { blockingTree, flatten, headSummary };
