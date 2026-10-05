// Git — Branches: lista com o quanto cada uma está à frente/atrás da base, se já foi mesclada, upstream; criar, trocar
// (perguntando o que fazer com as mudanças), renomear, excluir (com ponto de volta) e comparar duas branches.
import { DS } from '../../lib/ds.js';
import { validBranchName } from '../../git/ops.js';
import { gitApi, useRepoData, ago, short, FilePath, OpButton, laneColor } from './shared.jsx';
import { GitDiff } from './GitDiff.jsx';

const { Icon, Spinner, Modal, Button, Checkbox, Select } = DS;

/** Barrinha de divergência: commits atrás (esquerda) e à frente (direita) da base. */
function Divergence({ behind = 0, ahead = 0 }) {
  const max = Math.max(1, behind, ahead);
  const w = (n) => (n ? Math.max(6, (n / max) * 50) : 0);
  return (
    <span className="gt-div" title={`${behind} commit(s) da base que esta branch não tem · ${ahead} commit(s) só desta branch`}>
      <span className="gt-div__side is-behind"><span className="gt-div__n">{behind || ''}</span><span className="gt-div__bar" style={{ width: w(behind) }} /></span>
      <span className="gt-div__mid" />
      <span className="gt-div__side is-ahead"><span className="gt-div__bar" style={{ width: w(ahead) }} /><span className="gt-div__n">{ahead || ''}</span></span>
    </span>
  );
}

function Compare({ repo, branches, initial }) {
  const names = branches.map((b) => b.name);
  const [a, setA] = React.useState(initial.a);
  const [b, setB] = React.useState(initial.b);
  const [file, setFile] = React.useState(null);
  React.useEffect(() => { setA(initial.a); setB(initial.b); setFile(null); }, [initial.a, initial.b]);
  const { data: cmp, error } = useRepoData(repo, (r) => (a && b && a !== b ? gitApi().compare(r, a, b) : null), [a, b]);
  const diff = useRepoData(repo, (r) => (file ? gitApi().diff(r, { area: 'range', hash: a, ref: b, path: file }) : null), [a, b, file]);
  const opts = names.map((n) => ({ value: n, label: n }));
  return (
    <div className="gt-compare">
      <div className="gt-compare__pick">
        <Select size="sm" options={opts} value={a} onChange={(v) => { setA(v); setFile(null); }} style={{ minWidth: 160 }} />
        <Icon name="arrow-left-right" size={14} />
        <Select size="sm" options={opts} value={b} onChange={(v) => { setB(v); setFile(null); }} style={{ minWidth: 160 }} />
      </div>
      {a === b && <div className="gt-msg">Escolha duas branches diferentes.</div>}
      {error && <div className="gt-msg is-error">{error}</div>}
      {cmp && (
        <>
          <div className="gt-fork">
            <div className="gt-fork__side"><span className="gt-fork__name" style={{ color: laneColor(0) }}>{a}</span><b>{cmp.onlyA}</b> commit{cmp.onlyA === 1 ? '' : 's'} só aqui</div>
            <svg viewBox="0 0 120 50" className="gt-fork__svg" aria-hidden="true">
              <path d="M10,25 L50,25" stroke="var(--tk-text-3)" />
              <path d="M50,25 C70,25 80,8 110,8" stroke={laneColor(0)} />
              <path d="M50,25 C70,25 80,42 110,42" stroke={laneColor(1)} />
              <circle cx="50" cy="25" r="4" fill="var(--tk-text-3)" />
            </svg>
            <div className="gt-fork__side"><span className="gt-fork__name" style={{ color: laneColor(1) }}>{b}</span><b>{cmp.onlyB}</b> commit{cmp.onlyB === 1 ? '' : 's'} só aqui</div>
          </div>
          <p className="gt-hint">Ancestral comum: <code>{short(cmp.base) || '—'}</code>. {cmp.onlyA === 0 && cmp.onlyB > 0 ? `${a} pode avançar direto até ${b} (fast-forward).` : cmp.onlyA > 0 && cmp.onlyB > 0 ? 'As duas andaram: juntar exige um merge (ou rebase).' : cmp.onlyB === 0 && cmp.onlyA === 0 ? 'Estão no mesmo commit.' : ''}</p>
          <div className="gt-compare__cols">
            {[[a, cmp.commitsA, 0], [b, cmp.commitsB, 1]].map(([name, list, color]) => (
              <div key={name} className="gt-compare__col">
                <div className="gt-files__head"><span className="gt-files__title" style={{ color: laneColor(color) }}>Só em {name}</span><span className="gt-files__n">{list.length}</span></div>
                {list.slice(0, 50).map((c) => <div key={c.hash} className="gt-mini"><code>{short(c.hash)}</code> {c.subject} <span className="gt-mini__meta">{c.author} · {ago(c.time)}</span></div>)}
                {!list.length && <div className="gt-msg">Nenhum.</div>}
              </div>
            ))}
          </div>
          <div className="gt-files__head"><span className="gt-files__title">O que {b} mudou desde o ancestral comum</span><span className="gt-files__n">{cmp.files.length}</span></div>
          {cmp.files.map((f) => (
            <div key={f.path} className={'gt-file' + (file === f.path ? ' is-sel' : '')} role="button" tabIndex={0} onClick={() => setFile(file === f.path ? null : f.path)}>
              <FilePath path={f.path} />
              <span className="gt-stat">{f.binary ? 'binário' : <><b className="is-add">+{f.added}</b> <b className="is-del">−{f.deleted}</b></>}</span>
            </div>
          ))}
          {file && diff.data && <GitDiff patch={diff.data.patch} truncated={diff.data.truncated} />}
        </>
      )}
    </div>
  );
}

