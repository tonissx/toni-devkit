// Posição do cursor num <textarea> (para ancorar popups como o autocomplete de [[link]]).
// Técnica do div-espelho: um div invisível com a mesma fonte/padding/largura recebe o texto até o
// cursor; a posição de um <span> no fim é a posição do cursor.

const COPY = ['boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
  'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize', 'textIndent'];

/** { top, left, height } do cursor em `pos`, relativo ao canto do textarea (já descontado o scroll). */
export function caretRect(ta, pos) {
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  for (const k of COPY) div.style[k] = cs[k];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', overflow: 'hidden' });
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = ta.value.slice(pos, pos + 1) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  const r = { top: span.offsetTop - ta.scrollTop, left: span.offsetLeft - ta.scrollLeft, height: lh };
  div.remove();
  return r;
}
