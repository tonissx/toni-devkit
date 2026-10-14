// Git — Histórico: grafo de commits (raias coloridas pela paleta do tema), filtros por texto e autor, e o painel do
// commit escolhido (mensagem, arquivos, diff) com ações: criar branch aqui e voltar a branch para este ponto.
import { DS } from '../../lib/ds.js';
import { load, usePersisted } from '../../lib/store.js';
import { layoutGraph } from '../../git/graph.js';
import { sideWidth, SIDE_MIN, SIDE_MAX, SIDE_DEFAULT, SIDE_WIDE } from '../../git/panel.js';
import { validBranchName } from '../../git/ops.js';
import { gitApi, useRepoData, ago, fullDate, short, RefBadges, FilePath, laneColor, OpButton } from './shared.jsx';
import { GitDiff } from './GitDiff.jsx';
import { useAiMode, useAiTask, aiOn, AiButton, AiPanel } from '../../ai/ui.jsx';

const { Icon, Spinner } = DS;
const AVATAR = 11; // raio do círculo do avatar; com a borda de 2px o avatar mede 24px
const ROW = 38;   // altura de uma linha (igual ao height de .gt-row em git.css)
const LANE = AVATAR * 2 + 8;  // largura de uma raia: avatar de 24px + 6px de respiro entre vizinhos
const PAD = AVATAR + 5;       // margem do grafo: cabe o avatar e o halo do HEAD sem cortar na borda
const MAX_LANES = 14;
const PAGE = 300;

