// Git — Máquina do tempo: os pontos de volta que o Devkit guardou antes de cada operação arriscada (com "voltar a antes
// disto") e o reflog — tudo o que aconteceu com o HEAD, em português —, de onde dá para recuperar commits e branches.
import { DS } from '../../lib/ds.js';
import { validBranchName } from '../../git/ops.js';
import { gitApi, useRepoData, ago, fullDate, short, OpButton } from './shared.jsx';

const { Icon, Spinner } = DS;

const KIND_ICON = { commit: 'git-commit-horizontal', amend: 'pencil', checkout: 'log-in', reset: 'rotate-ccw', merge: 'git-merge', rebase: 'git-pull-request-arrow', 'cherry-pick': 'cherry', pull: 'download', clone: 'copy', branch: 'git-branch', other: 'circle' };

function ReflogEntry({ e, run, current }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  return (
    <li className={'gt-tl__item is-' + e.kind}>
      <span className="gt-tl__dot"><Icon name={KIND_ICON[e.kind] || 'circle'} size={12} /></span>
      <div className="gt-tl__body">
        <button type="button" className="gt-tl__text" onClick={() => setOpen((v) => !v)}>{e.text}</button>
        <span className="gt-tl__meta" title={fullDate(e.time)}>{ago(e.time)} · <code>{short(e.hash)}</code> · {e.selector}{current ? ' · você está aqui' : ''}</span>
        {open && (
          <div className="gt-tl__actions">
            <form className="gt-inline" onSubmit={(ev) => { ev.preventDefault(); if (validBranchName(name)) run({ op: 'branch.create', name, from: e.hash }).then((ok) => ok && setName('')); }}>
              <Icon name="git-branch-plus" size={13} />
              <input value={name} onChange={(ev) => setName(ev.target.value.replace(/\s/g, '-'))} placeholder="recuperar como branch…" aria-label="Nome da branch" />
              <OpButton op={{ op: 'branch.create', name: name || 'x', from: e.hash }} run={() => validBranchName(name) && run({ op: 'branch.create', name, from: e.hash }).then((ok) => ok && setName(''))} disabled={!validBranchName(name)}>Criar</OpButton>
            </form>
            {!current && <OpButton op={{ op: 'reset', to: e.hash, mode: 'hard' }} run={run} icon="rotate-ccw" variant="danger">Voltar a branch e os arquivos para cá</OpButton>}
          </div>
        )}
      </div>
    </li>
  );
}

export function TimeMachine({ repo, status, run, undo }) {
  const backups = useRepoData(repo, (r) => gitApi().backups(r));
  const reflog = useRepoData(repo, (r) => gitApi().reflog(r, 150));
  return (
    <div className="gt-time tk-scroll">
      <div className="gt-time__intro">
        <Icon name="life-buoy" size={20} />
        <div>
          <b>Nada se perde de verdade.</b> Antes de qualquer operação que reescreve ou descarta, o Devkit guarda um ponto de volta.
          E o git registra cada movimento do HEAD (o <i>reflog</i>): commits "sumidos" e branches excluídas continuam
          recuperáveis por aqui por um bom tempo.
        </div>
        {!status.unborn && <OpButton op={{ op: 'undo.commit' }} run={run} icon="undo-2" size="md">Desfazer o último commit</OpButton>}
      </div>

      <section className="gt-card">
        <h3><Icon name="shield-check" size={14} /> Pontos de volta do Devkit</h3>
        {!backups.data ? <div className="gt-msg"><Spinner size={14} /></div> : !backups.data.length ? <div className="gt-msg">Nenhum ainda — eles aparecem quando você descarta, corrige um commit, exclui uma branch…</div> : (
          <ul className="gt-backups">
            {backups.data.map((b) => (
              <li key={b.id}>
                <Icon name={b.kind === 'branch' ? 'git-branch' : b.kind === 'stash' ? 'archive' : b.kind === 'files' ? 'file-plus' : 'save'} size={14} />
                <span className="gt-backups__main"><b>Antes de: {b.title}</b><small>{ago(Date.parse(b.at) / 1000)}{b.branch ? ` · na branch ${b.branch}` : ''} · <code>{b.display}</code></small></span>
                <button type="button" className="gt-op is-ghost is-sm" title={b.kind === 'branch' ? 'Recria a branch excluída' : b.kind === 'stash' ? 'Devolve o stash para a lista' : b.kind === 'files' ? 'Devolve os arquivos apagados' : 'Volta a branch e os arquivos ao estado de antes (o estado atual também vira um ponto de volta)'} onClick={() => undo(b.id)}>
                  <Icon name="rotate-ccw" size={13} /><span>{b.kind === 'branch' ? 'Recriar branch' : b.kind === 'stash' ? 'Recuperar stash' : b.kind === 'files' ? 'Recuperar arquivos' : 'Voltar a antes disto'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="gt-card">
        <h3><Icon name="history" size={14} /> O que aconteceu (reflog)</h3>
        {!reflog.data ? <div className="gt-msg"><Spinner size={14} /></div> : !reflog.data.length ? <div className="gt-msg">Ainda não há movimentos.</div> : (
          <ul className="gt-tl">{reflog.data.map((e, i) => <ReflogEntry key={e.selector + e.hash} e={e} run={run} current={i === 0} />)}</ul>
        )}
      </section>
    </div>
  );
}
