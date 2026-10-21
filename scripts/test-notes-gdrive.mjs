// Notes + Google Drive (fase 2): motor de sync, provedor, OAuth, token e gerenciador — node --test scripts/test-notes-gdrive.mjs
// Nenhum teste fala com o Google: `fakeDrive()` implementa em memória a parte da API REST que o app usa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const require = createRequire(import.meta.url);
const engine = require('../electron/sync/engine.js');
const { createGDriveProvider } = require('../electron/sync/providers/gdrive.js');
const oauth = require('../electron/sync/oauth.js');
const { createTokenStore } = require('../electron/sync/tokens.js');
const { createSyncManager } = require('../electron/sync/manager.js');
const { createNotesService } = require('../electron/notes/service.js');
const { serialize } = require('../src/notes/format.js');
const { createNote } = require('../src/notes/note.js');

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'devkit-gd-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const put = (dir, rel, text) => { const f = path.join(dir, ...rel.split('/')); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
const read = (dir, rel) => readFileSync(path.join(dir, ...rel.split('/')), 'utf8');
const has = (dir, rel) => existsSync(path.join(dir, ...rel.split('/')));
const mdFiles = (dir) => readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
const noop = { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0 };
const counts = (r) => ({ uploaded: r.uploaded, downloaded: r.downloaded, deletedLocal: r.deletedLocal, deletedRemote: r.deletedRemote, conflicts: r.conflicts });

/* ─────────────── Google Drive de mentira ─────────────── */
function fakeDrive({ pageLimit = 1000 } = {}) {
  const files = new Map(); // id → { id, name, bytes, modified }
  const sessions = new Map();
  const calls = [];
  const script = []; // respostas forçadas (funções) para as próximas requisições ao Drive
  const tokenCalls = [];
  let seq = 0, tokenSeq = 0, clock = Date.now();
  const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const meta = (f) => ({ id: f.id, name: f.name, md5Checksum: md5(f.bytes), modifiedTime: new Date(f.modified).toISOString() });
  const save = (id, name, bytes) => {
    const f = files.get(id) || { id: id || 'f' + ++seq };
    Object.assign(f, { name: name ?? f.name, bytes: Buffer.from(bytes), modified: ++clock });
    files.set(f.id, f);
    return f;
  };

  async function fetchImpl(url, init = {}) {
    const u = new URL(url), method = init.method || 'GET';
    calls.push(`${method} ${u.pathname}${u.searchParams.get('uploadType') ? '?' + u.searchParams.get('uploadType') : ''}`);
    if (u.host === 'oauth2.googleapis.com') {
      const p = Object.fromEntries(new URLSearchParams(init.body));
      tokenCalls.push(p);
      if (p.grant_type === 'authorization_code') return json({ access_token: 'at-0', refresh_token: 'rt-1', expires_in: 3600 });
      if (p.refresh_token !== 'rt-1') return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
      return json({ access_token: 'at-' + ++tokenSeq, expires_in: 3600 });
    }
    if (script.length) { const s = script.shift(); if (s) return s(); }
    if (u.host === 'upload.fake') {
      const s = sessions.get(u.pathname);
      const f = save(s.id, s.name, init.body);
      return json(meta(f));
    }
    const m = /^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/.exec(u.pathname);
    if (!m) return json({ error: { message: 'rota desconhecida ' + u.pathname } }, 404);
    const [, upload, id] = m;
    const type = u.searchParams.get('uploadType');
    if (!upload && !id && method === 'GET') {
      const all = [...files.values()];
      const start = Number(u.searchParams.get('pageToken') || 0);
      const page = all.slice(start, start + pageLimit);
      return json({ files: page.map(meta), ...(start + pageLimit < all.length ? { nextPageToken: String(start + pageLimit) } : {}) });
    }
    if (!upload && id && method === 'GET') { const f = files.get(id); return f ? new Response(f.bytes) : json({ error: { message: 'File not found' } }, 404); }
    if (!upload && id && method === 'DELETE') { if (!files.delete(id)) return json({ error: { message: 'File not found' } }, 404); return new Response(null, { status: 204 }); }
    if (upload && type === 'resumable') {
      const s = '/session/' + ++seq;
      const body = JSON.parse(init.body);
      sessions.set(s, { id: id || null, name: body.name });
      return new Response(null, { status: 200, headers: { Location: 'https://upload.fake' + s } });
    }
    if (upload && type === 'multipart') {
      const boundary = /boundary=(.+)$/.exec(init.headers['Content-Type'])[1];
      const parts = Buffer.from(init.body).toString('latin1').split('--' + boundary);
      const metaJson = JSON.parse(Buffer.from(parts[1].slice(parts[1].indexOf('\r\n\r\n') + 4, -2), 'latin1').toString('utf8'));
      const bytes = Buffer.from(parts[2].slice(parts[2].indexOf('\r\n\r\n') + 4, -2), 'latin1');
      assert.deepEqual(metaJson.parents, ['appDataFolder']);
      return json(meta(save(null, metaJson.name, bytes)));
    }
    if (upload && type === 'media' && id && method === 'PATCH') return files.has(id) ? json(meta(save(id, undefined, init.body))) : json({ error: { message: 'File not found' } }, 404);
    return json({ error: { message: 'não suportado' } }, 400);
  }
  return { files, calls, script, tokenCalls, fetchImpl, byName: (n) => [...files.values()].find((f) => f.name === n) };
}

