import { DS } from '../../lib/ds.js';
import { MONTHS, monthGrid, inRange, pickDay, normalizeRange, localDay } from '../../notes/calendar.js';

const { IconButton } = DS;
const DOW = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/**
 * Mês com a contagem de notas criadas em cada dia. Clique num dia filtra o dia; outro clique fecha o intervalo.
 * Também dá para apertar num dia e arrastar até outro: o intervalo aparece enquanto arrasta e vale ao soltar.
 * `range` = { from, to } ('YYYY-MM-DD') ou null; `counts` = { 'YYYY-MM-DD': n } de TODAS as notas.
 */
export function DateFilter({ range, counts, onChange, innerRef }) {
  const today = localDay(new Date());
  const start = range ? range.from : today;
  const [view, setView] = React.useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 }));
  const go = (delta) => setView((v) => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const cells = React.useMemo(() => monthGrid(view.y, view.m), [view]);

  // Arrastar: o intervalo é só visual até soltar (um filtro novo a cada dia por onde passa recarregaria a lista).
  const [drag, setDrag] = React.useState(null);          // { anchor, cur } enquanto o botão está apertado
  const dragRef = React.useRef(null);
  const skipClick = React.useRef(false);                  // soltou noutro dia: o clique que o navegador ainda dispara não vale
  const changeRef = React.useRef(onChange);
  changeRef.current = onChange;
  const dragging = drag !== null;
  React.useEffect(() => {
    if (!dragging) return undefined;
    const end = () => { dragRef.current = null; setDrag(null); };
    const move = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const day = el && el.closest ? el.closest('[data-day]') : null;
      const d = dragRef.current;
      if (!day || !d || day.dataset.day === d.cur) return;
      dragRef.current = { ...d, cur: day.dataset.day };
      setDrag(dragRef.current);
    };
    const up = () => {
      const d = dragRef.current;
      end();
      if (d && d.anchor !== d.cur) { skipClick.current = true; changeRef.current(normalizeRange(d.anchor, d.cur)); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', end);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', end); };
  }, [dragging]);
  const startDrag = (e, day) => {
    if (e.button !== 0) return;
    skipClick.current = false;
    dragRef.current = { anchor: day, cur: day };
    setDrag(dragRef.current);
  };
  const shown = drag && drag.anchor !== drag.cur ? normalizeRange(drag.anchor, drag.cur) : range;

  return (
    <div className="nts-cal" ref={innerRef}>
      <div className="nts-cal__head">
        <IconButton size="sm" icon="chevron-left" label="Mês anterior" onClick={() => go(-1)} />
        <span className="nts-cal__title" aria-live="polite">{MONTHS[view.m]} {view.y}</span>
        <IconButton size="sm" icon="chevron-right" label="Próximo mês" onClick={() => go(1)} />
      </div>
      <div className="nts-cal__grid" role="grid" aria-label={`${MONTHS[view.m]} de ${view.y}`}>
        {DOW.map((d, i) => <span key={i} className="nts-cal__dow" aria-hidden="true">{d}</span>)}
        {cells.map((day, i) => {
          if (!day) return <span key={i} className="nts-cal__day is-empty" />;
          const n = counts[day] || 0;
          const on = inRange(day, shown);
          const edge = !!shown && (day === shown.from || day === shown.to);
          return (
            <button key={i} type="button" className={'nts-cal__day' + (on ? ' is-in' : '') + (edge ? ' is-edge' : '') + (day === today ? ' is-today' : '') + (n ? ' has-notes' : '')}
              data-day={day} aria-pressed={on} title={n ? `${n} ${n === 1 ? 'nota criada' : 'notas criadas'}` : undefined} aria-label={`${Number(day.slice(8))} de ${MONTHS[view.m]}${n ? `, ${n} ${n === 1 ? 'nota' : 'notas'}` : ''}`}
              onPointerDown={(e) => startDrag(e, day)}
              onClick={() => { if (skipClick.current) { skipClick.current = false; return; } onChange(pickDay(range, day)); }}>
              <b>{Number(day.slice(8))}</b>
              {n > 0 && <i>{n}</i>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
