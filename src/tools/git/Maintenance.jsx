// Git — Manutenção: tags (marcar versões), limpar branches já mescladas, apagar arquivos não versionados (com prévia
// e cópia de segurança) e o .gitignore. Tudo com o comando equivalente e ponto de volta quando apaga algo.
import { DS } from '../../lib/ds.js';
import { validBranchName } from '../../git/ops.js';
import { gitApi, useRepoData, ago, short, FilePath, OpButton } from './shared.jsx';

const { Icon, Spinner, Checkbox } = DS;

function Tags({ repo, run }) {
  const { data: tags } = useRepoData(repo, (r) => gitApi().tags(r));
  const [name, setName] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const create = () => validBranchName(name) && run({ op: 'tag.create', name, message: msg || undefined }).then((ok) => { if (ok) { setName(''); setMsg(''); } });
  return (
    <section className="gt-card">
      <h3><Icon name="tag" size={14} /> Tags <span className="gt-files__n">{tags ? tags.length : ''}</span></h3>
      <p className="gt-hint">Uma tag dá nome a um commit — normalmente uma versão entregue (<code>v1.2.0</code>). Diferente de uma branch, ela não anda.</p>
      <form className="gt-mt__form" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <input value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, '-'))} placeholder="v1.0.0" aria-label="Nome da tag" />
        <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Mensagem (opcional — cria uma tag anotada)" aria-label="Mensagem da tag" className="is-wide" />
        <OpButton op={{ op: 'tag.create', name: name || 'x', message: msg || undefined }} run={create} disabled={!validBranchName(name)} icon="tag" variant="accent" size="md">Marcar o commit atual</OpButton>
      </form>
      {!tags ? <div className="gt-msg"><Spinner size={14} /></div> : !tags.length ? <div className="gt-msg">Nenhuma tag ainda.</div> : (
        <div className="gt-mt__list">
          {tags.map((t) => (
            <div key={t.name} className="gt-mt__row">
              <span className="gt-ref is-tag"><Icon name="tag" size={10} />{t.name}</span>
              <span className="gt-mt__main">{t.message ? <b>{t.message}</b> : null}<small>{t.subject} · <code>{short(t.commit)}</code> · {ago(t.time)}{t.annotated ? ' · anotada' : ''}</small></span>
              <OpButton op={{ op: 'tag.delete', name: t.name }} run={run} icon="trash-2" variant="danger" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MergedBranches({ repo, run }) {
  const { data } = useRepoData(repo, (r) => gitApi().branches(r));
  const [pick, setPick] = React.useState(() => new Set());
  const merged = data ? data.branches.filter((b) => b.merged && !b.current) : null;
  const free = merged ? merged.filter((b) => !b.worktree) : null;
  const key = merged ? merged.map((b) => b.name + (b.worktree ? '@' : '')).join('\n') : '';
  // Começa com todas marcadas; recargas (o watcher recarrega sozinho) só tiram as que sumiram.
  const seen = React.useRef('');
  React.useEffect(() => {
    if (!merged) return;
    if (!seen.current) setPick(new Set(free.map((b) => b.name)));
    else setPick((s) => new Set([...s].filter((n) => free.some((b) => b.name === n))));
    seen.current = key;
  }, [key]);
  const names = free ? free.filter((b) => pick.has(b.name)).map((b) => b.name) : [];
  return (
    <section className="gt-card">
      <h3><Icon name="git-branch" size={14} /> Branches já mescladas em {data ? data.base : '…'}</h3>
      <p className="gt-hint">Todos os commits delas já estão na base — excluí-las não perde nada (e o Devkit ainda guarda um ponto de volta).</p>
      {!merged ? <div className="gt-msg"><Spinner size={14} /></div> : !merged.length ? <div className="gt-msg"><Icon name="circle-check" size={14} /> Nenhuma branch sobrando.</div> : (
        <>
          <div className="gt-mt__list">
            {merged.map((b) => (
              <div key={b.name} className="gt-mt__row">
                <Checkbox checked={!b.worktree && pick.has(b.name)} disabled={!!b.worktree} onChange={() => setPick((s) => { const n = new Set(s); n.has(b.name) ? n.delete(b.name) : n.add(b.name); return n; })} label={<b className="gt-mono">{b.name}</b>} />
                <span className="gt-mt__main"><small>{b.subject} · {ago(b.time)}</small></span>
                {b.noOwnCommits && <span className="gt-tag is-merged" title={`Ainda não tem commits próprios: aponta para um commit que já está em ${data.base}. Mudanças não commitadas não contam.`}>sem commits próprios</span>}
                {b.worktree && b.worktreeDirty > 0 && <span className="gt-tag is-gone" title="O worktree desta branch tem mudanças não commitadas — elas não contam como mescladas.">{b.worktreeDirty} mudança{b.worktreeDirty === 1 ? '' : 's'} pendente{b.worktreeDirty === 1 ? '' : 's'}</span>}
                {b.worktree && <span className="gt-tag is-gone" title={`Aberta no worktree ${b.worktree}. Remova o worktree (seção Worktrees) para poder excluí-la.`}>em uso por worktree</span>}
              </div>
            ))}
          </div>
          <OpButton op={{ op: 'branch.deleteMany', names: names.length ? names : ['x'] }} run={() => names.length && run({ op: 'branch.deleteMany', names })} disabled={!names.length} icon="trash-2" variant="accent" size="md">
            Excluir {names.length} selecionada{names.length === 1 ? '' : 's'}
          </OpButton>
        </>
      )}
    </section>
  );
}

function Untracked({ repo, run }) {
  const { data: list } = useRepoData(repo, (r) => gitApi().cleanPreview(r));
  const [pick, setPick] = React.useState(() => new Set());
  const key = list ? list.join('\n') : '';
  // Recargas (o watcher recarrega sozinho) mantêm a seleção, menos o que não existe mais.
  React.useEffect(() => { if (list) setPick((s) => new Set([...s].filter((p) => list.includes(p)))); }, [key]);
  const paths = list ? list.filter((p) => pick.has(p)) : [];
  return (
    <section className="gt-card">
      <h3><Icon name="file-x" size={14} /> Arquivos e pastas não versionados</h3>
      <p className="gt-hint">O que um <code>git clean</code> apagaria (os ignorados pelo .gitignore ficam de fora). Escolha o que apagar — o Devkit guarda uma cópia antes. Pastas com outro repositório dentro aparecem como pasta.</p>
      {!list ? <div className="gt-msg"><Spinner size={14} /></div> : !list.length ? <div className="gt-msg"><Icon name="circle-check" size={14} /> Nada sobrando.</div> : (
        <>
          <div className="gt-mt__list">
            {list.map((p) => (
              <div key={p} className="gt-mt__row">
                <Checkbox checked={pick.has(p)} onChange={() => setPick((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; })} label={<FilePath path={p} />} />
              </div>
            ))}
          </div>
          <OpButton op={{ op: 'cleanFiles', paths: paths.length ? paths : ['x'] }} run={() => paths.length && run({ op: 'cleanFiles', paths })} disabled={!paths.length} icon="trash-2" variant="danger" size="md">
            Apagar {paths.length} selecionado{paths.length === 1 ? '' : 's'}
          </OpButton>
        </>
      )}
    </section>
  );
}

function Gitignore({ repo, run }) {
  const { data: text } = useRepoData(repo, (r) => gitApi().gitignore(r));
  const [pattern, setPattern] = React.useState('');
  const add = () => pattern.trim() && run({ op: 'ignore.add', pattern }).then((ok) => ok && setPattern(''));
  return (
    <section className="gt-card">
      <h3><Icon name="eye-off" size={14} /> .gitignore</h3>
      <p className="gt-hint">Padrões do que o git não deve acompanhar: <code>*.log</code> (extensão), <code>build/</code> (pasta em qualquer lugar), <code>/config.local.json</code> (só na raiz). Também dá para ignorar direto pela lista de Mudanças.</p>
      <form className="gt-mt__form" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="ex.: *.log, .env, /.claude/" aria-label="Padrão" className="is-wide" />
        <OpButton op={{ op: 'ignore.add', pattern: pattern || 'x' }} run={add} disabled={!pattern.trim()} icon="plus" variant="accent" size="md">Acrescentar</OpButton>
      </form>
      {text == null ? <div className="gt-msg"><Spinner size={14} /></div> : <pre className="gt-mt__ignore tk-scroll">{text || '(ainda não existe — o primeiro padrão cria o arquivo)'}</pre>}
    </section>
  );
}

/** Worktrees: cópias de trabalho extras do repositório (o Claude Code cria em .claude/worktrees). */
function Worktrees({ repo, run }) {
  const { data: list } = useRepoData(repo, (r) => gitApi().worktrees(r));
  if (!list || !list.length) return null;
  const missing = list.some((w) => !w.exists || w.prunable);
  return (
    <section className="gt-card">
      <h3><Icon name="folder-tree" size={14} /> Worktrees <span className="gt-files__n">{list.length}</span></h3>
      <p className="gt-hint">Outras pastas de trabalho deste repositório, cada uma com uma branch aberta (o Claude Code cria em <code>.claude/worktrees</code>). Enquanto um worktree existe, a branch dele não pode ser excluída nem aberta aqui. Remover apaga só a pasta — commits e branch continuam.</p>
      <div className="gt-mt__list">
        {list.map((w) => (
          <div key={w.path} className="gt-mt__row">
            <Icon name="folder-git-2" size={14} />
            <span className="gt-mt__main">
              <b>{w.name}{w.branch ? <span className="gt-mono"> · {w.branch}</span> : ' · HEAD solto'}</b>
              <small>{w.path}{!w.exists ? ' · a pasta não existe mais' : w.dirty ? ` · ${w.dirty} mudança(s) não commitada(s)` : ' · sem mudanças'}{w.locked ? ' · travado' : ''}</small>
            </span>
            {w.exists && (w.dirty > 0
              ? <OpButton op={{ op: 'worktree.removeForce', path: w.path }} run={run} disabled={w.locked} icon="trash-2" variant="danger">Remover mesmo assim</OpButton>
              : <OpButton op={{ op: 'worktree.remove', path: w.path }} run={run} disabled={w.locked} icon="trash-2" variant="danger">Remover</OpButton>)}
          </div>
        ))}
      </div>
      {missing && <OpButton op={{ op: 'worktree.prune' }} run={run} icon="eraser">Esquecer worktrees cuja pasta sumiu</OpButton>}
    </section>
  );
}

export function Maintenance({ repo, status, run }) {
  if (status.unborn) return <div className="gt-msg">Faça o primeiro commit para usar a manutenção.</div>;
  return (
    <div className="gt-maint tk-scroll">
      <Tags repo={repo} run={run} />
      <MergedBranches repo={repo} run={run} />
      <Worktrees repo={repo} run={run} />
      <Untracked repo={repo} run={run} />
      <Gitignore repo={repo} run={run} />
    </div>
  );
}
