'use strict';
/**
 * Logs — arquivos rotacionados numa pasta: reconhece as "famílias" (server.log + server.log.1 + server.log.2026-10-10
 * + server.log.2026-10-09.gz…) e põe os arquivos em ordem, do mais antigo ao atual. Puro: recebe nomes e datas.
 *
 * Nomes reconhecidos (com .gz opcional):
 *   app.log  app.log.1  app.log.2            (número maior = mais antigo — logrotate, log4j RollingFile)
 *   server.log.2026-10-10                    (JBoss/Fluig periodic-rotating-file-handler)
 *   app.2026-10-10.log  app-2026-10-10.log  app_20261010.log  app.2026-10-10.1.log
 *   u_ex261011.log                           (IIS: yymmdd)
 */

const LOG_EXT = /\.(log|txt|out|json|ndjson|jsonl)$/i;

/** Data num nome → 'YYYY-MM-DD' (ou com hora 'YYYY-MM-DD-HH'). */
function dateIn(s) {
  let m = /(?:^|[._-])(\d{4})-?(\d{2})-?(\d{2})(?:[-_T]?(\d{2}))?(?=$|[._-])/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) return `${m[1]}-${m[2]}-${m[3]}` + (m[4] ? '-' + m[4] : '');
  m = /^u_ex(\d{2})(\d{2})(\d{2})(\d{2})?/i.exec(s); // IIS
  if (m) return `20${m[1]}-${m[2]}-${m[3]}` + (m[4] ? '-' + m[4] : '');
  return null;
}

/**
 * Lê um nome de arquivo. → { name, family, date, n, gz, active } ou null (não parece log).
 * family: o nome "base" que junta os rotacionados. active: é o arquivo que está sendo escrito (sem data/número).
 */
function parseName(name) {
  let rest = String(name);
  const gz = /\.gz$/i.test(rest);
  if (gz) rest = rest.slice(0, -3);
  // IIS: u_ex261011.log → família u_ex.log
  let m = /^(u_ex|ex|u_in|in|u_nc|nc)(\d{6,8})(?:_x)?\.log$/i.exec(rest);
  if (m) return { name, family: m[1].toLowerCase() + '.log', date: dateIn(rest), n: 0, gz, active: false };
  // app.log.3
  m = /^(.*\.(?:log|txt|out|json|ndjson|jsonl))\.(\d{1,4})$/i.exec(rest);
  if (m) return { name, family: m[1], date: null, n: Number(m[2]), gz, active: false };
  // server.log.2026-10-10 (pode ter .1 depois)
  m = /^(.*\.(?:log|txt|out))[._-](\d{4}-?\d{2}-?\d{2}(?:[-_T]?\d{2})?)(?:\.(\d+))?$/i.exec(rest);
  if (m && dateIn('.' + m[2])) return { name, family: m[1], date: dateIn('.' + m[2]), n: m[3] ? Number(m[3]) : 0, gz, active: false };
  if (!LOG_EXT.test(rest)) return null;
  const ext = rest.slice(rest.lastIndexOf('.'));
  const stem = rest.slice(0, -ext.length);
  // app.2026-10-10.log · app-2026-10-10.1.log · app_20261010.log
  m = /^(.*?)[._-](\d{4}-?\d{2}-?\d{2}(?:[-_T]?\d{2})?)(?:[._-](\d+))?$/.exec(stem);
  if (m && dateIn('.' + m[2])) return { name, family: m[1] + ext, date: dateIn('.' + m[2]), n: m[3] ? Number(m[3]) : 0, gz, active: false };
  // app.1.log (log4j2 com %i)
  m = /^(.*?)[._-](\d{1,3})$/.exec(stem);
  if (m && m[1]) return { name, family: m[1] + ext, date: null, n: Number(m[2]), gz, active: false };
  return { name, family: rest, date: null, n: 0, gz, active: !gz };
}

/**
 * Famílias de logs numa pasta. entries: [{ name, mtime (ms), size }].
 * → [{ family, files: [{ name, date, n, gz, active, mtime, size }] (antigo → atual), active: name|null, size, mtime }]
 *   ordenadas pela mais recente (mtime do arquivo mais novo).
 */
function families(entries) {
  const by = new Map();
  for (const e of entries || []) {
    const p = parseName(e.name);
    if (!p) continue;
    const key = p.family.toLowerCase();
    if (!by.has(key)) by.set(key, { family: p.family, files: [] });
    by.get(key).files.push({ ...p, mtime: e.mtime || 0, size: e.size || 0 });
  }
  const out = [];
  for (const f of by.values()) {
    f.files.sort(compareOldFirst);
    const last = f.files[f.files.length - 1];
    f.active = last && last.active ? last.name : null;
    f.size = f.files.reduce((s, x) => s + x.size, 0);
    f.mtime = Math.max(0, ...f.files.map((x) => x.mtime));
    out.push(f);
  }
  return out.sort((a, b) => b.mtime - a.mtime || a.family.localeCompare(b.family));
}

/** Do mais antigo ao atual: datados por data (e número), numerados do maior ao menor, o ativo por último. */
function compareOldFirst(a, b) {
  if (a.active !== b.active) return a.active ? 1 : -1;
  if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.date && !b.date) return b.n ? 1 : -1;
  if (!a.date && b.date) return a.n ? -1 : 1;
  if (a.date && b.date) return a.n - b.n; // mesmo dia: .1, .2 na ordem em que foram criados
  if (a.n !== b.n) return b.n - a.n; // app.log.3 é mais antigo que app.log.1
  return (a.mtime || 0) - (b.mtime || 0);
}

/** Meia-noite local do dia de um arquivo (para logs que gravam só a hora): pela data no nome ou pelo mtime. */
function baseDayOf(file) {
  const d = file && file.date;
  if (d) { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); }
  const t = new Date(file && file.mtime ? file.mtime : Date.now());
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
}

module.exports = { parseName, families, compareOldFirst, dateIn, baseDayOf };