/** Um provedor ligado direto ao fakeDrive, e um "computador" (pasta + estado do motor). */
const provider = (drive) => createGDriveProvider({ getToken: async () => 'at-x', fetchImpl: drive.fetchImpl, sleep: async () => {} });
const device = (drive) => ({ dir: tmp(), state: { base: {} }, provider: provider(drive) });
const run = (d, opts = {}) => engine.sync({ dir: d.dir, provider: d.provider, state: d.state, ...opts });
const cleanup = (...dirs) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));

/* ─────────────── motor ─────────────── */
test('plan: decision table', () => {
  const mk = (l, r, b) => {
    const local = new Map(), remote = new Map(), base = {};
    if (l) local.set('k', { hash: l });
    if (r) remote.set('k', { hash: r });
    if (b) base.k = { hash: b };
    return engine.plan(local, remote, base).map((a) => a.type).join();
  };
  assert.equal(mk('a', 'a', 'a'), '');                 // tudo igual
  assert.equal(mk('a', 'a', null), 'adopt');
  assert.equal(mk('a', null, null), 'upload');         // nova local
  assert.equal(mk(null, 'a', null), 'download');       // nova remota
  assert.equal(mk('a', 'b', null), 'conflict');        // nova nos dois, diferente
  assert.equal(mk('b', 'a', 'a'), 'upload');           // só local mudou
  assert.equal(mk('a', 'b', 'a'), 'download');         // só remoto mudou
  assert.equal(mk(null, 'a', 'a'), 'delRemote');       // excluída aqui
  assert.equal(mk('a', null, 'a'), 'delLocal');        // excluída lá
  assert.equal(mk('b', 'c', 'a'), 'conflict');         // mudou nos dois
  assert.equal(mk(null, 'b', 'a'), 'download');        // excluída aqui, editada lá: a edição vence
  assert.equal(mk('b', null, 'a'), 'upload');          // excluída lá, editada aqui: a edição vence
  assert.equal(mk(null, null, 'a'), 'forget');
});

test('validKey: only notes, folder configs, trash and assets — never traversal', () => {
  for (const ok of ['a.md', 'Trabalho/Fluig/a.md', '.trash/a.md', '.trash/Pasta/a.md', 'Pasta/.folder.json', '.assets/2026-10-21-1.png']) assert.equal(engine.validKey(ok), true, ok);
  for (const bad of ['', '../a.md', 'a/../b.md', '/a.md', 'C:/a.md', 'a\\b.md', '.devkit/links.json', '.devkit/history/x/1.md', '.git/x.md', '.assets/sub/x.png', 'a.md.1.tmp', 'notas.txt', '.hidden.md', 'x/.hidden/a.md']) assert.equal(engine.validKey(bad), false, bad);
});

