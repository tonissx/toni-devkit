// Testes do painel do Início (regras puras): node --test scripts/test-home.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const H = require('../src/home/dashboard.js');

const at = (h) => new Date(2026, 9, 4, h, 30);

test('greeting muda com a hora do dia', () => {
  assert.equal(H.greeting(at(4)), 'Boa noite');
  assert.equal(H.greeting(at(5)), 'Bom dia');
  assert.equal(H.greeting(at(11)), 'Bom dia');
  assert.equal(H.greeting(at(12)), 'Boa tarde');
  assert.equal(H.greeting(at(17)), 'Boa tarde');
  assert.equal(H.greeting(at(18)), 'Boa noite');
});

test('longDate escreve dia da semana, dia e mês', () => {
  assert.equal(H.longDate(new Date(2026, 9, 4)), 'domingo, 4 de outubro');
});

test('dueLabel é relativo a hoje e vira dd/mm longe dele', () => {
  const today = '2026-10-04';
  assert.equal(H.dueLabel('2026-10-04', today), 'Hoje');
  assert.equal(H.dueLabel('2026-10-05', today), 'Amanhã');
  assert.equal(H.dueLabel('2026-10-03', today), 'Ontem');
  assert.equal(H.dueLabel('2026-10-01', today), 'há 3 dias');
  assert.equal(H.dueLabel('2026-10-09', today), 'em 5 dias');
  assert.equal(H.dueLabel('2026-11-12', today), '12/11');
  assert.equal(H.dueLabel('2026-09-01', today), '01/09');
  // Virada de mês/ano não confunde a conta de dias.
  assert.equal(H.dueLabel('2027-01-01', '2026-12-31'), 'Amanhã');
});

test('agenda: vencidas, hoje e próximos 7 dias; sem prazo só com prioridade', () => {
  const today = '2026-10-04';
  const tasks = [
    { text: 'atrasada', due: '2026-10-01' },
    { text: 'hoje', due: '2026-10-04', priority: 1 },
    { text: 'semana', due: '2026-10-10' },
    { text: 'longe', due: '2026-12-01' },
    { text: 'sem prazo' },
    { text: 'sem prazo !3', priority: 3 },
    { text: 'sem prazo !1', priority: 1 },
    { text: 'feita', due: '2026-10-04', checked: true },
  ];
  const { items, counts } = H.agenda(tasks, today);
  assert.deepEqual(items.map((t) => t.text), ['atrasada', 'hoje', 'semana', 'sem prazo !1', 'sem prazo !3']);
  assert.deepEqual(items.map((t) => t.bucket), ['late', 'today', 'next', 'none', 'none']);
  assert.deepEqual(counts, { late: 1, today: 1, next: 2, none: 3, open: 7 });
});

test('agenda respeita o limite', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ text: 't' + i, due: '2026-10-04' }));
  const { items, counts } = H.agenda(tasks, '2026-10-04', { limit: 5 });
  assert.equal(items.length, 5);
  assert.equal(counts.today, 20);
  assert.deepEqual(H.agenda(null, '2026-10-04').items, []);
});

test('daySummary resume o que vence', () => {
  assert.equal(H.daySummary({ late: 2, today: 1, open: 5 }), '2 tarefas vencidas · 1 tarefa para hoje');
  assert.equal(H.daySummary({ late: 1, today: 0, open: 1 }), '1 tarefa vencida');
  assert.equal(H.daySummary({ late: 0, today: 3, open: 3 }), '3 tarefas para hoje');
  assert.equal(H.daySummary({ late: 0, today: 0, open: 4 }), 'Nada vencendo hoje');
  assert.equal(H.daySummary({ late: 0, today: 0, open: 0 }), '');
  assert.equal(H.daySummary(null), '');
});

test('recentNotes junta editadas e vistas sem repetir', () => {
  const recent = { edited: [{ id: 'a' }, { id: 'b' }], viewed: [{ id: 'b' }, { id: 'c' }, { id: 'd' }] };
  assert.deepEqual(H.recentNotes(recent, 3).map((n) => n.id), ['a', 'b', 'c']);
  assert.deepEqual(H.recentNotes(null), []);
});

test('dashboardLinks põe os usados primeiro e depois ordena por alias', () => {
  const links = [
    { alias: 'zeta', recent: [] },
    { alias: 'beta', recent: ['1'] },
    { alias: 'alfa' },
    { alias: 'solic', recent: ['123', '456'] },
  ];
  assert.deepEqual(H.dashboardLinks(links).map((l) => l.alias), ['beta', 'solic', 'alfa', 'zeta']);
  assert.equal(H.dashboardLinks(links, 2).length, 2);
});

test('PANELS tem ids únicos', () => {
  const ids = H.PANELS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});
