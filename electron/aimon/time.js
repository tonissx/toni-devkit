'use strict';
/** Monitor de IA — dias locais (AAAA-MM-DD). Puro. */
const pad = (n) => String(n).padStart(2, '0');
/** Dia local de um instante em ms. */
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Meia-noite local de um dia AAAA-MM-DD, em ms. */
const dayStart = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

module.exports = { dayKey, dayStart };