test('first sync uploads notes, trash, folder config and assets — and nothing else', async () => {
  const drive = fakeDrive(), a = device(drive);
  try {
    put(a.dir, 'n1.md', 'um'); put(a.dir, 'Trabalho/n2.md', 'dois'); put(a.dir, '.trash/velha.md', 'lixo');
    put(a.dir, 'Trabalho/.folder.json', '{"color":"red"}'); put(a.dir, '.assets/a.png', 'png');
    put(a.dir, '.devkit/history/x/1.md', 'hist'); put(a.dir, '.devkit/links.json', '[]'); put(a.dir, 'n1.md.99.tmp', 'tmp'); put(a.dir, 'leia.txt', 'x');
    const r = await run(a);
    assert.equal(r.uploaded, 5);
    assert.deepEqual([...drive.files.values()].map((f) => f.name).sort(), ['.assets/a.png', '.trash/velha.md', 'Trabalho/.folder.json', 'Trabalho/n2.md', 'n1.md']);
    assert.deepEqual(counts(await run(a)), noop); // segunda rodada: nada a fazer, nem uma requisição de envio
    assert.equal(drive.calls.filter((c) => c.startsWith('POST') || c.startsWith('PATCH')).length, 5);
  } finally { cleanup(a.dir); }
});

test('two computers converge: create, edit, delete and move-to-trash propagate', async () => {
  const drive = fakeDrive(), a = device(drive), b = device(drive);
  try {
    put(a.dir, 'n1.md', 'um'); put(a.dir, 'n2.md', 'dois');
    await run(a);
    assert.equal((await run(b)).downloaded, 2);
    assert.equal(read(b.dir, 'n1.md'), 'um');
    assert.deepEqual(counts(await run(b)), noop);

    put(b.dir, 'n1.md', 'um editado em B');          // edição
    rmSync(path.join(b.dir, 'n2.md'));               // excluída…
    put(b.dir, '.trash/n2.md', 'dois');              // …indo para a Lixeira
    put(b.dir, 'n3.md', 'nova em B');
    const rb = await run(b);
    assert.equal(rb.uploaded, 3); assert.equal(rb.deletedRemote, 1);

    const ra = await run(a);
    assert.equal(ra.downloaded, 3); assert.equal(ra.deletedLocal, 1);
    assert.equal(read(a.dir, 'n1.md'), 'um editado em B');
    assert.equal(has(a.dir, 'n2.md'), false);
    assert.equal(read(a.dir, '.trash/n2.md'), 'dois');
    assert.equal(read(a.dir, 'n3.md'), 'nova em B');
    assert.deepEqual(counts(await run(a)), noop);
    assert.deepEqual(counts(await run(b)), noop);
  } finally { cleanup(a.dir, b.dir); }
});

test('conflict: both edited the same note → local stays, remote version saved next to it, nothing lost', async () => {
  const drive = fakeDrive(), a = device(drive), b = device(drive);
  try {
    put(a.dir, 'n.md', 'base');
    await run(a); await run(b);
    put(a.dir, 'n.md', 'edição de A'); await run(a);   // A chega primeiro ao Drive
    put(b.dir, 'n.md', 'edição de B');
    const r = await run(b, { now: () => new Date(2026, 9, 21, 20, 30, 0) });
    assert.equal(r.conflicts, 1);
    assert.equal(read(b.dir, 'n.md'), 'edição de B');
    assert.equal(read(b.dir, 'n (conflito de sync 20261021-203000).md'), 'edição de A');
    assert.equal(drive.byName('n.md').bytes.toString(), 'edição de B');   // o Drive passa a ter a versão local
    await run(b);                                      // sobe a cópia de conflito
    await run(a);                                      // A recebe a edição de B e a cópia
    assert.equal(read(a.dir, 'n.md'), 'edição de B');
    assert.equal(read(a.dir, 'n (conflito de sync 20261021-203000).md'), 'edição de A');
  } finally { cleanup(a.dir, b.dir); }
});

