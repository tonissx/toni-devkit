// Testes do Vault (cofre de dados sensíveis): node --test scripts/test-vault.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const vc = require('../src/vault/crypto.js');
const ve = require('../src/vault/entry.js');
const { createVaultService } = require('../electron/vault/service.js');

const FAST = { N: 2 ** 12 }; // scrypt rápido só nos testes
const PW = 'correct horse battery';

/** Relógio e timers falsos: timers só disparam com advance(ms). */
function fakeTime(start = Date.parse('2026-10-01T12:00:00Z')) {
  let t = start;
  const list = [];
  return {
    now: () => t,
    timers: {
      setTimeout: (fn, ms) => { const h = { fn, at: t + ms, on: true }; list.push(h); return h; },
      clearTimeout: (h) => { if (h) h.on = false; },
    },
    advance(ms) {
      t += ms;
      for (const h of list) if (h.on && h.at <= t) { h.on = false; h.fn(); }
    },
  };
}

async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'devkit-vault-'));
  const file = path.join(dir, 'vault.json');
  const clip = { text: '', secretWrites: 0, readText() { return this.text; }, clear() { this.text = ''; } };
  const time = fakeTime();
  const events = [];
  const make = () => createVaultService({
    file, clipboard: clip, now: time.now, timers: time.timers, kdfParams: FAST,
    writeSecret: async (t) => { clip.text = t; clip.secretWrites++; },
    broadcast: (e) => events.push(e),
  });
  const svc = make();
  await svc.init();
  return { dir, file, clip, time, events, svc, make, done: () => rm(dir, { recursive: true, force: true }) };
}

const dbEntry = (over = {}) => ({
  name: 'RM Produção', kind: 'db', tags: ['rm'],
  fields: [
    { name: 'Servidor', value: 'sql01.local', secret: false },
    { name: 'Porta', value: '1433', secret: false },
    { name: 'Banco', value: 'CorporeRM', secret: false },
    { name: 'Usuário', value: 'sa', secret: false },
    { name: 'Senha', value: 's3nh@;"forte"', secret: true },
  ],
  ...over,
});

/* ─────────────── crypto ─────────────── */
test('crypto: roundtrip, fresh IV per seal, wrong password and tampering fail alike', async () => {
  const kdf = vc.newKdf(FAST);
  const key = await vc.deriveKey(PW, kdf);
  const a = vc.seal(key, kdf, { hello: 'mundo' });
  const b = vc.seal(key, kdf, { hello: 'mundo' });
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
  assert.deepEqual(vc.open(key, a), { hello: 'mundo' });

  const wrong = await vc.deriveKey('outra senha qualquer', kdf);
  assert.throws(() => vc.open(wrong, a), { code: 'WRONG_PASSWORD' });

  const flipped = Buffer.from(a.data, 'base64'); flipped[0] ^= 1;
  assert.throws(() => vc.open(key, { ...a, data: flipped.toString('base64') }), { code: 'WRONG_PASSWORD' });
  // Cabeçalho também é autenticado (AAD): trocar o N invalida.
  assert.throws(() => vc.open(key, { ...a, kdf: { ...a.kdf, N: 2 ** 13 } }), { code: 'WRONG_PASSWORD' });
  assert.throws(() => vc.open(key, { nope: 1 }), /não é válido/);
});

test('crypto: default scrypt cost is high and password rule is enforced', () => {
  assert.ok(vc.KDF_DEFAULTS.N >= 2 ** 17);
  assert.match(vc.passwordProblem('curta'), /8 caracteres/);
  assert.match(vc.passwordProblem('        '), /espaços/);
  assert.equal(vc.passwordProblem('longa o bastante'), null);
});

/* ─────────────── entry ─────────────── */
test('entry: metaOf never exposes secret values', () => {
  const e = ve.normalizeEntry(dbEntry());
  const m = ve.metaOf(e);
  assert.equal(m.fields[4].value, null);
  assert.equal(m.fields[4].set, true);
  assert.equal(m.fields[3].value, 'sa');
  assert.ok(!JSON.stringify(m).includes('s3nh@'));
  assert.equal(ve.summary(m), 'sa@sql01.local');
});

