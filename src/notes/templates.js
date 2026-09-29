'use strict';
/**
 * Templates — funções puras.
 *
 * Template = qualquer nota dentro da pasta "Templates". Ao criar uma nota a partir dele, as variáveis
 * {{nome}} são trocadas: {{data}} 29/09/2026 · {{hoje}} 2026-09-29 · {{ontem}} 28/09/2026 · {{amanha}} 30/09/2026 ·
 * {{hora}} 14:21 · {{dia_semana}} terça-feira · {{data_extenso}} terça-feira, 29 de setembro de 2026 · {{titulo}} ·
 * {{cursor}} (onde o cursor começa). Nomes sem diferenciar maiúsculas nem acentos ({{amanhã}} também vale {{amanha}}).
 * Variável desconhecida fica como está.
 */
const TEMPLATES_FOLDER = 'Templates';

/** Variáveis sugeridas no autocomplete (ao digitar "{" num template) e listadas na ajuda. */
const TEMPLATE_VARS = [
  { name: 'data', desc: 'Data de hoje (dd/mm/aaaa)' },
  { name: 'hoje', desc: 'Data de hoje em aaaa-mm-dd — boa para ordenar e buscar' },
  { name: 'ontem', desc: 'Data de ontem (dd/mm/aaaa)' },
  { name: 'amanha', desc: 'Data de amanhã (dd/mm/aaaa)' },
  { name: 'hora', desc: 'Hora em que a nota foi criada (hh:mm)' },
  { name: 'dia_semana', desc: 'Dia da semana por extenso' },
  { name: 'data_extenso', desc: 'Data completa por extenso' },
  { name: 'cursor', desc: 'Onde o cursor começa na nota criada (some do texto)' },
];

const pad = (n) => String(n).padStart(2, '0');
/** Nome de variável comparável: sem acento, minúsculo. */
const varKey = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Variáveis de data/hora de `now` (hora local) + extras ({ titulo }). */
function templateVars(now = new Date(), extra = {}) {
  const br = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const plus = (days) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days); // vira mês/ano sozinho
  return {
    hoje: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    data: br(now),
    ontem: br(plus(-1)),
    amanha: br(plus(1)),
    hora: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    dia_semana: new Intl.DateTimeFormat('pt-BR', { weekday: 'long' }).format(now),
    data_extenso: new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now),
    titulo: '',
    ...extra,
  };
}

/**
 * Troca {{variáveis}} (sem diferenciar maiúsculas nem acentos; espaços dentro das chaves são aceitos).
 * {{cursor}} some e vira a posição inicial do cursor. → { text, cursor: número | null }
 */
function applyTemplate(text, vars = {}) {
  const map = Object.fromEntries(Object.entries(vars).map(([k, v]) => [varKey(k), v]));
  let cursor = null;
  let out = '';
  let last = 0;
  const src = String(text || '');
  for (const m of src.matchAll(/\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu)) {
    const key = varKey(m[1]);
    out += src.slice(last, m.index);
    last = m.index + m[0].length;
    if (key === 'cursor') { if (cursor === null) cursor = out.length; continue; }
    out += key in map && map[key] != null ? String(map[key]) : m[0];
  }
  out += src.slice(last);
  // Variáveis vazias no fim não deixam linhas em branco sobrando.
  const trimmed = out.replace(/\s+$/, '') + '\n';
  return { text: trimmed, cursor: cursor === null ? null : Math.min(cursor, trimmed.length) };
}

/** A pasta (caminho com "/") é a Templates ou está dentro dela? */
const isTemplateFolder = (folder) => {
  const top = String(folder || '').split('/')[0];
  return !!top && varKey(top) === varKey(TEMPLATES_FOLDER);
};

module.exports = { TEMPLATES_FOLDER, TEMPLATE_VARS, templateVars, applyTemplate, isTemplateFolder, varKey };
