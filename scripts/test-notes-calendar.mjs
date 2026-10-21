// Testes do filtro de calendário das Notes (dia local, contagem, intervalo): node --test scripts/test-notes-calendar.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../src/notes/calendar.js');
const { createNote } = require('../src/notes/note.js');
const { searchNotes } = require('../src/notes/search.js');

// Data local → ISO em UTC, como as notas guardam (independe do fuso de quem roda o teste).
const iso = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const note = (title, created) => createNote({ title, created, updated: created });

test('localDay: usa o dia local, não o texto UTC, e ignora data ilegível', () => {
  assert.equal(C.localDay(iso(2026, 10, 21, 23, 30)), '2026-10-21'); // à noite o UTC já pode ser o dia seguinte
  assert.equal(C.localDay(iso(2026, 10, 21, 0, 15)), '2026-10-21');  // e de madrugada, o dia anterior
  assert.equal(C.localDay('lixo'), null);
  assert.equal(C.localDay(''), null);
  assert.equal(C.localDay(null), null);
  assert.equal(C.localDay(undefined), null);
});

test('countByDay: conta as notas criadas por dia e deixa de fora as sem data válida', () => {
  const notes = [note('a', iso(2026, 10, 19)), note('b', iso(2026, 10, 19, 23, 50)), note('c', iso(2026, 10, 21)), { created: 'x' }, {}];
  assert.deepEqual(C.countByDay(notes), { '2026-10-19': 2, '2026-10-21': 1 });
  assert.deepEqual(C.countByDay([]), {});
  assert.deepEqual(C.countByDay(null), {});
});

test('normalizeRange/inRange: ordena as pontas e inclui as duas', () => {
  assert.deepEqual(C.normalizeRange('2026-10-21', '2026-10-19'), { from: '2026-10-19', to: '2026-10-21' });
  assert.deepEqual(C.normalizeRange('2026-10-19', '2026-10-19'), { from: '2026-10-19', to: '2026-10-19' });
  const r = { from: '2026-10-19', to: '2026-10-21' };
  assert.ok(C.inRange('2026-10-19', r) && C.inRange('2026-10-20', r) && C.inRange('2026-10-21', r));
  assert.ok(!C.inRange('2026-10-18', r) && !C.inRange('2026-10-22', r));
  assert.ok(!C.inRange(null, r) && !C.inRange('2026-10-20', null));
});

test('pickDay: um dia, depois o intervalo (em qualquer ordem); o mesmo dia limpa; intervalo pronto recomeça', () => {
  const a = C.pickDay(null, '2026-10-21');
  assert.deepEqual(a, { from: '2026-10-21', to: '2026-10-21' });
  assert.deepEqual(C.pickDay(a, '2026-10-19'), { from: '2026-10-19', to: '2026-10-21' }); // 21 → 19 vira 19–21
  assert.deepEqual(C.pickDay(a, '2026-10-23'), { from: '2026-10-21', to: '2026-10-23' });
  assert.equal(C.pickDay(a, '2026-10-21'), null);
  assert.deepEqual(C.pickDay({ from: '2026-10-19', to: '2026-10-21' }, '2026-10-25'), { from: '2026-10-25', to: '2026-10-25' });
});

test('monthGrid: semana começa no domingo, preenche com null e fecha em múltiplo de 7', () => {
  const g = C.monthGrid(2026, 9); // outubro de 2026 começa numa quinta
  assert.equal(g.length % 7, 0);
  assert.deepEqual(g.slice(0, 5), [null, null, null, null, '2026-10-01']);
  assert.equal(g.filter(Boolean).length, 31);
  assert.equal(g.filter(Boolean).at(-1), '2026-10-31');
  const fev = C.monthGrid(2024, 1); // 2024 é bissexto
  assert.equal(fev.filter(Boolean).length, 29);
});

test('rangeLabel: repete só o que muda', () => {
  assert.equal(C.rangeLabel(null), '');
  assert.equal(C.rangeLabel({ from: '2026-10-21', to: '2026-10-21' }), '21 out');
  assert.equal(C.rangeLabel({ from: '2026-10-19', to: '2026-10-21' }), '19–21 out');
  assert.equal(C.rangeLabel({ from: '2026-09-28', to: '2026-10-02' }), '28 set – 2 out');
});

test('searchNotes: filter.created recorta por dia de criação (pontas incluídas) e soma com a busca', () => {
  const notes = [
    note('Reunião de alinhamento', iso(2026, 10, 19, 0, 10)),
    note('Reunião de deploy', iso(2026, 10, 21, 23, 50)),
    note('Rascunho da API', iso(2026, 10, 20)),
    note('Reunião antiga', iso(2026, 9, 30)),
    { ...note('Sem data', 'lixo') },
  ];
  const titles = (rs) => rs.map((r) => r.title).sort();
  const range = { from: '2026-10-19', to: '2026-10-21' };
  assert.deepEqual(titles(searchNotes(notes, '', { filter: { created: range } })), ['Rascunho da API', 'Reunião de alinhamento', 'Reunião de deploy']);
  assert.deepEqual(titles(searchNotes(notes, 'reuniao', { filter: { created: range } })), ['Reunião de alinhamento', 'Reunião de deploy']);
  assert.deepEqual(titles(searchNotes(notes, '', { filter: { created: { from: '2026-10-20', to: '2026-10-20' } } })), ['Rascunho da API']);
  assert.equal(searchNotes(notes, '', { filter: {} }).length, 5); // sem o filtro, nada muda (nem a nota sem data)
});

test('searchNotes: filter.tags exige todas (padrão) ou qualquer uma, e a tag avulsa continua valendo', () => {
  const t = (title, tags) => createNote({ title, tags });
  const notes = [t('a', ['api', 'reuniao']), t('b', ['api']), t('c', ['reuniao', 'deploy']), t('d', [])];
  const titles = (rs) => rs.map((r) => r.title).sort();
  const run = (filter) => titles(searchNotes(notes, '', { filter }));
  assert.deepEqual(run({ tags: ['api', 'reuniao'] }), ['a']);                         // todas é o padrão
  assert.deepEqual(run({ tags: ['api', 'reuniao'], tagMode: 'all' }), ['a']);
  assert.deepEqual(run({ tags: ['api', 'reuniao'], tagMode: 'any' }), ['a', 'b', 'c']);
  assert.deepEqual(run({ tags: ['api'], tagMode: 'any' }), ['a', 'b']);
  assert.deepEqual(run({ tags: ['nada'], tagMode: 'any' }), []);
  assert.deepEqual(run({ tags: [] }), ['a', 'b', 'c', 'd']);                          // lista vazia não filtra
  assert.deepEqual(run({ tag: 'reuniao' }), ['a', 'c']);                              // formato antigo
  assert.deepEqual(run({ tag: 'reuniao', tags: ['deploy'], tagMode: 'any' }), ['c']); // a avulsa soma com a lista
  assert.deepEqual(run({ tags: ['api', 'reuniao'], tagMode: 'any', created: { from: '1999-01-01', to: '1999-01-02' } }), []); // soma com os outros filtros
});
