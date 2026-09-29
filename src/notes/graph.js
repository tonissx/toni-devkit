'use strict';
/**
 * Grafo das notas — funções puras (serviço monta os dados; o painel usa o layout).
 *
 * buildGraph: nós = notas, arestas = [[links]] resolvidos (título ou alias), sem duplicar nem laço.
 * Link para nota inexistente vira nó "fantasma". Layout: forças simples (repulsão, molas, gravidade)
 * com "temperatura" (alpha) que esfria até parar — o painel só anima enquanto está quente.
 */
const { wikiLinks } = require('./note.js');
const { normalize } = require('../commands/search.js');

/**
 * notes: [{ id, title, folder, type, tags, content }] (title = título exibido).
 * index: Map(normalize(título | alias) → id) — o mesmo de resolveLink.
 * exclude(note) → true para deixar a nota fora (ex.: templates).
 * → { nodes: [{ id, title, folder, type, tags, degree, ghost }], links: [{ source, target }] }
 */
function buildGraph(notes, index, exclude = () => false) {
  const nodes = new Map();
  for (const n of notes) {
    if (exclude(n)) continue;
    nodes.set(n.id, { id: n.id, title: n.title, folder: n.folder || '', type: n.type || 'note', tags: n.tags || [], degree: 0, ghost: false });
  }
  const seen = new Set();
  const links = [];
  const connect = (a, b) => {
    const key = a < b ? a + '\n' + b : b + '\n' + a;
    if (a === b || seen.has(key)) return;
    seen.add(key);
    links.push({ source: a, target: b });
    nodes.get(a).degree++;
    nodes.get(b).degree++;
  };
  for (const n of notes) {
    if (!nodes.has(n.id)) continue;
    for (const title of wikiLinks(n.content)) {
      const key = normalize(title).trim();
      if (!key) continue;
      const target = index.get(key);
      if (target) { if (nodes.has(target)) connect(n.id, target); continue; } // alvo excluído (template): sem aresta
      const gid = 'ghost:' + key;
      if (!nodes.has(gid)) nodes.set(gid, { id: gid, title, folder: '', type: 'ghost', tags: [], degree: 0, ghost: true });
      connect(n.id, gid);
    }
  }
  return { nodes: [...nodes.values()], links };
}

/** Subgrafo sem órfãs (grau 0) e/ou sem fantasmas. Graus recalculados para o que sobrou. */
function filterGraph(graph, { orphans = true, ghosts = true } = {}) {
  let nodes = graph.nodes.filter((n) => (ghosts || !n.ghost));
  const ids = new Set(nodes.map((n) => n.id));
  const links = graph.links.filter((l) => ids.has(l.source) && ids.has(l.target));
  const degree = new Map();
  for (const l of links) { degree.set(l.source, (degree.get(l.source) || 0) + 1); degree.set(l.target, (degree.get(l.target) || 0) + 1); }
  nodes = nodes.map((n) => ({ ...n, degree: degree.get(n.id) || 0 }));
  if (!orphans) nodes = nodes.filter((n) => n.degree > 0);
  return { nodes, links };
}

/** Vizinhança de `id` até `depth` saltos (grafo local da nota aberta). */
function neighborhood(graph, id, depth = 1) {
  if (!graph.nodes.some((n) => n.id === id)) return { nodes: [], links: [] };
  const adj = new Map();
  for (const l of graph.links) {
    if (!adj.has(l.source)) adj.set(l.source, []);
    if (!adj.has(l.target)) adj.set(l.target, []);
    adj.get(l.source).push(l.target);
    adj.get(l.target).push(l.source);
  }
  const keep = new Set([id]);
  let frontier = [id];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const v of frontier) for (const w of adj.get(v) || []) if (!keep.has(w)) { keep.add(w); next.push(w); }
    frontier = next;
  }
  return filterGraph({ nodes: graph.nodes.filter((n) => keep.has(n.id)), links: graph.links.filter((l) => keep.has(l.source) && keep.has(l.target)) });
}

/* ─────────────── Layout (forças) ─────────────── */
const REPEL = 2600;      // repulsão entre nós
const SPRING = 0.06;     // força das molas (arestas)
const LINK_LEN = 70;     // comprimento de repouso da mola
const GRAVITY = 0.012;   // puxa tudo levemente para o centro (0, 0)
const DAMPING = 0.55;    // atrito
const DECAY = 0.982;     // quanto o alpha esfria por passo (~300 passos até parar)
const ALPHA_MIN = 0.006;
const MAX_SPEED = 40;
const CUTOFF = 420;      // repulsão ignorada além dessa distância
const GRID_FROM = 400;   // a partir de quantos nós usa grade espacial (evita O(n²) em grafos grandes)

