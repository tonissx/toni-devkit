// Git — Visão geral do repositório: números, atividade dos últimos 90 dias (mapa de calor), autores, arquivos mais
// alterados, último commit e atalhos para o que mais se faz.
import { DS } from '../../lib/ds.js';
import { gitApi, useRepoData, ago, short, FilePath, RefBadges, OpButton } from './shared.jsx';

const { Icon, Spinner } = DS;

function Kpi({ icon, label, value, tone, onClick, title }) {
  return (
    <button type="button" className={'gt-kpi' + (tone ? ' is-' + tone : '')} onClick={onClick} disabled={!onClick} title={title}>
      <span className="gt-kpi__icon"><Icon name={icon} size={16} /></span>
      <span className="gt-kpi__value">{value}</span>
      <span className="gt-kpi__label">{label}</span>
    </button>
  );
}

/** Mapa de calor: colunas = semanas, linhas = dias da semana (como o do GitHub). */
function Heatmap({ activity }) {
  const max = Math.max(1, ...activity.map((a) => a.n));
  const total = activity.reduce((s, a) => s + a.n, 0);
  // Alinha a 1ª coluna no domingo.
  const first = new Date(activity[0].day + 'T12:00:00');
  const pad = first.getDay();
  const cells = [...Array(pad).fill(null), ...activity];
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  return (
    <div className="gt-heat">
      <div className="gt-heat__grid">
        {weeks.map((w, i) => (
          <div key={i} className="gt-heat__week">
            {w.map((c, j) => c
              ? <span key={j} className={'gt-heat__cell l' + level(c.n)} title={`${new Date(c.day + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}: ${c.n} commit${c.n === 1 ? '' : 's'}`} />
              : <span key={j} className="gt-heat__cell is-pad" />)}
          </div>
        ))}
      </div>
      <div className="gt-heat__foot">
        <span>{total} commit{total === 1 ? '' : 's'} nos últimos 90 dias (na branch atual)</span>
        <span className="gt-heat__legend">menos {[0, 1, 2, 3, 4].map((l) => <span key={l} className={'gt-heat__cell l' + l} />)} mais</span>
      </div>
    </div>
  );
}

function Bars({ items, label, value, onClick }) {
  const max = Math.max(1, ...items.map(value));
  return (
    <div className="gt-bars">
      {items.map((it, i) => (
        <button type="button" key={i} className="gt-bars__row" onClick={onClick ? () => onClick(it) : undefined} disabled={!onClick}>
          <span className="gt-bars__label">{label(it)}</span>
          <span className="gt-bars__track"><span className="gt-bars__fill" style={{ width: Math.max(4, (value(it) / max) * 100) + '%' }} /></span>
          <span className="gt-bars__n">{value(it)}</span>
        </button>
      ))}
    </div>
  );
}

/** Situação da branch em relação à remota — o ahead/behind vale para o último fetch, por isso mostra quando foi. */
function syncInfo(s, lastFetch) {
  const b = s.branch;
  const when = lastFetch ? 'busca ' + ago(lastFetch) : 'nunca buscou';
  if (!s.remote) return { value: 'só local', label: 'repositório sem remoto' };
  if (b.detached) return { value: '—', label: 'HEAD solto, sem branch remota' };
  if (!b.upstream) return { value: 'não publicada', label: `branch ainda não está em ${s.remote}`, tone: 'warn' };
  const parts = [b.behind ? `↓${b.behind}` : '', b.ahead ? `↑${b.ahead}` : ''].filter(Boolean);
  return { value: parts.length ? parts.join(' ') : 'em dia', label: `${b.upstream} · ${when}`, tone: b.behind ? 'warn' : '' };
}

const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Quando os commits acontecem: dias da semana × horas (180 dias). */
function Rhythm({ repo }) {
  const { data, error } = useRepoData(repo, (r) => gitApi().rhythm(r));
  const title = <h3><Icon name="clock" size={14} /> Ritmo (últimos 180 dias)</h3>;
  // Card com spinner enquanto carrega: sem ele o último commit ocupa esta vaga e pula de lugar quando o ritmo chega.
  if (error && !data) return null;
  if (!data) return <section className="gt-card gt-ov-rhythm">{title}<div className="gt-msg"><Spinner size={14} /></div></section>;
  if (!data.total) return null;
  const max = Math.max(1, ...data.grid.flat());
  const peak = data.grid.flatMap((row, d) => row.map((n, h) => ({ n, d, h }))).sort((a, b) => b.n - a.n)[0];
  return (
    <section className="gt-card gt-ov-rhythm">
      {title}
      <div className="gt-rhythm">
        <div className="gt-rhythm__hours">{Array.from({ length: 24 }, (_, h) => <span key={h}>{h % 3 === 0 ? h + 'h' : ''}</span>)}</div>
        {data.grid.map((row, d) => (
          <div key={d} className="gt-rhythm__row">
            <span className="gt-rhythm__day">{DAYS[d]}</span>
            {row.map((n, h) => <span key={h} className={'gt-heat__cell l' + (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)))} title={`${DAYS[d]} ${h}h: ${n} commit${n === 1 ? '' : 's'}`} />)}
          </div>
        ))}
      </div>
      <div className="gt-heat__foot"><span>{data.total} commits · mais comum: {DAYS[peak.d]} às {peak.h}h</span></div>
    </section>
  );
}

