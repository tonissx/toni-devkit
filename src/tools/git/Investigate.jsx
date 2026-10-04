// Git — Investigar: quem mudou cada linha (blame), quando um texto apareceu ou sumiu (git log -S/-G), o histórico de
// um arquivo, e o bisect guiado para achar o commit que introduziu um bug.
import { DS } from '../../lib/ds.js';
import { normalize } from '../../commands/search.js';
import { gitApi, useRepoData, ago, fullDate, short, FilePath, OpButton, laneColor } from './shared.jsx';
import { GitDiff } from './GitDiff.jsx';

const { Icon, Spinner, SegmentedControl, Checkbox } = DS;

const MODES = [
  { value: 'blame', label: 'Quem mudou cada linha' },
  { value: 'search', label: 'Quando um texto apareceu' },
  { value: 'file', label: 'Histórico de um arquivo' },
  { value: 'bisect', label: 'Achar o commit de um bug' },
];

/** Escolher um arquivo do repositório (os versionados em HEAD), filtrando por texto. */
function FilePicker({ repo, value, onPick }) {
  const { data: files } = useRepoData(repo, (r) => gitApi().files(r, 'HEAD'));
  const [q, setQ] = React.useState('');
  const nq = normalize(q);
  const shown = files ? files.filter((f) => !nq || normalize(f).includes(nq)).slice(0, 300) : [];
  return (
    <div className="gt-picker">
      <label className="gt-search is-wide"><Icon name="file-search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Digite parte do caminho do arquivo" /></label>
      <div className="gt-picker__list tk-scroll">
        {!files && <div className="gt-msg"><Spinner size={14} /></div>}
        {shown.map((f) => <button type="button" key={f} className={'gt-picker__item' + (f === value ? ' is-sel' : '')} onClick={() => onPick(f)}><FilePath path={f} /></button>)}
        {files && !shown.length && <div className="gt-msg">Nenhum arquivo com esse nome.</div>}
      </div>
    </div>
  );
}