test('entry: unchanged secret (value null) keeps the previous value', () => {
  const prev = ve.normalizeEntry(dbEntry());
  const edited = { ...ve.metaOf(prev), name: 'RM Prod' }; // a UI devolve o meta com Senha = null
  const next = ve.normalizeEntry(edited, prev);
  assert.equal(next.fields[4].value, 's3nh@;"forte"');
  assert.equal(next.id, prev.id);
  assert.equal(next.created, prev.created);
});

test('entry: connection strings quote values with ; and quotes', () => {
  const e = ve.normalizeEntry(dbEntry());
  assert.equal(ve.connectionString(e), 'Server=sql01.local,1433;Database=CorporeRM;User Id=sa;Password="s3nh@;""forte""";TrustServerCertificate=True;');
  assert.match(ve.connectionString(e, 'jdbc'), /^jdbc:sqlserver:\/\/sql01\.local:1433;databaseName=CorporeRM;user=sa;password=/);
});

test('entry: secret blocks in markdown', () => {
  const md = 'texto\n```secret RM Produção\n```\n\n~~~secret\napi-github\n~~~\n```sql\nselect 1\n```\n```secret rm produção\n```';
  assert.deepEqual(ve.secretRefs(md), ['RM Produção', 'api-github']);
  assert.equal(ve.secretNameFromBlock('secret RM Produção', ''), 'RM Produção');
  assert.equal(ve.secretNameFromBlock('secret', 'api-github\n'), 'api-github');
  assert.equal(ve.secretNameFromBlock('sql', 'x'), null);
  assert.equal(ve.secretBlock('a`b'), '```secret a b\n```');
});

/* ─────────────── service ─────────────── */
test('service: create → file on disk never contains plaintext', async () => {
  const s = await setup();
  try {
    assert.equal(s.svc.status().exists, false);
    await assert.rejects(s.svc.create('curta'), /8 caracteres/);
    await s.svc.create(PW);
    await s.svc.save(dbEntry());
    const raw = await readFile(s.file, 'utf8');
    for (const leak of ['s3nh@', 'RM Produção', 'sql01', 'CorporeRM']) assert.ok(!raw.includes(leak), 'vazou ' + leak);
    assert.equal(JSON.parse(raw).format, 'toni-devkit-vault');
    await assert.rejects(s.svc.create(PW), /já existe/);
  } finally { await s.done(); }
});

test('service: list/resolve expose metadata only; locked hides everything', async () => {
  const s = await setup();
  try {
    await s.svc.create(PW);
    await s.svc.save(dbEntry());
    const list = s.svc.list();
    assert.equal(list.length, 1);
    assert.ok(!JSON.stringify(list).includes('s3nh@'));
    const r = s.svc.resolve(['rm produção', 'nada']);
    assert.equal(r.items['rm produção'].name, 'RM Produção');
    assert.equal(r.items.nada, null);
    s.svc.lock();
    assert.equal(s.svc.list(), null);
    assert.deepEqual(s.svc.resolve(['x']), { locked: true, exists: true, items: {} });
    assert.throws(() => s.svc.reveal(list[0].id, 4), { code: 'LOCKED' });
  } finally { await s.done(); }
});

test('service: reopen from disk with the right password only', async () => {
  const s = await setup();
  try {
    await s.svc.create(PW);
    await s.svc.save(dbEntry());
    const again = s.make();
    await again.init();
    assert.equal(again.status().unlocked, false);
    await assert.rejects(again.unlock('senha errada demais'), { code: 'WRONG_PASSWORD' });
    await again.unlock(PW);
    assert.equal(again.list()[0].name, 'RM Produção');
    assert.equal(again.reveal(again.list()[0].id, 4), 's3nh@;"forte"');
  } finally { await s.done(); }
});