test('deleted on one side, edited on the other: the edit wins and the file comes back', async () => {
  const drive = fakeDrive(), a = device(drive), b = device(drive);
  try {
    put(a.dir, 'n.md', 'base'); await run(a); await run(b);
    rmSync(path.join(a.dir, 'n.md')); put(b.dir, 'n.md', 'editada em B');
    await run(a);                                      // A: excluída aqui, sem mudança remota → apaga no Drive
    const rb = await run(b);                           // B: editou, o Drive não tem mais → sobe de novo
    assert.equal(rb.uploaded, 1);
    assert.equal((await run(a)).downloaded, 1);
    assert.equal(read(a.dir, 'n.md'), 'editada em B');
  } finally { cleanup(a.dir, b.dir); }
});

test('first sync on a computer that already has other notes: union, same-name different content = conflict copy', async () => {
  const drive = fakeDrive(), a = device(drive), b = device(drive);
  try {
    put(a.dir, 'so-a.md', 'A'); put(a.dir, 'igual.md', 'mesmo'); put(a.dir, 'choque.md', 'versão A');
    await run(a);
    put(b.dir, 'so-b.md', 'B'); put(b.dir, 'igual.md', 'mesmo'); put(b.dir, 'choque.md', 'versão B');
    const r = await run(b);
    assert.equal(r.conflicts, 1);
    assert.equal(r.errors.length, 0);
    assert.equal(read(b.dir, 'so-a.md'), 'A');
    assert.equal(mdFiles(b.dir).filter((n) => n.startsWith('choque')).length, 2);
  } finally { cleanup(a.dir, b.dir); }
});

test('mass-delete guard: an empty/wiped remote never empties the computer unless forced', async () => {
  const drive = fakeDrive(), a = device(drive);
  try {
    for (let i = 0; i < 20; i++) put(a.dir, `n${i}.md`, 'x' + i);
    await run(a);
    drive.files.clear();                               // o Drive "voltou vazio"
    await assert.rejects(() => run(a), engine.GuardError);
    assert.equal(mdFiles(a.dir).length, 20);           // nada apagado
    const forced = await run(a, { force: true });      // o usuário confirmou
    assert.equal(forced.deletedLocal, 20);
    assert.equal(mdFiles(a.dir).length, 0);
  } finally { cleanup(a.dir); }
});

test('remote names that are not notes/assets (or try to escape the folder) are ignored', async () => {
  const drive = fakeDrive(), a = device(drive);
  try {
    for (const name of ['../fora.md', 'C:/x.md', '.devkit/links.json', 'virus.exe', '/abs.md']) drive.files.set(name, { id: 'id-' + name, name, bytes: Buffer.from('x'), modified: 1 });
    const r = await run(a);
    assert.deepEqual(counts(r), noop);
    assert.deepEqual(readdirSync(a.dir), []);
    assert.equal(existsSync(path.join(a.dir, '..', 'fora.md')), false);
  } finally { cleanup(a.dir); }
});

test('a note edited while its remote version downloads is left alone (next round decides)', async () => {
  const drive = fakeDrive(), a = device(drive), b = device(drive);
  try {
    put(a.dir, 'n.md', 'v1'); await run(a); await run(b);
    put(a.dir, 'n.md', 'v2 de A'); await run(a);
    const exclusive = async (fn) => { put(b.dir, 'n.md', 'digitando em B'); return fn(); }; // o app gravou antes de entrarmos na fila
    const r = await run(b, { exclusive });
    assert.equal(r.downloaded, 0);
    assert.equal(read(b.dir, 'n.md'), 'digitando em B');
    const next = await run(b);                          // agora mudou nos dois → conflito, sem perder nenhuma
    assert.equal(next.conflicts, 1);
  } finally { cleanup(a.dir, b.dir); }
});

test('a download that does not match the Drive checksum is rejected, not written', async () => {
  const drive = fakeDrive(), a = device(drive), b = device(drive);
  try {
    put(a.dir, 'n.md', 'certo'); await run(a);
    const corrupt = (url, init) => (String(url).includes('alt=media') ? Promise.resolve(new Response('corrompido')) : drive.fetchImpl(url, init));
    b.provider = createGDriveProvider({ getToken: async () => 't', fetchImpl: corrupt, sleep: async () => {} });
    const r = await run(b);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].error, /não confere/);
    assert.equal(has(b.dir, 'n.md'), false);
    assert.deepEqual(b.state.base, {});                    // e não foi marcado como sincronizado
  } finally { cleanup(a.dir, b.dir); }
});

