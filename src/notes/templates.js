'use strict';
/**
 * Templates e nota diária — funções puras.
 *
 * Template = qualquer nota dentro da pasta "Templates". Ao criar uma nota a partir dele, as variáveis
 * {{nome}} são trocadas: {{data}} 29/09/2026 · {{hoje}} 2026-09-29 · {{hora}} 14:21 · {{dia_semana}} terça-feira ·
 * {{data_extenso}} terça-feira, 29 de setembro de 2026 · {{titulo}} · {{cursor}} (onde o cursor começa).
 * Variável desconhecida fica como está.
 *
 * Nota diária = nota "AAAA-MM-DD" na pasta "Diário". Nasce do template "Diário" (se existir na pasta
 * Templates) ou do padrão abaixo; além das variáveis acima, tem {{pendencias}} (tarefas vencidas e de hoje,
 * como lista com link para a nota de origem) e {{anterior}} (link para a nota diária anterior).
 */
const DAILY_FOLDER = 'Diário';
const TEMPLATES_FOLDER = 'Templates';
const DAILY_TEMPLATE = 'Diário'; // título do template da nota diária
const PENDING_MAX = 20;

const DEFAULT_DAILY = [
  '# {{data_extenso}}',
  '',
  '## Pendências',
  '{{pendencias}}',
  '',
  '## Hoje',
  '- [ ] {{cursor}}',
  '',
  '## Anotações',
  '',
  '',
  '{{anterior}}',
].join('\n');

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const br = (isoDate) => `${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}`;

/** Variáveis de data/hora de `now` (hora local) + extras ({ titulo, pendencias, anterior }). */
function templateVars(now = new Date(), extra = {}) {
  return {
    hoje: iso(now),
    data: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`,
    hora: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    dia_semana: new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(now),
    data_extenso: new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now),
    titulo: '',
    ...extra,
  };
}

/**
 * Troca {{variáveis}} (sem diferenciar maiúsculas; espaços dentro das chaves são aceitos).
 * {{cursor}} some e vira a posição inicial do cursor. → { text, cursor: número | null }
 */
function applyTemplate(text, vars = {}) {
  const map = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  let cursor = null;
  let out = '';
  let last = 0;
  const src = String(text || '');
  for (const m of src.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)) {
    const key = m[1].toLowerCase();
    out += src.slice(last, m.index);
    last = m.index + m[0].length;
    if (key === 'cursor') { if (cursor === null) cursor = out.length; continue; }
    out += key in map && map[key] != null ? String(map[key]) : m[0];
  }
  out += src.slice(last);
  // Variáveis vazias no fim (ex.: {{anterior}} sem nota anterior) não deixam linhas em branco sobrando.
  const trimmed = out.replace(/\s+$/, '') + '\n';
  return { text: trimmed, cursor: cursor === null ? null : Math.min(cursor, trimmed.length) };
}

/** Título da nota diária de uma data. */
const dailyTitle = (d = new Date()) => iso(d);
const isDailyTitle = (t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t || '').trim());

/**
 * Pendências para a nota diária: tarefas abertas vencidas ou para hoje (as de tasks() do serviço),
 * como lista simples com link para a nota de origem — não duplicam as tarefas no painel Tarefas.
 */
function pendingList(tasks, today) {
  const due = (tasks || []).filter((t) => !t.checked && t.due && t.due <= today);
  if (!due.length) return '_Nada vencido nem para hoje._';
  const lines = due.slice(0, PENDING_MAX).map((t) => {
    const when = t.due < today ? `🔴 venceu ${br(t.due)}` : '📅 hoje';
    const pri = t.priority ? ` !${t.priority}` : '';
    return `- ${t.text}${pri} — [[${t.noteTitle}]] (${when})`;
  });
  if (due.length > PENDING_MAX) lines.push(`- …e mais ${due.length - PENDING_MAX} (veja o painel Tarefas)`);
  return lines.join('\n');
}

module.exports = {
  DAILY_FOLDER, TEMPLATES_FOLDER, DAILY_TEMPLATE, DEFAULT_DAILY,
  templateVars, applyTemplate, dailyTitle, isDailyTitle, pendingList,
};
