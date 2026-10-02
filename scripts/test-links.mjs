// Testes dos links rápidos (alias → URL com {q}): node --test scripts/test-links.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const L = require('../src/links/link.js');
const { createLinksService } = require('../electron/links/service.js');

const FLUIG = 'https://fluig.navship.com.br/portal/p/001/pageworkflowview?app_ecm_workflowview_detailsProcessInstanceID={q}';

test('normalizeLink: alias, URL e protocolo', () => {
  const l = L.normalizeLink({ alias: ' solic ', name: 'Solicitação', url: FLUIG, param: 'Número' });
  assert.equal(l.alias, 'solic');
  assert.match(l.id, /^l/);
  assert.deepEqual(l.recent, []);
  assert.throws(() => L.normalizeLink({ alias: '', url: FLUIG }), /alias/);
  assert.throws(() => L.normalizeLink({ alias: 'a/b', url: FLUIG }), /letras, números/);
  assert.throws(() => L.normalizeLink({ alias: 'x', url: '' }), /URL/);
  assert.throws(() => L.normalizeLink({ alias: 'x', url: 'javascript:alert(1)' }), /http/);
  assert.throws(() => L.normalizeLink({ alias: 'x', url: 'file:///C:/x' }), /http/);
  assert.throws(() => L.normalizeLink({ alias: 'x', url: 'não é url' }), /inválida/);
  assert.equal(L.normalizeLink({ alias: 'intra', url: 'http://intranet/x?id={q}' }).url, 'http://intranet/x?id={q}');
  assert.equal(L.normalizeLink({ alias: 'meu link', url: FLUIG }).alias, 'meu-link');
});

test('normalizeLink: editar mantém id, criação e recentes', () => {
  const prev = { ...L.normalizeLink({ alias: 'solic', url: FLUIG }), recent: ['1', '2'] };
  const next = L.normalizeLink({ id: prev.id, alias: 'sol', url: FLUIG }, prev);
  assert.equal(next.id, prev.id);
  assert.equal(next.created, prev.created);
  assert.deepEqual(next.recent, ['1', '2']);
});

test('buildUrl: valor no {q} com encode; vazio é erro; sem {q} é favorito', () => {
  const l = L.normalizeLink({ alias: 'solic', url: FLUIG, param: 'Número da solicitação' });
  assert.equal(L.buildUrl(l, ' 12345 '), FLUIG.replace('{q}', '12345'));
  assert.equal(L.buildUrl({ url: 'https://a.com/s?q={q}&x={Q}' }, 'a b&c'), 'https://a.com/s?q=a%20b%26c&x=a%20b%26c');
  assert.throws(() => L.buildUrl(l, '  '), /número da solicitação/);
  assert.equal(L.buildUrl({ url: 'https://tdn.totvs.com' }, ''), 'https://tdn.totvs.com');
  assert.equal(L.needsValue(l), true);
  assert.equal(L.needsValue({ url: 'https://a.com' }), false);
  assert.equal(L.needsValue(l), true, 'chamar de novo não muda o resultado');
});

test('withPlaceholder: {q} no fim quando há rótulo ou a URL termina em "="', () => {
  const semQ = FLUIG.replace('{q}', '');
  assert.equal(L.withPlaceholder(semQ, ''), FLUIG, 'termina em =');
  assert.equal(L.withPlaceholder('https://a.com/busca/', 'Termo'), 'https://a.com/busca/{q}', 'tem rótulo');
  assert.equal(L.withPlaceholder('https://tdn.totvs.com/', ''), 'https://tdn.totvs.com/', 'favorito continua favorito');
  assert.equal(L.withPlaceholder(FLUIG, 'Número'), FLUIG, 'já tem {q}');
  // O caso real: salvo sem {q}, com rótulo → passa a pedir o número.
  const l = L.normalizeLink({ alias: 'solic', url: semQ, param: 'Número da Solicitação' });
  assert.equal(l.url, FLUIG);
  assert.equal(L.buildUrl(l, '4321'), FLUIG.replace('{q}', '4321'));
});

test('pushRecent: mais recente primeiro, sem repetir, até 8', () => {
  let r = [];
  for (const v of ['1', '2', '3', '2', ' ', '4', '5', '6', '7', '8', '9']) r = L.pushRecent(r, v);
  assert.deepEqual(r, ['9', '8', '7', '6', '5', '4', '2', '3']);
});

