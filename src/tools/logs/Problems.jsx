// Logs — aba Problemas: erros e avisos agrupados pela impressão digital (src/logs/fingerprint.js). A mesma falha
// com ids/horários diferentes vira uma linha: quantas vezes (no filtro e no total), primeira e última, o desenho no
// tempo e se é nova (apareceu depois que o log foi aberto, ou hoje).
import { DS } from '../../lib/ds.js';
import { logsApi, LevelBadge, Highlight, Sparkline, fmtNum, fmtTime, ago, levelColor, sameDay } from './shared.jsx';
import { attribute, previousMilestone, afterText, strongHint, touchedFile, sortAfterLatest } from '../../logs/milestones.js';
import { MilestoneMenu, MilestoneIcon } from './MilestoneMenu.jsx';

const { Icon } = DS;

const SORTS = [
  { id: 'count', label: 'Mais frequentes' },
  { id: 'last', label: 'Mais recentes' },
  { id: 'first', label: 'Mais novos' },
  { id: 'milestone', label: 'Depois do último marco' },
];

/**
 * Etiqueta "depois de…": o marco que veio antes da primeira ocorrência e o intervalo. Diz só a ordem no tempo, nunca
 * a causa. `a` = resultado de `attribute` (+ `file` quando um arquivo do marco é o do frame do erro).
 */
function AfterTag({ a, open, onToggle }) {
  if (a.preexisting) {
    return <span className="lg-after is-pre" title="A primeira ocorrência está no primeiro minuto do log — pode ter começado antes dele.">já existia no início do log</span>;
  }
  const { milestone: m, gapMs } = a;
  const text = afterText(m, gapMs);
  const strong = a.strong && !a.faded && a.file;
  const tip = strong ? strongHint(m, a.file)
    : `Primeira ocorrência ${text} (${fmtTime(m.ts, { date: true, millis: false })}). Mostra só a ordem no tempo, não a causa.`;
  const cls = 'lg-after is-' + (m.kind === 'merge' ? 'merge' : m.kind === 'manual' ? 'manual' : 'deploy') + (strong ? ' is-strong' : a.faded ? ' is-faded' : '');
  return (
    <button type="button" className={cls} title={tip} data-mm-anchor aria-haspopup="menu" aria-expanded={open}
      aria-label={text + (strong ? ' — ' + strongHint(m, a.file) : '') + '. Abrir o menu do marco'}
      onClick={(e) => { e.stopPropagation(); onToggle(e.currentTarget); }}>
      {strong ? <Icon name="crosshair" size={11} strokeWidth={2.25} className="lg-after__aim" /> : <MilestoneIcon kind={m.kind} />}
      <span className="lg-after__txt">{text}</span>
    </button>
  );
}

/**
 * props: id, sum (resultado da consulta), openedAt (ms), res, selKey, onPick(group), onFilter(term, replace), aiSlot
 * Marcos: milestones (já filtrados pelo que o usuário quer ver), logStart (ms), related(m) → arquivos, repo, commitsOf, commitsState,
 * onSeek(ts), onRange(range), onMilestone({ type: 'investigate', m, group, gapMs })
 */