function Blame({ repo, go }) {
  const [file, setFile] = React.useState(null);
  const { data: b, error } = useRepoData(repo, (r) => (file ? gitApi().blame(r, file) : null), [file]);
  // Cor por commit (estável na sessão): ajuda a ver as "faixas" de cada mudança.
  const colorOf = React.useMemo(() => { const m = new Map(); return (h) => { if (!m.has(h)) m.set(h, m.size); return laneColor(m.get(h)); }; }, [b]);
  return (
    <div className="gt-inv">
      <aside className="gt-inv__side"><FilePicker repo={repo} value={file} onPick={setFile} /></aside>
      <section className="gt-inv__main tk-scroll">
        {!file && <div className="gt-msg"><Icon name="info" size={14} /> Escolha um arquivo para ver quem escreveu cada linha e em qual commit.</div>}
        {error && <div className="gt-msg is-error">{error}</div>}
        {file && !b && !error && <div className="gt-msg"><Spinner size={14} /> Lendo o histórico do arquivo…</div>}
        {b && (
          <div className="gt-blame">
            <div className="gt-diffhead"><FilePath path={file} /><span className="gt-diffhead__area">{b.lines.length} linhas · {Object.keys(b.commits).length} commits{b.truncated ? ' · cortado em 6000 linhas' : ''}</span></div>
            {b.groups.map((g) => {
              const c = b.commits[g.hash];
              return (
                <div key={g.start} className="gt-blame__group" style={{ '--c': colorOf(g.hash) }}>
                  <button type="button" className="gt-blame__who" onClick={() => go('history', { hash: g.hash })} title={`${c.summary}\n${c.author} · ${fullDate(c.time)}\nClique para ver o commit`}>
                    <span className="gt-blame__sum">{c.summary}</span>
                    <span className="gt-blame__meta">{c.author} · {ago(c.time)} · <code>{short(g.hash)}</code></span>
                  </button>
                  <div className="gt-blame__code">
                    {b.lines.filter((l) => l.n >= g.start && l.n <= g.end).map((l) => (
                      <div key={l.n} className="gt-blame__line"><span className="gt-dl__n">{l.n}</span><span className="gt-dl__text">{l.text || ' '}</span></div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Search({ repo, go }) {
  const [q, setQ] = React.useState('');
  const [regex, setRegex] = React.useState(false);
  const [query, setQuery] = React.useState(null);
  const { data: hits, error, loading } = useRepoData(repo, (r) => (query ? gitApi().searchText(r, query.text, { regex: query.regex }) : null), [query && query.text, query && query.regex]);
  return (
    <div className="gt-inv is-single tk-scroll">
      <form className="gt-inv__form" onSubmit={(e) => { e.preventDefault(); if (q.trim()) setQuery({ text: q, regex }); }}>
        <label className="gt-search is-wide"><Icon name="search" size={14} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Texto do código (ex.: validateForm, CODCOLIGADA = 1, TODO)" /></label>
        <Checkbox label="Expressão regular" checked={regex} onChange={setRegex} />
        <button type="submit" className="gt-op is-primary is-md" disabled={!q.trim()}><Icon name="search" size={14} /><span>Procurar no histórico</span></button>
      </form>
      <p className="gt-hint gt-inv__help">
        {regex ? <>Commits cujo diff tem uma linha que casa com a expressão (<code>git log -G</code>).</>
          : <>Commits em que o texto <b>apareceu ou sumiu</b> — a quantidade de ocorrências mudou (<code>git log -S</code>). Bom para "quem removeu aquela validação?".</>}
      </p>
      {error && <div className="gt-msg is-error">{error}</div>}
      {loading && query && <div className="gt-msg"><Spinner size={14} /> Procurando em todo o histórico…</div>}
      {hits && !loading && (
        <div className="gt-hits">
          <div className="gt-files__head"><span className="gt-files__title">Commits encontrados</span><span className="gt-files__n">{hits.length}</span></div>
          {!hits.length && <div className="gt-msg">Nenhum commit mudou esse texto.</div>}
          {hits.map((c) => (
            <button type="button" key={c.hash} className="gt-hit" onClick={() => go('history', { hash: c.hash })}>
              <span className="gt-hit__subject"><code>{short(c.hash)}</code> {c.subject}</span>
              <span className="gt-hit__meta">{c.author} · {ago(c.time)}</span>
              <span className="gt-hit__files">{c.files.slice(0, 6).map((f) => <span key={f} className="gt-hit__file">{f}</span>)}{c.files.length > 6 ? ` +${c.files.length - 6}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FileHistory({ repo, go }) {
  const [file, setFile] = React.useState(null);
  const [sel, setSel] = React.useState(null);
  const { data: commits } = useRepoData(repo, (r) => (file ? gitApi().log(r, { file, ref: 'HEAD', limit: 300 }) : null), [file]);
  React.useEffect(() => setSel(commits && commits[0] ? commits[0].hash : null), [commits]);
  // --follow: o nome pode ter mudado no passado; o diff de um commit antigo usa o caminho daquela época (sem filtro).
  const diff = useRepoData(repo, (r) => (sel ? gitApi().diff(r, { area: 'commit', hash: sel, path: file }) : null), [sel, file]);
  return (
    <div className="gt-inv">
      <aside className="gt-inv__side"><FilePicker repo={repo} value={file} onPick={(f) => { setFile(f); setSel(null); }} /></aside>
      <section className="gt-inv__main tk-scroll">
        {!file && <div className="gt-msg"><Icon name="info" size={14} /> Escolha um arquivo para ver todas as versões dele (segue renomeações).</div>}
        {file && !commits && <div className="gt-msg"><Spinner size={14} /></div>}
        {commits && (
          <>
            <div className="gt-diffhead"><FilePath path={file} /><span className="gt-diffhead__area">{commits.length} versões</span></div>
            <div className="gt-fh">
              <div className="gt-fh__list">
                {commits.map((c) => (
                  <button type="button" key={c.hash} className={'gt-fh__item' + (c.hash === sel ? ' is-sel' : '')} onClick={() => setSel(c.hash)}>
                    <span className="gt-fh__subject">{c.subject}</span>
                    <span className="gt-fh__meta">{c.author} · {ago(c.time)} · <code>{short(c.hash)}</code></span>
                  </button>
                ))}
              </div>
              <div className="gt-fh__diff">
                {sel && <div className="gt-fh__actions"><button type="button" className="gt-op is-ghost is-sm" onClick={() => go('history', { hash: sel })}><Icon name="git-commit-horizontal" size={13} /><span>Ver o commit inteiro</span></button></div>}
                {diff.data ? <GitDiff patch={diff.data.patch} truncated={diff.data.truncated} empty="Neste commit o arquivo tinha outro nome — veja o commit inteiro." /> : sel && <div className="gt-msg"><Spinner size={14} /></div>}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function Bisect({ repo, status, run, go }) {
  const { data: st, error } = useRepoData(repo, (r) => gitApi().bisectState(r), [status.operation, status.branch.oid]);
  const { data: log } = useRepoData(repo, (r) => gitApi().log(r, { ref: 'HEAD', limit: 60 }), []);
  const { data: tags } = useRepoData(repo, (r) => gitApi().tags(r));
  const [good, setGood] = React.useState('');
  const dirty = status.staged.length + status.unstaged.length > 0;
  if (error) return <div className="gt-msg is-error">{error}</div>;
  if (!st) return <div className="gt-msg"><Spinner size={14} /></div>;

  if (st.active && st.found) {
    return (
      <div className="gt-inv is-single tk-scroll">
        <div className="gt-bisect is-found">
          <Icon name="target" size={28} />
          <div>
            <div className="gt-bisect__title">Achado! O problema começou neste commit:</div>
            <div className="gt-bisect__commit"><code>{short(st.found.hash)}</code> <b>{st.found.subject}</b> <span>{st.found.author} · {ago(st.found.time)}</span></div>
            <div className="gt-bisect__actions">
              <button type="button" className="gt-op is-accent is-md" onClick={() => go('history', { hash: st.found.hash })}><Icon name="eye" size={14} /><span>Ver o commit</span></button>
              <OpButton op={{ op: 'bisect.reset' }} run={run} icon="log-out" size="md">Encerrar e voltar para a branch</OpButton>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (st.active) {
    return (
      <div className="gt-inv is-single tk-scroll">
        <div className="gt-bisect">
          <div className="gt-bisect__progress">
            <span>Testando o commit <code>{short(st.current.hash)}</code> <b>{st.current.subject}</b></span>
            <span className="gt-hint">{st.candidates != null ? `${st.candidates} commit(s) suspeito(s) · ~${st.steps} passo(s) restante(s)` : ''} · {st.tested} já marcado(s)</span>
          </div>
          <p>O repositório está <b>neste commit agora</b> (os arquivos estão como eram nele). Rode o app ou os testes e diga como ficou:</p>
          <div className="gt-bisect__answers">
            <OpButton op={{ op: 'bisect.mark', verdict: 'good' }} run={run} icon="circle-check" variant="accent" size="md">Funciona</OpButton>
            <OpButton op={{ op: 'bisect.mark', verdict: 'bad' }} run={run} icon="circle-x" variant="danger" size="md">Está quebrado</OpButton>
            <OpButton op={{ op: 'bisect.mark', verdict: 'skip' }} run={run} icon="skip-forward" size="md">Não dá para testar (pular)</OpButton>
          </div>
          <OpButton op={{ op: 'bisect.reset' }} run={run} icon="x">Desistir e voltar para a branch</OpButton>
        </div>
      </div>
    );
  }
  const options = [...(tags || []).map((t) => ({ hash: t.name, label: `tag ${t.name}`, sub: t.subject })), ...(log || []).slice(1).map((c) => ({ hash: c.hash, label: short(c.hash), sub: c.subject, time: c.time }))];
  return (
    <div className="gt-inv is-single tk-scroll">
      <div className="gt-bisect">
        <p><b>Algo que funcionava parou de funcionar e você não sabe em qual commit?</b> O bisect resolve por eliminação: você diz uma versão que funcionava e o git vai te levando a commits no meio do caminho. Para cada um você testa e responde "funciona" ou "quebrado" — em poucos passos ele aponta o culpado (até em centenas de commits).</p>
        <ol className="gt-bisect__steps">
          <li><b>Versão quebrada:</b> a atual (<code>{short(status.branch.oid)}</code> {status.branch.head})</li>
          <li><b>Versão que funcionava:</b> escolha abaixo (um commit antigo ou uma tag)</li>
        </ol>
        {dirty && <div className="gt-verdict is-warn"><Icon name="triangle-alert" size={16} /><span>Você tem mudanças não commitadas. O bisect troca os arquivos de versão — guarde-as num stash antes.</span></div>}
        <div className="gt-bisect__pick tk-scroll">
          {options.map((o) => (
            <button type="button" key={o.hash} className={'gt-fh__item' + (good === o.hash ? ' is-sel' : '')} onClick={() => setGood(o.hash)}>
              <span className="gt-fh__subject"><code>{o.label}</code> {o.sub}</span>
              {o.time ? <span className="gt-fh__meta">{ago(o.time)}</span> : null}
            </button>
          ))}
        </div>
        <OpButton op={{ op: 'bisect.start', bad: 'HEAD', good: good || 'HEAD~1' }} run={run} disabled={!good || dirty} icon="play" variant="primary" size="md">Começar a caçar</OpButton>
      </div>
    </div>
  );
}

export function Investigate(props) {
  const [mode, setMode] = React.useState(props.status.operation === 'bisect' ? 'bisect' : 'blame');
  React.useEffect(() => { if (props.status.operation === 'bisect') setMode('bisect'); }, [props.status.operation]);
  if (props.status.unborn) return <div className="gt-msg">Ainda não há commits para investigar.</div>;
  return (
    <div className="gt-invest">
      <div className="gt-toolbar"><SegmentedControl size="sm" options={MODES} value={mode} onChange={setMode} /></div>
      {mode === 'blame' ? <Blame {...props} /> : mode === 'search' ? <Search {...props} /> : mode === 'file' ? <FileHistory {...props} /> : <Bisect {...props} />}
    </div>
  );
}
