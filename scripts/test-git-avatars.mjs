// Teste: node --test scripts/test-git-avatars.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createAvatarService, hashEmail, urlFor } = require('../electron/git/avatars.js');

const png = Buffer.from([137, 80, 78, 71]);
const ok = () => ({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png });
const notFound = () => ({ ok: false, headers: { get: () => '' }, arrayBuffer: async () => Buffer.alloc(0) });

test('hash: SHA-256 do e-mail minúsculo e sem espaços; a URL não contém o e-mail', () => {
  assert.equal(hashEmail('  Foo@Bar.COM '), hashEmail('foo@bar.com'));
  assert.match(hashEmail('foo@bar.com'), /^[0-9a-f]{64}$/);
  assert.ok(!urlFor('foo@bar.com').includes('foo@bar.com'));
  assert.match(urlFor('foo@bar.com'), /d=404/);
});

test('devolve data URL para quem tem foto e null para quem não tem', async () => {
  const svc = createAvatarService({ fetchImpl: async (url) => (url.includes(hashEmail('a@x.com')) ? ok() : notFound()) });
  const r = await svc.get(['A@x.com', 'b@x.com']);
  assert.equal(r['a@x.com'], 'data:image/png;base64,' + png.toString('base64'));
  assert.equal(r['b@x.com'], null);
});

test('cache: não busca duas vezes o mesmo e-mail (nem o negativo)', async () => {
  let calls = 0;
  const svc = createAvatarService({ fetchImpl: async () => { calls++; return notFound(); } });
  await svc.get(['a@x.com', 'A@X.com']);
  await svc.get(['a@x.com']);
  assert.equal(calls, 1);
});

test('erro de rede vira null e não derruba a chamada', async () => {
  const svc = createAvatarService({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await svc.get(['a@x.com']), { 'a@x.com': null });
});

test('resposta que não é imagem é descartada', async () => {
  const svc = createAvatarService({ fetchImpl: async () => ({ ok: true, headers: { get: () => 'text/html' }, arrayBuffer: async () => png }) });
  assert.deepEqual(await svc.get(['a@x.com']), { 'a@x.com': null });
});
