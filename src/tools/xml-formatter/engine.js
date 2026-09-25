'use strict';
/**
 * Motor de formatação XML — parser/serializer próprio, sem dependências.
 * Valida apenas boa-formação (well-formedness), não contra XSD/DTD.
 * Opções inspiradas nas do LemMinX (motor do vscode-xml).
 */

function posAt(xml, idx) {
  let line = 1, col = 1;
  for (let i = 0; i < idx; i++) {
    if (xml[i] === '\n') { line++; col = 1; } else col++;
  }
  return { line, col };
}

class XmlParseError extends Error {
  constructor(message, xml, idx) {
    const { line, col } = posAt(xml, idx);
    super(`${message} (linha ${line}, coluna ${col})`);
    this.name = 'XmlParseError';
  }
}

const NAME_START = /[A-Za-z_:]/;
const NAME_CHAR = /[A-Za-z0-9_:.-]/;

function readName(xml, i) {
  if (i >= xml.length || !NAME_START.test(xml[i])) return null;
  let j = i + 1;
  while (j < xml.length && NAME_CHAR.test(xml[j])) j++;
  return { name: xml.slice(i, j), end: j };
}

function skipWs(xml, i) {
  while (i < xml.length && /\s/.test(xml[i])) i++;
  return i;
}

/** Parseia o documento (tolerante a múltiplos elementos de nível raiz). */
function parse(xml) {
  const len = xml.length;
  let i = 0;
  const root = { children: [] };
  const stack = [root];

  const top = () => stack[stack.length - 1];

  while (i < len) {
    if (xml[i] === '<') {
      if (xml.startsWith('<?', i)) {
        const end = xml.indexOf('?>', i + 2);
        if (end === -1) throw new XmlParseError('Instrução de processamento não terminada', xml, i);
        const body = xml.slice(i + 2, end);
        const m = body.match(/^([^\s]+)\s*([\s\S]*)$/);
        top().children.push({ type: 'pi', target: m ? m[1] : body, value: m ? m[2].trim() : '' });
        i = end + 2;
      } else if (xml.startsWith('<!--', i)) {
        const end = xml.indexOf('-->', i + 4);
        if (end === -1) throw new XmlParseError('Comentário não terminado', xml, i);
        top().children.push({ type: 'comment', value: xml.slice(i + 4, end) });
        i = end + 3;
      } else if (xml.startsWith('<![CDATA[', i)) {
        const end = xml.indexOf(']]>', i + 9);
        if (end === -1) throw new XmlParseError('CDATA não terminado', xml, i);
        top().children.push({ type: 'cdata', value: xml.slice(i + 9, end) });
        i = end + 3;
      } else if (/^<!DOCTYPE/i.test(xml.slice(i, i + 9))) {
        let j = i + 9;
        while (j < len) {
          const c = xml[j];
          if (c === '"' || c === "'") {
            const close = xml.indexOf(c, j + 1);
            if (close === -1) throw new XmlParseError('DOCTYPE com aspas não terminadas', xml, i);
            j = close + 1;
          } else if (c === '[') {
            const close = xml.indexOf(']', j + 1);
            if (close === -1) throw new XmlParseError('DOCTYPE com subconjunto interno não terminado', xml, i);
            j = close + 1;
          } else if (c === '>') {
            break;
          } else j++;
        }
        if (j >= len) throw new XmlParseError('DOCTYPE não terminado', xml, i);
        top().children.push({ type: 'doctype', value: xml.slice(i + 9, j).trim() });
        i = j + 1;
      } else if (xml.startsWith('</', i)) {
        const r = readName(xml, i + 2);
        if (!r) throw new XmlParseError('Nome de tag de fechamento inválido', xml, i);
        const j = skipWs(xml, r.end);
        if (xml[j] !== '>') throw new XmlParseError(`Tag de fechamento </${r.name}> malformada`, xml, i);
        const node = top();
        if (stack.length < 2 || !node.__tag || node.__tag !== r.name) {
          const open = stack.length >= 2 ? node.__tag : null;
          throw new XmlParseError(
            open ? `Tag </${r.name}> não corresponde à aberta <${open}>` : `Tag </${r.name}> sem abertura correspondente`,
            xml, i
          );
        }
        node.innerEnd = i;
        stack.pop();
        i = j + 1;
      } else if (NAME_START.test(xml[i + 1] || '')) {
        const r = readName(xml, i + 1);
        const attrs = [];
        let j = skipWs(xml, r.end);
        while (j < len && xml[j] !== '>' && !(xml[j] === '/' && xml[j + 1] === '>')) {
          const a = readName(xml, j);
          if (!a) throw new XmlParseError(`Atributo inválido em <${r.name}>`, xml, i);
          let k = skipWs(xml, a.end);
          if (xml[k] !== '=') throw new XmlParseError(`Atributo "${a.name}" sem valor em <${r.name}>`, xml, i);
          k = skipWs(xml, k + 1);
          const q = xml[k];
          if (q !== '"' && q !== "'") throw new XmlParseError(`Valor do atributo "${a.name}" sem aspas em <${r.name}>`, xml, i);
          const vEnd = xml.indexOf(q, k + 1);
          if (vEnd === -1) throw new XmlParseError(`Aspas não terminadas no atributo "${a.name}" em <${r.name}>`, xml, i);
          attrs.push({ name: a.name, value: xml.slice(k + 1, vEnd), quote: q });
          j = skipWs(xml, vEnd + 1);
        }
        if (j >= len) throw new XmlParseError(`Tag <${r.name}> não terminada`, xml, i);
        const selfClosing = xml[j] === '/';
        const gt = selfClosing ? j + 1 : j;
        if (xml[gt] !== '>') throw new XmlParseError(`Tag <${r.name}> malformada`, xml, i);
        const node = { type: 'element', name: r.name, attrs, selfClosing, children: [], __tag: r.name };
        top().children.push(node);
        i = gt + 1;
        if (!selfClosing) {
          node.innerStart = i;
          stack.push(node);
        }
      } else {
        throw new XmlParseError("Caractere '<' inesperado", xml, i);
      }
    } else {
      const next = xml.indexOf('<', i);
      const end = next === -1 ? len : next;
      top().children.push({ type: 'text', value: xml.slice(i, end) });
      i = end;
    }
  }

  if (stack.length > 1) throw new XmlParseError(`Tag <${top().__tag}> não fechada`, xml, len);
  return root.children;
}

