import { DS } from '../../lib/ds.js';
import { pairRows, diffInline } from './engine.js';
import { tokenize, mergeSegments } from './syntax.js';

const { Icon } = DS;

/** Linhas iguais de contexto mantidas em volta de cada mudança quando "Recolher iguais" está ligado. */
const CTX = 3;

/** Texto de uma linha com realce de sintaxe + trechos alterados (.dfc-chg). */
function Code({ text, segs, lang }) {
  if (text === '') return ' ';
  return mergeSegments(tokenize(text, lang), segs).map(([c, t, ch], k) =>
    c || ch ? <span key={k} className={(c ? 'tk-syn-' + c : '') + (ch ? ' dfc-chg' : '')}>{t}</span> : t);
}

/** Agrupa as linhas em itens de exibição, recolhendo trechos longos de linhas iguais. */
function buildItems(rows, collapse, expanded) {
  if (!collapse) return rows.map((r, i) => ({ row: r, i }));
  const items = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].t !== 'eq') { items.push({ row: rows[i], i }); i++; continue; }
    let e = i;
    while (e < rows.length && rows[e].t === 'eq') e++;
    const head = i === 0 ? 0 : CTX;           // contexto depois da mudança anterior
    const tail = e === rows.length ? 0 : CTX; // contexto antes da próxima mudança
    if (e - i > head + tail + 1 && !expanded.has(i)) {
      for (let k = i; k < i + head; k++) items.push({ row: rows[k], i: k });
      items.push({ fold: i, count: e - i - head - tail });
      for (let k = e - tail; k < e; k++) items.push({ row: rows[k], i: k });
    } else {
      for (let k = i; k < e; k++) items.push({ row: rows[k], i: k });
    }
    i = e;
  }
  return items;
}

const Cell = ({ kind, no, text, segs, lang }) => (
  <div className={'tk-diff__row is-' + kind}>
    <span className="tk-diff__no">{no}</span>
    <span className="tk-diff__sign">{kind === 'add' ? '+' : kind === 'del' ? '−' : ''}</span>
    <span className="tk-diff__text">{kind === 'empty' ? ' ' : <Code text={text} segs={segs} lang={lang} />}</span>
  </div>
);

/**
 * Resultado do diff. Uma única área de scroll com uma linha de grid por item,
 * assim os dois lados ficam sempre alinhados (scroll sincronizado de graça).
 */
export function DiffView({ result, view, granularity, collapse, compare, lang, current, onMerge, onPick }) {
  const { a, b } = result;
  const rows = React.useMemo(() => pairRows(result), [result]);
  const [expanded, setExpanded] = React.useState(() => new Set());
  React.useEffect(() => setExpanded(new Set()), [result]);

  // Segmentos dentro da linha de cada par removido/adicionado.
  const inline = React.useMemo(() => {
    const m = new Map();
    rows.forEach((r, i) => { if (r.t === 'mod') m.set(i, diffInline(a[r.a], b[r.b], granularity, compare)); });
    return m;
  }, [rows, granularity, compare]);

  const items = React.useMemo(() => buildItems(rows, collapse, expanded), [rows, collapse, expanded]);

  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    const el = scrollRef.current && scrollRef.current.querySelector('[data-hunk-start="' + current + '"]');
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [current, result, view]);

  const fold = (it) => (
    <button key={'f' + it.fold} type="button" className="dfc-fold" onClick={() => setExpanded((s) => new Set(s).add(it.fold))}>
      <Icon name="unfold-vertical" size={13} />
      {it.count === 1 ? 'Mostrar 1 linha igual' : 'Mostrar ' + it.count + ' linhas iguais'}
    </button>
  );

  const rowProps = (r, i) => ({
    className: 'dfc-row' + (r.hunk >= 0 && r.hunk === current ? ' is-cur' : ''),
    'data-hunk-start': r.hunk >= 0 && (i === 0 || rows[i - 1].hunk !== r.hunk) ? r.hunk : undefined,
    onClick: r.hunk >= 0 && r.hunk !== current ? () => onPick(r.hunk) : undefined,
  });

  if (view === 'unified') {
    // Em cada bloco: todas as remoções e depois todas as adições (como no git).
    const out = [];
    let k = 0;
    while (k < items.length) {
      const it = items[k];
      if (it.fold !== undefined) { out.push(fold(it)); k++; continue; }
      if (it.row.t === 'eq') {
        const r = it.row;
        out.push(<div key={it.i} {...rowProps(r, it.i)}><div className="tk-diff__row is-ctx dfc-uni">
          <span className="tk-diff__no">{r.a + 1}</span><span className="tk-diff__no">{r.b + 1}</span>
          <span className="tk-diff__sign"></span><span className="tk-diff__text"><Code text={a[r.a]} lang={lang} /></span>
        </div></div>);
        k++; continue;
      }
      const h = it.row.hunk, block = [];
      while (k < items.length && items[k].row && items[k].row.hunk === h) block.push(items[k++]);
      const line = (it, side) => {
        const r = it.row, del = side === 'del';
        const segs = r.t === 'mod' && inline.get(it.i) ? inline.get(it.i)[del ? 0 : 1] : null;
        return (
          <div key={it.i + side} {...rowProps(r, it.i)} data-hunk-start={undefined}><div className={'tk-diff__row dfc-uni is-' + side}>
            <span className="tk-diff__no">{del ? r.a + 1 : ''}</span><span className="tk-diff__no">{del ? '' : r.b + 1}</span>
            <span className="tk-diff__sign">{del ? '−' : '+'}</span>
            <span className="tk-diff__text"><Code text={del ? a[r.a] : b[r.b]} segs={segs} lang={lang} /></span>
          </div></div>
        );
      };
      out.push(<div key={'h' + h} data-hunk-start={h}>
        {block.filter((x) => x.row.a >= 0).map((x) => line(x, 'del'))}
        {block.filter((x) => x.row.b >= 0).map((x) => line(x, 'add'))}
      </div>);
    }
    return <div ref={scrollRef} className="dfc-scroll tk-scroll">{out}</div>;
  }

  return (
    <div ref={scrollRef} className="dfc-scroll tk-scroll">
      {items.map((it) => {
        if (it.fold !== undefined) return fold(it);
        const r = it.row, i = it.i;
        const segs = r.t === 'mod' ? inline.get(i) : null;
        const start = r.hunk >= 0 && (i === 0 || rows[i - 1].hunk !== r.hunk);
        return (
          <div key={i} {...rowProps(r, i)} data-split="">
            {r.a >= 0
              ? <Cell kind={r.t === 'eq' ? 'ctx' : 'del'} no={r.a + 1} text={a[r.a]} segs={segs && segs[0]} lang={lang} />
              : <Cell kind="empty" />}
            <div className="dfc-gutter">
              {start && <>
                <button type="button" className="dfc-merge" title="Aplicar no Alterado (→)" aria-label="Aplicar no Alterado"
                  onClick={(e) => { e.stopPropagation(); onMerge(r.hunk, 'toRight'); }}><Icon name="arrow-right" size={12} /></button>
                <button type="button" className="dfc-merge" title="Aplicar no Original (←)" aria-label="Aplicar no Original"
                  onClick={(e) => { e.stopPropagation(); onMerge(r.hunk, 'toLeft'); }}><Icon name="arrow-left" size={12} /></button>
              </>}
            </div>
            {r.b >= 0
              ? <Cell kind={r.t === 'eq' ? 'ctx' : 'add'} no={r.b + 1} text={b[r.b]} segs={segs && segs[1]} lang={lang} />
              : <Cell kind="empty" />}
          </div>
        );
      })}
    </div>
  );
}
