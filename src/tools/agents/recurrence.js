'use strict';
// Recorrência das rotinas dos Agentes (sem React e sem Electron): próxima execução e o texto que a descreve.
// { kind: 'daily' | 'weekdays' | 'weekly' | 'interval', time: 'HH:MM', days: [0..6] (0 = domingo; só no weekly), everyMin: número (só no interval) }

const KINDS = [
  { value: 'daily', label: 'Todo dia' },
  { value: 'weekdays', label: 'Dias úteis' },
  { value: 'weekly', label: 'Dias da semana' },
  { value: 'interval', label: 'A cada X minutos' },
];
const DAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MIN_INTERVAL = 5;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Normaliza o que veio da tela; lança Error (em português) se não faz sentido. */
function cleanRecurrence(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const kind = KINDS.some((k) => k.value === r.kind) ? r.kind : null;
  if (!kind) throw new Error('Escolha a frequência da rotina.');
  if (kind === 'interval') {
    const everyMin = Math.round(Number(r.everyMin));
    if (!Number.isFinite(everyMin) || everyMin < MIN_INTERVAL) throw new Error(`O intervalo mínimo é de ${MIN_INTERVAL} minutos.`);
    return { kind, everyMin: Math.min(everyMin, 60 * 24 * 30) };
  }
  const time = String(r.time || '');
  if (!TIME.test(time)) throw new Error('Informe o horário no formato HH:MM.');
  if (kind === 'weekly') {
    const days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (!days.length) throw new Error('Marque pelo menos um dia da semana.');
    return { kind, time, days };
  }
  return { kind, time };
}

const allowedDay = (rec, day) => rec.kind === 'daily' || (rec.kind === 'weekdays' && day >= 1 && day <= 5) || (rec.kind === 'weekly' && rec.days.includes(day));

/** Próxima execução estritamente depois de `from` (ms). `interval` conta a partir de `from`. */
function nextRun(rec, from) {
  if (rec.kind === 'interval') return from + rec.everyMin * 60000;
  const [h, m] = rec.time.split(':').map(Number);
  for (let i = 0; i <= 8; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (d.getTime() > from && allowedDay(rec, d.getDay())) return d.getTime();
  }
  return null;
}

function describeRecurrence(rec) {
  if (!rec) return '';
  if (rec.kind === 'interval') return rec.everyMin % 60 === 0 ? `A cada ${rec.everyMin / 60} h` : `A cada ${rec.everyMin} min`;
  if (rec.kind === 'daily') return `Todo dia às ${rec.time}`;
  if (rec.kind === 'weekdays') return `Dias úteis às ${rec.time}`;
  return `${rec.days.map((d) => DAY_NAMES[d]).join(', ')} às ${rec.time}`;
}

module.exports = { KINDS, DAY_NAMES, MIN_INTERVAL, cleanRecurrence, nextRun, describeRecurrence };
