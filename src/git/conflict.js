'use strict';
/**
 * Git — arquivo em conflito: lê os marcadores que o git deixa no arquivo e monta o resultado a partir das escolhas
 * feitas na tela (por bloco: o meu, o deles, os dois, ou um texto editado). JS puro, testado em scripts/test-git.mjs.
 *
 *   <<<<<<< HEAD            ← "meu" (a branch em que você está)
 *   ...
 *   ||||||| base            ← opcional (conflictStyle=diff3): como era antes
 *   ...
 *   =======
 *   ...                     ← "deles" (o que está entrando)
 *   >>>>>>> outra-branch
 */

/**
 * Texto com marcadores → { eol, parts } com parts: { type: 'text', lines } | { type: 'conflict', ours, base, theirs,
 * oursLabel, theirsLabel } (linhas sem a quebra). Marcadores incompletos ficam como texto comum.
 */
function parseConflicts(text) {
  const src = String(text || '');
  const eol = /\r\n/.test(src) ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const endsWithEol = lines.length > 1 && lines[lines.length - 1] === '';
  if (endsWithEol) lines.pop();
  const parts = [];
  let plain = [];
  const flush = () => { if (plain.length) { parts.push({ type: 'text', lines: plain }); plain = []; } };
  for (let i = 0; i < lines.length; i++) {
    const m = /^<{7}(?: (.*))?$/.exec(lines[i]);
    if (!m) { plain.push(lines[i]); continue; }
    // Procura o fim do bloco; sem ele, o "<<<<<<<" é texto.
    const block = { type: 'conflict', ours: [], base: null, theirs: [], oursLabel: m[1] || '', theirsLabel: '' };
    let j = i + 1, where = 'ours', ok = false;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (where === 'ours' && /^\|{7}( .*)?$/.test(l)) { where = 'base'; block.base = []; continue; }
      if ((where === 'ours' || where === 'base') && /^={7}$/.test(l)) { where = 'theirs'; continue; }
      const end = where === 'theirs' && /^>{7}(?: (.*))?$/.exec(l);
      if (end) { block.theirsLabel = end[1] || ''; ok = true; break; }
      block[where].push(l);
    }
    if (!ok) { plain.push(lines[i]); continue; }
    flush();
    parts.push(block);
    i = j;
  }
  flush();
  return { eol, endsWithEol, parts };
}

const conflictCount = (parsed) => parsed.parts.filter((p) => p.type === 'conflict').length;

/**
 * Monta o arquivo final. choices[k] para o k-ésimo conflito: 'ours' | 'theirs' | 'both' (meu e depois o deles) |
 * 'both-rev' (deles e depois o meu) | { text } (editado à mão) | undefined (mantém os marcadores).
 */
function resolveConflicts(parsed, choices = []) {
  const out = [];
  let k = 0;
  for (const p of parsed.parts) {
    if (p.type === 'text') { out.push(...p.lines); continue; }
    const c = choices[k++];
    if (c === 'ours') out.push(...p.ours);
    else if (c === 'theirs') out.push(...p.theirs);
    else if (c === 'both') out.push(...p.ours, ...p.theirs);
    else if (c === 'both-rev') out.push(...p.theirs, ...p.ours);
    else if (c && typeof c.text === 'string') { if (c.text !== '') out.push(...c.text.split(/\r?\n/)); }
    else {
      out.push('<<<<<<< ' + p.oursLabel, ...p.ours);
      if (p.base) out.push('|||||||', ...p.base);
      out.push('=======', ...p.theirs, '>>>>>>> ' + p.theirsLabel);
    }
  }
  return out.join(parsed.eol) + (parsed.endsWithEol ? parsed.eol : '');
}

/** O texto ainda tem marcadores de conflito? (Para não marcar como resolvido por engano.) */
const hasMarkers = (text) => /^(<{7}|={7}|>{7})( |$)/m.test(String(text || '').replace(/\r/g, ''));

module.exports = { parseConflicts, resolveConflicts, conflictCount, hasMarkers };