export function Branches({ repo, status, run, openMerge }) {
  const { data, error } = useRepoData(repo, (r) => gitApi().branches(r));
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const [checkout, setCheckout] = React.useState(true);
  const [renaming, setRenaming] = React.useState(null); // { from, to }
  const [switching, setSwitching] = React.useState(null); // nome da branch, quando há mudanças pendentes
  const [cmp, setCmp] = React.useState(null); // { a, b }
  const dirty = status.staged.length + status.unstaged.length + status.untracked.length > 0;

  if (status.unborn) return <div className="gt-msg">Faça o primeiro commit para poder criar branches.</div>;
  if (error) return <div className="gt-msg is-error">{error}</div>;
  if (!data) return <div className="gt-msg"><Spinner size={14} /> Lendo as branches…</div>;
  const { base, branches } = data;
  const current = status.branch.head;

  const switchTo = (b) => (dirty ? setSwitching(b) : run({ op: 'branch.switch', name: b }));
  const create = async (e) => {
    e.preventDefault();
    if (!validBranchName(name)) return;
    if (await run({ op: 'branch.create', name, checkout })) { setName(''); setCreating(false); }
  };

  return (
    <div className="gt-branches tk-scroll">
      <div className="gt-toolbar">
        <button type="button" className="gt-op is-accent is-sm" onClick={() => setCreating((v) => !v)}><Icon name="git-branch-plus" size={13} /><span>Nova branch</span></button>
        <button type="button" className="gt-op is-ghost is-sm" onClick={() => setCmp(cmp ? null : { a: base || current, b: (branches.find((x) => x.name !== (base || current)) || {}).name || current })}><Icon name="arrow-left-right" size={13} /><span>Comparar</span></button>
        <span className="gt-toolbar__spacer" />
        <span className="gt-hint">Base para comparação: <b>{base}</b></span>
      </div>
      {creating && (
        <form className="gt-newbranch" onSubmit={create}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))} placeholder="nome-da-branch (ex.: feature/login)" aria-label="Nome da branch" />
          <span className="gt-hint">a partir de <b>{current || 'HEAD'}</b></span>
          <Checkbox label="Trocar para ela" checked={checkout} onChange={setCheckout} />
          <OpButton op={{ op: 'branch.create', name: name || 'x', checkout }} run={() => create({ preventDefault() {} })} disabled={!validBranchName(name)} variant="primary" size="md">Criar</OpButton>
          {name && !validBranchName(name) && <span className="gt-err">Nome inválido (sem espaços, “..”, “~”, “^”, “:”…)</span>}
        </form>
      )}
      {cmp && <Compare repo={repo} branches={branches} initial={cmp} />}

      <table className="gt-btable">
        <thead><tr><th /><th>Branch</th><th>Último commit</th><th title="Atrás / à frente da base">vs {base}</th><th>Upstream</th><th /></tr></thead>
        <tbody>
          {branches.map((b, i) => (
            <tr key={b.name} className={b.current ? 'is-current' : ''}>
              <td><span className="gt-bdot" style={{ background: laneColor(i) }} /></td>
              <td className="gt-btable__name">
                {renaming && renaming.from === b.name ? (
                  <form onSubmit={(e) => { e.preventDefault(); if (validBranchName(renaming.to)) run({ op: 'branch.rename', from: b.name, to: renaming.to }).then((ok) => ok && setRenaming(null)); }}>
                    <input autoFocus value={renaming.to} onChange={(e) => setRenaming({ ...renaming, to: e.target.value.replace(/\s/g, '-') })} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} aria-label="Novo nome" />
                  </form>
                ) : <>
                  <b>{b.name}</b>
                  {b.current && <span className="gt-tag is-current">atual</span>}
                  {b.merged && !b.noOwnCommits && <span className="gt-tag is-merged" title={`Todos os commits dela já estão em ${base}`}>mesclada</span>}
                  {b.merged && b.noOwnCommits && <span className="gt-tag is-merged" title={`Ainda não tem commits próprios: aponta para um commit que já está em ${base}. Mudanças não commitadas não contam.`}>sem commits próprios</span>}
                  {!b.merged && !b.current && b.name !== base && b.containedIn && b.containedIn.length > 0 && <span className="gt-tag is-merged" title={`Todos os commits dela já estão em ${b.containedIn.join(', ')} — dá para excluir sem perder nada`}>contida em {b.containedIn[0]}{b.containedIn.length > 1 ? ` +${b.containedIn.length - 1}` : ''}</span>}
                  {b.gone && <span className="gt-tag is-gone" title="A branch remota que ela acompanhava foi apagada">remota sumiu</span>}
                  {b.worktree && <span className="gt-tag is-gone" title={`Aberta no worktree ${b.worktree} — não dá para trocar para ela nem excluí-la daqui (veja Manutenção → Worktrees)`}>em worktree</span>}
                </>}
              </td>
              <td className="gt-btable__last"><span className="gt-btable__subject">{b.subject}</span><span className="gt-btable__meta">{b.author} · {ago(b.time)}</span></td>
              <td>{b.name === base ? <span className="gt-hint">base</span> : <Divergence behind={b.baseBehind} ahead={b.baseAhead} />}</td>
              <td className="gt-btable__up">{b.upstream ? <span title="Comparado com o que o git sabe da remota (último fetch)">{b.upstream} {b.ahead ? `↑${b.ahead}` : ''} {b.behind ? `↓${b.behind}` : ''}</span> : <span className="gt-hint">só local</span>}</td>
              <td className="gt-btable__actions">
                {!b.current && !b.worktree && <OpButton op={{ op: 'branch.switch', name: b.name }} run={() => switchTo(b.name)} icon="log-in">Trocar</OpButton>}
                {!b.current && current && <button type="button" className="gt-op is-ghost is-sm" title={`Mesclar ${b.name} em ${current} (com prévia)`} onClick={() => openMerge(b.name)}><Icon name="git-merge" size={13} /></button>}
                <button type="button" className="gt-op is-ghost is-sm" title="Comparar com a base" onClick={() => setCmp({ a: base, b: b.name })} disabled={b.name === base}><Icon name="arrow-left-right" size={13} /></button>
                <button type="button" className="gt-op is-ghost is-sm" title="Renomear" onClick={() => setRenaming({ from: b.name, to: b.name })}><Icon name="pencil" size={13} /></button>
                {!b.current && !b.worktree && <OpButton op={{ op: 'branch.delete', name: b.name, force: !b.merged, contained: b.containedIn }} run={run} icon="trash-2" variant="danger" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {switching && (
        <Modal title={`Trocar para ${switching}`} icon="git-branch" onClose={() => setSwitching(null)} width={520}
          description="Você tem mudanças que ainda não foram commitadas. O que fazer com elas?"
          footer={<Button variant="ghost" onClick={() => setSwitching(null)}>Cancelar</Button>}>
          <div className="gt-choices">
            <button type="button" className="gt-choice" onClick={() => { setSwitching(null); run({ op: 'branch.switch', name: switching, stash: true }); }}>
              <Icon name="archive" size={18} /><span><b>Guardar e trocar</b><small>Vão para um stash (aba Stash) e a outra branch abre limpa. Recomendado.</small><code>git stash push -u · git switch {switching}</code></span>
            </button>
            <button type="button" className="gt-choice" onClick={() => { setSwitching(null); run({ op: 'branch.switch', name: switching }); }}>
              <Icon name="briefcase" size={18} /><span><b>Levar junto</b><small>As mudanças continuam nos arquivos, na outra branch. O git recusa se elas baterem com diferenças entre as branches.</small><code>git switch {switching}</code></span>
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
