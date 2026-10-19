// Monitor de IA — o que a sessão mudou: alterações não comitadas da pasta dela (git status/diff, só leitura) e os commits
// que ela própria fez. Enquanto a sessão trabalha, a lista se atualiza sozinha. Nada é gravado no repositório.
import { DS } from '../../lib/ds.js';
import { errText, ago, fmtTime } from '../../lib/fmt.jsx';
import { gitAlerts } from './alerts.js';
import { ChangesAi } from './SessionAi.jsx';
import { AutoReview } from './Review.jsx';

const { Icon, Spinner } = DS;

const api = () => window.devkit.aimon;

const KIND = {
  modified: { l: 'M', label: 'Modificado' },
  added: { l: 'A', label: 'Novo (preparado)' },
  deleted: { l: 'D', label: 'Apagado' },
  renamed: { l: 'R', label: 'Renomeado' },
  untracked: { l: '?', label: 'Não rastreado' },
  conflict: { l: 'U', label: 'Em conflito' },
  typechange: { l: 'T', label: 'Tipo mudou' },
  copied: { l: 'C', label: 'Copiado' },
};
const AREA = { staged: 'preparado', unstaged: 'no disco', untracked: 'novo', conflict: 'conflito' };
const MAX_LINES = 2000;

function Diff({ d }) {
  if (!d) return <div className="lg-muted lg-pad"><Spinner size={12} /> Lendo o diff…</div>;
  if (d.binary) return <div className="am-diff__note">Arquivo binário: sem diff em texto.</div>;
  if (!d.patch) return <div className="am-diff__note">Sem diferenças em texto.</div>;
  const lines = d.patch.split('\n');
  const shown = lines.slice(0, MAX_LINES);
  return (
    <pre className="am-diff tk-scroll am-priv">
      {shown.map((l, i) => <span key={i} className={'am-diff__l' + (l[0] === '+' && !l.startsWith('+++') ? ' is-add' : l[0] === '-' && !l.startsWith('---') ? ' is-del' : l[0] === '@' ? ' is-hunk' : '')}>{l || ' '}{'\n'}</span>)}
      {(d.truncated || lines.length > MAX_LINES) && <span className="am-diff__l is-hunk">… diff cortado (arquivo grande){'\n'}</span>}
    </pre>
  );
}

