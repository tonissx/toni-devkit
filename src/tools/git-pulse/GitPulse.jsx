import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { emit } from '../../lib/events.js';
import { statusLabel, formatRelativeTime, formatCounts } from './format.js';

const { PageHeader, Button, EmptyState, Alert, Card, LabelValue, DataTable, Badge, DiffViewer } = DS;

const REFRESH_THROTTLE_MS = 4000;

function CommitRow({ commit }) {
  return (
    <div className="gtp__commit">
      <span className="gtp__commit-hash tk-mono">{commit.shortHash}</span>
      <span className="gtp__commit-subject">{commit.subject}</span>
      <span className="gtp__commit-meta">{commit.author} · {formatRelativeTime(commit.date)}</span>
    </div>
  );
}

export function GitPulse({ toast }) {
  const [repo, setRepo] = usePersisted('gitpulse.repo', { path: null });
  const [detect, setDetect] = React.useState(null);
  const [status, setStatus] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [statusError, setStatusError] = React.useState(null);
  const [selected, setSelected] = React.useState(null);
  const [diff, setDiff] = React.useState(null);
  const [diffLoading, setDiffLoading] = React.useState(false);
  const [diffError, setDiffError] = React.useState(null);
  const lastRefresh = React.useRef(0);
  const busy = React.useRef(false);

  const load = React.useCallback(async (showSpinner) => {
    if (!repo.path || busy.current) return;
    busy.current = true;
    if (showSpinner) setLoading(true);
    setStatusError(null);
    try {
      const d = await window.devkit.git.detect(repo.path);
      setDetect(d);
      if (d.isRepo) setStatus(await window.devkit.git.status(d.root));
      else setStatus(null);
    } catch (e) {
      setStatusError(String((e && e.message) || e));
      setStatus(null);
    } finally {
      lastRefresh.current = Date.now();
      busy.current = false;
      setLoading(false);
    }
  }, [repo.path]);

  React.useEffect(() => { load(true); }, [load]);

  // Refresh ao focar a janela — throttled, e só quando já há uma pasta escolhida.
  React.useEffect(() => {
    const onFocus = () => {
      if (!repo.path || Date.now() - lastRefresh.current < REFRESH_THROTTLE_MS) return;
      load(false);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [repo.path, load]);

  // Trocou de repo: descarta a seleção de arquivo/diff anteriores (um "Atualizar" comum não mexe
  // na seleção — só o conteúdo do diff fica potencialmente desatualizado até o usuário clicar de novo).
  React.useEffect(() => { setSelected(null); setDiff(null); setDiffError(null); }, [repo.path]);

  const pickFolder = async () => {
    try {
      const r = await window.devkit.git.pickRepo();
      if (r) setRepo({ path: r.path });
    } catch (e) { toast('Erro ao escolher pasta', String((e && e.message) || e), 'error'); }
  };

  const refresh = async () => {
    await load(true);
    emit('tool.used', { tool: 'git-pulse' });
  };

  const openFile = async (file) => {
    setSelected(file.path);
    setDiff(null);
    setDiffError(null);
    setDiffLoading(true);
    try {
      setDiff(await window.devkit.git.fileDiff(detect.root, file.path));
    } catch (e) {
      setDiffError(String((e && e.message) || e));
    } finally {
      setDiffLoading(false);
    }
  };

  const actions = (
    <>
      {repo.path && (
        <Button variant="ghost" icon="folder-open" onClick={pickFolder}>Trocar pasta</Button>
      )}
      {status && (
        <Button variant="secondary" icon="refresh-cw" disabled={loading} onClick={refresh}>Atualizar</Button>
      )}
    </>
  );

  let body;
  if (!repo.path) {
    body = (
      <div className="gtp__center">
        <EmptyState
          title="Escolha uma pasta"
          description="Aponte para um repositório local — o Git Pulse lê o status, o branch e os commits, tudo local."
          action={<Button variant="primary" icon="folder-open" onClick={pickFolder}>Escolher pasta</Button>}
        />
      </div>
    );
  } else if (loading && !status && !statusError) {
    body = <div className="gtp__center"><EmptyState title="Carregando repositório…" animate="sequence" compact /></div>;
  } else if (statusError) {
    body = (
      <div className="gtp__center">
        <Alert variant="error" title="Erro ao ler o repositório" mono action={<Button variant="secondary" size="sm" onClick={() => load(true)}>Tentar de novo</Button>}>
          {statusError}
        </Alert>
      </div>
    );
  } else if (detect && !detect.gitAvailable) {
    body = (
      <div className="gtp__center">
        <EmptyState
          title="Git não encontrado"
          description="Instale o git e garanta que ele está no PATH do sistema para usar o Git Pulse."
          action={<Button variant="secondary" icon="folder-open" onClick={pickFolder}>Escolher outra pasta</Button>}
        />
      </div>
    );
  } else if (detect && !detect.isRepo) {
    body = (
      <div className="gtp__center">
        <EmptyState
          title="Não é um repositório git"
          description={repo.path + ' não é (nem está dentro de) um repositório git.'}
          action={<Button variant="secondary" icon="folder-open" onClick={pickFolder}>Escolher outra pasta</Button>}
        />
      </div>
    );
  } else if (status) {
    const stats = [
      { label: 'Branch', value: status.detached ? 'HEAD destacado' : (status.branch || '—') },
      { label: 'Arquivos alterados', value: String(status.totals.filesChanged) },
      { label: 'Alterações', value: formatCounts(status.totals.insertions, status.totals.deletions) },
    ];
    if (status.hasUpstream) stats.push({ label: 'Ahead / behind', value: `↑ ${status.ahead} / ↓ ${status.behind}` });

    const columns = [
      { key: 'kind', label: 'Status', width: 120, render: (v) => {
        const st = statusLabel(v);
        return <Badge variant={st.tone} size="sm" dot>{st.label}</Badge>;
      } },
      { key: 'path', label: 'Arquivo', mono: true, render: (v, r) => (r.origPath ? `${r.origPath} → ${v}` : v) },
      { key: 'insertions', label: 'Alterações', width: 110, align: 'right', mono: true, render: (_v, r) => formatCounts(r.insertions, r.deletions) },
    ];

    let diffPanel = null;
    if (selected) {
      let diffBody;
      if (diffLoading) diffBody = <div className="gtp__center"><EmptyState compact animate="sequence" title="Carregando diff…" /></div>;
      else if (diffError) diffBody = <Alert variant="error" mono title="Erro ao ler o arquivo">{diffError}</Alert>;
      else if (diff && diff.binary) diffBody = <Alert variant="info" title="Arquivo binário">Não é possível mostrar o diff de um arquivo binário.</Alert>;
      else if (diff) diffBody = <DiffViewer before={diff.before} after={diff.after} mode="unified" showStats height={360} />;
      diffPanel = <Card title={selected} icon="file-diff" className="gtp__diff">{diffBody}</Card>;
    }

    body = (
      <>
        <LabelValue items={stats} columns={stats.length} className="gtp__stats" />
        <div className="gtp__grid">
          <Card title="Commits recentes" icon="history" className="gtp__commits">
            {status.hasCommits ? (
              status.recentCommits.length
                ? status.recentCommits.map((c) => <CommitRow key={c.hash} commit={c} />)
                : <div className="gtp__empty-hint">Nenhum commit retornado.</div>
            ) : (
              <div className="gtp__empty-hint">Ainda não há commits neste repositório.</div>
            )}
          </Card>
          <Card title="Arquivos alterados" icon="list" className="gtp__files">
            {status.totals.filesChanged
              ? <DataTable columns={columns} rows={status.files} rowKey="path" onRowClick={openFile} activeRow={selected} empty="Nenhum arquivo alterado" maxHeight={320} />
              : <div className="gtp__empty-hint">Working tree limpa — nada para mostrar.</div>}
          </Card>
        </div>
        {diffPanel}
      </>
    );
  }

  return (
    <div className="sqlf gtp">
      <PageHeader
        icon="git-branch"
        title={status ? status.repoName : 'Git Pulse'}
        subtitle={status ? repo.path : 'Status local do repositório — branch, mudanças e commits, 100% local'}
        actions={actions}
      />
      <div className="sqlf__body gtp__body">{body}</div>
    </div>
  );
}