/* ─────────────── provedor ─────────────── */
test('gdrive: pagination, duplicate names keep the newest, create/update small and large', async () => {
  const drive = fakeDrive({ pageLimit: 2 }), p = provider(drive);
  const made = [];
  for (const n of ['a.md', 'b.md', 'c.md']) made.push(await p.put(n, Buffer.from('conteúdo ' + n)));
  assert.ok(drive.calls.includes('POST /upload/drive/v3/files?multipart'));
  const list = await p.list();
  assert.deepEqual([...list.keys()].sort(), ['a.md', 'b.md', 'c.md']);
  assert.equal(list.get('b.md').hash, md5(Buffer.from('conteúdo b.md')));
  assert.equal((await p.get('b.md', list.get('b.md').ref)).toString(), 'conteúdo b.md');
  assert.equal(drive.calls.filter((c) => c === 'GET /drive/v3/files').length, 2); // duas páginas

  await p.put('a.md', Buffer.from('novo'), made[0].ref);  // atualização pequena
  assert.ok(drive.calls.some((c) => c.startsWith('PATCH') && c.endsWith('?media')));
  assert.equal(drive.files.get(made[0].ref).bytes.toString(), 'novo');

  const big = Buffer.alloc(5 * 1024 * 1024, 7);          // maior que 4 MB → envio resumable
  const bigInfo = await p.put('.assets/grande.bin', big);
  assert.ok(drive.calls.some((c) => c.endsWith('?resumable')));
  assert.equal(bigInfo.hash, md5(big));
  await p.put('.assets/grande.bin', Buffer.alloc(5 * 1024 * 1024, 8), bigInfo.ref);
  assert.equal(drive.files.get(bigInfo.ref).bytes[0], 8);

  drive.files.set('dup', { id: 'dup', name: 'a.md', bytes: Buffer.from('mais velho'), modified: 1 }); // mesmo nome, mais antigo
  const l2 = await p.list();
  assert.equal(l2.get('a.md').ref, made[0].ref);
  await sleep(10);
  assert.equal(drive.files.has('dup'), false);            // o duplicado foi limpo

  await p.del('a.md', made[0].ref);
  await p.del('a.md', made[0].ref);                        // 404 na segunda vez não é erro
  assert.equal((await p.list()).has('a.md'), false);
});

test('gdrive: 401 refreshes the token once, 429/503 are retried, other errors carry the Google message', async () => {
  const drive = fakeDrive();
  const tokens = []; let n = 0;
  const p = createGDriveProvider({ getToken: async (force) => { tokens.push(force); return 'at-' + ++n; }, fetchImpl: drive.fetchImpl, sleep: async () => {} });
  const resp = (status, body = { error: { message: 'x' } }) => () => new Response(JSON.stringify(body), { status });

  drive.script.push(resp(401));
  assert.equal((await p.list()).size, 0);
  assert.deepEqual(tokens, [false, true]);               // renovou e tentou de novo

  tokens.length = 0;
  drive.script.push(resp(429), resp(503));
  assert.equal((await p.list()).size, 0);
  assert.equal(tokens.length, 3);                          // 2 falhas + sucesso, sem renovar token

  drive.script.push(resp(403, { error: { message: 'The user has exceeded their storage quota' } }));
  await assert.rejects(() => p.put('a.md', Buffer.from('x')), /storage quota.*403/);

  drive.script.push(resp(401), resp(401));
  await assert.rejects(() => p.list(), /\(401\)/);          // renova só uma vez, não fica em laço

  const offline = createGDriveProvider({ getToken: async () => 't', fetchImpl: async () => { throw new Error('ENOTFOUND'); }, sleep: async () => {} });
  await assert.rejects(() => offline.list(), /Sem conexão/);
});

