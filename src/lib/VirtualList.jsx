// Lista virtualizada (Logs, Banco): só as linhas visíveis existem no DOM, com altura fixa.
// O Chromium limita a altura de um elemento (~33 milhões de px): acima de MAX_H a barra de rolagem fica em escala
// (scale > 1) e a roda do mouse anda em pixels "virtuais", para continuar rolando linha a linha.
const MAX_H = 8_000_000;
const OVERSCAN = 8;

/**
 * props: count, rowHeight, renderRow(index, style) → elemento, onRange(start, end), onAtBottom(bool),
 * scrollTo: { index, nonce, align: 'center'|'end'|'nearest' }, className
 */
export function VirtualList({ count, rowHeight, renderRow, onRange, onAtBottom, scrollTo, className = '', innerRef }) {
  const ref = React.useRef(null);
  const [view, setView] = React.useState({ top: 0, h: 600 });
  const total = count * rowHeight;
  const physH = Math.min(total, MAX_H);
  const scale = total > MAX_H ? (total - view.h) / Math.max(1, MAX_H - view.h) : 1;
  const virtTop = view.top * scale;

  const sync = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setView((v) => (v.top === el.scrollTop && v.h === el.clientHeight ? v : { top: el.scrollTop, h: el.clientHeight }));
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    if (innerRef) innerRef.current = el;
    return () => ro.disconnect();
  }, [sync]);

  // Roda do mouse em escala: anda o mesmo tanto de linhas que andaria sem escala.
  React.useEffect(() => {
    const el = ref.current;
    if (!el || scale <= 1) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      const dy = e.deltaMode === 1 ? e.deltaY * rowHeight : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
      el.scrollTop += dy / scale;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, rowHeight]);

  const first = Math.max(0, Math.floor(virtTop / rowHeight) - OVERSCAN);
  const last = Math.min(count, Math.ceil((virtTop + view.h) / rowHeight) + OVERSCAN);

  React.useEffect(() => { if (onRange) onRange(first, last); }, [first, last, count, onRange]);

  const atBottom = count === 0 || virtTop + view.h >= total - rowHeight * 1.5;
  React.useEffect(() => { if (onAtBottom) onAtBottom(atBottom); }, [atBottom]);

  // Rolar até uma linha (seleção por teclado, "ir para", seguir o fim).
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !scrollTo || scrollTo.index == null) return;
    const i = Math.max(0, Math.min(count - 1, scrollTo.index));
    const h = el.clientHeight;
    const y = i * rowHeight; // virtual
    let want = null;
    if (scrollTo.align === 'end') want = total - h;
    else if (scrollTo.align === 'center') want = y - h / 2 + rowHeight / 2;
    else if (y < virtTop) want = y;
    else if (y + rowHeight > virtTop + h) want = y + rowHeight - h;
    if (want == null) return;
    el.scrollTop = Math.max(0, want) / scale;
    sync();
  }, [scrollTo && scrollTo.nonce]);

  const rows = [];
  for (let i = first; i < last; i++) {
    // Posição física: relativa ao topo visível, para funcionar com escala.
    const top = view.top + (i * rowHeight - virtTop);
    rows.push(renderRow(i, { position: 'absolute', top, left: 0, right: 0, height: rowHeight }));
  }
  return (
    <div ref={ref} className={'lg-vlist tk-scroll ' + className} onScroll={sync} tabIndex={-1}>
      <div className="lg-vlist__inner" style={{ height: physH }}>{rows}</div>
    </div>
  );
}
