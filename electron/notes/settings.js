'use strict';
/**
 * Configurações das Notes que valem para o app todo (arquivo JSON em userData):
 *   dir          — pasta das notas (vale após reiniciar; `DEVKIT_NOTES_DIR` continua mandando mais)
 *   historyMax   — versões guardadas por nota
 *   historyGapMin — minutos entre duas versões da mesma nota
 * As preferências só da tela (tempo do auto-save, janela de desfazer) ficam no localStorage do renderer.
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = { historyMax: 50, historyGapMin: 10 };
const LIMITS = { historyMax: [5, 500], historyGapMin: [1, 240] };

const inRange = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;

/** Devolve as configurações válidas de `raw`; o que for inválido some (volta ao padrão). */
function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (typeof r.dir === 'string' && r.dir.trim() && path.isAbsolute(r.dir.trim())) out.dir = path.normalize(r.dir.trim());
  for (const k of Object.keys(LIMITS)) if (inRange(Math.round(r[k]), LIMITS[k])) out[k] = Math.round(r[k]);
  return out;
}

function createNotesSettings(file) {
  let data = {};
  try { data = clean(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { data = {}; }

  return {
    /** Configurações efetivas (com padrões) + a pasta definida pelo usuário, se houver. */
    get: () => ({ ...DEFAULTS, ...data }),
    /** Só o que o usuário definiu (sem padrões). */
    raw: () => ({ ...data }),
    /**
     * Aplica um patch ({ campo: valor | null }; null volta ao padrão). Erro de validação vira exceção com
     * mensagem em português. Devolve as configurações efetivas.
     */
    set(patch = {}) {
      const next = { ...data };
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in DEFAULTS) && k !== 'dir') continue;
        if (v == null || v === '') { delete next[k]; continue; }
        if (k === 'dir') {
          if (typeof v !== 'string' || !path.isAbsolute(v.trim())) throw new Error('Escolha uma pasta (caminho completo).');
          next.dir = path.normalize(v.trim());
        } else {
          const n = Math.round(Number(v));
          if (!inRange(n, LIMITS[k])) throw new Error(k === 'historyMax' ? `Versões por nota: de ${LIMITS.historyMax[0]} a ${LIMITS.historyMax[1]}.` : `Intervalo entre versões: de ${LIMITS.historyGapMin[0]} a ${LIMITS.historyGapMin[1]} minutos.`);
          next[k] = n;
        }
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(next, null, 2));
      data = next;
      return { ...DEFAULTS, ...data };
    },
  };
}

module.exports = { createNotesSettings, DEFAULTS, LIMITS };