/* ─────────────── OAuth e token ─────────────── */
test('oauth: PKCE pair, consent URL and the full loopback flow', async () => {
  const { verifier, challenge } = oauth.pkcePair();
  assert.equal(challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
  const url = new URL(oauth.authUrl({ clientId: 'cid.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:1', challenge, state: 's' }));
  assert.equal(url.host, 'accounts.google.com');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');

  const drive = fakeDrive();
  let seen;
  const openExternal = async (authorizeUrl) => {
    seen = new URL(authorizeUrl);
    const redirect = seen.searchParams.get('redirect_uri');
    assert.match(redirect, /^http:\/\/127\.0\.0\.1:\d+$/);
    const wrong = await fetch(redirect + '/?code=zzz&state=errado');
    assert.equal(wrong.status, 400);                       // state errado não conclui o fluxo
    assert.equal((await fetch(redirect + '/favicon.ico')).status, 404);
    const ok = await fetch(redirect + '/?code=abc123&state=' + seen.searchParams.get('state'));
    assert.equal(ok.status, 200);
  };
  const t = await oauth.authorize({ clientId: 'cid', clientSecret: 'sec', openExternal, fetchImpl: drive.fetchImpl });
  assert.deepEqual({ refresh: t.refreshToken, access: t.accessToken }, { refresh: 'rt-1', access: 'at-0' });
  const call = drive.tokenCalls[0];
  assert.equal(call.code, 'abc123');
  assert.equal(call.client_secret, 'sec');
  assert.equal(crypto.createHash('sha256').update(call.code_verifier).digest('base64url'), seen.searchParams.get('code_challenge')); // o verifier bate com o challenge enviado
  assert.equal(call.redirect_uri, seen.searchParams.get('redirect_uri'));
});

test('oauth: denial, missing refresh_token, timeout and refresh with a revoked token', async () => {
  const deny = (u) => fetch(new URL(u).searchParams.get('redirect_uri') + '/?error=access_denied&state=' + new URL(u).searchParams.get('state'));
  await assert.rejects(() => oauth.authorize({ clientId: 'c', clientSecret: 's', openExternal: deny, fetchImpl: fakeDrive().fetchImpl }), /não autorizou/);

  const noRefresh = async () => new Response(JSON.stringify({ access_token: 'x', expires_in: 3600 }), { status: 200 });
  const approve = (u) => fetch(new URL(u).searchParams.get('redirect_uri') + '/?code=c&state=' + new URL(u).searchParams.get('state'));
  await assert.rejects(() => oauth.authorize({ clientId: 'c', clientSecret: 's', openExternal: approve, fetchImpl: noRefresh }), /uso contínuo/);

  await assert.rejects(() => oauth.authorize({ clientId: 'c', clientSecret: 's', openExternal: async () => {}, fetchImpl: noRefresh, timeoutMs: 30 }), /Tempo esgotado/);

  const drive = fakeDrive();
  const ok = await oauth.refresh({ clientId: 'c', clientSecret: 's', refreshToken: 'rt-1', fetchImpl: drive.fetchImpl, now: () => 1000 });
  assert.deepEqual(ok, { accessToken: 'at-1', expiresAt: 1000 + 3600_000 });
  await assert.rejects(() => oauth.refresh({ clientId: 'c', clientSecret: 's', refreshToken: 'revogado', fetchImpl: drive.fetchImpl }), (e) => e.code === 'invalid_grant');
});

const fakeCipher = (available = true) => ({ available: () => available, encrypt: (s) => Buffer.from([...Buffer.from(s)].reverse()), decrypt: (b) => Buffer.from([...b].reverse()).toString() });

test('token store: encrypted on disk, unreadable file means "not connected", refuses without encryption', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'sub', 'tokens.json');
    const s = createTokenStore({ file, cipher: fakeCipher() });
    assert.equal(await s.load(), null);
    await s.save('rt-secreto');
    assert.ok(!readFileSync(file, 'utf8').includes('rt-secreto'));     // nada em texto puro
    assert.equal(await s.load(), 'rt-secreto');
    writeFileSync(file, '{ quebrado');
    assert.equal(await s.load(), null);
    await s.clear();
    assert.equal(existsSync(file), false);
    const none = createTokenStore({ file, cipher: fakeCipher(false) });
    await assert.rejects(() => none.save('x'), /criptografia/);
    assert.equal(existsSync(file), false);
  } finally { cleanup(dir); }
});

