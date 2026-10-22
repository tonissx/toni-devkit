// Logs — painel de baixo da lista: os achados do filtro e as entradas fixadas. O log continua inteiro na lista de cima
// (com os achados marcados); aqui ficam só os que casaram. Clicar leva a lista completa até a entrada; ▲▼ (e n/N) pulam
// de achado em achado.
import { DS } from '../../lib/ds.js';
import { LogList } from './LogList.jsx';
import { LevelBadge, fmtNum, fmtTime } from './shared.jsx';

const { Icon } = DS;

function Pins({ pins, onJump, onUnpin }) {
  if (!pins.length) return <div className="lg-empty is-small"><b>Nada fixado</b><span>Selecione uma entrada e aperte <kbd>m</kbd> (ou o alfinete no detalhe).</span></div>;
  return (
    <div className="lg-pins tk-scroll">
      {pins.map((p) => (
        <div key={p.i} className={'lg-pin lv-' + p.level} onClick={() => onJump(p.i)} role="row" title="Ir até esta entrada">
          <Icon name="pin" size={12} />
          <span className="lg-row__time">{fmtTime(p.ts, { date: false })}</span>
          <LevelBadge level={p.level} compact={false} />
          <span className="lg-pin__text">{p.text}</span>
          <button type="button" className="lg-icon" onClick={(e) => { e.stopPropagation(); onUnpin(p.i); }} title="Soltar" aria-label="Soltar"><Icon name="x" size={12} /></button>
        </div>
      ))}
    </div>
  );
}

/**
 * props: id, sum, res, http, k (achado atual ou null), folded, onFold(bool), scrollTo, listRef, onPick(k, i), onStep(dir),
 * showHits (há filtro: aba Achados), tab ('hits' | 'pins'), onTab, pins, onJumpPin(i), onUnpin(i)
 */
export function Hits({ id, sum, res, http, k, folded, onFold, scrollTo, listRef, onPick, onStep, showHits, tab, onTab, pins, onJumpPin, onUnpin }) {
  const total = sum.total;
  const cur = showHits && tab === 'hits' ? 'hits' : 'pins';
  return (
    <section className={'lg-hits' + (folded ? ' is-folded' : '')} aria-label="Achados do filtro e entradas fixadas">
      <header className="lg-hits__head">
        <button type="button" className="lg-hits__fold" onClick={() => onFold(!folded)} aria-expanded={!folded} title={folded ? 'Mostrar o painel' : 'Esconder o painel'}>
          <Icon name={folded ? 'chevron-right' : 'chevron-down'} size={13} />
        </button>
        <div className="lg-hits__tabs" role="tablist">
          {showHits && <button type="button" role="tab" aria-selected={cur === 'hits'} className={cur === 'hits' ? 'is-on' : ''} onClick={() => { onTab('hits'); if (folded) onFold(false); }}>Achados <small>{fmtNum(total)}</small></button>}
          <button type="button" role="tab" aria-selected={cur === 'pins'} className={cur === 'pins' ? 'is-on' : ''} onClick={() => { onTab('pins'); if (folded) onFold(false); }}>Fixados <small>{fmtNum(pins.length)}</small></button>
        </div>
        {cur === 'hits' && <span className="lg-muted">{k != null && total ? `${fmtNum(k + 1)} de ${fmtNum(total)}` : ''}</span>}
        <span className="lg-grow" />
        {cur === 'hits' && (
          <>
            <button type="button" className="lg-btn" onClick={() => onStep(-1)} disabled={!total} title="Achado anterior (N)" aria-label="Achado anterior"><Icon name="chevron-up" size={13} /></button>
            <button type="button" className="lg-btn" onClick={() => onStep(1)} disabled={!total} title="Próximo achado (n)" aria-label="Próximo achado"><Icon name="chevron-down" size={13} /></button>
          </>
        )}
      </header>
      {!folded && (
        <div className="lg-hits__body">
          {cur === 'hits'
            ? (
              <LogList id={id} summary={sum} view="hits" total={total} res={res} http={http} selPos={k} listRef={listRef}
                onSelect={(pos, row) => onPick(pos, row.i)} scrollTo={scrollTo}
                empty={<div className="lg-empty is-small"><b>Nada casa com esse filtro</b></div>} />
            )
            : <Pins pins={pins} onJump={onJumpPin} onUnpin={onUnpin} />}
        </div>
      )}
    </section>
  );
}
