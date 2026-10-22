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
 * props: id, sum, res, http, k (achado atual ou null), height (altura do corpo; 0 = só o cabeçalho), dragging, grip (props da
 * borda arrastável), onOpen() (abre no tamanho padrão), scrollTo, listRef, onPick(k, i), onStep(dir),
 * showHits (há filtro: aba Achados), tab ('hits' | 'pins'), onTab, pins, onJumpPin(i), onUnpin(i)
 */
export function Hits({ id, sum, res, http, k, height, dragging, grip, onOpen, scrollTo, listRef, onPick, onStep, showHits, tab, onTab, pins, onJumpPin, onUnpin }) {
  const total = sum.total;
  const cur = showHits && tab === 'hits' ? 'hits' : 'pins';
  const open = height > 0;
  const pick = (t) => { onTab(t); if (!open) onOpen(); };
  return (
    <section className={'lg-hits' + (dragging ? ' is-dragging' : '')} aria-label="Achados do filtro e entradas fixadas">
      <div className="lg-grip is-h" role="separator" aria-orientation="horizontal" aria-label="Altura dos achados (arraste; duplo clique alterna)"
        aria-valuenow={height} tabIndex={0} {...grip} />
      <header className="lg-hits__head">
        <div className="lg-hits__tabs" role="tablist">
          {showHits && <button type="button" role="tab" aria-selected={cur === 'hits'} className={cur === 'hits' ? 'is-on' : ''} onClick={() => pick('hits')}>Achados <small>{fmtNum(total)}</small></button>}
          <button type="button" role="tab" aria-selected={cur === 'pins'} className={cur === 'pins' ? 'is-on' : ''} onClick={() => pick('pins')}>Fixados <small>{fmtNum(pins.length)}</small></button>
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
      {open && (
        <div className="lg-hits__body" style={{ height }}>
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
