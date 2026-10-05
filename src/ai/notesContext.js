'use strict';
// IA — monta o contexto de "Perguntar às notas": busca local primeiro (a mesma busca da tela de Notes) e manda só
// trechos das melhores notas. Notas com a tag "privado" nunca entram. O conteúdo vai como está no arquivo: blocos
// ```secret``` têm só o NOME da entrada do Vault — o segredo nunca é resolvido aqui.

const STOP = new Set('a o os as um uma uns umas de do da dos das em no na nos nas por para pra com sem que qual quais quando como onde quem é e ou se meu minha meus minhas eu foi era ser está estão the of to in on for and or is are was what how where when which who why my i'.split(' '));

/** Palavras que importam na pergunta (sem acento, sem palavras vazias). */
function keywords(question) {
  return [...new Set(String(question || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^\w.-]+/).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 8);
}

/** Trecho de até `max` caracteres em volta da 1ª palavra-chave encontrada (ou o começo da nota). */
function excerptAround(content, words, max = 1500) {
  const text = String(content || '');
  if (text.length <= max) return text;
  const plain = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const hits = words.map((w) => plain.indexOf(w)).filter((i) => i >= 0);
  const at = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), text.length - max));
  return (start > 0 ? '…' : '') + text.slice(start, start + max) + (start + max < text.length ? '…' : '');
}

/** → { question, notes: [{ id, title, excerpt }] } com até `limit` notas. */
async function gatherNotes(question, limit = 6) {
  const api = window.devkit.notes;
  const words = keywords(question);
  const score = new Map(); // id → { hit, score }
  const add = (hits) => { for (const h of hits) { const cur = score.get(h.id); if (!cur || h.score > cur.score) score.set(h.id, h); } };
  add(await api.search(question, { limit: 12 }).catch(() => []));
  if (score.size < limit) for (const w of words) add(await api.search(w, { limit: 6 }).catch(() => []));
  const best = [...score.values()].filter((h) => !(h.tags || []).includes('privado')).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, limit);
  const notes = [];
  for (const h of best) {
    const full = await api.get(h.id).catch(() => null);
    if (full && !(full.tagsAll || full.tags || []).includes('privado')) notes.push({ id: h.id, title: h.title, excerpt: excerptAround(full.content, words) });
  }
  return { question, notes };
}

module.exports = { keywords, excerptAround, gatherNotes };