/** Iniciais do autor ("Antonio Gonçalves" -> "AG"). */
function initials(name) {
  const p = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/** Matiz estável por e-mail: o mesmo autor tem sempre a mesma cor, sem rede. */
function hue(key) {
  let n = 0;
  for (const ch of String(key || '')) n = (n * 31 + ch.codePointAt(0)) >>> 0;
  return n % 360;
}

/** Largura da coluna do grafo: as raias entre duas margens. */
const graphWidth = (layout) => (Math.min(MAX_LANES, Math.max(1, layout.width)) - 1) * LANE + PAD * 2;

const photoOf =(photos, c) => (photos && c.email ? photos[c.email.trim().toLowerCase()] : null);

/** O grafo inteiro num SVG só, atrás da coluna de raias. */
function Graph({ layout, commits, headHash, photos }) {
  const w = graphWidth(layout);
  const x = (c) => PAD + Math.min(c, MAX_LANES - 1) * LANE;
  const y = (r) => r * ROW + ROW / 2;
  const paths = [];
  layout.rows.forEach((row, r) => {
    for (const s of row.segments) {
      const x1 = x(s.x1), x2 = x(s.x2), y1 = y(r), y2 = y(r + 1);
      const d = x1 === x2 ? `M${x1},${y1}L${x2},${y2}` : `M${x1},${y1}C${x1},${y1 + ROW * 0.6} ${x2},${y2 - ROW * 0.6} ${x2},${y2}`;
      paths.push(<path key={r + ':' + paths.length} d={d} stroke={laneColor(s.color)} />);
    }
  });
  return (
    <svg className="gt-graph" width={w} height={commits.length * ROW} aria-hidden="true">
      <g className="gt-graph__lines">{paths}</g>
      {layout.rows.map((row, r) => {
        const merge = commits[r].parents.length > 1;
        const head = commits[r].hash === headHash;
        return (
          <g key={row.hash}>
            {head && <circle cx={x(row.col)} cy={y(r)} r={AVATAR + 3.5} className="gt-graph__halo" stroke={laneColor(row.color)} />}
            {merge
              ? <circle cx={x(row.col)} cy={y(r)} r={4.5} fill="var(--tk-surface-1)" stroke={laneColor(row.color)} strokeWidth={2} />
              : (
                <>
                  <circle cx={x(row.col)} cy={y(r)} r={AVATAR} fill={`hsl(${hue(commits[r].email || commits[r].author)} 45% 38%)`} stroke={laneColor(row.color)} strokeWidth={2} />
                  <text x={x(row.col)} y={y(r)} className="gt-graph__avatar-text">{initials(commits[r].author)}</text>
                  {photoOf(photos, commits[r]) && (
                    <>
                      <clipPath id={'gt-av-' + r}><circle cx={x(row.col)} cy={y(r)} r={AVATAR - 1} /></clipPath>
                      <image href={photoOf(photos, commits[r])} x={x(row.col) - AVATAR} y={y(r) - AVATAR} width={AVATAR * 2} height={AVATAR * 2} clipPath={`url(#gt-av-${r})`} preserveAspectRatio="xMidYMid slice" />
                    </>
                  )}
                </>
              )}
          </g>
        );
      })}
    </svg>
  );
}

/** O commit como nota (mensagem, arquivos e o diff, cortado se for enorme; e a explicação da IA, se houver). */
async function saveAsNote(repo, c, explanation) {
  const d = await gitApi().diff(repo, { area: 'commit', hash: c.hash });
  const patch = d.patch.length > 60000 ? d.patch.slice(0, 60000) + '\n… (diff cortado)' : d.patch;
  const repoName = repo.split(/[\\/]/).pop();
  const files = c.files.map((f) => `- \`${f.path}\` (+${f.added} −${f.deleted})`).join('\n');
  const explained = explanation ? `### Explicação (IA)\n${explanation}\n\n` : '';
  const content = `${c.message}\n\n**Commit** \`${c.hash}\` · ${c.author} · ${fullDate(c.time)} · repositório ${repoName}\n\n${explained}### Arquivos\n${files}\n\n### Diff\n\`\`\`diff\n${patch.replace(/\`\`\`/g, "'''")}\n\`\`\`\n`;
  return window.devkit.notes.create({ title: `Commit ${short(c.hash)}: ${c.message.split('\n')[0]}`.slice(0, 120), content, tags: ['git', repoName.toLowerCase().replace(/[^\w-]+/g, '-')], type: 'note', source: 'git' });
}

/** "Explicar este commit": o que mudou, por quê e o que observar — a partir da mensagem e do diff. */
function ExplainCommit({ repo, c, cfg }) {
  const ai = useAiTask('explainCommit', cfg);
  const go = () => ai.start(async () => ({ message: c.message, patch: (await gitApi().diff(repo, { area: 'commit', hash: c.hash })).patch }));
  const save = async () => { const n = await saveAsNote(repo, c, ai.st.text); window.devkit.notes.open({ id: n.id }); };
  return (
    <div className="gt-explain">
      {!ai.st && <AiButton ai={ai} label="Explicar este commit" onClick={go} />}
      <AiPanel ai={ai} actions={[{ label: 'Salvar como nota (com a explicação)', icon: 'notebook-pen', onClick: save }]} />
    </div>
  );
}

function CommitDetail({ repo, hash, run, onPick }) {
  const cfg = useAiMode();
  const { data: c, error } = useRepoData(repo, (r) => gitApi().commit(r, hash), [hash]);
  const [file, setFile] = React.useState(null);
  const [branch, setBranch] = React.useState('');
  const [advanced, setAdvanced] = React.useState(false);
  React.useEffect(() => { setFile(null); setBranch(''); }, [hash]);
  const diff = useRepoData(repo, (r) => (file ? gitApi().diff(r, { area: 'commit', hash, path: file }) : null), [hash, file]);
  if (error) return <div className="gt-msg is-error">{error}</div>;
  if (!c) return <div className="gt-msg"><Spinner size={14} /> Carregando o commit…</div>;
  const [subject, ...body] = c.message.split('\n');
  const totalAdd = c.files.reduce((n, f) => n + f.added, 0), totalDel = c.files.reduce((n, f) => n + f.deleted, 0);
  return (
    <div className="gt-detail">
      <div className="gt-detail__head">
        <div className="gt-detail__subject">{subject}</div>
        <RefBadges refs={c.refs} />
        {body.join('\n').trim() && <pre className="gt-detail__body">{body.join('\n').trim()}</pre>}
        <div className="gt-detail__meta">
          <span><Icon name="user" size={12} /> {c.author}</span>
          <span title={fullDate(c.time)}><Icon name="clock" size={12} /> {ago(c.time)}</span>
          <button type="button" className="gt-hash" title="Copiar o hash completo" onClick={() => window.devkit.clipboard.write(c.hash)}><Icon name="copy" size={11} /> {short(c.hash)}</button>
          {c.parents.length > 1 && <span className="gt-detail__merge" title="Commit de merge: junta duas linhas de história"><Icon name="git-merge" size={12} /> merge</span>}
          <button type="button" className="gt-hash" title="Cria uma nota com a mensagem, os arquivos e o diff deste commit" onClick={() => saveAsNote(repo, c).then((n) => window.devkit.notes.open({ id: n.id }))}><Icon name="notebook-pen" size={11} /> salvar como nota</button>
        </div>
        {aiOn(cfg) && <ExplainCommit key={c.hash} repo={repo} c={c} cfg={cfg} />}
        {c.parents.length > 0 && (
          <div className="gt-detail__parents">Pai{c.parents.length > 1 ? 's' : ''}: {c.parents.map((p) => <button type="button" key={p} className="gt-hash" onClick={() => onPick(p)}>{short(p)}</button>)}</div>
        )}
      </div>

      <div className="gt-detail__actions">
        <form className="gt-inline" onSubmit={(e) => { e.preventDefault(); if (validBranchName(branch)) run({ op: 'branch.create', name: branch, from: c.hash }).then((ok) => ok && setBranch('')); }}>
          <Icon name="git-branch-plus" size={13} />
          <input value={branch} onChange={(e) => setBranch(e.target.value.replace(/\s/g, '-'))} placeholder="nova-branch a partir daqui" aria-label="Nome da nova branch" />
          <OpButton op={{ op: 'branch.create', name: branch || 'x', from: c.hash }} run={() => validBranchName(branch) && run({ op: 'branch.create', name: branch, from: c.hash }).then((ok) => ok && setBranch(''))} disabled={!validBranchName(branch)}>Criar</OpButton>
        </form>
        {c.inHead
          ? <button type="button" className={'gt-op is-ghost is-sm' + (advanced ? ' is-on' : '')} onClick={() => setAdvanced((v) => !v)}><Icon name="history" size={13} /><span>Voltar a branch para cá…</span></button>
          : <OpButton op={{ op: 'cherry-pick', hashes: [c.hash] }} run={run} icon="cherry" variant="accent">Trazer para a branch atual</OpButton>}
      </div>
      {advanced && c.inHead && (
        <div className="gt-resetbox">
          <p>A branch atual passa a apontar para <code>{short(c.hash)}</code>. Os commits depois dele saem da branch (o Devkit guarda um ponto de volta). O que fazer com as mudanças deles?</p>
          <OpButton op={{ op: 'reset', to: c.hash, mode: 'soft' }} run={run} icon="package">Manter no stage (soft)</OpButton>
          <OpButton op={{ op: 'reset', to: c.hash, mode: 'mixed' }} run={run} icon="file-pen">Manter nos arquivos (mixed)</OpButton>
          <OpButton op={{ op: 'reset', to: c.hash, mode: 'hard' }} run={run} icon="trash-2" variant="danger">Jogar fora (hard)</OpButton>
        </div>
      )}

      <div className="gt-detail__files">
        <div className="gt-files__head"><span className="gt-files__title">Arquivos</span><span className="gt-files__n">{c.files.length}</span><span className="gt-stat"><b className="is-add">+{totalAdd}</b> <b className="is-del">−{totalDel}</b></span></div>
        {c.files.map((f) => (
          <div key={f.path} className={'gt-file' + (file === f.path ? ' is-sel' : '')} role="button" tabIndex={0} onClick={() => setFile(file === f.path ? null : f.path)}>
            <FilePath path={f.path} />
            {f.orig && <span className="gt-file__orig">← {f.orig.split('/').pop()}</span>}
            <span className="gt-stat">{f.binary ? 'binário' : <><b className="is-add">+{f.added}</b> <b className="is-del">−{f.deleted}</b></>}</span>
          </div>
        ))}
      </div>
      {file && (
        <div className="gt-fh__actions">
          <button type="button" className="gt-op is-ghost is-sm" title="Abre o antes e o depois deste arquivo no Diff Checker" onClick={async () => {
            const v = await gitApi().fileVersions(repo, hash, file);
            const name = file.split('/').pop();
            window.devkit.app.command({ type: 'go', route: 'diff', params: { left: v.before, right: v.after, leftFile: `${name} (antes de ${short(hash)})`, rightFile: `${name} (${short(hash)})` } });
          }}><Icon name="git-compare" size={13} /><span>Abrir no Diff Checker</span></button>
        </div>
      )}
      {file && (diff.data ? <GitDiff patch={diff.data.patch} truncated={diff.data.truncated} /> : <div className="gt-msg"><Spinner size={14} /> Carregando…</div>)}
    </div>
  );
}

export function History({ repo, status, run, focus }) {
  const [q, setQ] = React.useState('');
  const [author, setAuthor] = React.useState('');
  const [query, setQuery] = React.useState({ grep: '', author: '' });
  const [pages, setPages] = React.useState(1);
  const [sel, setSel] = React.useState(null);
  const { data: commits, error, loading } = useRepoData(repo, (r) => gitApi().log(r, { limit: PAGE * pages, grep: query.grep || undefined, author: query.author || undefined }), [query.grep, query.author, pages]);
  const layout = React.useMemo(() => layoutGraph(commits || []), [commits]);
  // Fotos do Gravatar (Configurações): lidas ao abrir a aba; quem não tem foto continua com as iniciais.
  const useGravatar = React.useMemo(() => !!load('prefs', {}).gitAvatars, []);
  const [photos, setPhotos] = React.useState({});
  React.useEffect(() => {
    if (!useGravatar || !commits) return undefined;
    const todo = [...new Set(commits.map((c) => (c.email || '').trim().toLowerCase()).filter((e) => e && !(e in photos)))];
    if (!todo.length) return undefined;
    let alive = true;
    gitApi().avatars(todo).then((got) => { if (alive) setPhotos((p) => ({ ...p, ...got })); }, () => {});
    return () => { alive = false; };
  }, [commits, useGravatar]);
  React.useEffect(() => { if (focus && focus.hash) setSel(focus.hash); }, [focus && focus.nonce]);
  React.useEffect(() => { if (!sel && commits && commits[0]) setSel(commits[0].hash); }, [commits]);
  const lanesW = graphWidth(layout);
  // Bandeja de detalhes: arrastar a borda esquerda define a largura (só grava ao soltar); duplo clique alterna padrão/expandida.
  const [prefs, setPrefs] = usePersisted('git.historySide', { w: SIDE_DEFAULT });
  const rootRef = React.useRef(null);
  const [live, setLive] = React.useState(null);
  const maxW = () => (rootRef.current ? rootRef.current.getBoundingClientRect().width * 0.7 : SIDE_MAX);
  const width = sideWidth(prefs.w, maxW());
  const w = live ?? width;
  const setW = (v) => setPrefs((p) => ({ ...p, w: sideWidth(v, maxW()) }));
  const drag = {
    onPointerDown: (e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setLive(width); },
    onPointerMove: (e) => { if (live != null && rootRef.current) setLive(sideWidth(rootRef.current.getBoundingClientRect().right - e.clientX, maxW())); },
    onPointerUp: () => { if (live != null) { setW(live); setLive(null); } },
    onLostPointerCapture: () => setLive(null),
    onDoubleClick: () => setW(width >= SIDE_WIDE - 8 ? SIDE_DEFAULT : SIDE_WIDE),
    onKeyDown: (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      setW(width + (e.key === 'ArrowLeft' ? 16 : -16)); // a borda está à esquerda: ← alarga, → estreita
    },
  };
  const listRef = React.useRef(null);
  React.useEffect(() => {
    // Commit escolhido de fora (pai, Visão geral): rola até ele.
    if (!sel || !commits || !listRef.current) return;
    const i = commits.findIndex((c) => c.hash.startsWith(sel));
    if (i >= 0) { const el = listRef.current; const top = i * ROW; if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - ROW) el.scrollTop = top - el.clientHeight / 3; }
  }, [sel, commits]);

  if (status.unborn) return <div className="gt-msg">Ainda não há commits neste repositório.</div>;
  const selected = commits && commits.find((c) => c.hash.startsWith(sel || '-'));

  return (
    <div className="gt-history" ref={rootRef}>
      <div className="gt-history__main">
        <form className="gt-toolbar" onSubmit={(e) => { e.preventDefault(); setPages(1); setQuery({ grep: q.trim(), author: author.trim() }); }}>
          <label className="gt-search"><Icon name="search" size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar na mensagem" /></label>
          <label className="gt-search"><Icon name="user" size={13} /><input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Autor" /></label>
          <button type="submit" className="gt-op is-ghost is-sm"><span>Filtrar</span></button>
          {(query.grep || query.author) && <button type="button" className="gt-op is-ghost is-sm" onClick={() => { setQ(''); setAuthor(''); setQuery({ grep: '', author: '' }); }}><Icon name="x" size={13} /><span>Limpar</span></button>}
          <span className="gt-toolbar__spacer" />
          {loading && <Spinner size={13} />}
          <span className="gt-toolbar__count">{commits ? `${commits.length} commit${commits.length === 1 ? '' : 's'}` : ''}</span>
        </form>
        {error && <div className="gt-msg is-error">{error}</div>}
        <div className="gt-log tk-scroll" ref={listRef}>
          {commits && (
            <div className="gt-log__inner" style={{ height: commits.length * ROW }}>
              <Graph layout={layout} commits={commits} headHash={status.branch.oid} photos={photos} />
              {commits.map((c, i) => (
                <div key={c.hash} className={'gt-row' + (selected && selected.hash === c.hash ? ' is-sel' : '') + (c.hash === status.branch.oid ? ' is-head' : '')}
                  style={{ top: i * ROW, paddingLeft: lanesW }} onClick={() => setSel(c.hash)} role="button" tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' && commits[i + 1]) { e.preventDefault(); setSel(commits[i + 1].hash); e.currentTarget.nextSibling && e.currentTarget.nextSibling.focus(); }
                    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); setSel(commits[i - 1].hash); e.currentTarget.previousSibling && e.currentTarget.previousSibling.focus(); }
                  }}>
                  <span className="gt-row__subject"><RefBadges refs={c.refs} />{c.subject}</span>
                  <span className="gt-row__author">{c.author}</span>
                  <span className="gt-row__date" title={fullDate(c.time)}>{ago(c.time)}</span>
                  <span className="gt-row__hash">{short(c.hash)}</span>
                </div>
              ))}
            </div>
          )}
          {commits && commits.length >= PAGE * pages && <button type="button" className="gt-more" onClick={() => setPages((n) => n + 1)}>Carregar mais {PAGE}</button>}
          {commits && !commits.length && <div className="gt-msg">Nenhum commit encontrado com esse filtro.</div>}
        </div>
      </div>
      <aside className={'gt-history__side' + (live != null ? ' is-dragging' : '')} style={{ width: w }}>
        <div className="gt-history__grip" role="separator" aria-orientation="vertical" aria-label="Largura dos detalhes do commit"
          aria-valuemin={SIDE_MIN} aria-valuemax={SIDE_MAX} aria-valuenow={w} tabIndex={0} {...drag} />
        <div className="gt-history__scroll tk-scroll">
          {selected ? <CommitDetail repo={repo} hash={selected.hash} run={run} onPick={setSel} /> : <div className="gt-msg">Escolha um commit.</div>}
        </div>
      </aside>
    </div>
  );
}
