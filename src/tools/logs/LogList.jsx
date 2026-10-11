// Logs — a lista de entradas do filtro atual. Pede ao worker só as páginas visíveis (200 linhas por vez) e, enquanto
// a consulta nova não chega, continua mostrando as linhas da anterior (sem piscar ao filtrar ou no tail).
import { DS } from '../../lib/ds.js';
import { VirtualList } from './VirtualList.jsx';
import { logsApi, LevelBadge, Highlight, fmtTime, fmtMs, sameDay } from './shared.jsx';

const { Icon } = DS;

export const ROW_H = 22;
const PAGE = 200;

/** Linhas sob demanda. → { get(pos), ensure(first, last) } */
export function useRows(id, summary) {
  const cache = React.useRef({ qid: null, pages: new Map(), prev: new Map(), inflight: new Set() });
  const [, bump] = React.useReducer((x) => x + 1, 0);
  const qid = summary ? summary.qid : null;
  if (cache.current.qid !== qid) {
    // Consulta nova: as páginas antigas viram reserva até as novas chegarem.
    cache.current = { qid, pages: new Map(), prev: cache.current.pages.size ? cache.current.pages : cache.current.prev, inflight: new Set() };
  }
  const ensure = React.useCallback((first, last) => {
    const c = cache.current;
    if (c.qid == null || !summary || !summary.total) return;
    const p0 = Math.floor(first / PAGE);
    const p1 = Math.floor(Math.max(first, last - 1) / PAGE);
    for (let p = p0; p <= p1; p++) {
      if (c.pages.has(p) || c.inflight.has(p)) continue;
      c.inflight.add(p);
      const myQid = c.qid;
      logsApi().rows({ id, qid: myQid, from: p * PAGE, count: PAGE }).then((r) => {
        if (cache.current.qid !== myQid || !r || r.stale) return;
        cache.current.pages.set(p, r.rows);
        cache.current.inflight.delete(p);
        bump();
      }, () => { if (cache.current.qid === myQid) cache.current.inflight.delete(p); });
    }
  }, [id, qid, summary && summary.total]);
  const get = (pos) => {
    const c = cache.current;
    const p = Math.floor(pos / PAGE);
    const page = c.pages.get(p) || c.prev.get(p);
    return page ? page[pos - p * PAGE] || null : null;
  };
  return { get, ensure };
}

// Tira do começo da linha o que já está nas colunas (data/hora e nível).
const TS_PREFIX = /^\[?(?:\d{4}[-/]\d{2}[-/]\d{2}[ T_]|\d{2}\/\d{2}\/\d{4} )?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/;
const LV_PREFIX = /^\[?(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE)\]?\s+/;
export function displayText(row, http) {
  if (row.display != null) return row.display;
  if (http) return row.text;
  return row.text.replace(TS_PREFIX, '').replace(LV_PREFIX, '');
}

function Row({ row, pos, style, sel, onSelect, res, http, showDate }) {
  if (!row) return <div className="lg-row is-loading" style={style}><span className="lg-row__time" /><span className="lg-row__bar" /></div>;
  const lv = row.level;
  return (
    <div className={'lg-row lv-' + lv + (sel ? ' is-sel' : '')} style={style} onClick={() => onSelect(pos, row)} role="row" aria-selected={sel}>
      <span className="lg-row__bar" />
      <span className="lg-row__time" title={new Date(row.ts).toLocaleString('pt-BR')}>{fmtTime(row.ts, { date: showDate })}</span>
      <LevelBadge level={lv} compact={false} />
      {http && <span className={'lg-row__status s' + String(row.status || 0)[0]}>{row.status || '—'}</span>}
      {http && <span className="lg-row__ms">{row.ms != null ? fmtMs(row.ms) : ''}</span>}
      <span className="lg-row__text"><Highlight text={displayText(row, http)} res={res} /></span>
      {row.lines > 1 && <span className="lg-row__more" title={`${row.lines} linhas (stack trace / continuação) — veja no detalhe`}><Icon name="chevrons-down" size={11} />{row.lines - 1}</span>}
    </div>
  );
}

/**
 * props: id, summary, res, http, selPos, onSelect(pos, row), scrollTo, onAtBottom, listRef, empty
 */
export function LogList({ id, summary, res, http, selPos, onSelect, scrollTo, onAtBottom, listRef, empty }) {
  const rows = useRows(id, summary);
  const total = summary ? summary.total : 0;
  // Data junto da hora quando o log atravessa dias.
  const showDate = !!(summary && summary.tsMin != null && summary.tsMax != null && !sameDay(summary.tsMin, summary.tsMax));
  if (summary && !total) return empty;
  return (
    <VirtualList
      className="lg-list"
      count={total}
      rowHeight={ROW_H}
      innerRef={listRef}
      onRange={rows.ensure}
      onAtBottom={onAtBottom}
      scrollTo={scrollTo}
      renderRow={(i, style) => <Row key={i} pos={i} row={rows.get(i)} style={style} sel={i === selPos} onSelect={onSelect} res={res} http={http} showDate={showDate} />}
    />
  );
}
