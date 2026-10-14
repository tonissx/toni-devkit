// Logs — aba Problemas: erros e avisos agrupados pela impressão digital (src/logs/fingerprint.js). A mesma falha
// com ids/horários diferentes vira uma linha: quantas vezes (no filtro e no total), primeira e última, o desenho no
// tempo e se é nova (apareceu depois que o log foi aberto, ou hoje).
import { DS } from '../../lib/ds.js';
import { logsApi, LevelBadge, Highlight, Sparkline, fmtNum, fmtTime, ago, levelColor, sameDay } from './shared.jsx';

const { Icon } = DS;

const SORTS = [
  { id: 'count', label: 'Mais frequentes' },
  { id: 'last', label: 'Mais recentes' },
  { id: 'first', label: 'Mais novos' },
];

/**
 * props: id, sum (resultado da consulta), openedAt (ms), res, selKey, onPick(group), onFilter(term, replace), aiSlot
 */
export function Problems({ id, sum, openedAt, res, selKey, onPick, onFilter, aiSlot, aiPanel }) {
  const [sort, setSort] = React.useState('count');
  const [sparks, setSparks] = React.useState({});
  const groups = React.useMemo(() => {
    const g = (sum && sum.groups ? sum.groups : []).slice();
    if (sort === 'last') g.sort((a, b) => (b.last || 0) - (a.last || 0));
    else if (sort === 'first') g.sort((a, b) => (b.first || 0) - (a.first || 0));
    return g;
  }, [sum, sort]);

  React.useEffect(() => {
    if (!sum || !groups.length) { setSparks({}); return undefined; }
    let alive = true;
    logsApi().sparks({ id, qid: sum.qid, groups: groups.slice(0, 60).map((g) => g.id) }).then((r) => { if (alive && r && r.sparks) setSparks(r.sparks); }, () => {});
    return () => { alive = false; };
  }, [sum && sum.qid, sort]);

  if (!sum) return null;
  if (!groups.length) {
    return (
      <div className="lg-empty">
        <Icon name="party-popper" size={22} />
        <b>Nenhum erro ou aviso {sum.total ? 'neste filtro' : ''}</b>
        <span>Os problemas aparecem aqui agrupados: a mesma falha com ids e horários diferentes vira uma linha só.</span>
      </div>
    );
  }
  const latest = sum.tsMax || Date.now();
  // "Novo": apareceu depois que o log foi aberto (ao vivo) ou só na última hora de um log que cobre mais de 2 h.
  const span = sum.tsMin != null && sum.tsMax != null ? sum.tsMax - sum.tsMin : 0;
  const recentFrom = span > 2 * 3600e3 ? latest - 3600e3 : Infinity;
  const errs = groups.filter((g) => g.level >= 5).length;
  return (
    <div className="lg-problems">
      <div className="lg-problems__head">
        <span><b>{fmtNum(sum.groupsTotal)}</b> problema{sum.groupsTotal === 1 ? '' : 's'} diferente{sum.groupsTotal === 1 ? '' : 's'} · {errs} de erro</span>
        <span className="lg-grow" />
        {aiSlot && aiSlot(groups)}
        <div className="lg-seg" role="group" aria-label="Ordem">
          {SORTS.map((s) => <button key={s.id} type="button" className={sort === s.id ? 'is-on' : ''} onClick={() => setSort(s.id)}>{s.label}</button>)}
        </div>
      </div>
      {aiPanel}
      <div className="lg-problems__list tk-scroll" role="list">
        {groups.map((g) => {
          const isNew = g.first != null && (g.first >= openedAt || g.first >= recentFrom);
          const newWhy = g.first >= openedAt ? 'Apareceu depois que você abriu o log' : 'Apareceu pela primeira vez na última hora do log';
          return (
            <div key={g.id} role="listitem" className={'lg-prob' + (selKey === g.key ? ' is-sel' : '')} onClick={() => onPick(g)}>
              <span className="lg-prob__bar" style={{ background: levelColor(g.level) }} />
              <div className="lg-prob__main">
                <div className="lg-prob__title">
                  <LevelBadge level={g.level} compact />
                  <span className="lg-prob__text"><Highlight text={g.title} res={res} /></span>
                  {isNew && <span className="lg-new" title={newWhy}><Icon name="sparkle" size={10} />novo</span>}
                </div>
                <div className="lg-prob__meta">
                  {g.rootCause && g.rootCause !== g.exception ? <span title="Causa raiz (último Caused by)"><Icon name="corner-down-right" size={11} /> {g.rootCause}</span> : g.exception ? <span>{g.exception}</span> : null}
                  {g.frame && <span title="Primeiro frame fora do framework"><Icon name="map-pin" size={11} /> {g.frame}</span>}
                  {!g.exception && g.logger && <span>{g.logger}</span>}
                  <span title={`Primeira: ${fmtTime(g.first, { date: true })}`}>desde {sameDay(g.first, latest) ? fmtTime(g.first, { millis: false }) : fmtTime(g.first, { date: true, millis: false })}</span>
                  <span title={`Última: ${fmtTime(g.last, { date: true })}`}>última {ago(g.last, latest) === 'agora' ? 'no fim do log' : fmtTime(g.last, { date: !sameDay(g.last, latest), millis: false })}</span>
                </div>
              </div>
              <span className="lg-prob__spark" style={{ color: levelColor(g.level) }}><Sparkline data={sparks[g.id]} title={`Ocorrências de ${g.title} no tempo`} /></span>
              <span className="lg-prob__count">
                <b>{fmtNum(g.count)}</b>
                {g.total !== g.count && <small title="No log inteiro">de {fmtNum(g.total)}</small>}
              </span>
              <div className="lg-prob__acts" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="lg-icon" title="Ver as ocorrências na lista" onClick={() => onFilter('group:' + g.key, true)}><Icon name="list-filter" size={14} /></button>
                <button type="button" className="lg-icon" title="Esconder este problema" onClick={() => onFilter('-group:' + g.key)}><Icon name="eye-off" size={14} /></button>
              </div>
            </div>
          );
        })}
        {sum.groupsTotal > groups.length && <div className="lg-muted lg-pad">Mostrando os {groups.length} mais frequentes de {fmtNum(sum.groupsTotal)}.</div>}
      </div>
    </div>
  );
}