/* ─────────────── gerenciador + serviço de notas, ponta a ponta ─────────────── */
async function pc(drive, { clientReady = true, revoke = { on: false } } = {}) {
  const dir = tmp(), data = tmp();
  const events = [];
  const svc = createNotesService({ dir, broadcast: (e) => events.push(e) });
  await svc.init();
  const statuses = [];
  const openExternal = async (u) => { const x = new URL(u); await fetch(x.searchParams.get('redirect_uri') + '/?code=c&state=' + x.searchParams.get('state')); };
  const mgr = createSyncManager({
    files: { client: path.join(data, 'sync-google.json'), tokens: path.join(data, 'sync-tokens.json'), state: path.join(data, 'sync-state.json') },
    getService: () => svc, cipher: fakeCipher(), openExternal, broadcast: (s) => statuses.push(s),
    fetchImpl: (url, init) => (revoke.on && String(url).includes('oauth2') && String(init.body).includes('refresh_token')
      ? Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) : drive.fetchImpl(url, init)),
    intervalMs: 3600_000, startDelayMs: 3600_000, changeDelayMs: 20,
  });
  await mgr.start();
  if (clientReady) await mgr.setClient({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 'sec' });
  return { dir, data, svc, mgr, events, statuses, done: () => { mgr.stop(); cleanup(dir, data); } };
}

test('manager: setClient validates, connect needs a configured client, status reflects everything', async () => {
  const drive = fakeDrive(), a = await pc(drive, { clientReady: false });
  try {
    assert.equal(a.mgr.status().configured, false);
    await assert.rejects(() => a.mgr.connect(), /Configure o ID/);
    await assert.rejects(() => a.mgr.setClient({ clientId: 'x', clientSecret: 'y' }), /apps\.googleusercontent\.com/);
    await assert.rejects(() => a.mgr.setClient({ clientId: '', clientSecret: '' }), /Informe/);
    const s = await a.mgr.setClient({ clientId: 'abc.apps.googleusercontent.com', clientSecret: 'sec' });
    assert.equal(s.configured, true); assert.equal(s.connected, false);
    assert.equal(JSON.parse(readFileSync(path.join(a.data, 'sync-google.json'), 'utf8')).clientSecret, 'sec');
    await assert.rejects(() => a.mgr.syncNow(), /não está conectado/);
  } finally { a.done(); }
});

test('manager: two computers sync a note through the (fake) Drive, edits arrive in the other service', async () => {
  const drive = fakeDrive(), a = await pc(drive), b = await pc(drive);
  try {
    await a.svc.save({ id: 'n1', title: 'Da casa', content: 'primeira' });
    await a.mgr.connect();
    await a.mgr.syncNow();
    assert.equal(a.mgr.status().connected, true);
    assert.ok([...drive.files.values()].some((f) => f.name.endsWith('n1.md')));
    assert.ok(existsSync(path.join(a.data, 'sync-tokens.json')));
    assert.ok(!readFileSync(path.join(a.data, 'sync-tokens.json'), 'utf8').includes('rt-1'));

    await b.mgr.connect(); await b.mgr.syncNow();
    assert.equal(b.svc.get('n1').content, 'primeira');                    // o serviço do B já enxerga (reload automático)
    assert.ok(b.events.some((e) => e.type === 'saved' && e.id === 'n1'));

    await b.svc.save({ id: 'n1', content: 'primeira, editada no B' });
    await b.svc.save({ id: 'n2', title: 'Só do B', content: 'x' });
    await b.mgr.syncNow();
    await a.mgr.syncNow();
    assert.equal(a.svc.get('n1').content, 'primeira, editada no B');
    assert.equal(a.svc.get('n2').title, 'Só do B');

    await a.svc.remove('n2');                                             // vai para a Lixeira em A
    await a.mgr.syncNow(); await b.mgr.syncNow();
    assert.equal(b.svc.get('n2'), null);
    assert.equal(await b.svc.trashCount(), 1);

    const r = a.mgr.status().lastResult;
    assert.equal(r.errors, 0);
    assert.ok(a.mgr.status().lastRun);
  } finally { a.done(); b.done(); }
});