test('service: copy writes protected clipboard and clears it after the timeout (if unchanged)', async () => {
  const s = await setup();
  try {
    await s.svc.create(PW);
    const { id } = await s.svc.save(dbEntry());
    const r = await s.svc.copy(id, 'primary');
    assert.deepEqual(r, { label: 'Senha', name: 'RM Produção', clearsIn: 30 });
    assert.equal(s.clip.text, 's3nh@;"forte"');
    assert.equal(s.clip.secretWrites, 1);
    s.time.advance(29_000);
    assert.equal(s.clip.text, 's3nh@;"forte"');
    s.time.advance(1_000);
    assert.equal(s.clip.text, '');

    await s.svc.copy(id, 'connstr');
    s.clip.text = 'outra coisa que o usuário copiou';
    s.time.advance(30_000);
    assert.equal(s.clip.text, 'outra coisa que o usuário copiou', 'não apaga o que não é nosso');
    await assert.rejects(s.svc.copy(id, 7), /não tem um campo/);
  } finally { await s.done(); }
});

test('service: auto-lock after inactivity; listing does not extend it', async () => {
  const s = await setup();
  try {
    await s.svc.create(PW);
    await s.svc.save(dbEntry());
    s.time.advance(9 * 60_000);
    s.svc.list(); // abrir a palette não conta como atividade
    s.time.advance(60_000);
    assert.equal(s.svc.status().unlocked, false);
    assert.ok(s.events.some((e) => e.reason === 'lock:auto'));

    await s.svc.unlock(PW);
    await s.svc.setSettings({ autoLockMin: 1, clearSeconds: 999 }); // 999 não é opção válida: ignora
    assert.equal(s.svc.status().clearSeconds, 30);
    s.time.advance(59_000);
    s.svc.reveal(s.svc.list()[0].id, 4); // ação do usuário: reinicia
    s.time.advance(59_000);
    assert.equal(s.svc.status().unlocked, true);
    s.time.advance(1_000);
    assert.equal(s.svc.status().unlocked, false);
  } finally { await s.done(); }
});

test('service: growing wait after repeated wrong passwords', async () => {
  const s = await setup();
  try {
    await s.svc.create(PW);
    s.svc.lock();
    for (let i = 0; i < 3; i++) await assert.rejects(s.svc.unlock('errada errada'), { code: 'WRONG_PASSWORD' });
    await assert.rejects(s.svc.unlock(PW), /aguarde 1 s/);
    s.time.advance(1_000);
    await s.svc.unlock(PW);
    assert.equal(s.svc.status().unlocked, true);
  } finally { await s.done(); }
});

test('service: unique names, edit keeps secret, remove', async () => {
  const s = await setup();
  try {
    await s.svc.create(PW);
    const a = await s.svc.save(dbEntry());
    await assert.rejects(s.svc.save(dbEntry({ name: 'rm producao' })), /Já existe/);
    const edited = await s.svc.save({ ...a, tags: ['rm', 'prod'] }); // Senha volta como null
    assert.equal(s.svc.reveal(edited.id, 4), 's3nh@;"forte"');
    await s.svc.remove(a.id);
    assert.deepEqual(s.svc.list(), []);
  } finally { await s.done(); }
});

test('service: change password requires the current one and re-keys the file', async () => {
  const s = await setup();
  try {
    await s.svc.create(PW);
    await s.svc.save(dbEntry());
    const before = JSON.parse(await readFile(s.file, 'utf8')).kdf.salt;
    await assert.rejects(s.svc.changePassword('não é a atual', 'nova senha longa'), { code: 'WRONG_PASSWORD' });
    await assert.rejects(s.svc.changePassword(PW, 'curta'), /8 caracteres/);
    await s.svc.changePassword(PW, 'nova senha longa');
    assert.notEqual(JSON.parse(await readFile(s.file, 'utf8')).kdf.salt, before);
    const again = s.make();
    await again.init();
    await assert.rejects(again.unlock(PW), { code: 'WRONG_PASSWORD' });
    await again.unlock('nova senha longa');
    assert.equal(again.list().length, 1);
  } finally { await s.done(); }
});

test('service: reset keeps an encrypted backup aside; broken file is never overwritten', async () => {
  const s = await setup();
  try {
    await s.svc.create(PW);
    await assert.rejects(s.svc.reset('sim'), /APAGAR/);
    await s.svc.reset('APAGAR');
    assert.equal(s.svc.status().exists, false);
    assert.ok((await readdir(s.dir)).some((f) => /^vault-\d{8}-\d{6}\.bak\.json$/.test(f)));

    await writeFile(s.file, '{ quebrado');
    const b = s.make();
    await b.init();
    assert.ok(b.status().broken);
    await assert.rejects(b.create(PW), /ilegível/);
  } finally { await s.done(); }
});