export function Overview({ repo, status, go, run, net }) {
  const { data: ov, error } = useRepoData(repo, (r) => gitApi().overview(r));
  if (error) return <div className="gt-msg is-error">{error}</div>;
  if (!ov) return <div className="gt-msg"><Spinner size={14} /> Lendo o repositório…</div>;
  const s = ov.status;
  const changes = s.staged.length + s.unstaged.length + s.untracked.length;
  return (
    <div className="gt-overview tk-scroll">
      <div className="gt-kpis">
        <Kpi icon="file-diff" label="mudanças pendentes" value={changes} tone={changes ? 'warn' : ''} onClick={() => go('changes')} />
        {/* rev-list --count HEAD: commits alcançáveis da branch atual (inclui os herdados da base), não só os dela. */}
        <Kpi icon="git-commit-horizontal" label={s.branch.detached ? 'commits até o HEAD' : `commits em ${s.branch.head}`} value={ov.commits}
          onClick={() => go('history')} title="Total de commits no histórico da branch atual" />
        {(() => {
          const sync = syncInfo(s, ov.lastFetch);
          return <Kpi icon="refresh-cw" label={sync.label} value={sync.value} tone={sync.tone}
            onClick={s.remote ? () => (net || run)({ op: 'fetch' }) : undefined}
            title={s.remote ? 'Clique para buscar da remota agora (git fetch)' : undefined} />;
        })()}
        <Kpi icon="git-branch" label="branches" value={ov.branches} onClick={() => go('branches')} />
        <Kpi icon="archive" label="stashes" value={s.stashes} onClick={() => go('stash')} />
        <Kpi icon="tag" label="tags" value={ov.tags} />
      </div>

      {s.unborn ? (
        <div className="gt-card gt-welcome">
          <Icon name="sparkles" size={18} />
          <div><b>Repositório novo, ainda sem commits.</b> Vá em <a href="#" onClick={(e) => { e.preventDefault(); go('changes'); }}>Mudanças</a>, prepare os arquivos e faça o primeiro commit.</div>
        </div>
      ) : (
        <div className="gt-ov-grid">
          <section className="gt-card gt-ov-heat">
            <h3><Icon name="activity" size={14} /> Atividade</h3>
            <Heatmap activity={ov.activity} />
          </section>
          {/* Os dois mapas de calor ficam juntos; o último commit vem depois. */}
          <Rhythm repo={repo} />
          {ov.last && (
            <section className="gt-card gt-ov-last">
              <h3><Icon name="git-commit-horizontal" size={14} /> Últimos commits</h3>
              <div className="gt-last">
                <div className="gt-last__subject">{ov.last.subject}</div>
                <RefBadges refs={ov.last.refs} />
                <div className="gt-last__meta">{ov.last.author} · {ago(ov.last.time)} · <code>{short(ov.last.hash)}</code></div>
                <div className="gt-last__actions">
                  <OpButton op={{ op: 'undo.commit' }} run={run} icon="undo-2">Desfazer este commit</OpButton>
                  <button type="button" className="gt-op is-ghost is-sm" onClick={() => go('history', { hash: ov.last.hash })}><Icon name="eye" size={13} /><span>Ver</span></button>
                </div>
              </div>
              {(ov.recent || []).length > 1 && (
                <div className="gt-recent">
                  {ov.recent.slice(1).map((c) => (
                    <button type="button" key={c.hash} className="gt-recent__row" onClick={() => go('history', { hash: c.hash })} title={c.subject}>
                      <span className="gt-recent__subject">{c.subject}</span>
                      <span className="gt-recent__meta">{c.author} · {ago(c.time)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          <section className="gt-card gt-ov-authors">
            <h3><Icon name="users" size={14} /> Quem mais commitou</h3>
            <Bars items={ov.authors} label={(a) => a.name} value={(a) => a.n} />
          </section>
          <section className="gt-card gt-ov-hot">
            <h3><Icon name="flame" size={14} /> Arquivos mais alterados (180 dias)</h3>
            {ov.hotspots.length ? <Bars items={ov.hotspots} label={(h) => <FilePath path={h.path} />} value={(h) => h.n} /> : <div className="gt-msg">Nenhum ainda.</div>}
          </section>
        </div>
      )}
    </div>
  );
}