/* ─────────────── Serialização ─────────────── */

const hasXmlSpacePreserve = (node) => node.attrs?.some((a) => a.name === 'xml:space' && a.value === 'preserve');
const hasXmlSpaceDefault = (node) => node.attrs?.some((a) => a.name === 'xml:space' && a.value === 'default');

function indentUnitOf(opts) {
  return opts.indent === 'tab' ? '\t' : ' '.repeat(Number(opts.indent) || 4);
}

function quoteAttr(attr, opts) {
  const q = opts.quoteStyle === 'double' ? '"' : opts.quoteStyle === 'single' ? "'" : attr.quote;
  let value = attr.value;
  if (q !== attr.quote) {
    // Escapa o novo delimitador se ele aparecer literalmente no valor.
    const entity = q === '"' ? '&quot;' : '&apos;';
    value = value.split(q).join(entity);
  }
  return `${attr.name}=${q}${value}${q}`;
}

function buildStartTag(node, opts, indentStr, indentUnit) {
  const attrsFlat = node.attrs.map((a) => quoteAttr(a, opts));
  const closeToken = node.selfClosing ? (opts.spaceBeforeEmptyCloseTag ? ' />' : '/>') : '>';
  const singleLine = `<${node.name}${attrsFlat.length ? ' ' + attrsFlat.join(' ') : ''}${closeToken}`;
  const oneLineLen = indentStr.length + singleLine.length;
  const shouldWrap = attrsFlat.length > 0 && (opts.splitAttributes || (opts.maxLineWidth > 0 && oneLineLen > opts.maxLineWidth));

  if (!shouldWrap) return indentStr + singleLine;

  const attrIndent = indentStr + indentUnit;
  const attrLines = attrsFlat.map((a) => attrIndent + a);
  if (opts.closingBracketNewLine) {
    return [indentStr + '<' + node.name, ...attrLines, indentStr + closeToken.trim()].join('\n');
  }
  attrLines[attrLines.length - 1] += closeToken;
  return [indentStr + '<' + node.name, ...attrLines].join('\n');
}

function collapseWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function isMixedContent(children) {
  const hasElement = children.some((c) => c.type === 'element' || c.type === 'comment' || c.type === 'cdata' || c.type === 'pi');
  const hasText = children.some((c) => c.type === 'text' && c.value.trim() !== '');
  return hasElement && hasText;
}

function serializeNode(node, depth, opts, preserveCtx, source) {
  const indentUnit = indentUnitOf(opts);
  const indentStr = indentUnit.repeat(depth);

  if (node.type === 'pi') return indentStr + `<?${node.target}${node.value ? ' ' + node.value : ''}?>`;
  if (node.type === 'doctype') return indentStr + `<!DOCTYPE ${node.value}>`;
  if (node.type === 'comment') {
    const value = opts.joinLines ? ' ' + collapseWs(node.value) + ' ' : node.value;
    return indentStr + `<!--${value}-->`;
  }
  if (node.type === 'cdata') {
    const value = opts.joinLines ? collapseWs(node.value) : node.value;
    return indentStr + `<![CDATA[${value}]]>`;
  }

  // element
  const preserve = hasXmlSpaceDefault(node) ? false : preserveCtx || hasXmlSpacePreserve(node);
  const startTag = buildStartTag(node, opts, indentStr, indentUnit);

  const rawInner = node.innerStart != null ? source.slice(node.innerStart, node.innerEnd) : '';
  const meaningfulChildren = node.children.filter((c) => !(c.type === 'text' && c.value.trim() === ''));

  if (node.selfClosing || node.innerStart == null) {
    return applyEmptyElementsOption(node, opts, indentStr, indentUnit, startTag);
  }

  if (preserve || isMixedContent(node.children)) {
    return `${startTag.replace(/\/>$/, '>')}${rawInner}</${node.name}>`;
  }

  if (meaningfulChildren.length === 0) {
    return applyEmptyElementsOption(node, opts, indentStr, indentUnit, startTag);
  }

  if (meaningfulChildren.length === 1 && meaningfulChildren[0].type === 'text') {
    const text = meaningfulChildren[0].value.trim();
    if (!text.includes('\n') || opts.joinLines) {
      const inline = opts.joinLines ? collapseWs(text) : text;
      return `${startTag}${inline}</${node.name}>`;
    }
    return `${startTag}\n${text}\n${indentStr}</${node.name}>`;
  }

  const childLines = meaningfulChildren
    .map((c) => serializeNode(c, depth + 1, opts, preserve, source))
    .join('\n');
  return `${startTag}\n${childLines}\n${indentStr}</${node.name}>`;
}

function applyEmptyElementsOption(node, opts, indentStr, indentUnit) {
  const mode = opts.emptyElements;
  const wantSelfClose = mode === 'collapse' ? true : mode === 'expand' ? false : node.selfClosing;
  const nodeForTag = { ...node, selfClosing: wantSelfClose };
  const startTag = buildStartTag(nodeForTag, opts, indentStr, indentUnit);
  return wantSelfClose ? startTag : `${startTag.replace(/\s*\/>$/, '>')}</${node.name}>`;
}

function formatXml(xml, options = {}) {
  const opts = {
    indent: 4,
    maxLineWidth: 80,
    emptyElements: 'ignore',
    quoteStyle: 'ignore',
    splitAttributes: false,
    closingBracketNewLine: false,
    spaceBeforeEmptyCloseTag: true,
    joinLines: false,
    ...options,
  };
  const t0 = performance.now();
  const source = String(xml ?? '');
  const nodes = parse(source).filter((n) => !(n.type === 'text' && n.value.trim() === ''));
  const result = nodes.map((n) => serializeNode(n, 0, opts, false, source)).join('\n') + '\n';
  return { result, ms: performance.now() - t0 };
}

module.exports = { formatXml, XmlParseError };