/* ─────────────── notas: cartão do bloco secret (markdown empacotado como no app) ─────────────── */
async function loadMarkdown() {
  const esbuild = await import('esbuild');
  const out = await esbuild.build({ entryPoints: ['src/notes/markdown.js'], bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'error' });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

test('notes: secret block renders a card from metadata, never a value, and escapes names', async () => {
  const { renderMarkdown } = await loadMarkdown();
  const meta = ve.metaOf(ve.normalizeEntry(dbEntry({ name: 'RM <b>Prod</b>' })));
  const md = 'antes\n\n```secret RM <b>Prod</b>\n```\n\n```sql\nselect 1\n```';
  const { html, blocks } = renderMarkdown(md, { secret: () => meta });
  assert.deepEqual(blocks, ['select 1'], 'o bloco secret não vira bloco copiável');
  assert.match(html, /class="md-secret"/);
  assert.match(html, /RM &lt;b&gt;Prod&lt;\/b&gt;/);
  assert.ok(!html.includes('<b>Prod</b>'));
  assert.ok(!html.includes('s3nh@'));
  assert.match(html, /data-vault-copy="[^"]+" data-vault-what="4"/);
  assert.match(html, /data-vault-what="connstr"/);
  assert.match(html, /sql01\.local/);

  assert.match(renderMarkdown(md, { secret: () => undefined }).html, /Carregando/);
  assert.match(renderMarkdown(md, { secret: () => ({ locked: true, exists: true }) }).html, /data-vault-unlock/);
  assert.match(renderMarkdown(md, { secret: () => ({ locked: true, exists: false }) }).html, /data-vault-create/);
  assert.match(renderMarkdown(md, { secret: () => ({ missing: true }) }).html, /Não existe no cofre/);
  // Sem resolvedor (ex.: lixeira): continua um cartão, nunca o texto cru do bloco.
  assert.match(renderMarkdown(md).html, /md-secret/);
});

/* ─────────────── palette ─────────────── */
test('palette: vault entries become dynamic commands; Enter copies, Ctrl+Enter opens', async () => {
  const { vaultCommands, COMMANDS } = require('../src/commands/registry.js');
  const { BINDABLE_IDS } = require('../src/commands/binds.js');
  const meta = ve.metaOf(ve.normalizeEntry(dbEntry()));
  const cmds = vaultCommands([meta]);
  assert.deepEqual(cmds.map((c) => c.id), ['vault:entry:' + meta.id, 'vault:conn:' + meta.id]);
  assert.ok(cmds.every((c) => c.dynamic && c.vault && c.category === 'vault'));
  assert.ok(!JSON.stringify(cmds.map(({ run, ...c }) => c)).includes('s3nh@'));
  assert.match(cmds[0].description, /sa@sql01\.local · Enter copia senha/);
  assert.deepEqual(vaultCommands(null), []);

  const calls = [];
  const ctx = {
    vault: { copy: async (id, what) => { calls.push(['copy', id, what]); return { label: 'Senha', name: meta.name, clearsIn: 30 }; } },
    openApp: (route, params) => calls.push(['open', route, params]),
  };
  assert.match(await cmds[0].run(ctx, undefined, {}), /Senha de “RM Produção” copiado — some do clipboard em 30 s/);
  await cmds[0].run(ctx, undefined, { ctrl: true });
  await cmds[1].run(ctx, undefined, {});
  assert.deepEqual(calls, [['copy', meta.id, 'primary'], ['open', 'vault', { id: meta.id }], ['copy', meta.id, 'connstr']]);

  assert.ok(BINDABLE_IDS.includes('vault:lock'));
  assert.ok(COMMANDS.some((c) => c.id === 'vault:lock' && !c.keepOpen && !c.takesQuery));
  assert.ok(COMMANDS.some((c) => c.id === 'tool:vault'));
});
