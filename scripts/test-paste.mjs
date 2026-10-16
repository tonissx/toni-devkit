// Colar snippet (electron/paste.js): o clipboard do usuário volta ao que era. node --test scripts/test-paste.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createPaster } = require('../electron/paste.js');

/** Clipboard fake. `async` = leituras devolvem Promise (como em algumas versões do Electron). */
function fakeClipboard({ text = '', html = '', rtf = '', image = null, async = false } = {}) {
  const st = { text, html, rtf, image };
  const r = (v) => (async ? Promise.resolve(v) : v);
  return {
    st,
    readText: () => r(st.text),
    readHTML: () => r(st.html),
    readRTF: () => r(st.rtf),
    availableFormats: () => r(st.image ? ['image/png'] : st.text ? ['text/plain'] : []),
    readImage: () => r(st.image),
    writeText: (t) => { Object.assign(st, { text: t, html: '', rtf: '', image: null }); },
    write: (d) => { Object.assign(st, { text: '', html: '', rtf: '', image: null }, d); },
  };
}

const noWait = () => Promise.resolve();
const make = (clipboard, win) => {
  const seen = [];
  const paster = createPaster({
    clipboard, hide: () => {}, notify: (n) => seen.push(n), sleep: noWait,
    win: { foreground: async () => 1, focus: async () => true, keys: async () => {}, paste: async () => { seen.push({ clipboardAtPaste: clipboard.st.text }); }, ...win },
  });
  return { paster, seen };
};

for (const async of [false, true]) {
  test(`depois de colar o clipboard volta ao valor anterior (leitura ${async ? 'Promise' : 'direta'})`, async () => {
    const cb = fakeClipboard({ text: 'valor copiado', async });
    const { paster, seen } = make(cb);
    await paster.capture();
    const r = await paster.paste({ code: 'SELECT * FROM t WHERE x = \'{{clipboard}}\'{{cursor}};' });
    assert.equal(r.pasted, true);
    assert.equal(seen[0].clipboardAtPaste, "SELECT * FROM t WHERE x = 'valor copiado';", '{{clipboard}} usa o valor original');
    assert.equal(cb.st.text, 'valor copiado');
  });
}

test('texto com formatação (HTML/RTF) volta inteiro', async () => {
  const cb = fakeClipboard({ text: 'oi', html: '<b>oi</b>', rtf: '{\\rtf1 oi}', async: true });
  const { paster } = make(cb);
  await paster.capture();
  await paster.paste({ code: 'snippet' });
  assert.deepEqual({ text: cb.st.text, html: cb.st.html, rtf: cb.st.rtf }, { text: 'oi', html: '<b>oi</b>', rtf: '{\\rtf1 oi}' });
});

test('imagem no clipboard volta', async () => {
  const img = { fake: 'png' };
  const cb = fakeClipboard({ image: img, async: true });
  const { paster } = make(cb);
  await paster.capture();
  await paster.paste({ code: 'snippet' });
  assert.equal(cb.st.image, img);
});

test('se o Windows recusar as teclas, o snippet fica copiado para colar na mão', async () => {
  const cb = fakeClipboard({ text: 'antes' });
  const blocked = Object.assign(new Error('blocked'), { code: 'BLOCKED' });
  const { paster, seen } = make(cb, { paste: async () => { throw blocked; } });
  await paster.capture();
  const r = await paster.paste({ code: 'snippet' });
  assert.equal(r.pasted, false);
  assert.equal(cb.st.text, 'snippet');
  assert.match(seen[0].message, /Ctrl\+V/);
});