export function Problems({ id, sum, openedAt, res, selKey, onPick, onFilter, aiSlot, aiPanel,
  milestones = [], logStart = null, related, repo, commitsOf, commitsState, onSeek, onRange, onMilestone }) {
  const [sort, setSort] = React.useState('count');
  const [sparks, setSparks] = React.useState({});
  const [menu, setMenu] = React.useState(null); // { gid, m, group, gapMs, style }
  const boxRef = React.useRef(null);
  const hasMs = milestones.length > 0;
  // Marco mais recente dentro do log (merges depois do fim do log não contam).
  const latestMs = React.useMemo(() => {
    const m = hasMs && sum ? previousMilestone(milestones, sum.tsMax != null ? sum.tsMax : Infinity) : null;
    return m ? m.ts : null;
  }, [milestones, sum && sum.tsMax]);
  const sortOn = sort === 'milestone' && !hasMs ? 'count' : sort;
  const groups = React.useMemo(() => {
    const g = (sum && sum.groups ? sum.groups : []).slice();
    if (sortOn === 'last') g.sort((a, b) => (b.last || 0) - (a.last || 0));
    else if (sortOn === 'first') g.sort((a, b) => (b.first || 0) - (a.first || 0));
    else if (sortOn === 'milestone') return sortAfterLatest(g, latestMs);
    return g;
  }, [sum, sortOn, latestMs]);

  // Marco anterior de cada grupo (busca binária por grupo; os arquivos de cada marco são calculados uma vez só).
  const attrs = React.useMemo(() => {
    const out = new Map();
    if (!sum || !hasMs || logStart == null || !related) return out;
    const files = new Map();
    const filesOf = (m) => { if (!files.has(m.id)) files.set(m.id, related(m)); return files.get(m.id); };
    for (const g of sum.groups || []) {
      if (g.first == null) continue;
      const a = attribute(g, milestones, logStart, filesOf);
      if (!a) continue;
      // `preexisting` também vem quando o único marco anterior é de antes do log; aí o erro surgiu no meio do log e
      // "já existia no início" seria falso — sem etiqueta.
      if (a.preexisting && g.first >= logStart + 60000) continue;
      out.set(g.id, a.strong ? { ...a, file: touchedFile(filesOf(a.milestone), g.frame) } : a);
    }
    return out;
  }, [sum, milestones, logStart, related]);

  React.useEffect(() => {
    if (!sum || !groups.length) { setSparks({}); return undefined; }
    let alive = true;
    logsApi().sparks({ id, qid: sum.qid, groups: groups.slice(0, 60).map((g) => g.id) }).then((r) => { if (alive && r && r.sparks) setSparks(r.sparks); }, () => {});
    return () => { alive = false; };
  }, [sum && sum.qid, sortOn, sortOn === 'milestone' ? latestMs : null]);

  // Abre o menu do marco embaixo da etiqueta (ou em cima, se não couber), dentro da área da aba.
  const toggleMenu = (g, a, el) => {
    if (menu && menu.gid === g.id) { setMenu(null); return; }
    const box = boxRef.current;
    if (!box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const W = 360;
    const left = Math.max(8, Math.min(r.left - b.left, b.width - W - 8));
    const below = r.bottom - b.top + 4;
    const style = below + 300 > b.height && r.top - b.top > 300
      ? { left, right: 'auto', top: 'auto', bottom: b.bottom - r.top + 4 }
      : { left, right: 'auto', top: below };
    setMenu({ gid: g.id, m: a.milestone, group: g, gapMs: a.gapMs, style });
  };

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
    <div className="lg-problems" ref={boxRef}>
      <div className="lg-problems__head">
        <span><b>{fmtNum(sum.groupsTotal)}</b> problema{sum.groupsTotal === 1 ? '' : 's'} diferente{sum.groupsTotal === 1 ? '' : 's'} · {errs} de erro</span>
        <span className="lg-grow" />
        {aiSlot && aiSlot(groups)}
        <div className="lg-seg" role="group" aria-label="Ordem">
          {SORTS.map((s) => {
            const off = s.id === 'milestone' && !hasMs;
            return (
              <button key={s.id} type="button" className={sortOn === s.id ? 'is-on' : ''} disabled={off} onClick={() => setSort(s.id)}
                title={s.id === 'milestone' ? (off ? 'Sem marcos (deploys, merges ou manuais) neste log' : 'Primeiro os que apareceram depois do marco mais recente, depois os mais frequentes') : undefined}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>
      {aiPanel}
      <div className="lg-problems__list tk-scroll" role="list" onScroll={menu ? () => setMenu(null) : undefined}>
        {groups.map((g) => {
          const isNew = g.first != null && (g.first >= openedAt || g.first >= recentFrom);
          const a = attrs.get(g.id);
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
                  {a && <AfterTag a={a} open={!!menu && menu.gid === g.id} onToggle={(el) => toggleMenu(g, a, el)} />}
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
      {menu && (
        <MilestoneMenu key={menu.gid + '|' + menu.m.id} milestones={[menu.m]} repo={repo} commitsOf={commitsOf} commitsState={commitsState} style={menu.style}
          multiDay={sum.tsMin != null && !sameDay(sum.tsMin, latest)} onSeek={onSeek} onRange={onRange} onClose={() => setMenu(null)}
          extra={onMilestone ? [{ icon: 'clipboard-plus', label: 'Adicionar à investigação', hint: 'como suspeita', onClick: (m) => onMilestone({ type: 'investigate', m, group: menu.group, gapMs: menu.gapMs }) }] : null} />
      )}
    </div>
  );
}
