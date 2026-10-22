// Testes do motor e do serviço de Logs com arquivos de verdade (sem Electron, sem worker): node --test scripts/test-logs-service.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
const { createEngine, sniffEncoding } = require('../electron/logs/engine.js');
const { createLogsService } = require('../electron/logs/service.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tk-logs-'));
const line = (s, lv, msg) => `2026-10-11 10:00:${String(s).padStart(2, '0')},000 ${lv.padEnd(5)} [com.x] (t) ${msg}\n`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(opts = {}) {
  const dir = tmp();
  const engine = createEngine(opts);
  const events = [];
  const svc = createLogsService({
    file: path.join(dir, 'logs.json'),
    callWorker: async (op, args) => engine.call(op, args),
    broadcast: (e) => events.push(e),
    watch: () => ({ close() {}, on() {} }),
    pollMs: 3600e3,
  });
  return { dir, engine, svc, events };
}

test('encoding: BOM, UTF-8 válido, windows-1252 e UTF-16 sem BOM', () => {
  assert.deepEqual(sniffEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), { encoding: 'utf-8', bom: 3 });
  assert.deepEqual(sniffEncoding(Buffer.from([0xff, 0xfe, 0x61, 0])), { encoding: 'utf-16le', bom: 2 });
  assert.equal(sniffEncoding(Buffer.from('ação', 'utf8')).encoding, 'utf-8');
  assert.equal(sniffEncoding(Buffer.from([0x61, 0xe7, 0xe3, 0x6f, 0x0a])).encoding, 'windows-1252'); // "açãо" em cp1252
  assert.equal(sniffEncoding(Buffer.from('2026-10-11 10:00:00 INFO teste de log\n'.repeat(3), 'utf16le')).encoding, 'utf-16le');
  // UTF-8 cortado no meio de um caractere no fim da amostra continua UTF-8.
  assert.equal(sniffEncoding(Buffer.from('aç', 'utf8').subarray(0, 2)).encoding, 'utf-8');
});

test('serviço abre o arquivo, detecta o formato e começa ao vivo', async () => {
  const { dir, svc } = setup();
  const f = path.join(dir, 'server.log');
  fs.writeFileSync(f, line(1, 'INFO', 'ok') + line(2, 'ERROR', 'falhou id=7') + '\tat com.x.Y.z(Y.java:1)\n' + line(3, 'WARN', 'lento'));
  const info = await svc.open({ kind: 'file', path: f });
  assert.equal(info.format, 'jboss');
  assert.equal(info.n, 3);
  assert.equal(info.live, true);
  assert.equal(info.name, 'server.log');
  assert.equal(svc.recents()[0].kind, 'file');
  await assert.rejects(svc.open({ kind: 'file', path: path.join(dir, 'nao-existe.log') }), /Não encontrado/);
  svc.unwatch();
});

