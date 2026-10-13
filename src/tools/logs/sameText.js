// Logs — selecionou um trecho numa linha: as ocorrências iguais nas outras linhas visíveis ganham destaque.
//
// Leve de propósito: usa a CSS Custom Highlight API (CSS.highlights) — pinta trechos por Range, sem mexer no DOM.
// Nada é re-renderizado (a seleção da pessoa continua intacta para o Ctrl+C) e só os elementos visíveis são lidos:
// a lista é virtual, então são ~30–60 linhas, não o log inteiro. Para o log inteiro há o botão "Filtrar".

const NAME = 'lg-same';
const TARGETS = '.lg-row__text, .lg-ctx__text, .lg-msg, .lg-stack__line, .lg-raw, .lg-prob__text';
const MIN = 2;
const MAX = 200;
const MAX_RANGES = 600;

const supported = () => typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';

/** Texto selecionado dentro de root (numa linha só), ou ''. */
function selectedText(root) {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
  const node = sel.anchorNode;
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  if (!el || !root.contains(el) || !el.closest(TARGETS)) return '';
  const t = sel.toString();
  if (t.includes('\n')) return '';
  const s = t.trim();
  return s.length >= MIN && s.length <= MAX ? s : '';
}

/** Ranges de cada ocorrência de text nos elementos (o texto pode estar partido em vários nós, ex.: <mark> da busca). */
function rangesIn(root, text) {
  const out = [];
  for (const el of root.querySelectorAll(TARGETS)) {
    const full = el.textContent;
    if (!full || full.indexOf(text) < 0) continue;
    // Nós de texto e onde cada um começa no texto do elemento.
    const nodes = []; const starts = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let pos = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push(n); starts.push(pos); pos += n.data.length; }
    const at = (p) => {
      let lo = 0; let hi = nodes.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= p) lo = mid; else hi = mid - 1; }
      return [nodes[lo], p - starts[lo]];
    };
    let i = full.indexOf(text);
    while (i >= 0 && out.length < MAX_RANGES) {
      const r = new Range();
      const [sn, so] = at(i);
      const [en, eo] = at(i + text.length - 1);
      r.setStart(sn, so);
      r.setEnd(en, eo + 1);
      out.push(r);
      i = full.indexOf(text, i + text.length);
    }
    if (out.length >= MAX_RANGES) break;
  }
  return out;
}

/**
 * Liga o destaque dentro de rootRef. onChange({ text, count }) avisa a tela (rodapé) — só quando muda.
 * Recalcula quando a seleção muda e quando as linhas visíveis mudam (rolagem, ao vivo, outro filtro).
 */
export function useSameText(rootRef, onChange) {
  const cb = React.useRef(onChange);
  cb.current = onChange;
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || !supported()) return undefined;
    let text = '';
    let last = '';
    let raf = 0;
    let t = 0;
    const paint = () => {
      raf = 0;
      if (!text) { CSS.highlights.delete(NAME); report('', 0); return; }
      const ranges = rangesIn(root, text);
      CSS.highlights.set(NAME, new Highlight(...ranges));
      report(text, ranges.length);
    };
    const report = (tx, n) => {
      const key = tx + '\u0000' + n;
      if (key === last) return;
      last = key;
      cb.current({ text: tx, count: n });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
    // selectionchange dispara a cada pixel do arraste: espera a seleção assentar.
    const onSel = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = selectedText(root);
        // Clique fora/seleção vazia limpa; seleção fora das linhas (ex.: no campo de busca) também.
        if (s !== text) { text = s; schedule(); }
      }, 120);
    };
    // Linhas novas na tela (rolagem, ao vivo, outro filtro): repinta só se há algo selecionado.
    const mo = new MutationObserver(() => { if (text) schedule(); });
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      mo.disconnect();
      clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
      CSS.highlights.delete(NAME);
    };
  }, []);
}

/** Termo de filtro para o texto selecionado: "frase" (ou /regex/ se tiver aspas). */
export function filterTermFor(text) {
  if (!text.includes('"')) return `"${text}"`;
  return '/' + text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '/';
}
