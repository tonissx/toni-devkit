// Git — Mudanças: o que está preparado (stage), o que não está, arquivos novos e conflitos; diff do arquivo escolhido
// com botões por trecho; e a caixa de commit (com "corrigir o último commit").
import { DS, isMod } from '../../lib/ds.js';
import { gitApi, useRepoData, FilePath, KindBadge, OpButton, preview, RiskBadge } from './shared.jsx';
import { GitDiff } from './GitDiff.jsx';
import { ConflictEditor } from './Conflicts.jsx';
import { suggestions } from '../../git/ignore.js';

const { Icon, Spinner, Checkbox } = DS;

/** Menu "Ignorar…": padrões sugeridos para o .gitignore a partir do caminho. */
function IgnoreMenu({ path, run, onClose }) {
  React.useEffect(() => {
    const h = (e) => { if (!e.target.closest('.gt-ignore')) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="gt-ignore" role="menu" onClick={(e) => e.stopPropagation()}>
      <div className="gt-ignore__head">Acrescentar ao .gitignore</div>
      {suggestions(path).map((s) => (
        <button type="button" key={s.pattern} role="menuitem" className="gt-ignore__item" onClick={() => { onClose(); run({ op: 'ignore.add', pattern: s.pattern }); }}>
          <code>{s.pattern}</code><span>{s.label}</span>
        </button>
      ))}
    </div>
  );
}

function FileRow({ f, area, selected, onSelect, run, unborn }) {
  const p = [f.path];
  const [ignoring, setIgnoring] = React.useState(false);
  return (
    <div className={'gt-file' + (selected ? ' is-sel' : '')} onClick={() => onSelect({ area, path: f.path })} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect({ area, path: f.path }); }}>
      <KindBadge kind={area === 'untracked' ? f.kind : area === 'conflicts' ? 'conflict' : f.kind} />
      <FilePath path={f.path} />
      {f.orig && <span className="gt-file__orig" title={'Antes: ' + f.orig}>← {f.orig.split('/').pop()}</span>}
      <span className="gt-file__actions">
        {area === 'unstaged' && <OpButton op={{ op: 'discard', paths: p }} run={run} icon="undo-2" variant="danger" />}
        {area === 'untracked' && <button type="button" className={'gt-op is-ghost is-sm' + (ignoring ? ' is-on' : '')} title="Ignorar (.gitignore)" onClick={(e) => { e.stopPropagation(); setIgnoring((v) => !v); }}><Icon name="eye-off" size={13} /></button>}
        {area === 'untracked' && f.kind !== 'nested' && <OpButton op={{ op: 'removeUntracked', paths: p }} run={run} icon="trash-2" variant="danger" />}
        {(area === 'unstaged' || (area === 'untracked' && f.kind !== 'nested')) && <OpButton op={{ op: 'stage', paths: p }} run={run} icon="plus" variant="accent" />}
        {area === 'staged' && <OpButton op={{ op: 'unstage', paths: p }} run={run} icon="minus" ctx={{ unborn }} />}
        {area === 'conflicts' && <OpButton op={{ op: 'stage', paths: p }} run={run} icon="check">Resolvido</OpButton>}
      </span>
      {ignoring && <IgnoreMenu path={f.path} run={run} onClose={() => setIgnoring(false)} />}
    </div>
  );
}

function Section({ title, hint, files, area, actions, sel, ...rest }) {
  if (!files.length) return null;
  return (
    <section className={'gt-files is-' + area}>
      <header className="gt-files__head">
        <span className="gt-files__title" title={hint}>{title}</span>
        <span className="gt-files__n">{files.length}</span>
        <span className="gt-files__actions">{actions}</span>
      </header>
      {files.map((f) => <FileRow key={area + f.path} f={f} area={area} selected={!!sel && sel.area === area && sel.path === f.path} {...rest} />)}
    </section>
  );
}

function CommitBox({ status, run, repo, focus }) {
  const [msg, setMsg] = React.useState(() => { try { return localStorage.getItem('tk.git.draft:' + repo) || ''; } catch { return ''; } });
  const [amend, setAmend] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { try { localStorage.setItem('tk.git.draft:' + repo, msg); } catch { /* ignore */ } }, [msg, repo]);
  const subject = msg.split('\n')[0];
  const canCommit = (status.staged.length > 0 || amend) && msg.trim() && !status.conflicts.length;
  const p = preview({ op: 'commit', message: msg || 'x', amend });
  const go = async () => {
    if (!canCommit || busy) return;
    setBusy(true);
    const ok = await run({ op: 'commit', message: msg, amend });
    setBusy(false);
    if (ok) { setMsg(''); setAmend(false); }
  };
  // Amend: traz a mensagem do último commit para editar.
  const toggleAmend = async (on, force) => {
    setAmend(on);
    if (on && (force || !msg.trim())) {
      try { const [c] = await gitApi().log(repo, { limit: 1, ref: 'HEAD' }); if (c) { const d = await gitApi().commit(repo, c.hash); setMsg(d.message); } } catch { /* sem commit */ }
    }
  };
  // Receita "mudar a mensagem do último commit": chega com { amend: true }.
  React.useEffect(() => { if (focus && focus.amend && !status.unborn) toggleAmend(true, true); }, [focus && focus.nonce]);
  return (
    <div className="gt-commit">
      <textarea className="gt-commit__msg" value={msg} onChange={(e) => setMsg(e.target.value)} rows={3}
        placeholder={'Mensagem do commit — o que mudou e por quê\n(1ª linha curta; detalhes depois de uma linha em branco)'}
        onKeyDown={(e) => { if (isMod(e) && e.key === 'Enter') { e.preventDefault(); go(); } }} aria-label="Mensagem do commit" />
      <div className="gt-commit__bar">
        <span className={'gt-commit__count' + (subject.length > 72 ? ' is-long' : subject.length > 50 ? ' is-warn' : '')} title="A 1ª linha fica melhor com até 50 caracteres (máximo 72)">{subject.length}/50</span>
        {!status.unborn && <Checkbox label="Corrigir o último commit (amend)" checked={amend} onChange={toggleAmend} />}
        <span className="gt-commit__spacer" />
        {amend && <RiskBadge risk="rewrite" />}
        <button type="button" className="gt-op is-primary is-md" disabled={!canCommit || busy} onClick={go}
          title={status.conflicts.length ? 'Resolva os conflitos antes' : !status.staged.length && !amend ? 'Prepare (stage) algum arquivo primeiro' : `${p.display}\nCtrl+Enter`}>
          {busy ? <Spinner size={13} /> : <Icon name="git-commit-horizontal" size={14} />}
          <span>{amend ? 'Corrigir commit' : status.staged.length ? `Commit de ${status.staged.length} arquivo${status.staged.length === 1 ? '' : 's'}` : 'Commit'}</span>
        </button>
      </div>
    </div>
  );
}