export function Changes({ session, events, onOpenGit, toast }) {
  const [ch, setCh] = React.useState(null);
  const [open, setOpen] = React.useState(null); // { path, area }
  const [diff, setDiff] = React.useState(null);
  const key = session.key;
  const live = session.status === 'working' || session.status === 'waiting';

  const load = React.useCallback(() => api().gitChanges(key).then((c) => setCh((prev) => (prev && prev.key === key && JSON.stringify(prev.c) === JSON.stringify(c) ? prev : { key, c })), (e) => setCh({ key, c: { git: false, error: errText(e), files: [], total: 0, counts: {} } })), [key]);
  React.useEffect(() => { setCh(null); setOpen(null); setDiff(null); load(); }, [key]);
  React.useEffect(() => { if (!live) return undefined; const t = setInterval(load, 4000); return () => clearInterval(t); }, [live, load]);

  const openFile = (f) => {
    if (open && open.path === f.path && open.area === f.area) { setOpen(null); setDiff(null); return; }
    setOpen({ path: f.path, area: f.area }); setDiff(null);
    api().gitDiff(key, f.path, f.area).then((d) => setDiff(d), (e) => { setDiff({ patch: '', error: true }); toast('Diff', errText(e), 'error'); });
  };
  // O diff aberto acompanha a sessão: se o arquivo mudou de novo, relê.
  const sig = ch && ch.c.files ? JSON.stringify(ch.c.files) : '';
  React.useEffect(() => {
    if (!open || !live) return;
    api().gitDiff(key, open.path, open.area).then(setDiff, () => {});
  }, [sig]);

  const commits = React.useMemo(() => (events || []).filter((e) => e.kind === 'commit'), [events]);
  const c = ch && ch.key === key ? ch.c : null;
  const repo = session.repo;

  if (!c) return <div className="lg-muted lg-pad"><Spinner size={12} /> Lendo o Git…</div>;
  const alerts = gitAlerts({ branch: c.branch || (repo && repo.branch), dirty: c.total, active: live });
  return (
    <div className="am-changes tk-scroll">
      {!c.exists && <div className="am-note"><Icon name="info" size={12} />A pasta desta sessão não existe mais{session.cwd ? `: ${session.cwd}` : ''}.</div>}
      {c.exists && !c.git && <div className="am-note"><Icon name="info" size={12} />Esta pasta não é um repositório git, então não há alterações para mostrar.</div>}
      {c.git && (
        <>
          <div className="am-changes__sum">
            <b>{c.total === 0 ? 'Nada alterado' : `${c.total} arquivo(s) alterado(s)`}</b>
            {Object.entries(c.counts).map(([k, n]) => <span key={k} className="lg-pill" title={(KIND[k] || {}).label}>{n} {(KIND[k] || { label: k }).label.toLowerCase()}</span>)}
            {c.ahead > 0 && <span className="lg-pill" title="Commits ainda não enviados ao remoto"><Icon name="arrow-up" size={10} />{c.ahead}</span>}
            {c.behind > 0 && <span className="lg-pill" title="Commits no remoto que faltam aqui"><Icon name="arrow-down" size={10} />{c.behind}</span>}
            <button type="button" className="lg-btn" onClick={load} title="Ler de novo"><Icon name="refresh-cw" size={12} /><span>Atualizar</span></button>
            {live && <span className="lg-muted"><Icon name="radio" size={11} /> acompanhando</span>}
          </div>
          {alerts.map((a) => <div key={a.id} className="am-alert" title={a.title}><Icon name={a.icon} size={13} /><span>{a.text}</span></div>)}
          <ChangesAi session={session} events={events} dirty={c.total > 0} toast={toast} />
          {!session.parentId && <AutoReview session={session} toast={toast} />}
          {c.truncated && <div className="am-note"><Icon name="info" size={12} />Mostrando os primeiros {c.files.length} de {c.total} arquivos.</div>}
          <div className="am-files">
            {c.files.map((f) => {
              const k = KIND[f.kind] || { l: '·', label: f.kind };
              const on = open && open.path === f.path && open.area === f.area;
              return (
                <React.Fragment key={f.area + f.path}>
                  <button type="button" className={'am-file' + (on ? ' is-open' : '')} aria-expanded={on} onClick={() => openFile(f)}>
                    <span className={'am-file__k is-' + f.kind} title={k.label}>{k.l}</span>
                    <span className="am-file__path am-priv" title={f.path}>{f.path}</span>
                    <span className="lg-muted">{AREA[f.area] || ''}</span>
                    <Icon name={on ? 'chevron-down' : 'chevron-right'} size={13} />
                  </button>
                  {on && <Diff d={diff} />}
                </React.Fragment>
              );
            })}
          </div>
        </>
      )}
      <h4 className="am-changes__h"><Icon name="git-commit-horizontal" size={13} />Commits feitos por esta sessão</h4>
      {commits.length === 0 ? <div className="lg-muted am-changes__empty">Nenhum commit nesta sessão (só aparecem os que a própria sessão executou).</div> : (
        <div className="am-commits">
          {commits.map((e, i) => (
            <button key={e.hash + i} type="button" className="am-commit" disabled={!repo} onClick={() => onOpenGit(repo, { tab: 'history', hash: e.hash })} title={repo ? 'Abrir este commit no histórico do Git' : 'Repositório não identificado'}>
              <code>{e.hash.slice(0, 7)}</code>
              <span className="am-commit__msg am-priv">{e.summary || '(sem mensagem)'}</span>
              {e.branch && <span className="lg-pill">{e.branch}</span>}
              <span className="lg-muted" title={fmtTime(e.ts, { millis: false })}>{ago(e.ts)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