test('parseCapture: "link: alias url nome"', () => {
  assert.equal(L.parseCapture('solic 123'), null);
  assert.deepEqual(L.parseCapture('link: solic ' + FLUIG + ' Solicitação Fluig'), { alias: 'solic', url: FLUIG, name: 'Solicitação Fluig' });
  assert.deepEqual(L.parseCapture('LINK:tdn https://tdn.totvs.com'), { alias: 'tdn', url: 'https://tdn.totvs.com', name: '' });
  assert.match(L.parseCapture('link:').error, /Formato/);
  assert.match(L.parseCapture('link: solic').error, /URL/);
});

test('service: grava em .devkit/links.json, alias único, recentes e relê do disco', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devkit-links-'));
  const file = path.join(dir, '.devkit', 'links.json');
  const events = [];
  try {
    const svc = createLinksService({ file, broadcast: (e) => events.push(e.reason) });
    await svc.init();
    assert.deepEqual(await svc.list(), []);
    const l = await svc.save({ alias: 'solic', name: 'Solicitação', url: FLUIG, param: 'Número' });
    await assert.rejects(svc.save({ alias: 'SOLIC', url: 'https://a.com' }), /já é usado/);
    await svc.save({ alias: 'tdn', url: 'https://tdn.totvs.com' });
    assert.deepEqual((await svc.list()).map((x) => x.alias), ['solic', 'tdn']);

    assert.equal(await svc.use(l.id, '12345'), FLUIG.replace('{q}', '12345'));
    await svc.use(l.id, '777');
    await assert.rejects(svc.use(l.id, ''), /Digite/);
    assert.deepEqual((await svc.list())[0].recent, ['777', '12345']);
    await svc.forget(l.id, '777');
    assert.deepEqual((await svc.list())[0].recent, ['12345']);

    const disk = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(disk.v, 1);
    assert.equal(disk.links.length, 2);

    // Outra máquina sincronizou o arquivo: a próxima leitura pega a mudança.
    await new Promise((r) => setTimeout(r, 20));
    disk.links = disk.links.filter((x) => x.alias !== 'tdn');
    await writeFile(file, JSON.stringify(disk));
    assert.deepEqual((await svc.list()).map((x) => x.alias), ['solic']);

    await svc.remove(l.id);
    assert.deepEqual(await svc.list(), []);
    assert.ok(events.includes('save') && events.includes('use') && events.includes('remove'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('service: link antigo salvo sem {q} (termina em "=") passa a receber o valor ao carregar', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devkit-links-'));
  const file = path.join(dir, '.devkit', 'links.json');
  try {
    await (await import('node:fs/promises')).mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ v: 1, links: [{ id: 'lx', alias: 'solic', name: 'Solicitação do Fluig', url: FLUIG.replace('{q}', ''), param: 'Número da Solicitação', recent: [] }] }));
    const svc = createLinksService({ file });
    await svc.init();
    const [l] = await svc.list();
    assert.equal(L.needsValue(l), true);
    assert.equal(await svc.use('lx', '999'), FLUIG.replace('{q}', '999'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('palette: links viram comandos; com {q} fixam o chip, sem {q} abrem direto', async () => {
  const { linkCommands, COMMANDS, categoryName } = require('../src/commands/registry.js');
  const solic = L.normalizeLink({ alias: 'solic', name: 'Solicitação Fluig', url: FLUIG });
  const fav = L.normalizeLink({ alias: 'tdn', url: 'https://tdn.totvs.com' });
  const [a, b] = linkCommands([solic, fav]);
  assert.equal(a.name, 'solic');
  assert.equal(a.keepOpen, true);
  assert.equal(b.keepOpen, false);
  assert.match(a.description, /^Solicitação Fluig · fluig\.navship\.com\.br/);
  assert.equal(categoryName(a.category), 'Link');

  const calls = [];
  const ctx = { palette: { enterLink: (id) => calls.push(['chip', id]) }, links: { open: async (id, v) => calls.push(['open', id, v]) } };
  await a.run(ctx);
  await b.run(ctx);
  assert.deepEqual(calls, [['chip', solic.id], ['open', fav.id, '']]);
  assert.deepEqual(linkCommands(null), []);
  assert.ok(COMMANDS.some((c) => c.id === 'links:manage'));
});
