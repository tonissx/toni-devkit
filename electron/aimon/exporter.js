'use strict';
/**
 * Monitor de IA — exportar as métricas de uso (o objeto de usage.range) em CSV, JSON ou Markdown. Puro: devolve o texto;
 * quem chama decide onde salvar. Só números e nomes de projeto/modelo/ferramenta; nunca texto de prompt.
 */
const FORMATS = { csv: { ext: 'csv', label: 'CSV' }, json: { ext: 'json', label: 'JSON' }, md: { ext: 'md', label: 'Markdown' } };

const round = (n, d = 4) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
const min = (ms) => (Number.isFinite(ms) ? round(ms / 60000, 2) : null);

/** Célula de CSV: aspas quando há vírgula, aspas ou quebra de linha; fórmulas de planilha (= + - @) não saem soltas. */
function cell(v) {
  if (v == null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const line = (arr) => arr.map(cell).join(',');

const COLS = ['secao', 'nome', 'tokens', 'custo_usd', 'trabalho_min', 'espera_min', 'sessoes', 'execucoes', 'erros', 'media_ms', 'max_ms'];

/** CSV "longo": uma linha por dia, modelo, projeto e ferramenta, com a coluna `secao` dizendo qual é. */
function toCsv(r) {
  const rows = [COLS];
  for (const d of r.series) rows.push(['dia', d.day, d.tokens, round(d.cost), min(d.workMs), min(d.waitMs), d.sessions, '', '', '', '']);
  for (const m of r.byModel) rows.push(['modelo', m.model, m.total, m.cost == null ? '' : round(m.cost), '', '', '', '', '', '', '']);
  for (const p of r.byProject) rows.push(['projeto', p.project, p.total, round(p.cost), min(p.workMs), min(p.waitMs), p.sessions, '', '', '', '']);
  for (const t of r.byTool || []) rows.push(['ferramenta', t.tool, '', '', '', '', '', t.n, t.errors, t.avgMs == null ? '' : Math.round(t.avgMs), Math.round(t.maxMs)]);
  return rows.map(line).join('\r\n') + '\r\n';
}

function toJson(r, meta = {}) {
  return JSON.stringify({ exportadoEm: new Date(meta.at || Date.now()).toISOString(), dias: r.days, totais: { ...r.totals, tokens: undefined, tokensDetalhe: r.totals.tokens }, porDia: r.series, porModelo: r.byModel.map(({ model, total, cost, price }) => ({ model, total, cost, price })), porProjeto: r.byProject, porFerramenta: r.byTool || [], turnos: r.turns || null, planos: r.plans, semPreco: r.unpriced, observacao: 'Custo é uma estimativa a partir dos tokens e dos preços configurados.' }, null, 2) + '\n';
}

const usd = (v) => (v == null || !Number.isFinite(v) ? '—' : 'US$ ' + v.toFixed(2));
const hm = (ms) => { const m = Math.round((ms || 0) / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
const sec = (ms) => (ms == null ? '—' : ms >= 60000 ? hm(ms) : ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : Math.round(ms) + ' ms');
const md = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`, ...rows.map((x) => `| ${x.map(md).join(' | ')} |`)].join('\n') : '_Sem dados no período._');

function toMarkdown(r, meta = {}) {
  const t = r.totals;
  const when = new Date(meta.at || Date.now()).toLocaleDateString('pt-BR');
  const out = [
    `# Uso de IA — últimos ${r.days} dia(s)`, '', `Exportado em ${when}. O custo é uma **estimativa** a partir dos tokens e dos preços configurados.`, '',
    '## Resumo', '',
    `- Custo estimado: **${usd(t.cost)}**${t.savings > 0.005 ? ` (o cache poupou ${usd(t.savings)})` : ''}`,
    `- Tokens: **${t.total.toLocaleString('pt-BR')}** (saída ${t.tokens.output.toLocaleString('pt-BR')})`,
    `- Trabalhando: **${hm(t.workMs)}** · esperando você: **${hm(t.waitMs)}** (${Math.round(t.waitShare * 100)}% do tempo, ${t.waitCount} pausa(s))`,
    `- Sessões: **${t.sessions}** · subagentes: ${t.agents}`,
  ];
  if (r.turns && r.turns.n) out.push(`- Turnos: ${r.turns.n} · duração média ${sec(r.turns.avgMs)} · maior ${sec(r.turns.maxMs)}`);
  if (r.plans.approved + r.plans.rejected) out.push(`- Planos: ${r.plans.approved} aprovado(s), ${r.plans.rejected} recusado(s)`);
  out.push('', '## Por dia', '', table(['Dia', 'Tokens', 'Custo', 'Trabalho', 'Espera', 'Sessões'], r.series.filter((d) => d.tokens || d.workMs || d.waitMs).map((d) => [d.day, d.tokens.toLocaleString('pt-BR'), usd(d.cost), hm(d.workMs), hm(d.waitMs), d.sessions])));
  out.push('', '## Por modelo', '', table(['Modelo', 'Tokens', 'Custo'], r.byModel.map((m) => [m.model, m.total.toLocaleString('pt-BR'), m.cost == null ? 'sem preço' : usd(m.cost)])));
  out.push('', '## Por projeto', '', table(['Projeto', 'Custo', 'Trabalho', 'Espera', 'Sessões'], r.byProject.map((p) => [p.project, usd(p.cost), hm(p.workMs), hm(p.waitMs), p.sessions])));
  out.push('', '## Ferramentas', '', 'A duração inclui, às vezes, a espera por uma permissão; execuções acima de 30 min ficam fora da média.', '',
    table(['Ferramenta', 'Execuções', 'Erros', 'Taxa de erro', 'Média', 'Maior'], (r.byTool || []).map((x) => [x.tool, x.n, x.errors, Math.round(x.errorRate * 100) + '%', sec(x.avgMs), sec(x.maxMs)])));
  return out.join('\n') + '\n';
}

/** → { text, ext, mime }. Formato desconhecido lança erro. */
function exportUsage(range, format, meta = {}) {
  if (!range || !Array.isArray(range.series)) throw new Error('Nada para exportar');
  if (format === 'csv') return { text: toCsv(range), ext: 'csv', mime: 'text/csv' };
  if (format === 'json') return { text: toJson(range, meta), ext: 'json', mime: 'application/json' };
  if (format === 'md') return { text: toMarkdown(range, meta), ext: 'md', mime: 'text/markdown' };
  throw new Error('Formato de exportação desconhecido');
}

module.exports = { exportUsage, toCsv, toJson, toMarkdown, FORMATS, cell };
