'use strict';
/**
 * Painel do Início — regras puras (sem React nem IPC), testadas em scripts/test-home.mjs.
 * A tela (src/screens/Home.jsx) só busca os dados nos serviços e desenha o que sai daqui.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'Bom dia' (5h–11h) · 'Boa tarde' (12h–17h) · 'Boa noite'. */
function greeting(now = new Date()) {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** "sábado, 4 de outubro". */
function longDate(now = new Date()) {
  return now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Dias entre duas datas ISO (YYYY-MM-DD), b − a. */
function daysBetween(a, b) {
  const d = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((d(b) - d(a)) / DAY_MS);
}

/** Prazo relativo a hoje: 'Hoje' · 'Amanhã' · 'Ontem' · 'há 3 dias' · 'em 5 dias' · '12/11' (mais de uma semana). */
function dueLabel(due, today) {
  const n = daysBetween(today, due);
  if (n === 0) return 'Hoje';
  if (n === 1) return 'Amanhã';
  if (n === -1) return 'Ontem';
  if (n < 0 && n >= -7) return `há ${-n} dias`;
  if (n > 0 && n <= 7) return `em ${n} dias`;
  return `${due.slice(8, 10)}/${due.slice(5, 7)}`;
}

/**
 * Agenda do dia a partir das tarefas abertas (notes.tasks, já ordenadas por prazo e prioridade):
 * vencidas, de hoje e dos próximos `horizon` dias; se sobrar espaço, completa com as sem prazo de prioridade.
 * → { items: [{ ...tarefa, bucket: 'late'|'today'|'next'|'none' }], counts: { late, today, next, none, open } }
 */
function agenda(tasks, today, { limit = 7, horizon = 7 } = {}) {
  const counts = { late: 0, today: 0, next: 0, none: 0, open: 0 };
  const due = [];
  const loose = [];
  for (const t of tasks || []) {
    if (t.checked) continue;
    counts.open++;
    if (!t.due) { counts.none++; loose.push({ ...t, bucket: 'none' }); continue; }
    const n = daysBetween(today, t.due);
    const bucket = n < 0 ? 'late' : n === 0 ? 'today' : 'next';
    counts[bucket]++;
    if (n <= horizon) due.push({ ...t, bucket });
  }
  // Sem prazo só entram as com prioridade (as outras são "algum dia" e poluiriam o painel).
  const extra = loose.filter((t) => t.priority).sort((a, b) => a.priority - b.priority);
  return { items: [...due, ...extra].slice(0, limit), counts };
}

/** Partes do resumo do dia para o cabeçalho, com o tom de cada uma: [{ text, tone: 'late'|'today'|'calm' }]. */
function daySummaryParts(counts) {
  if (!counts) return [];
  const parts = [];
  if (counts.late) parts.push({ text: counts.late === 1 ? '1 tarefa vencida' : `${counts.late} tarefas vencidas`, tone: 'late' });
  if (counts.today) parts.push({ text: counts.today === 1 ? '1 tarefa para hoje' : `${counts.today} tarefas para hoje`, tone: 'today' });
  if (!parts.length && counts.open) parts.push({ text: 'Nada vencendo hoje', tone: 'calm' });
  return parts;
}

/** Frase-resumo do dia, ou '' quando não há nada pendente. */
const daySummary = (counts) => daySummaryParts(counts).map((p) => p.text).join(' · ');

/** Notas recentes sem repetir: as editadas primeiro, completando com as vistas (recent() do serviço). */
function recentNotes(recent, limit = 6) {
  const seen = new Set();
  const out = [];
  for (const n of [...((recent && recent.edited) || []), ...((recent && recent.viewed) || [])]) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

/** Links rápidos para o painel: os com valores recentes primeiro (mais usados), depois os favoritos, por alias. */
function dashboardLinks(links, limit = 6) {
  return [...(links || [])]
    .sort((a, b) => ((b.recent || []).length > 0) - ((a.recent || []).length > 0) || String(a.alias).localeCompare(String(b.alias)))
    .slice(0, limit);
}

/** Painéis do Início, na ordem em que aparecem. O usuário pode esconder qualquer um (Personalizar). */
const PANELS = [
  { id: 'tasks', name: 'Tarefas' },
  { id: 'notes', name: 'Notas recentes' },
  { id: 'links', name: 'Links rápidos' },
  { id: 'devcore', name: 'DevCore' },
  { id: 'tools', name: 'Ferramentas' },
];

module.exports = { greeting, longDate, daysBetween, dueLabel, agenda, daySummary, daySummaryParts, recentNotes, dashboardLinks, PANELS };
