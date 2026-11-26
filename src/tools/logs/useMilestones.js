// Logs — junta os marcos de deploy (do log), os manuais (salvos por log) e os merges da main dos repositórios ligados.
// Devolve a lista já filtrada por `meta.show`, a lista completa (para achar o deploy anterior), os repositórios
// ligados e a sugestão de repositório. Liga sozinho o repositório cujas pastas batem com as widgets publicadas (só
// quando um vence sem empate e o usuário nunca escolheu). Também lê, com prioridade baixa, a main dos outros
// repositórios cadastrados (`allCommits`, para a dica "arquivo mudou … antes" da aba Problemas).
// Os marcos nunca afirmam causa: quem desenha diz "depois de" / "mudou … antes" / "suspeita".
import { logsApi } from './shared.jsx';
import { mergeMilestones, rankRepos, autoRepo, foldersOf, commitsInDeploy, previousSameArtifact } from '../../logs/milestones.js';

const DAY = 86400e3;
const HOUR = 3600e3;
const EMPTY_META = { repos: null, repoAuto: false, manual: [], show: { deploy: true, merge: true, manual: true } };
const ALL_ON = { deploy: true, merge: true, manual: true };
const NONE = [];
export const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
const normMeta = (m) => ({ ...EMPTY_META, ...m, show: { ...EMPTY_META.show, ...((m && m.show) || {}) } });
const normDir = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const sameDir = (a, b) => !!a && !!b && normDir(a) === normDir(b);
const REFRESH_MS = 15 * 60e3; // além do aviso do Git, relê os merges de tempos em tempos (fetch automático, outra janela)
const tagCommits = (path, list) => (list || []).map((c) => ({ ...c, repo: path, repoName: baseName(path) }));