export function Changes({ repo, status, run, focus }) {
  const [sel, setSel] = React.useState(null); // { area, path }
  const s = status;
  // Caminho terminado em "/" = pasta com outro repositório dentro (ex.: worktree): não dá para preparar nem excluir daqui.
  const untracked = React.useMemo(() => s.untracked.map((p) => ({ path: p, kind: p.endsWith('/') ? 'nested' : 'untracked' })), [s.untracked]);
  const all = { staged: s.staged, unstaged: s.unstaged, untracked, conflicts: s.conflicts };
  // Seleção some (arquivo commitado/descartado)? Vai para o próximo disponível.
  React.useEffect(() => {
    if (sel && all[sel.area] && all[sel.area].some((f) => f.path === sel.path)) return;
    const first = ['conflicts', 'unstaged', 'untracked', 'staged'].map((a) => all[a][0] && { area: a, path: all[a][0].path }).find(Boolean);
    setSel(first || null);
  }, [s]);
  const diff = useRepoData(repo, (r) => (sel && sel.area !== 'conflicts' ? gitApi().diff(r, { area: sel.area, path: sel.path }) : null), [sel && sel.area, sel && sel.path, s]);
  const total = s.staged.length + s.unstaged.length + untracked.length + s.conflicts.length;

  return (
    <div className="gt-changes">
      <div className="gt-changes__side">
        <div className="gt-changes__lists tk-scroll">
          {total === 0 && <div className="gt-clean"><Icon name="circle-check" size={28} /><b>Tudo commitado</b><span>Nenhuma mudança pendente na branch {s.branch.head || 'atual'}.</span></div>}
          {['conflicts', 'staged', 'unstaged', 'untracked'].map((area) => (
            <Section key={area} area={area} files={all[area]} sel={sel} onSelect={setSel} run={run} unborn={s.unborn}
              title={{ conflicts: 'Em conflito', staged: 'Preparadas para o commit', unstaged: 'Modificadas', untracked: 'Novas (fora do git)' }[area]}
              hint={{ conflicts: 'Arquivos com conflito: edite, resolva e marque como resolvido', staged: 'Área de preparação (stage): o que entra no próximo commit', unstaged: 'Mudanças que ainda não vão para o commit', untracked: 'Arquivos que o git ainda não acompanha' }[area]}
              actions={area === 'staged' ? <OpButton op={{ op: 'unstageAll' }} ctx={{ unborn: s.unborn }} run={run} icon="minus">Tirar tudo</OpButton>
                : area === 'unstaged' || area === 'untracked' ? <OpButton op={{ op: 'stage', paths: all[area].filter((f) => f.kind !== 'nested').map((f) => f.path) }} disabled={!all[area].some((f) => f.kind !== 'nested')} run={run} icon="plus" variant="accent">Preparar todos</OpButton> : null}
            />
          ))}
        </div>
        <CommitBox status={s} run={run} repo={repo} focus={focus} />
      </div>
      <div className="gt-changes__diff tk-scroll">
        {sel && sel.area === 'conflicts' ? <ConflictEditor repo={repo} path={sel.path} operation={s.operation} run={run} /> : sel ? (
          <>
            <div className="gt-diffhead"><FilePath path={sel.path} /><span className="gt-diffhead__area">{sel.path.endsWith('/') ? 'outro repositório' : { staged: 'preparado', unstaged: 'não preparado', untracked: 'arquivo novo', conflicts: 'em conflito' }[sel.area]}</span></div>
            {diff.data && diff.data.nested ? (
              <div className="gt-nested">
                <p><b>Esta pasta tem outro repositório git dentro</b> — por exemplo um <i>worktree</i> (como os que o Claude Code cria em <code>.claude/worktrees</code>), um clone ou um submódulo não registrado. O git não olha o conteúdo dela; por isso não há diff.</p>
                <p>Normalmente o certo é <b>ignorá-la</b>: acrescente <code>{sel.path}</code> (ou a pasta-mãe) ao <code>.gitignore</code>. Preparar a pasta a registraria como um repositório embutido, o que quase nunca é o que se quer.</p>
              </div>
            ) : diff.data ? <GitDiff patch={diff.data.patch} truncated={diff.data.truncated} mode={sel.area === 'conflicts' ? 'readonly' : sel.area} run={run} />
              : diff.error ? <div className="gt-msg is-error">{diff.error}</div> : <div className="gt-msg"><Spinner size={14} /> Carregando o diff…</div>}
          </>
        ) : <div className="gt-msg">Escolha um arquivo para ver o que mudou.</div>}
      </div>
    </div>
  );
}
