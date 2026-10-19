'use strict';
/**
 * Monitor de IA — utilidades dos adaptadores.
 *
 * Evento normalizado (o que todo adaptador produz):
 *   { ts, kind, tool?, ref?, summary?, tokens?, model?, error? }
 *   kind: prompt | text | thinking | tool_use | tool_result | turn_start | turn_end | usage | title | meta
 *   ref liga tool_use ↔ tool_result; tokens = { input, output, cacheRead, cacheWrite }.
 */
const clip = (s, n) => {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

/** Resumo curto do argumento de uma ferramenta (comando, caminho, padrão…). */
function describeInput(input) {
  if (input == null) return '';
  if (typeof input === 'string') return clip(input, 160);
  if (typeof input !== 'object') return clip(String(input), 160);
  const k = ['command', 'cmd', 'file_path', 'path', 'pattern', 'query', 'url', 'description', 'prompt'].find((x) => typeof input[x] === 'string' && input[x]);
  if (k) return clip(input[k], 160);
  try { return clip(JSON.stringify(input), 160); } catch { return ''; }
}

module.exports = { clip, describeInput };
