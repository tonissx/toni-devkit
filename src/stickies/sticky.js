'use strict';
/**
 * Sticky notes — regras puras (sem Electron), testadas em scripts/test-stickies.mjs.
 * Uma sticky é uma nota existente fixada na tela; aqui ficam só o formato do estado e a geometria das janelas.
 * Estado (por computador, %APPDATA%\Toni Devkit\stickies.json):
 *   { v: 1, hidden: false, stickies: [{ noteId, bounds: { x, y, width, height }, color, collapsed }] }
 * Toda sticky fica sempre por cima (é para isso que ela existe); para sair da frente: recolher, ocultar todas ou ✕.
 */

const MAX_STICKIES = 6;
const DEFAULT_SIZE = { width: 300, height: 260 };
const MIN_SIZE = { width: 200, height: 120 };
const COLLAPSED_HEIGHT = 38;
const MARGIN = 24;   // distância da borda do monitor para uma sticky nova
const CASCADE = 28;  // deslocamento entre stickies novas

/** Cores da faixa: cada uma vira um token do tema (ver renderer/sticky.css), então acompanham o tema. */
const COLORS = ['accent', 'keyword', 'string', 'bool', 'number'];

const ID_RE = /^[\w-]{1,64}$/;
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);

function normBounds(b) {
  if (!b || typeof b !== 'object') return null;
  const x = num(b.x), y = num(b.y), width = num(b.width), height = num(b.height);
  if ([x, y, width, height].some((v) => v == null)) return null;
  return { x, y, width: Math.max(MIN_SIZE.width, width), height: Math.max(MIN_SIZE.height, height) };
}

/** Uma sticky válida (ou null): noteId seguro, bounds numéricos, cor conhecida. Campos antigos (onTop) somem. */
function normalizeSticky(s) {
  if (!s || typeof s.noteId !== 'string' || !ID_RE.test(s.noteId)) return null;
  return {
    noteId: s.noteId,
    bounds: normBounds(s.bounds),
    color: COLORS.includes(s.color) ? s.color : COLORS[0],
    collapsed: s.collapsed === true,
  };
}

/** Estado lido do disco → formato válido (descarta inválidos, repetidos e o que passar do limite). */
function normalizeState(raw) {
  const seen = new Set();
  const stickies = [];
  for (const s of (raw && Array.isArray(raw.stickies) ? raw.stickies : [])) {
    const n = normalizeSticky(s);
    if (!n || seen.has(n.noteId)) continue;
    seen.add(n.noteId);
    stickies.push(n);
    if (stickies.length >= MAX_STICKIES) break;
  }
  return { v: 1, hidden: !!(raw && raw.hidden === true), stickies };
}

/** Área de interseção entre dois retângulos. */
function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Garante que a janela apareça inteira num monitor que existe. workAreas: [{ x, y, width, height }].
 * Usa o monitor com maior interseção (ou o mais próximo do centro, se nenhuma) e encaixa a janela nele,
 * encolhendo se ela for maior que o monitor. Monitor desconectado → a sticky volta para um que existe.
 */
function fitBounds(bounds, workAreas) {
  const b = normBounds(bounds) || { x: 0, y: 0, ...DEFAULT_SIZE };
  if (!workAreas || !workAreas.length) return b;
  let wa = workAreas.reduce((best, w) => (overlap(b, w) > overlap(b, best) ? w : best), workAreas[0]);
  if (!overlap(b, wa)) {
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const dist = (w) => Math.hypot(clamp(cx, w.x, w.x + w.width) - cx, clamp(cy, w.y, w.y + w.height) - cy);
    wa = workAreas.reduce((best, w) => (dist(w) < dist(best) ? w : best), workAreas[0]);
  }
  const width = Math.min(b.width, wa.width), height = Math.min(b.height, wa.height);
  return {
    x: clamp(b.x, wa.x, wa.x + wa.width - width),
    y: clamp(b.y, wa.y, wa.y + wa.height - height),
    width, height,
  };
}

/** Posição de uma sticky nova: canto superior direito do monitor, em cascata sobre as que já estão lá. */
function cascadeBounds(existing, workArea) {
  const wa = workArea;
  const { width, height } = DEFAULT_SIZE;
  const base = { x: wa.x + wa.width - width - MARGIN, y: wa.y + MARGIN };
  const taken = (existing || []).filter(Boolean);
  for (let i = 0; i < MAX_STICKIES + 2; i++) {
    const c = { x: base.x - i * CASCADE, y: base.y + i * CASCADE, width, height };
    if (!taken.some((t) => Math.abs(t.x - c.x) < 8 && Math.abs(t.y - c.y) < 8)) return fitBounds(c, [wa]);
  }
  return fitBounds({ ...base, width, height }, [wa]);
}

module.exports = {
  MAX_STICKIES, DEFAULT_SIZE, MIN_SIZE, COLLAPSED_HEIGHT, COLORS,
  normalizeSticky, normalizeState, fitBounds, cascadeBounds,
};
