// Logs — painel dos achados do filtro, embaixo da lista. O log continua inteiro na lista de cima (com os achados
// marcados); aqui ficam só os que casaram. Clicar leva a lista completa até a entrada; ▲▼ (e n/N) pulam de achado em achado.
import { DS } from '../../lib/ds.js';
import { LogList } from './LogList.jsx';
import { fmtNum } from './shared.jsx';

const { Icon } = DS;

/** props: id, sum, res, http, k (achado atual ou null), folded, onFold(bool), scrollTo, listRef, onPick(k, i), onStep(dir) */
export function Hits({ id, sum, res, http, k, folded, onFold, scrollTo, listRef, onPick, onStep }) {
  const total = sum.total;
  return (
    <section className={'lg-hits' + (folded ? ' is-folded' : '')} aria-label="Achados do filtro">
      <header className="lg-hits__head">
        <button type="button" className="lg-hits__fold" onClick={() => onFold(!folded)} aria-expanded={!folded} title={folded ? 'Mostrar os achados' : 'Esconder os achados'}>
          <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={13} /><b>Achados</b>
        </button>
        <span className="lg-muted">{k != null && total ? `${fmtNum(k + 1)} de ${fmtNum(total)}` : fmtNum(total)}</span>
        <span className="lg-grow" />
        <button type="button" className="lg-btn" onClick={() => onStep(-1)} disabled={!total} title="Achado anterior (N)" aria-label="Achado anterior"><Icon name="chevron-up" size={13} /></button>
        <button type="button" className="lg-btn" onClick={() => onStep(1)} disabled={!total} title="Próximo achado (n)" aria-label="Próximo achado"><Icon name="chevron-down" size={13} /></button>
      </header>
      {!folded && (
        <div className="lg-hits__body">
          <LogList id={id} summary={sum} view="hits" total={total} res={res} http={http} selPos={k} listRef={listRef}
            onSelect={(pos, row) => onPick(pos, row.i)} scrollTo={scrollTo}
            empty={<div className="lg-empty is-small"><b>Nada casa com esse filtro</b></div>} />
        </div>
      )}
    </section>
  );
}