test('manager: the app stays usable while syncing — saves wait their turn, nothing is lost', async () => {
  const drive = fakeDrive(), a = await pc(drive);
  try {
    await a.mgr.connect();
    for (let i = 0; i < 6; i++) await a.svc.save({ id: 'n' + i, title: 'N' + i, content: 'c' + i });
    const sync = a.mgr.syncNow();
    const during = await Promise.all([a.svc.save({ id: 'x1', title: 'Durante', content: 'digitada durante o sync' }), sync]);
    assert.equal(during[0].content, 'digitada durante o sync');
    await a.mgr.syncNow();
    assert.ok([...drive.files.values()].some((f) => f.name.endsWith('x1.md')));
    assert.equal(a.svc.list().length, 7);
  } finally { a.done(); }
});

test('manager: touch() schedules a sync soon after a local change', async () => {
  const drive = fakeDrive(), a = await pc(drive);
  try {
    await a.mgr.connect(); await a.mgr.syncNow();
    await a.svc.save({ id: 'z', title: 'Z', content: 'nova' });
    a.mgr.touch();
    for (let i = 0; i < 40 && ![...drive.files.values()].some((f) => f.name.endsWith('z.md')); i++) await sleep(25);
    assert.ok([...drive.files.values()].some((f) => f.name.endsWith('z.md')));
  } finally { a.done(); }
});

test('manager: wiped Drive trips the guard (needsForce) and only a forced sync applies it', async () => {
  const drive = fakeDrive(), a = await pc(drive);
  try {
    await a.mgr.connect();
    for (let i = 0; i < 12; i++) await a.svc.save({ id: 'g' + i, title: 'G' + i, content: 'c' });
    await a.mgr.syncNow();
    drive.files.clear();
    await assert.rejects(() => a.mgr.syncNow(), /apagaria/);
    assert.equal(a.mgr.status().needsForce, true);
    assert.equal(a.svc.list().length, 12);                                // intactas
    await a.mgr.syncNow({ force: true });
    assert.equal(a.svc.list().length, 0);
    assert.equal(a.mgr.status().needsForce, false);
  } finally { a.done(); }
});

test('manager: access revoked at Google (invalid_grant on refresh) disconnects with a clear message and keeps the notes', async () => {
  const drive = fakeDrive(), revoke = { on: false };
  const a = await pc(drive, { revoke });
  try {
    await a.svc.save({ id: 'r', title: 'R', content: 'fica' });
    await a.mgr.connect(); await a.mgr.syncNow();
    revoke.on = true;
    drive.script.push(() => new Response('{}', { status: 401 }));      // o Drive pede um token novo…
    await assert.rejects(() => a.mgr.syncNow(), (e) => e.code === 'invalid_grant'); // …e o Google recusa o refresh
    const s = a.mgr.status();
    assert.equal(s.connected, false);
    assert.match(s.lastError, /Conecte de novo/);
    assert.equal(existsSync(path.join(a.data, 'sync-tokens.json')), false);
    assert.equal(a.svc.get('r').content, 'fica');
  } finally { a.done(); }
});

test('manager: disconnect forgets the token and the base but leaves notes and Drive files alone', async () => {
  const drive = fakeDrive(), a = await pc(drive);
  try {
    await a.svc.save({ id: 'k', title: 'K', content: 'fica' });
    await a.mgr.connect(); await a.mgr.syncNow();
    const remoteBefore = drive.files.size;
    const s = await a.mgr.disconnect();
    assert.equal(s.connected, false);
    assert.equal(existsSync(path.join(a.data, 'sync-tokens.json')), false);
    assert.equal(JSON.parse(readFileSync(path.join(a.data, 'sync-state.json'), 'utf8')).enabled, false);
    assert.equal(a.svc.get('k').content, 'fica');
    assert.equal(drive.files.size, remoteBefore);
    await assert.rejects(() => a.mgr.syncNow(), /não está conectado/);
  } finally { a.done(); }
});
