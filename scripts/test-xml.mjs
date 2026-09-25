// Testes do motor de formatação XML: node --test scripts/test-xml.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { formatXml } = require('../src/tools/xml-formatter/engine.js');

const DEFAULTS = {
  indent: 4,
  maxLineWidth: 80,
  emptyElements: 'ignore',
  quoteStyle: 'ignore',
  splitAttributes: false,
  closingBracketNewLine: false,
  spaceBeforeEmptyCloseTag: true,
  joinLines: false,
};

const fmt = (xml, opts = {}) => formatXml(xml, { ...DEFAULTS, ...opts }).result;

test('indents nested elements with the configured width', () => {
  const out = fmt('<root><a><b>x</b></a></root>');
  assert.equal(out, '<root>\n    <a>\n        <b>x</b>\n    </a>\n</root>\n');
});

test('emptyElements "ignore" preserves original open/self-close form', () => {
  assert.equal(fmt('<root><a></a><b/></root>'), '<root>\n    <a></a>\n    <b />\n</root>\n');
});

test('emptyElements "collapse" forces self-closing tags', () => {
  assert.equal(fmt('<root><a></a></root>', { emptyElements: 'collapse' }), '<root>\n    <a />\n</root>\n');
});

test('emptyElements "expand" forces open/close pairs', () => {
  assert.equal(fmt('<root><a/></root>', { emptyElements: 'expand' }), '<root>\n    <a></a>\n</root>\n');
});

test('spaceBeforeEmptyCloseTag controls the space before />', () => {
  assert.equal(fmt('<a/>', { spaceBeforeEmptyCloseTag: false }), '<a/>\n');
});

test('normalizes whitespace between attributes and keeps original quote style by default', () => {
  const out = fmt(`<a  b="1"   c='2'   />`);
  assert.equal(out, `<a b="1" c='2' />\n`);
});

test('quoteStyle forces double quotes and escapes literal double quotes', () => {
  const out = fmt(`<a b='1' c='say "hi"'/>`, { quoteStyle: 'double' });
  assert.equal(out, `<a b="1" c="say &quot;hi&quot;" />\n`);
});

test('quoteStyle forces single quotes', () => {
  assert.equal(fmt(`<a b="1"/>`, { quoteStyle: 'single' }), `<a b='1' />\n`);
});

test('splitAttributes puts every attribute on its own line', () => {
  const out = fmt('<a b="1" c="2"/>', { splitAttributes: true });
  assert.equal(out, '<a\n    b="1"\n    c="2" />\n');
});

test('closingBracketNewLine puts the closing bracket on its own line', () => {
  const out = fmt('<a b="1" c="2"/>', { splitAttributes: true, closingBracketNewLine: true });
  assert.equal(out, '<a\n    b="1"\n    c="2"\n/>\n');
});

test('wraps attributes onto separate lines when the tag exceeds maxLineWidth', () => {
  const out = fmt('<item nome="valor-razoavelmente-longo" outro="tambem-razoavelmente-longo-para-passar"/>', { maxLineWidth: 40 });
  assert.equal(out, '<item\n    nome="valor-razoavelmente-longo"\n    outro="tambem-razoavelmente-longo-para-passar" />\n');
});

test('preserves comments, CDATA and processing instructions, reindented in place', () => {
  const out = fmt('<root><!-- oi --><![CDATA[<raw/>]]></root>');
  assert.equal(out, '<root>\n    <!-- oi -->\n    <![CDATA[<raw/>]]>\n</root>\n');
});

test('keeps the XML declaration on its own single line', () => {
  const out = fmt(`<?xml version="1.0" encoding="UTF-8"?>\n<root/>`);
  assert.equal(out, '<?xml version="1.0" encoding="UTF-8"?>\n<root />\n');
});

test('preserves the DOCTYPE declaration', () => {
  const out = fmt(`<!DOCTYPE html>\n<html/>`);
  assert.equal(out, '<!DOCTYPE html>\n<html />\n');
});

test('inlines single-line text content and trims surrounding whitespace', () => {
  assert.equal(fmt('<a>  hello world  </a>'), '<a>hello world</a>\n');
});

test('joinLines collapses multi-line text content onto a single line', () => {
  const out = fmt('<a>\n  line one\n  line two\n</a>', { joinLines: true });
  assert.equal(out, '<a>line one line two</a>\n');
});

test('xml:space="preserve" keeps inner content untouched', () => {
  const out = fmt('<a xml:space="preserve">  <b>  x  </b>  </a>');
  assert.equal(out, '<a xml:space="preserve">  <b>  x  </b>  </a>\n');
});

test('mixed content (text alongside elements) is left untouched', () => {
  const out = fmt('<p>Hello <b>world</b>!</p>');
  assert.equal(out, '<p>Hello <b>world</b>!</p>\n');
});

test('throws a descriptive error for an unclosed tag', () => {
  assert.throws(() => fmt('<root><a></root>'), /não corresponde|sem abertura/);
});

test('throws a descriptive error for unterminated attribute quotes', () => {
  assert.throws(() => fmt('<a b="1/>'), /Aspas não terminadas/);
});

test('formats multiple root-level nodes leniently', () => {
  assert.equal(fmt('<a/><b/>'), '<a />\n<b />\n');
});