export function useMilestones({ id, spec, tsMin, tsMax, appendedNonce = 0 }) {
  const api = logsApi();
  const [meta, setMetaState] = React.useState(EMPTY_META);
  const [metaFor, setMetaFor] = React.useState(''); // de qual log é o `meta` carregado (antes disso, nada de ligar sozinho)
  const [deploys, setDeploys] = React.useState([]);
  const [repos, setRepos] = React.useState([]);
  const [byRepo, setByRepo] = React.useState({}); // repositório ligado → { commits } | { error }
  const [others, setOthers] = React.useState({}); // repositório cadastrado não ligado → commits (falha = [])
  const [gitNonce, setGitNonce] = React.useState(0); // muda quando um repositório ligado mudou (aviso do Git ou intervalo)
  const [otherNonce, setOtherNonce] = React.useState(0);
  const [suggestions, setSuggestions] = React.useState(NONE);
  const [loading, setLoading] = React.useState(false);
  const folderCache = React.useRef(new Map()); // path → pastas; uma vez por sessão do hook
  const otherCache = React.useRef(new Map());  // path|janela → commits dos repositórios não ligados
  const autoDone = React.useRef(''); // log em que já ligou sozinho (não repete se o salvamento falhar)
  // Identidade do log: trocar de família (outro log da pasta) reabre com o mesmo `id`, mas é outro log.
  const specKey = spec ? spec.kind + '|' + spec.path + '|' + (spec.family || '') : '';
  const logKey = id + '|' + specKey;
  const specRef = React.useRef(spec);
  specRef.current = spec;
  const logKeyRef = React.useRef(logKey);
  logKeyRef.current = logKey;

  // Metadados salvos deste log (repositórios ligados, marcos manuais, o que mostrar).
  React.useEffect(() => {
    let alive = true;
    setMetaState(EMPTY_META);
    setMetaFor('');
    api.meta(specRef.current).then((m) => { if (alive && m) { setMetaState(normMeta(m)); setMetaFor(logKey); } }).catch(() => {});
    return () => { alive = false; };
  }, [id, specKey]);

  // Repositórios conhecidos do Git.
  React.useEffect(() => {
    let alive = true;
    const git = window.devkit && window.devkit.git;
    if (!git) return undefined;
    git.list().then((r) => { if (alive) setRepos(((r && r.repos) || []).map((x) => ({ path: x.path, name: baseName(x.path) }))); }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  // Outro log no mesmo `id`: os deploys do anterior não valem mais.
  const shownKey = React.useRef(logKey);
  React.useEffect(() => {
    if (shownKey.current === logKey) return;
    shownKey.current = logKey;
    setDeploys([]);
  }, [id, specKey]);

  // Deploys: ao abrir, ao trocar de log/formato e a cada `appended`/`reset` do log.
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api.deploys({ id })
      .then((r) => { if (alive) setDeploys((r && r.milestones) || []); })
      .catch(() => { if (alive) setDeploys([]); })
      .then(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, specKey, appendedNonce]);

  const linked = meta.repos || NONE;
  const linkedKey = linked.join('\n');
  const repoKey = repos.map((r) => r.path).join('\n');

  // Um repositório mudou (commit, merge, pull, fetch automático — o Git avisa) ou passou o intervalo: relê.
  // Ligado → relê os merges; só cadastrado → esquece o que estava guardado dele (a dica de arquivo relê depois).
  React.useEffect(() => {
    const git = window.devkit && window.devkit.git;
    if (!git) return undefined;
    let t = null;
    let t2 = null;
    const bump = () => setGitNonce((n) => n + 1);
    const off = git.onChanged ? git.onChanged((evt) => {
      if (!evt || evt.type !== 'changed') return;
      if (linked.some((r) => sameDir(evt.repo, r))) {
        clearTimeout(t);
        t = setTimeout(bump, 1500); // o watcher avisa em rajadas enquanto o git mexe nos arquivos
        return;
      }
      const other = repos.find((r) => sameDir(evt.repo, r.path));
      if (!other) return;
      for (const k of [...otherCache.current.keys()]) if (k.startsWith(other.path + '|')) otherCache.current.delete(k);
      clearTimeout(t2);
      t2 = setTimeout(() => setOtherNonce((n) => n + 1), 5000);
    }) : null;
    const iv = linked.length ? setInterval(bump, REFRESH_MS) : null;
    return () => { if (off) off(); clearTimeout(t); clearTimeout(t2); if (iv) clearInterval(iv); };
  }, [linkedKey, repoKey]);

  // Merges da main de cada repositório ligado: quando os repositórios, a janela do log (arredondada para a hora) ou
  // um repositório em si muda. Cada um responde por conta própria (um lento não segura os outros).
  const minH = tsMin != null ? Math.floor(tsMin / HOUR) : null;
  const maxH = tsMax != null ? Math.ceil(tsMax / HOUR) : null;
  const win = minH != null && maxH != null ? { since: minH * HOUR - 7 * DAY, until: maxH * HOUR + HOUR } : null;
  const queryKey = React.useRef('');
  React.useEffect(() => {
    let alive = true;
    const git = window.devkit && window.devkit.git;
    if (!linked.length || !win || !git) {
      queryKey.current = '';
      setByRepo({});
      return undefined;
    }
    // Só a releitura dos mesmos repositórios/janela mantém os commits na tela enquanto pergunta.
    const key = linkedKey + '|' + minH + '|' + maxH;
    if (queryKey.current !== key) { queryKey.current = key; setByRepo({}); }
    for (const path of linked) {
      git.milestones(path, win)
        .then((r) => (r && r.error ? { error: r.error } : { commits: tagCommits(path, r && r.commits) }))
        .catch(() => ({ error: 'Não deu para ler o repositório' }))
        .then((res) => { if (alive) setByRepo((cur) => ({ ...cur, [path]: res })); });
    }
    return () => { alive = false; };
  }, [linkedKey, minH, maxH, gitNonce]);

  // 'idle' (sem repositório) | 'loading' (algum ainda não respondeu) | 'error' (todos falharam) | 'ok'
  const commitsState = !linked.length || !win ? 'idle'
    : linked.some((p) => !byRepo[p]) ? 'loading'
      : linked.every((p) => byRepo[p].error) ? 'error' : 'ok';
  const commits = React.useMemo(() => linked.flatMap((p) => (byRepo[p] && byRepo[p].commits) || []), [linkedKey, byRepo]);
  const repoError = React.useMemo(() => {
    const errs = linked.filter((p) => byRepo[p] && byRepo[p].error).map((p) => baseName(p) + ': ' + byRepo[p].error);
    return errs.length ? errs.join(' · ') : null;
  }, [linkedKey, byRepo]);

  // Dica de arquivo: a main dos outros repositórios cadastrados, um por vez, só depois que os ligados responderam.
  // Guardado por repositório/janela; falha vira lista vazia, sem aviso.
  const linkedDone = commitsState !== 'loading';
  React.useEffect(() => {
    let alive = true;
    const git = window.devkit && window.devkit.git;
    const rest = repos.filter((r) => !linked.some((p) => sameDir(p, r.path)));
    if (!win || !git || !rest.length) { setOthers({}); return undefined; }
    if (!linkedDone) return undefined; // os ligados primeiro (a dica antiga fica até lá)
    (async () => {
      const out = {};
      for (const r of rest) {
        const k = r.path + '|' + minH + '|' + maxH;
        if (!otherCache.current.has(k)) {
          let list = [];
          try {
            const res = await git.milestones(r.path, win);
            if (res && !res.error) list = tagCommits(r.path, res.commits);
          } catch { /* repositório sumiu ou não abre: sem dica dele */ }
          // Guarda mesmo se a resposta chegou tarde (a próxima rodada aproveita); janelas antigas do mesmo repo saem.
          for (const old of [...otherCache.current.keys()]) if (old.startsWith(r.path + '|')) otherCache.current.delete(old);
          otherCache.current.set(k, list);
          if (!alive) return;
        }
        out[r.path] = otherCache.current.get(k);
      }
      if (alive) setOthers(out);
    })();
    return () => { alive = false; };
  }, [repoKey, linkedKey, minH, maxH, linkedDone, otherNonce]);

  const allCommits = React.useMemo(() => {
    const rest = Object.keys(others).filter((p) => !linked.some((l) => sameDir(l, p)));
    return [...commits, ...rest.flatMap((p) => others[p])];
  }, [commits, others, linkedKey]);

  // Repositório pelas pastas: com deploys e sem escolha ainda, liga sozinho quem vence sem empate; no empate, sugere
  // os dois primeiros. Depois que o usuário mexeu no seletor (até "Nenhum"), não liga mais sozinho.
  const artifactKey = React.useMemo(() => {
    const set = new Set();
    for (const d of deploys) for (const a of d.artifacts || []) set.add(String(a).replace(/\.(war|ear|jar)$/i, ''));
    return [...set].sort().join('\n');
  }, [deploys]);
  const neverChosen = metaFor === logKey && meta.repos === null;
  React.useEffect(() => {
    let alive = true;
    const git = window.devkit && window.devkit.git;
    if (!neverChosen || !artifactKey || !repos.length || !git) { setSuggestions(NONE); return undefined; }
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
      if (!alive) return;
      const ranked = rankRepos(artifactKey.split('\n'), rows);
      const auto = autoRepo(ranked);
      if (auto && autoDone.current !== logKey) {
        autoDone.current = logKey;
        setSuggestions(NONE);
        // Não deu para salvar: em vez de ligar, volta a perguntar.
        setMeta({ repos: [auto], repoAuto: true }).then((m) => { if (!m && logKeyRef.current === logKey) setSuggestions([auto]); });
        return;
      }
      // Empate: os dois primeiros. Com vencedor aqui, é porque ligar sozinho já falhou neste log: pergunta por ele.
      setSuggestions(auto ? [auto] : ranked.slice(0, 2).map((x) => x.path));
    })();
    return () => { alive = false; };
  }, [neverChosen, artifactKey, repoKey, logKey]);

  const merges = React.useMemo(() => commits.map((c) => ({
    id: 'merge:' + c.repo + ':' + c.hash, kind: 'merge', ts: c.ts, hash: c.hash, pr: c.pr, subject: c.subject,
    label: c.pr ? '#' + c.pr + ' ' + c.title : c.title, author: c.author, files: c.files, repo: c.repo, repoName: c.repoName,
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

  // Nunca manda chave `undefined` (o serviço também ignora, mas não custa). A resposta só vale se o log ainda é o mesmo.
  function setMeta(patch) {
    const clean = {};
    for (const k of Object.keys(patch || {})) if (patch[k] !== undefined) clean[k] = patch[k];
    const key = logKeyRef.current;
    return api.saveMeta(specRef.current, clean)
      .then((m) => { if (m && logKeyRef.current === key) { setMetaState(normMeta(m)); setMetaFor(key); } return m; })
      .catch(() => null);
  }
  const setMetaCb = React.useCallback(setMeta, [id, specKey]);

  const suggestion = suggestions[0] || null;
  return { list, all, meta, setMeta: setMetaCb, repos, linked, suggestion, suggestions, repoError, related, commitsOf, commitsState, loading, allCommits };
}