/** Hash estável de string → [0, 1) (posições iniciais determinísticas). */
function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Layout para um grafo. prev (layout anterior) mantém as posições de quem já existia — o grafo
 * muda sem "explodir". Nós novos nascem perto de um vizinho já posicionado ou numa espiral.
 */
function createLayout(graph, prev = null) {
  const old = new Map();
  if (prev) for (const p of prev.nodes) old.set(p.id, p);
  const nodes = graph.nodes.map((n, i) => {
    const o = old.get(n.id);
    if (o) return { ...n, x: o.x, y: o.y, vx: 0, vy: 0, fixed: o.fixed };
    const a = i * 2.399963 + hash01(n.id) * 0.5; // ângulo áureo
    const r = 12 * Math.sqrt(i + 1);
    return { ...n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, fixed: false, fresh: true };
  });
  const at = new Map(nodes.map((n, i) => [n.id, i]));
  const links = graph.links.map((l) => [at.get(l.source), at.get(l.target)]).filter(([a, b]) => a != null && b != null);
  // Nós novos com um vizinho já posicionado nascem ao lado dele.
  for (const [a, b] of links) {
    const [na, nb] = [nodes[a], nodes[b]];
    if (na.fresh && !nb.fresh) place(na, nb);
    else if (nb.fresh && !na.fresh) place(nb, na);
  }
  for (const n of nodes) delete n.fresh;
  const changed = !prev || nodes.length !== prev.nodes.length || links.length !== prev.links.length || nodes.some((n) => !old.has(n.id));
  return { nodes, links, at, alpha: prev ? (changed ? Math.max(prev.alpha, 0.5) : prev.alpha) : 1 };
}

function place(n, near) {
  const a = hash01(n.id) * Math.PI * 2;
  n.x = near.x + Math.cos(a) * LINK_LEN;
  n.y = near.y + Math.sin(a) * LINK_LEN;
}

/** Aplica repulsão entre i e j. */
function repel(ns, i, j, k) {
  const a = ns[i], b = ns[j];
  let dx = a.x - b.x, dy = a.y - b.y;
  let d2 = dx * dx + dy * dy;
  if (d2 > CUTOFF * CUTOFF) return;
  if (d2 < 0.01) { dx = (hash01(a.id) - 0.5) || 0.1; dy = (hash01(b.id) - 0.5) || 0.1; d2 = dx * dx + dy * dy; }
  const f = k / d2;
  a.vx += dx * f; a.vy += dy * f;
  b.vx -= dx * f; b.vy -= dy * f;
}

/** Um passo da simulação. Devolve true enquanto ainda está "quente" (vale continuar animando). */
function step(L) {
  if (L.alpha < ALPHA_MIN) return false;
  const ns = L.nodes, n = ns.length, alpha = L.alpha;
  const k = REPEL * alpha;
  if (n < GRID_FROM) {
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) repel(ns, i, j, k);
  } else {
    const cell = CUTOFF / 2, grid = new Map();
    const key = (x, y) => Math.floor(x / cell) + ':' + Math.floor(y / cell);
    ns.forEach((p, i) => { const g = key(p.x, p.y); if (!grid.has(g)) grid.set(g, []); grid.get(g).push(i); });
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(ns[i].x / cell), cy = Math.floor(ns[i].y / cell);
      for (let gx = cx - 2; gx <= cx + 2; gx++) for (let gy = cy - 2; gy <= cy + 2; gy++) {
        for (const j of grid.get(gx + ':' + gy) || []) if (j > i) repel(ns, i, j, k);
      }
    }
  }
  for (const [a, b] of L.links) {
    const p = ns[a], q = ns[b];
    const dx = q.x - p.x, dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const f = ((d - LINK_LEN) / d) * SPRING * alpha;
    p.vx += dx * f; p.vy += dy * f;
    q.vx -= dx * f; q.vy -= dy * f;
  }
  for (const p of ns) {
    p.vx = (p.vx - p.x * GRAVITY * alpha) * DAMPING;
    p.vy = (p.vy - p.y * GRAVITY * alpha) * DAMPING;
    if (p.fixed) { p.vx = 0; p.vy = 0; continue; }
    const s = Math.hypot(p.vx, p.vy);
    if (s > MAX_SPEED) { p.vx *= MAX_SPEED / s; p.vy *= MAX_SPEED / s; }
    p.x += p.vx; p.y += p.vy;
  }
  L.alpha *= DECAY;
  return true;
}

/** Esquenta de novo (ex.: ao arrastar um nó) para o resto se acomodar. */
const reheat = (L, a = 0.3) => { L.alpha = Math.max(L.alpha, a); };

/** Caixa que envolve os nós: { minX, minY, maxX, maxY } (para "Centralizar"). */
function bounds(L) {
  if (!L.nodes.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of L.nodes) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}

module.exports = { buildGraph, filterGraph, neighborhood, createLayout, step, reheat, bounds, LINK_LEN };
