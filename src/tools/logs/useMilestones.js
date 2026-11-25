// Logs — junta os marcos de deploy (do log), os manuais (salvos por log) e os merges da main do repositório ligado.
// Devolve a lista já filtrada por `meta.show`, a lista completa (para achar o deploy anterior), o repositório ligado
// e a sugestão de repositório. Os marcos nunca afirmam causa: quem desenha diz "depois de" / "suspeito".
import { logsApi } from './shared.jsx';
import { mergeMilestones, suggestRepo, foldersOf, commitsInDeploy, previousSameArtifact } from '../../logs/milestones.js';

const DAY = 86400e3;
const HOUR = 3600e3;
const EMPTY_META = { repo: null, manual: [], show: { deploy: true, merge: true, manual: true } };
const ALL_ON = { deploy: true, merge: true, manual: true };
const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
const normMeta = (m) => ({ ...EMPTY_META, ...m, show: { ...EMPTY_META.show, ...((m && m.show) || {}) } });

export function useMilestones({ id, spec, tsMin, tsMax, appendedNonce = 0 }) {
  const api = logsApi();
  const [meta, setMetaState] = React.useState(EMPTY_META);
  const [deploys, setDeploys] = React.useState([]);
  const [repos, setRepos] = React.useState([]);
  const [commits, setCommits] = React.useState([]);
  const [repoError, setRepoError] = React.useState(null);
  const [suggestion, setSuggestion] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const folderCache = React.useRef(new Map()); // path → pastas; uma vez por sessão do hook

  // Metadados salvos deste log (repositório ligado, marcos manuais, o que mostrar).
  React.useEffect(() => {
    let alive = true;
    setMetaState(EMPTY_META);
    api.meta(spec).then((m) => { if (alive && m) setMetaState(normMeta(m)); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // Repositórios conhecidos do Git.
  React.useEffect(() => {
    let alive = true;
    const git = window.devkit && window.devkit.git;
    if (!git) return undefined;
    git.list().then((r) => { if (alive) setRepos(((r && r.repos) || []).map((x) => ({ path: x.path, name: baseName(x.path) }))); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // Deploys: ao abrir e a cada `appended`/`reset` do log.
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api.deploys({ id })
      .then((r) => { if (alive) setDeploys((r && r.milestones) || []); })
      .catch(() => { if (alive) setDeploys([]); })
      .then(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, appendedNonce]);

  // Merges da main: quando o repositório ou a janela do log (arredondada para a hora) muda.
  const minH = tsMin != null ? Math.floor(tsMin / HOUR) : null;
  const maxH = tsMax != null ? Math.ceil(tsMax / HOUR) : null;
  React.useEffect(() => {
    let alive = true;
    setRepoError(null);
    const git = window.devkit && window.devkit.git;
    if (!meta.repo || minH == null || maxH == null || !git) { setCommits([]); return undefined; }
    git.milestones(meta.repo, { since: minH * HOUR - 7 * DAY, until: maxH * HOUR + HOUR })
      .then((r) => {
        if (!alive) return;
        if (r && r.error) { setRepoError(r.error); setCommits([]); } else setCommits((r && r.commits) || []);
      })
      .catch(() => { if (alive) { setRepoError('Repositório não encontrado'); setCommits([]); } });
    return () => { alive = false; };
  }, [meta.repo, minH, maxH]);

  // Sugestão: sem repositório ligado e com deploys, procura um repo com pasta de nome igual ao de algum artefato.
  const artifactKey = React.useMemo(() => {
    const set = new Set();
    for (const d of deploys) for (const a of d.artifacts || []) set.add(String(a).replace(/\.(war|ear|jar)$/i, ''));
    return [...set].sort().join('\n');
  }, [deploys]);
  const repoKey = repos.map((r) => r.path).join('\n');
  React.useEffect(() => {
    let alive = true;
    const git = window.devkit && window.devkit.git;
    if (meta.repo || !artifactKey || !repos.length || !git) { setSuggestion(null); return undefined; }
    (async () => {
      const rows = [];
      for (const r of repos) {
        if (!folderCache.current.has(r.path)) {
          let folders = [];
          try { folders = foldersOf(await git.files(r.path, 'HEAD')); } catch { /* repo sem HEAD ou sumiu */ }
          folderCache.current.set(r.path, folders);
        }
        rows.push({ path: r.path, folders: folderCache.current.get(r.path) });
      }
      if (alive) setSuggestion(suggestRepo(artifactKey.split('\n'), rows));
    })();
    return () => { alive = false; };
  }, [meta.repo, artifactKey, repoKey]);

  const merges = React.useMemo(() => commits.map((c) => ({
    id: 'merge:' + c.hash, kind: 'merge', ts: c.ts, hash: c.hash, pr: c.pr,
    label: c.pr ? '#' + c.pr + ' ' + c.title : c.title, author: c.author, files: c.files,
  })), [commits]);

  const all = React.useMemo(() => mergeMilestones(deploys, meta.manual, merges, ALL_ON), [deploys, meta.manual, merges]);
  const list = React.useMemo(() => mergeMilestones(deploys, meta.manual, merges, meta.show), [deploys, meta.manual, merges, meta.show]);

  const commitsOf = React.useCallback((m) => {
    if (!m || !['deploy', 'undeploy', 'restart'].includes(m.kind)) return [];
    return commitsInDeploy(m, previousSameArtifact(all, m), commits);
  }, [all, commits]);
  const related = React.useCallback((m) => {
    if (!m) return [];
    if (m.kind === 'merge') return m.files || [];
    return [...new Set(commitsOf(m).flatMap((c) => c.files || []))];
  }, [commitsOf]);

  // Nunca manda chave `undefined` (um `repo: undefined` explícito limparia o repositório).
  const setMeta = React.useCallback(async (patch) => {
    const clean = {};
    for (const k of Object.keys(patch || {})) if (patch[k] !== undefined) clean[k] = patch[k];
    try {
      const m = await api.saveMeta(spec, clean);
      if (m) setMetaState(normMeta(m));
      return m;
    } catch { return null; }
  }, [id]);

  return { list, all, meta, setMeta, repos, suggestion, repoError, related, commitsOf, loading };
}