test('engine: consulta, linhas, detalhe, contexto, próximo erro, exportar', async () => {
  const dir = tmp();
  const f = path.join(dir, 'server.log');
  fs.writeFileSync(f, line(1, 'INFO', 'ok') + line(2, 'ERROR', 'falhou id=7') + '\tat com.x.Y.z(Y.java:1)\n' + line(3, 'WARN', 'lento') + line(4, 'ERROR', 'falhou id=8') + '\tat com.x.Y.z(Y.java:1)\n');
  const e = createEngine();
  const info = await e.call('open', { id: 'a', files: [{ path: f, name: 'server.log' }], tail: false });
  assert.equal(info.n, 4);
  assert.deepEqual(info.levelTotals, [0, 0, 0, 1, 1, 2, 0]);
  const r = e.call('query', { id: 'a', qid: 1, q: 'falhou' });
  assert.equal(r.total, 2);
  assert.equal(r.groups.length, 1);
  assert.equal(r.groups[0].count, 2);
  assert.ok(r.hist && r.hist.data.length === r.hist.buckets * 7);
  const rows = e.call('rows', { id: 'a', qid: 1, from: 0, count: 10 });
  assert.deepEqual(rows.rows.map((x) => x.i), [1, 3]);
  assert.equal(rows.rows[0].lines, 2);
  assert.deepEqual(e.call('rows', { id: 'a', qid: 99, from: 0 }), { stale: true });
  const d = e.call('entry', { id: 'a', i: 1 });
  assert.equal(d.parsed.msg, 'falhou id=7');
  assert.match(d.parsed.stack, /at com\.x\.Y\.z/);
  assert.equal(d.group.count, 2);
  assert.deepEqual(e.call('context', { id: 'a', i: 1, before: 1, after: 1 }).rows.map((x) => x.i), [0, 1, 2]);
  e.call('query', { id: 'a', qid: 2, q: '' });
  assert.deepEqual(e.call('next', { id: 'a', qid: 2, pos: 1, dir: 1 }), { pos: 3 });
  assert.deepEqual(e.call('next', { id: 'a', qid: 2, pos: 1, dir: -1 }), { pos: -1 });
  assert.deepEqual(e.call('next', { id: 'a', qid: 2, pos: 3, dir: -1, minLevel: 4 }), { pos: 2 });
  assert.equal(e.call('locate', { id: 'a', qid: 2, i: 2 }).pos, 2);
  const out = path.join(dir, 'out.md');
  e.call('query', { id: 'a', qid: 3, q: 'level:error' });
  assert.deepEqual(await e.call('exportTo', { id: 'a', qid: 3, file: out, kind: 'md' }), { count: 2 });
  const md = fs.readFileSync(out, 'utf8');
  assert.match(md, /Filtro: `level:error` · 2 entradas/);
  assert.match(md, /falhou id=7\n\tat com\.x\.Y\.z\(Y\.java:1\)\n.*falhou id=8\n\tat com\.x\.Y\.z\(Y\.java:1\)\n```\n$/);
  const ch = e.call('charts', { id: 'a', qid: 3 });
  assert.equal(ch.loggers.items[0].key, 'com.x');
});

test('engine: visão "full" mantém o log inteiro e marca os achados; hitNear pula de achado em achado', async () => {
  const dir = tmp();
  const f = path.join(dir, 'server.log');
  fs.writeFileSync(f, line(1, 'INFO', 'ok') + line(2, 'ERROR', 'falhou id=7') + '\tat com.x.Y.z(Y.java:1)\n' + line(3, 'WARN', 'lento') + line(4, 'ERROR', 'falhou id=8') + line(5, 'INFO', 'fim'));
  const e = createEngine();
  await e.call('open', { id: 'a', files: [{ path: f, name: 'server.log' }], tail: false });
  const r = e.call('query', { id: 'a', qid: 1, q: 'falhou', full: true });
  assert.equal(r.total, 2);
  assert.equal(r.fullTotal, 5);
  assert.equal(e.call('query', { id: 'a', qid: 2, q: 'falhou' }).fullTotal, null);
  e.call('query', { id: 'a', qid: 1, q: 'falhou', full: true });
  // padrão ('hits') segue igual a antes; 'full' devolve tudo, com hit marcado
  assert.deepEqual(e.call('rows', { id: 'a', qid: 1, from: 0, count: 10 }).rows.map((x) => x.i), [1, 3]);
  const all = e.call('rows', { id: 'a', qid: 1, from: 0, count: 10, view: 'full' });
  assert.equal(all.total, 5);
  assert.deepEqual(all.rows.map((x) => [x.i, x.hit]), [[0, false], [1, true], [2, false], [3, true], [4, false]]);
  assert.equal(e.call('rows', { id: 'a', qid: 1, from: 0, count: 10 }).rows[0].hit, undefined);
  // locate: a posição de um achado na lista completa é a própria entrada
  assert.deepEqual(e.call('locate', { id: 'a', qid: 1, i: 3, view: 'full' }), { pos: 3, exact: true });
  assert.deepEqual(e.call('locate', { id: 'a', qid: 1, i: 3 }), { pos: 1, exact: true });
  // hitNear: de uma entrada qualquer para o achado seguinte/anterior, dando a volta
  assert.deepEqual(e.call('hitNear', { id: 'a', qid: 1, i: -1, dir: 1 }), { k: 0, i: 1, total: 2 });
  assert.deepEqual(e.call('hitNear', { id: 'a', qid: 1, i: 1, dir: 1 }), { k: 1, i: 3, total: 2 });
  assert.deepEqual(e.call('hitNear', { id: 'a', qid: 1, i: 3, dir: 1 }), { k: 0, i: 1, total: 2 });
  assert.deepEqual(e.call('hitNear', { id: 'a', qid: 1, i: 2, dir: -1 }), { k: 0, i: 1, total: 2 });
  assert.deepEqual(e.call('hitNear', { id: 'a', qid: 1, i: 1, dir: -1 }), { k: 1, i: 3, total: 2 });
  assert.deepEqual(e.call('hitNear', { id: 'a', qid: 1, i: 99, dir: -1 }), { k: 1, i: 3, total: 2 });
  assert.equal(e.call('hitNear', { id: 'a', qid: 99, i: 0 }).stale, true);
  // sem achados
  e.call('query', { id: 'a', qid: 3, q: 'nada-assim', full: true });
  assert.deepEqual(e.call('hitNear', { id: 'a', qid: 3, i: 0 }), { k: -1, i: -1, total: 0 });
  // intervalo de tempo continua valendo na visão completa
  const t3 = e.call('entry', { id: 'a', i: 3 }).ts;
  const rg = e.call('query', { id: 'a', qid: 4, q: 'falhou', from: t3, to: null, full: true });
  assert.equal(rg.fullTotal, 2);
  assert.deepEqual(e.call('rows', { id: 'a', qid: 4, from: 0, count: 10, view: 'full' }).rows.map((x) => x.i), [3, 4]);
});

test('engine: contexto ao redor dos achados (visão ctx) e marcadores', async () => {
  const dir = tmp();
  const f = path.join(dir, 'server.log');
  let txt = '';
  for (let k = 0; k < 10; k++) txt += line(k, k === 2 || k === 7 ? 'ERROR' : 'INFO', k === 2 || k === 7 ? 'falhou' : 'ok ' + k);
  fs.writeFileSync(f, txt);
  const e = createEngine();
  await e.call('open', { id: 'a', files: [{ path: f, name: 'server.log' }], tail: false });
  // sem contexto: ctx == só os achados
  let r = e.call('query', { id: 'a', qid: 1, q: 'falhou', full: true });
  assert.equal(r.ctxTotal, 2);
  assert.deepEqual(e.call('rows', { id: 'a', qid: 1, from: 0, count: 20, view: 'ctx' }).rows.map((x) => x.i), [2, 7]);
  // ± 1: achados 2 e 7 trazem 1,3 e 6,8
  r = e.call('query', { id: 'a', qid: 2, q: 'falhou', full: true, ctx: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.ctxTotal, 6);
  const c = e.call('rows', { id: 'a', qid: 2, from: 0, count: 20, view: 'ctx' }).rows;
  assert.deepEqual(c.map((x) => x.i), [1, 2, 3, 6, 7, 8]);
  assert.deepEqual(c.map((x) => [!!x.hit, !!x.near]), [[false, true], [true, false], [false, true], [false, true], [true, false], [false, true]]);
  // a visão de achados (painel) não muda; a completa marca os vizinhos
  assert.deepEqual(e.call('rows', { id: 'a', qid: 2, from: 0, count: 20 }).rows.map((x) => x.i), [2, 7]);
  const full = e.call('rows', { id: 'a', qid: 2, from: 0, count: 20, view: 'full' }).rows;
  assert.deepEqual(full.filter((x) => x.near).map((x) => x.i), [1, 3, 6, 8]);
  // borda do arquivo: achado na primeira/última entrada não estoura
  r = e.call('query', { id: 'a', qid: 4, q: '"ok 9"', full: true, ctx: 3 });
  assert.deepEqual(e.call('rows', { id: 'a', qid: 4, from: 0, count: 20, view: 'ctx' }).rows.map((x) => x.i), [6, 7, 8, 9]);
  // marcadores: 10 entradas em 5 faixas → achados 2 e 7 caem nas faixas 1 e 3; o pior nível é ERROR
  e.call('query', { id: 'a', qid: 5, q: 'falhou', full: true });
  const m = e.call('marks', { id: 'a', qid: 5, view: 'full', buckets: 5, pins: [0, 9, 99] });
  assert.equal(m.total, 10);
  assert.deepEqual(m.hits, [0, 1, 0, 1, 0]);
  assert.deepEqual(m.worst, [0, 5, 0, 5, 0]);
  assert.deepEqual(m.pins, [0, 4]);
  assert.equal(e.call('marks', { id: 'a', qid: 99, view: 'full' }).stale, true);
});

test('última linha sem \\n conta quando não está ao vivo', async () => {
  const dir = tmp();
  const f = path.join(dir, 'a.log');
  fs.writeFileSync(f, line(1, 'INFO', 'um') + line(2, 'ERROR', 'dois').trimEnd());
  const e = createEngine();
  assert.equal((await e.call('open', { id: 'a', files: [{ path: f, name: 'a.log' }], tail: false })).n, 2);
  const e2 = createEngine();
  assert.equal((await e2.call('open', { id: 'a', files: [{ path: f, name: 'a.log' }], tail: true })).n, 1);
});

test('ao vivo: cresce, linha cortada, assenta parado, trunca e rotaciona', async () => {
  const { dir, svc, events, engine } = setup();
  const f = path.join(dir, 'server.log');
  fs.writeFileSync(f, line(1, 'INFO', 'um'));
  const info = await svc.open({ kind: 'file', path: f });
  const id = info.id;
  fs.appendFileSync(f, line(2, 'ERROR', 'dois') + '\tat a.B.c(B.ja');
  await svc._check(id);
  assert.equal(events.at(-1).type, 'appended');
  assert.equal(events.at(-1).n, 2);
  fs.appendFileSync(f, 'va:1)\n');
  await svc._check(id);
  let q = engine.call('query', { id, qid: 1, q: '' });
  assert.equal(q.n, 2);
  assert.equal(q.groups.length, 0); // a entrada de erro ainda está aberta
  // Parado por 2 s: a entrada fecha e o erro entra no grupo.
  engine._sources.get(id).grownAt = Date.now() - 5000;
  await svc._check(id);
  q = engine.call('query', { id, qid: 2, q: '' });
  assert.equal(q.groups.length, 1);
  assert.equal(engine.call('entry', { id, i: 1 }).lines, 2);
  // Truncado (encolheu): reabre do zero.
  fs.writeFileSync(f, line(5, 'WARN', 'novo'));
  await svc._check(id);
  assert.equal(events.at(-1).type, 'reset');
  assert.equal(events.at(-1).reason, 'truncated');
  assert.equal(events.at(-1).info.n, 1);
  // Rotação: o arquivo foi renomeado e outro criado no lugar.
  fs.renameSync(f, f + '.1');
  await sleep(20);
  fs.writeFileSync(f, line(6, 'INFO', 'depois da rotação') + line(7, 'INFO', 'mais'));
  await svc._check(id);
  assert.equal(events.at(-1).type, 'reset');
  assert.equal(events.at(-1).info.n, 2);
  assert.equal(svc.list().length, 1);
  await svc.close(id);
  assert.equal(svc.list().length, 0);
});

test('pasta: junta os rotacionados (com .gz) em ordem e só o atual fica ao vivo', async () => {
  const { dir, svc, engine } = setup();
  fs.writeFileSync(path.join(dir, 'app.log.2.gz'), zlib.gzipSync(line(1, 'INFO', 'mais antigo')));
  fs.writeFileSync(path.join(dir, 'app.log.1'), line(2, 'WARN', 'ontem'));
  fs.writeFileSync(path.join(dir, 'app.log'), line(3, 'ERROR', 'hoje'));
  fs.writeFileSync(path.join(dir, 'outro.log'), line(4, 'INFO', 'outra família'));
  fs.writeFileSync(path.join(dir, 'leia.md'), '# nada');
  const info = await svc.open({ kind: 'folder', path: dir, family: 'app.log' });
  assert.deepEqual(info.files.map((f) => f.name), ['app.log.2.gz', 'app.log.1', 'app.log']);
  assert.equal(info.n, 3);
  assert.equal(info.live, true);
  assert.deepEqual(info.families.map((f) => f.family).sort(), ['app.log', 'outro.log']);
  const rows = (engine.call('query', { id: info.id, qid: 1 }), engine.call('rows', { id: info.id, qid: 1, from: 0, count: 5 })).rows;
  assert.deepEqual(rows.map((r) => r.text.split(') ')[1]), ['mais antigo', 'ontem', 'hoje']);
  assert.equal(engine.call('entry', { id: info.id, i: 0 }).segment, 'app.log.2.gz');
  const other = await svc.switchFamily(info.id, 'outro.log');
  assert.equal(other.n, 1);
  assert.equal(svc.recents()[0].family, 'outro.log');
});

test('windows-1252 e UTF-16 são lidos certo', async () => {
  const dir = tmp();
  const a = path.join(dir, 'cp.log');
  fs.writeFileSync(a, Buffer.from(line(1, 'ERROR', 'Falha na integração'), 'latin1'));
  const b = path.join(dir, 'u16.log');
  fs.writeFileSync(b, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(line(1, 'WARN', 'Atenção'), 'utf16le')]));
  const e = createEngine();
  const ia = await e.call('open', { id: 'a', files: [{ path: a, name: 'cp.log' }], tail: false });
  assert.equal(ia.encoding, 'windows-1252');
  e.call('query', { id: 'a', qid: 1 });
  assert.match(e.call('rows', { id: 'a', qid: 1 }).rows[0].text, /integração$/);
  const ib = await e.call('open', { id: 'b', files: [{ path: b, name: 'u16.log' }], tail: false });
  assert.equal(ib.encoding, 'utf-16le');
  assert.equal(ib.format, 'jboss');
  e.call('query', { id: 'b', qid: 1 });
  assert.match(e.call('rows', { id: 'b', qid: 1 }).rows[0].text, /^2026-10-11 10:00:01,000 WARN .*Atenção$/);
});

test('teto de memória: lê só o final e avisa', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.log.1'), line(1, 'INFO', 'velho'.repeat(20)));
  const body = Array.from({ length: 50 }, (_, k) => line(k % 60, 'INFO', 'linha ' + k)).join('');
  fs.writeFileSync(path.join(dir, 'a.log'), body);
  const e = createEngine({ maxBytes: 400 });
  const info = await e.call('open', { id: 'a', files: [{ path: path.join(dir, 'a.log.1'), name: 'a.log.1' }, { path: path.join(dir, 'a.log'), name: 'a.log' }], tail: false });
  assert.equal(info.truncated, true);
  assert.deepEqual(info.files.map((f) => [f.name, f.partial]), [['a.log', true]]);
  e.call('query', { id: 'a', qid: 1 });
  const rows = e.call('rows', { id: 'a', qid: 1, from: 0, count: 100 }).rows;
  assert.ok(rows.length > 0 && rows.length < 50);
  assert.match(rows[0].text, /^2026-10-11/); // começou numa linha inteira
  assert.match(rows.at(-1).text, /linha 49$/);
});

test('formato escolhido à mão é lembrado; recentes e filtros salvos persistem', async () => {
  const { dir, svc } = setup();
  const f = path.join(dir, 'x.log');
  fs.writeFileSync(f, line(1, 'INFO', 'a'));
  const info = await svc.open({ kind: 'file', path: f });
  const again = await svc.reformat(info.id, { format: 'plain' });
  assert.equal(again.format, 'plain');
  assert.equal(again.id, info.id);
  await svc.savePresets([{ name: ' Erros do Fluig ', q: 'logger:fluig', levels: [5, 6, 9] }, { name: '' }]);
  await svc.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'logs.json'), 'utf8'));
  assert.equal(saved.presets.length, 1);
  assert.equal(saved.presets[0].name, 'Erros do Fluig');
  assert.deepEqual(saved.presets[0].levels, [5, 6]);
  assert.equal(saved.recents[0].path, path.resolve(f));
  // Outro serviço (app reaberto) abre com o formato lembrado.
  const s2 = setup();
  const svc2 = createLogsService({ file: path.join(dir, 'logs.json'), callWorker: async (op, a) => s2.engine.call(op, a), watch: () => ({ close() {} }), pollMs: 3600e3 });
  await svc2.init();
  assert.equal((await svc2.open({ kind: 'file', path: f, tail: false })).format, 'plain');
  svc.unwatch();
});

test('Início: erros novos desde a última vez que a aba foi vista', async () => {
  const { dir, svc } = setup();
  const f = path.join(dir, 's.log');
  fs.writeFileSync(f, line(1, 'ERROR', 'a'));
  const info = await svc.open({ kind: 'file', path: f });
  assert.equal((await svc.summaries())[0].newErrors, 0);
  fs.appendFileSync(f, line(2, 'ERROR', 'b') + line(3, 'INFO', 'c'));
  await svc._check(info.id);
  const s = (await svc.summaries())[0];
  assert.equal(s.errors, 2);
  assert.equal(s.newErrors, 1);
  await svc.markSeen(info.id);
  assert.equal((await svc.summaries())[0].newErrors, 0);
  svc.unwatch();
});
