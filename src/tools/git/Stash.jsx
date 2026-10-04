// Git — Stash ("gaveta"): guardar as mudanças com um nome, ver o que tem em cada uma, aplicar, aplicar e remover,
// descartar (com ponto de volta).
import { DS } from '../../lib/ds.js';
import { gitApi, useRepoData, ago, fullDate, FilePath, OpButton } from './shared.jsx';
import { GitDiff } from './GitDiff.jsx';

const { Icon, Spinner, Checkbox } = DS;

function StashFiles({ repo, stash }) {
  const { data: files } = useRepoData(repo, (r) => gitApi().stashFiles(r, stash.ref), [stash.hash]);
  const [file, setFile] = React.useState(null);
  React.useEffect(() => setFile(null), [stash.hash]);
  const diff = useRepoData(repo, (r) => (file ? gitApi().diff(r, { area: 'stash', ref: stash.ref, path: file }) : null), [stash.hash, file]);
  if (!files) return <div className="gt-msg"><Spinner size={14} /> Carregando…</div>;
  return (
    <>
      {files.map((f) => (
        <div key={f.path} className={'gt-file' + (file === f.path ? ' is-sel' : '')} role="button" tabIndex={0} onClick={() => setFile(file === f.path ? null : f.path)}>
          <FilePath path={f.path} />
          <span className="gt-stat">{f.binary ? 'binário' : <><b className="is-add">+{f.added}</b> <b className="is-del">−{f.deleted}</b></>}</span>
        </div>
      ))}
      {file && diff.data && <GitDiff patch={diff.data.patch} truncated={diff.data.truncated} />}
    </>
  );
}

export function Stash({ repo, status, run }) {
  const { data: list, error } = useRepoData(repo, (r) => gitApi().stashes(r));
  const [sel, setSel] = React.useState(null);
  const [msg, setMsg] = React.useState('');
  const [untracked, setUntracked] = React.useState(true);
  const dirty = status.staged.length + status.unstaged.length + (untracked ? status.untracked.length : 0) > 0;
  React.useEffect(() => { if (list && (!sel || !list.some((s) => s.hash === sel))) setSel(list[0] ? list[0].hash : null); }, [list]);
  const cur = list && list.find((s) => s.hash === sel);
  return (
    <div className="gt-stash">
      <div className="gt-stash__side tk-scroll">
        <form className="gt-stash__new" onSubmit={(e) => { e.preventDefault(); if (dirty) run({ op: 'stash.push', message: msg.trim() || undefined, untracked }).then((ok) => ok && setMsg('')); }}>
          <div className="gt-files__title">Guardar as mudanças agora</div>
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Nome (ex.: ajuste da tela de login pela metade)" aria-label="Nome do stash" />
          <div className="gt-stash__row">
            <Checkbox label="Incluir arquivos novos" checked={untracked} onChange={setUntracked} />
            <OpButton op={{ op: 'stash.push', message: msg || undefined, untracked }} run={() => dirty && run({ op: 'stash.push', message: msg.trim() || undefined, untracked }).then((ok) => ok && setMsg(''))} disabled={!dirty} icon="archive" variant="accent" size="md">Guardar</OpButton>
          </div>
          {!dirty && <span className="gt-hint">Nada para guardar.</span>}
        </form>
        {error && <div className="gt-msg is-error">{error}</div>}
        {list && !list.length && <div className="gt-msg">Nenhum stash. Guarde mudanças aqui quando precisar trocar de assunto sem commitar.</div>}
        {list && list.map((s) => (
          <button type="button" key={s.hash} className={'gt-stashitem' + (s.hash === sel ? ' is-sel' : '')} onClick={() => setSel(s.hash)}>
            <Icon name="archive" size={14} />
            <span className="gt-stashitem__main"><b>{s.message}</b><small>{s.branch ? `em ${s.branch} · ` : ''}{ago(s.time)}</small></span>
            <code>{s.ref}</code>
          </button>
        ))}
      </div>
      <div className="gt-stash__detail tk-scroll">
        {cur ? (
          <>
            <div className="gt-detail__head">
              <div className="gt-detail__subject">{cur.message}</div>
              <div className="gt-detail__meta"><span title={fullDate(cur.time)}><Icon name="clock" size={12} /> {ago(cur.time)}</span>{cur.branch && <span><Icon name="git-branch" size={12} /> {cur.branch}</span>}</div>
              <div className="gt-detail__actions">
                <OpButton op={{ op: 'stash.pop', ref: cur.ref }} run={run} icon="package-open" variant="accent">Aplicar e remover</OpButton>
                <OpButton op={{ op: 'stash.apply', ref: cur.ref }} run={run} icon="copy">Aplicar (manter)</OpButton>
                <OpButton op={{ op: 'stash.drop', ref: cur.ref }} run={run} icon="trash-2" variant="danger">Descartar</OpButton>
              </div>
            </div>
            <StashFiles repo={repo} stash={cur} />
          </>
        ) : <div className="gt-msg">Escolha um stash para ver o conteúdo.</div>}
      </div>
    </div>
  );
}
