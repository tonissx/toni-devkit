// Logs — um log aberto: cabeçalho (arquivo, formato, ao vivo, exportar), filtros, linha do tempo e as abas Linhas,
// Problemas e Gráficos, com o detalhe da entrada à direita. A consulta roda no worker; aqui só o que aparece.
//
// Ao vivo: quando o arquivo cresce, a consulta roda de novo (no máximo ~2× por segundo). Se a lista está no fim,
// ela acompanha; se a pessoa subiu para ler, fica parada e mostra "↓ N novas".
import { DS } from '../../lib/ds.js';
import { useAiMode, useAiTask, AiButton, AiPanel, aiOn } from '../../ai/ui.jsx';
import { FORMATS, FORMAT_IDS } from '../../logs/parse.js';
import { logsApi, errText, toRegexes, fmtNum, fmtBytes, fmtTime, LEVEL_BY_ID, copyText, sameDay, useDelayed } from './shared.jsx';
import { LevelChips, SearchBox, RangeChip, Presets } from './FilterBar.jsx';
import { LogList } from './LogList.jsx';
import { Timeline } from './Timeline.jsx';
import { Detail } from './Detail.jsx';
import { Problems } from './Problems.jsx';
import { Charts } from './Charts.jsx';
import { Hits } from './Hits.jsx';
import { Marks } from './Marks.jsx';
import { useSameText, filterTermFor } from './sameText.js';
import { escapeRe } from '../../logs/query.js';
import { usePersisted } from '../../lib/store.js';
import { detailWidth, hitsHeight, DETAIL_DEFAULT, DETAIL_WIDE, DETAIL_MIN, DETAIL_MAX, HITS_DEFAULT, HITS_TALL } from '../../logs/panel.js';
import { useSplit } from './useSplit.js';

const HITS_HEAD = 31; // altura do cabeçalho do painel de baixo (30 + a linha de cima)

const { Icon, Spinner } = DS;

let QSEQ = 0;

const ENCODINGS = [['auto', 'Automático'], ['utf-8', 'UTF-8'], ['windows-1252', 'Windows-1252 (ANSI)'], ['utf-16le', 'UTF-16']];

function Menu({ label, icon, items, title }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="lg-pop-wrap" ref={ref}>
      <button type="button" className="lg-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={title}><Icon name={icon} size={14} />{label && <span>{label}</span>}<Icon name="chevron-down" size={12} /></button>
      {open && (
        <div className="lg-pop lg-menu" role="menu">
          {items.filter(Boolean).map((it) => (
            <button key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); it.onClick(); }} disabled={it.disabled}>
              <Icon name={it.icon} size={14} /><span>{it.label}</span>{it.hint && <small>{it.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * props: src (info do log aberto), state/setState (filtro e aba, guardados por caminho), presets/onPresets,
 * onInfo(info) (reaberto/novo formato), onClose, toast, openedAt
 */
export function LogView({ src, state, setState, presets, onPresets, onInfo, onClose, toast, openedAt }) {
  const api = logsApi();
  const id = src.id;
  const { q = '', levels = null, range = null, tab = 'lines', tlMode = 'all', tlFolded = false, mode = 'find', ctx = 0, hitsTab = 'hits' } = state;
  const set = (patch) => setState((s) => ({ ...s, ...patch }));
  // Filtrando, o log continua inteiro na lista e os achados vão para o painel ('find'); 'only' = a lista mostra só os achados
  // (mais as `ctx` entradas vizinhas de cada um, se pedido).
  const filtered = !!(q.trim() || (levels && levels.length));
  const wantFull = mode === 'find' && filtered;
  const ctxN = filtered ? ctx : 0;
  const wantView = wantFull ? 'full' : ctxN > 0 ? 'ctx' : 'hits';

  const [sum, setSum] = React.useState(null);
  const [hitK, setHitK] = React.useState(null);        // posição do achado atual entre os achados
  const [hitScroll, setHitScroll] = React.useState(null);
  const hitsRef = React.useRef(null);
  // Bandejas ajustáveis na mão (arrastar a borda): o Detalhe à direita e Achados/Fixados embaixo. Valem para todos os logs.
  const [lay, setLay] = usePersisted('logs.layout', { detailW: DETAIL_DEFAULT, hitsH: HITS_DEFAULT });
  const bodyRef = React.useRef(null);
  const mainRef = React.useRef(null);
  const detailSplit = useSplit({ value: lay.detailW, onCommit: (v) => setLay((l) => ({ ...l, detailW: v })), rootRef: bodyRef, axis: 'x',
    norm: detailWidth, maxOf: (r) => r.width * 0.7, def: DETAIL_DEFAULT, wide: DETAIL_WIDE });
  const hitsSplit = useSplit({ value: lay.hitsH, onCommit: (v) => setLay((l) => ({ ...l, hitsH: v })), rootRef: mainRef, axis: 'y', offset: HITS_HEAD,
    norm: hitsHeight, maxOf: (r) => r.height * 0.7, def: HITS_DEFAULT, wide: HITS_TALL });
  // Entradas fixadas (não persistem: o índice de uma entrada muda se o arquivo for rotacionado/reaberto).
  const [pins, setPins] = React.useState([]);          // [{ i, ts, level, text }]
  const pinSet = React.useMemo(() => new Set(pins.map((p) => p.i)), [pins]);
  const [markData, setMarkData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const dimmed = useDelayed(loading); // esmaece só se a consulta demorar (> 300 ms)
  const [sel, setSel] = React.useState(null);       // { pos | null, i }
  const [scrollTo, setScrollTo] = React.useState(null);
  const [atBottom, setAtBottom] = React.useState(true);
  const [newCount, setNewCount] = React.useState(0);
  const [live, setLive] = React.useState(src.live);
  const latest = React.useRef(0);
  const appended = React.useRef(false);
  const first = React.useRef(true);
  const searchRef = React.useRef(null);
  const listRef = React.useRef(null);
  const rootRef = React.useRef(null);
  const sumRef = React.useRef(null);
  sumRef.current = sum;
  const atBottomRef = React.useRef(true);
  atBottomRef.current = atBottom;
  React.useEffect(() => setLive(src.live), [src.live]);

  // Texto selecionado numa linha → mesmas ocorrências destacadas nas linhas visíveis (ver sameText.js).
  const [same, setSame] = React.useState({ text: '', count: 0 });
  useSameText(rootRef, setSame);

  // Servidores do Banco cadastrados (para "O que o banco fazia?" no detalhe de um erro de SQL).
  const [dbServers, setDbServers] = React.useState(0);
  React.useEffect(() => { if (window.devkit.db) window.devkit.db.list().then((l) => setDbServers(l.length), () => {}); }, []);

  const cfg = useAiMode();
  const aiErr = useAiTask('logError', cfg);
  const aiInc = useAiTask('logIncident', cfg);

  const goTo = (index, align = 'center') => setScrollTo({ index, align, nonce: Math.random() });
  const mainOf = (x) => (x.view === 'full' ? x.fullTotal : x.view === 'ctx' ? x.ctxTotal : x.total); // quantas linhas tem a lista principal
  const full = !!sum && sum.view === 'full';
  const view = sum ? sum.view : 'hits'; // 'full' (log inteiro) | 'ctx' (achados + vizinhos) | 'hits' (só achados)
  const mainTotal = sum ? mainOf(sum) : 0;
  const marked = !!sum && sum.view !== 'hits'; // a lista principal traz achados marcados (hit/near)

  /* ─────────────── Consulta ─────────────── */
  const run = React.useCallback(async () => {
    const qid = ++QSEQ;
    latest.current = qid;
    const wasAppend = appended.current;
    appended.current = false;
    // Ao vivo não mostra "carregando": as linhas novas só aparecem (sem esmaecer a tela a cada gravação).
    if (!wasAppend) setLoading(true);
    try {
      const r = await api.query({ id, qid, q, levels, from: range ? range.from : null, to: range ? range.to : null, buckets: 120, full: wantFull, ctx: ctxN });
      if (latest.current !== qid) return;
      const prev = sumRef.current;
      const cur = { ...r, viaAppend: wasAppend, view: wantView };
      setSum(cur);
      const tot = mainOf(cur);
      if (first.current) {
        first.current = false;
        if (src.live && tot) goTo(tot - 1, 'end'); // como o tail -f: começa no fim
      } else if (wasAppend && prev && tot > mainOf(prev)) {
        if (atBottomRef.current) goTo(tot - 1, 'end');
        else setNewCount((n) => n + (tot - mainOf(prev)));
      }
    } catch (e) {
      if (latest.current === qid) toast('Não foi possível filtrar', errText(e), 'error');
    } finally { if (latest.current === qid) setLoading(false); }
  }, [id, q, levels && levels.join(','), range && range.from, range && range.to, wantFull, ctxN]);
  const runRef = React.useRef(run);
  runRef.current = run;
  React.useEffect(() => { run(); }, [run]);
  React.useEffect(() => { setHitK(null); }, [q, levels && levels.join(',')]);

  // Eventos do serviço: cresceu, reaberto (rotação/truncado), erro.
  React.useEffect(() => {
    let t = null;
    const off = api.onChanged((evt) => {
      if (!evt || evt.id !== id) return;
      if (evt.type === 'appended') {
        appended.current = true;
        if (!t) t = setTimeout(() => { t = null; runRef.current(); }, 450);
      } else if (evt.type === 'reset') {
        if (evt.info) onInfo(evt.info);
        setSel(null);
        setPins([]);
        first.current = true;
        runRef.current();
        toast(evt.reason === 'rotated' ? 'Arquivo rotacionado' : 'Arquivo foi zerado', 'O log foi reaberto do começo do arquivo novo.', 'ok');
      } else if (evt.type === 'error') toast('Ao vivo: problema ao ler', evt.error, 'error');
    });
    return () => { off(); clearTimeout(t); };
  }, [id]);

  // Erros vistos (para o "novos" do Início).
  React.useEffect(() => { if (sum) api.markSeen(id).catch(() => {}); }, [sum && sum.qid]);
  React.useEffect(() => { if (atBottom) setNewCount(0); }, [atBottom]);

  // Filtro mudou: mantém a entrada selecionada se ela ainda está no resultado.
  React.useEffect(() => {
    if (!sum || !sel) return;
    // Atualização ao vivo (viaAppend) não rola de volta para a seleção; só mudança de filtro recentraliza.
    api.locate({ id, qid: sum.qid, i: sel.i, view }).then((r) => {
      if (!r || r.stale) return;
      if (r.exact) { setSel((s) => (s && s.i === sel.i ? { ...s, pos: r.pos } : s)); if (!sum.viaAppend) goTo(r.pos); } else setSel((s) => (s && s.i === sel.i ? { ...s, pos: null } : s));
    }, () => {});
  }, [sum && sum.qid]);

  // Outra entrada: a explicação anterior não vale mais.
  React.useEffect(() => { aiErr.close(); }, [sel && sel.i]);

  /* ─────────────── Ações ─────────────── */
  const selectPos = async (pos) => {
    if (!sum || pos < 0 || pos >= mainTotal) return;
    const r = await api.rows({ id, qid: sum.qid, from: pos, count: 1, view });
    if (r && r.rows && r.rows[0]) { setSel({ pos, i: r.rows[0].i }); goTo(pos, 'nearest'); }
  };
  // Próximo/anterior achado do filtro (dá a volta no fim); o log completo vai até a posição dele.
  const nextHit = async (dir) => {
    if (!sum) return;
    const r = await api.hitNear({ id, qid: sum.qid, i: sel ? sel.i : dir > 0 ? -1 : sum.n, dir });
    if (!r || r.stale) return;
    if (r.i < 0) { toast('Nenhum achado', 'Nada no log casa com o filtro.', 'ok'); return; }
    if (tab !== 'lines') set({ tab: 'lines' });
    pickHit(r.k, r.i);
  };
  const pickHit = (k, i) => {
    setHitK(k);
    setHitScroll({ index: k, align: 'nearest', nonce: Math.random() });
    jumpToEntry(i);
  };
  const nextLevel = async (dir, minLevel = 5) => {
    if (!sum) return;
    if (full && minLevel === 5) return nextHit(dir); // com filtro, n/N andam pelos achados
    const from = sel && sel.pos != null ? sel.pos : dir > 0 ? -1 : mainTotal;
    const r = await api.next({ id, qid: sum.qid, pos: from, dir, minLevel, view });
    if (r && r.pos >= 0) { if (tab !== 'lines') set({ tab: 'lines' }); selectPos(r.pos).then(() => goTo(r.pos)); } else toast(dir > 0 ? 'Nenhum erro depois daqui' : 'Nenhum erro antes daqui', '', 'ok');
  };
  const seek = async (t) => {
    if (!sum) return;
    const r = await api.seekTime({ id, qid: sum.qid, t, view });
    if (r && r.pos != null) { if (tab !== 'lines') set({ tab: 'lines' }); goTo(r.pos); selectPos(r.pos); }
  };
  const addFilter = (term, replace) => {
    const next = replace ? term : (q.split(/\s+/).includes(term) ? q : (q + ' ' + term).trim());
    set({ q: next, ...(replace ? { tab: 'lines' } : {}) });
  };
  // "Seguir" um valor (thread, ip, id…): troca o termo da mesma chave, em vez de empilhar (dois thread:"=…" nunca casam).
  const follow = (term) => {
    const key = term.slice(0, term.indexOf(':'));
    const re = new RegExp('(^|\\s)-?' + escapeRe(key) + ':(?:"[^"]*"|\\S+)', 'gi');
    const rest = q.replace(re, '$1').replace(/\s+/g, ' ').trim();
    set({ q: (rest + ' ' + term).trim(), tab: 'lines' });
  };
  const jumpToEntry = async (i) => {
    setSel({ pos: null, i });
    if (!sum) return;
    const r = await api.locate({ id, qid: sum.qid, i, view });
    if (r && r.exact) { setSel({ pos: r.pos, i }); goTo(r.pos); } else if (r && !r.stale) toast('Fora do filtro atual', 'Essa entrada não aparece na lista com o filtro/contexto de agora.', 'ok');
  };
  // Fixar / soltar a entrada (a selecionada, ou a que vier em `entry`).
  const togglePin = async (entry) => {
    const i = entry ? entry.i : sel ? sel.i : null;
    if (i == null) return;
    if (pinSet.has(i)) { setPins((l) => l.filter((p) => p.i !== i)); return; }
    let e = entry;
    if (!e || e.text == null) { try { e = await api.entry({ id, i }); } catch { return; } }
    setPins((l) => (l.some((p) => p.i === i) ? l : [...l, { i, ts: e.ts, level: e.level, text: String(e.text).split('\n')[0].slice(0, 140) }].sort((a, b) => a.i - b.i)));
  };
  // Faixa de marcadores ao lado da rolagem: onde estão os achados e os fixados.
  React.useEffect(() => {
    if (!sum || !marked || tab !== 'lines') { setMarkData(null); return undefined; }
    let alive = true;
    api.marks({ id, qid: sum.qid, view, buckets: 160, pins: pins.map((p) => p.i) }).then((m) => { if (alive && m && !m.stale) setMarkData(m); }, () => {});
    return () => { alive = false; };
  }, [sum && sum.qid, view, pins, tab]);
  const toggleLive = async () => {
    try { const on = await api.setLive(id, !live); setLive(on); toast(on ? 'Acompanhando ao vivo' : 'Parou de acompanhar', on ? 'Linhas novas entram sozinhas.' : 'O log fica como está agora.', 'ok'); } catch (e) { toast('Não foi possível', errText(e), 'error'); }
  };
  const reformat = async (patch) => {
    try { const info = await api.reformat(id, patch); onInfo(info); first.current = true; setSel(null); runRef.current(); } catch (e) { toast('Não foi possível reabrir', errText(e), 'error'); }
  };
  const switchFamily = async (family) => {
    try { const info = await api.switchFamily(id, family); onInfo(info); first.current = true; setSel(null); runRef.current(); } catch (e) { toast('Não foi possível abrir', errText(e), 'error'); }
  };
  const doExport = async (kind) => {
    if (!sum) return;
    try {
      const r = await api.exportTo({ id, qid: sum.qid, kind, name: src.name.split(/[\\/]/).pop().replace(/\.\w+$/, '') + (q ? '-filtrado' : '') });
      if (r) toast(`Exportadas ${fmtNum(r.count)} entradas`, r.path, 'ok');
    } catch (e) { toast('Não foi possível exportar', errText(e), 'error'); }
  };
  const copyFiltered = async () => {
    if (!sum) return;
    const r = await api.textOf({ id, qid: sum.qid, from: !full && sel && sel.pos != null ? sel.pos : 0, count: 200 });
    if (r && r.text) copyText(r.text, toast, `${r.count} entradas copiadas${r.more ? ' (até 200)' : ''}`);
  };

  /* ─────────────── IA ─────────────── */
  const explain = (entry) => aiErr.start(async () => {
    const ctx = await api.context({ id, i: entry.i, before: 8, after: 0 }).catch(() => ({ rows: [] }));
    const g = entry.group;
    return {
      text: entry.text.slice(0, 20000), format: src.formatLabel || src.format, logger: entry.parsed.logger,
      before: ctx.rows.filter((r) => r.i !== entry.i).map((r) => r.text).join('\n'),
      group: g ? { total: g.total, first: fmtTime(g.first, { date: true, millis: false }), last: fmtTime(g.last, { date: true, millis: false }) } : null,
    };
  });
  const summarize = (groups) => aiInc.start(() => ({
    name: src.name, format: src.formatLabel || src.format, total: sum.total, filter: q,
    window: sum.tsMin != null ? `${fmtTime(sum.tsMin, { date: true, millis: false })} a ${fmtTime(sum.tsMax, { date: true, millis: false })}` : '',
    counts: [6, 5, 4, 3].filter((l) => sum.counts[l]).map((l) => `${LEVEL_BY_ID[l].label} ${sum.counts[l]}`).join(', '),
    spikes: sum.hist && sum.spikes && sum.spikes.length ? sum.spikes.slice(0, 8).map((b) => fmtTime(sum.hist.start + b * sum.hist.step, { date: !sameDay(sum.hist.start, sum.tsMax), millis: false })).join(', ') : '',
    groups: groups.slice(0, 25).map((g) => ({ level: LEVEL_BY_ID[g.level].label, count: g.count, title: g.title, exception: g.exception, rootCause: g.rootCause, frame: g.frame, first: fmtTime(g.first, { date: true, millis: false }), last: fmtTime(g.last, { date: true, millis: false }) })),
  }));

  /* ─────────────── Teclado ─────────────── */
  const onKey = (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); if (searchRef.current) { searchRef.current.focus(); searchRef.current.select(); } return; }
    if (typing) return;
    if (e.key === 'Escape' && sel) { e.preventDefault(); setSel(null); return; }
    if (tab !== 'lines' || !sum) return;
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); selectPos(sel && sel.pos != null ? sel.pos + 1 : 0); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); selectPos(sel && sel.pos != null ? sel.pos - 1 : 0); }
    else if (e.key === 'm' && sel) { e.preventDefault(); togglePin(null); }
    else if (e.key === 'n') { e.preventDefault(); nextLevel(1); }
    else if (e.key === 'N') { e.preventDefault(); nextLevel(-1); }
    else if (e.key === 'w') { e.preventDefault(); nextLevel(1, 4); }
    else if (e.key === 'End') { e.preventDefault(); goTo(mainTotal - 1, 'end'); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(0, 'nearest'); }
  };

  const res = React.useMemo(() => toRegexes(sum && sum.highlight), [sum && sum.qid]);
  const fmtOptions = FORMAT_IDS.map((f) => [f, FORMATS[f].label]);
  const truncNote = src.truncated ? 'Arquivo grande: mostrando só o final (1,5 GB). Os arquivos/trechos mais antigos ficaram de fora.' : null;
  const errorsTotal = sum ? sum.levelTotals[5] + sum.levelTotals[6] : 0;

  return (
    <div className="lg-view" ref={rootRef} onKeyDown={onKey} tabIndex={-1}>
      <header className="lg-head">
        <div className="lg-head__title" title={src.files.map((f) => f.path).join('\n')}>
          <Icon name={src.spec && src.spec.kind === 'folder' ? 'folder-open' : 'file-text'} size={16} />
          <b>{src.name}</b>
          {src.files.length > 1 && <span className="lg-pill" title={src.files.map((f) => f.name).join(' → ')}>{src.files.length} arquivos</span>}
          {truncNote && <span className="lg-pill is-warn" title={truncNote}><Icon name="scissors" size={11} />só o final</span>}
        </div>
        <div className="lg-head__meta">
          {src.families && src.families.length > 1 && (
            <select className="lg-select" value={src.family || ''} onChange={(e) => switchFamily(e.target.value)} title="Outro log desta pasta">
              {src.families.map((f) => <option key={f.family} value={f.family}>{f.family} ({f.count})</option>)}
            </select>
          )}
          <select className="lg-select" value={src.format} onChange={(e) => reformat({ format: e.target.value })} title={`Formato${src.detected ? ` (detectado: ${FORMATS[src.detected.format] ? FORMATS[src.detected.format].label : src.detected.format})` : ''}`}>
            {fmtOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select className="lg-select" value={src.encoding} onChange={(e) => reformat({ encoding: e.target.value })} title="Codificação do texto (troque se aparecerem acentos estranhos)">
            {ENCODINGS.map(([v, l]) => <option key={v} value={v}>{v === 'auto' ? 'Auto' : l}</option>)}
            {!ENCODINGS.some(([v]) => v === src.encoding) && <option value={src.encoding}>{src.encoding}</option>}
          </select>
          <span className="lg-muted lg-head__size">{fmtBytes(src.bytes)} · {fmtNum(sum ? sum.n : src.n)} entradas</span>
          <button type="button" className={'lg-live' + (live ? ' is-on' : '')} onClick={toggleLive} disabled={src.files[src.files.length - 1].gz}
            title={live ? 'Acompanhando o arquivo — clique para parar' : 'Clique para acompanhar o arquivo ao vivo'}>
            <span className="lg-live__dot" />{live ? 'Ao vivo' : 'Parado'}
          </button>
          <Menu icon="download" title="Exportar ou copiar o que está filtrado" items={[
            { icon: 'file-down', label: 'Exportar .log', hint: 'o texto como está', onClick: () => doExport('log') },
            { icon: 'file-code', label: 'Exportar .md', hint: 'com o filtro no cabeçalho', onClick: () => doExport('md') },
            { icon: 'copy', label: 'Copiar entradas', hint: 'até 200, a partir da selecionada', onClick: copyFiltered },
            { icon: 'folder-search', label: 'Mostrar na pasta', onClick: () => api.reveal(src.files[src.files.length - 1].path) },
          ]} />
          <button type="button" className="lg-icon" onClick={onClose} title="Fechar este log" aria-label="Fechar este log"><Icon name="x" size={15} /></button>
        </div>
      </header>

      <div className="lg-filters">
        <LevelChips counts={sum && sum.counts} levels={levels} onChange={(lv) => set({ levels: lv })} />
        <SearchBox value={q} onChange={(v) => set({ q: v })} error={sum && sum.error} fields={src.fields} inputRef={searchRef} />
        <RangeChip range={range} onClear={() => set({ range: null })} />
        <Presets presets={presets} current={{ q, levels }} onApply={(p) => set({ q: p.q || '', levels: p.levels && p.levels.length ? p.levels : null })} onSave={onPresets} />
      </div>

      <Timeline hist={sum && sum.hist} range={range} onRange={(r) => set({ range: r })} onSeek={seek} spikes={tlMode === 'problems' || errorsTotal ? sum && sum.spikes : []}
        mode={tlMode} onMode={(m) => set({ tlMode: m })} loading={dimmed}
        collapsed={tlFolded} onCollapse={(v) => set({ tlFolded: v })} />

      <div className="lg-tabs" role="tablist">
        {[
          { v: 'lines', label: 'Linhas', icon: 'list', n: sum ? sum.total : null },
          { v: 'problems', label: 'Problemas', icon: 'flame', n: sum ? sum.groupsTotal : null },
          { v: 'charts', label: 'Gráficos', icon: 'chart-column' },
        ].map((t) => (
          <button key={t.v} type="button" role="tab" aria-selected={tab === t.v} className={tab === t.v ? 'is-on' : ''} onClick={() => set({ tab: t.v })}>
            <Icon name={t.icon} size={14} /><span>{t.label}</span>{t.n != null && <small>{fmtNum(t.n)}</small>}
          </button>
        ))}
        <span className="lg-grow" />
        {tab === 'lines' && filtered && (
          <select className="lg-select" value={ctx} onChange={(e) => set({ ctx: Number(e.target.value) })} title="Mostrar também as entradas vizinhas de cada achado (como o grep -C)" aria-label="Linhas de contexto">
            {[0, 2, 5, 10].map((n) => <option key={n} value={n}>{n ? `± ${n} de contexto` : 'Sem contexto'}</option>)}
          </select>
        )}
        {tab === 'lines' && filtered && (
          <button type="button" className={'lg-btn' + (mode === 'only' ? ' is-accent' : '')} aria-pressed={mode === 'only'} onClick={() => set({ mode: mode === 'only' ? 'find' : 'only' })}
            title={mode === 'only' ? 'Mostrando só os filtrados — clique para ver o log completo com os achados marcados' : 'Mostrar só os filtrados na lista (esconde o resto do log)'}>
            <Icon name="filter" size={13} /><span>Só filtrados</span>
          </button>
        )}
        {tab === 'lines' && sum && sum.total > 0 && (
          <span className="lg-navs">
            <button type="button" className="lg-btn" onClick={() => nextLevel(-1)} title={full ? 'Achado anterior (N)' : 'Erro anterior (N)'}><Icon name="chevron-up" size={13} /><span>{full ? 'Achado' : 'Erro'}</span></button>
            <button type="button" className="lg-btn" onClick={() => nextLevel(1)} title={full ? 'Próximo achado (n)' : 'Próximo erro (n)'}><Icon name="chevron-down" size={13} /><span>{full ? 'Achado' : 'Erro'}</span></button>
          </span>
        )}
      </div>

      <div className="lg-body" ref={bodyRef}>
        <div className={'lg-main' + (dimmed && sum ? ' is-loading' : '')} ref={mainRef}>
          {!sum ? <div className="lg-muted lg-pad"><Spinner size={12} /> Filtrando…</div>
            : tab === 'lines' ? (
              <>
                <div className="lg-listwrap">
                <LogList id={id} summary={sum} view={view} total={mainTotal} res={res} http={src.http} selPos={sel ? sel.pos : null} listRef={listRef} pins={pinSet}
                  onSelect={(pos, row) => setSel({ pos, i: row.i })} scrollTo={scrollTo} onAtBottom={setAtBottom}
                  empty={(
                    <div className="lg-empty">
                      <Icon name="search-x" size={22} />
                      <b>Nada com esse filtro</b>
                      <span>{sum.n ? `O log tem ${fmtNum(sum.n)} entradas — afrouxe o filtro, os níveis ou o intervalo de tempo.` : 'O arquivo ainda está vazio.'}</span>
                      {(q || levels || range) && <button type="button" className="lg-btn is-accent" onClick={() => set({ q: '', levels: null, range: null })}><Icon name="filter-x" size={13} /><span>Limpar filtros</span></button>}
                    </div>
                  )} />
                {markData && mainTotal > 0 && (
                  <Marks data={markData} pos={sel && sel.pos != null ? sel.pos : null} total={mainTotal} onGo={(p) => goTo(p)} />
                )}
                </div>
                {(full || pins.length > 0) && (
                  <Hits id={id} sum={sum} res={res} http={src.http} k={hitK} height={hitsSplit.size} dragging={hitsSplit.dragging} grip={hitsSplit.grip} onOpen={() => setLay((l) => ({ ...l, hitsH: HITS_DEFAULT }))}
                    scrollTo={hitScroll} listRef={hitsRef} onPick={(k, i) => pickHit(k, i)} onStep={nextHit}
                    showHits={full} tab={full ? hitsTab : 'pins'} onTab={(t) => set({ hitsTab: t })}
                    pins={pins} onJumpPin={(i) => jumpToEntry(i)} onUnpin={(i) => setPins((l) => l.filter((p) => p.i !== i))} />
                )}
                {newCount > 0 && !atBottom && (
                  <button type="button" className="lg-newlines" style={full || pins.length > 0 ? { bottom: hitsSplit.size + HITS_HEAD + 14 } : undefined} onClick={() => { goTo(mainTotal - 1, 'end'); setNewCount(0); }}>
                    <Icon name="arrow-down" size={13} /> {fmtNum(newCount)} nova{newCount === 1 ? '' : 's'}
                  </button>
                )}
              </>
            ) : tab === 'problems' ? (
              <Problems id={id} sum={sum} openedAt={openedAt} res={res} selKey={null}
                onPick={(g) => setSel({ pos: null, i: g.lastIdx })} onFilter={addFilter}
                aiSlot={aiOn(cfg) ? (groups) => (
                  <>
                    <AiButton ai={aiInc} label="Resumir" onClick={() => summarize(groups)} title="Resumir os problemas do filtro com IA (os textos passam pelo filtro de segredos)" />
                  </>
                ) : null}
                aiPanel={aiOn(cfg) ? <AiPanel ai={aiInc} className="lg-ai" /> : null} />
            ) : (
              <Charts id={id} sum={sum} onFilter={(t) => addFilter(t, false) || set({ tab: 'lines' })} onLevels={(lv) => set({ levels: lv, tab: 'lines' })} />
            )}
        </div>
        {sel && tab !== 'charts' && (
          <div className={'lg-side' + (detailSplit.dragging ? ' is-dragging' : '')} style={{ width: detailSplit.size }}>
            <div className="lg-grip is-v" role="separator" aria-orientation="vertical" aria-label="Largura do detalhe (arraste; duplo clique alterna)"
              aria-valuemin={DETAIL_MIN} aria-valuemax={DETAIL_MAX} aria-valuenow={detailSplit.size} tabIndex={0} {...detailSplit.grip} />
            <Detail id={id} i={sel.i} res={res} http={src.http} toast={toast} onClose={() => setSel(null)}
              onAddFilter={addFilter} onJump={jumpToEntry} onFollow={follow} pinned={pinSet.has(sel.i)} onPin={togglePin}
              ai={aiOn(cfg) ? aiErr : null}
              aiSlot={aiOn(cfg) ? (entry) => <AiButton ai={aiErr} label="Explicar" onClick={() => explain(entry)} title="Explicar o erro com IA (o texto passa pelo filtro de segredos)" /> : null}
              dbServers={dbServers} />
          </div>
        )}
      </div>

      <footer className="lg-status">
        {sum ? (full
          ? <span>{fmtNum(sum.total)} achado{sum.total === 1 ? '' : 's'} em {fmtNum(mainTotal)} entradas</span>
          : <span>{fmtNum(sum.total)} de {fmtNum(sum.n)} entradas{sum.total !== sum.n ? ' (filtro)' : ''}</span>) : <span>…</span>}
        {dimmed && <Spinner size={11} />}
        {sum && sum.tsMin != null && <span className="lg-muted">{fmtTime(sum.tsMin, { date: true, millis: false })} → {fmtTime(sum.tsMax, { date: true, millis: false })}</span>}
        <span className="lg-grow" />
        {same.text && (
          <span className="lg-same" title="Ocorrências do texto selecionado nas linhas que estão na tela">
            <span className="lg-same__swatch" />
            <code>{same.text.length > 40 ? same.text.slice(0, 40) + '…' : same.text}</code>
            <span className="lg-muted">{same.count} na tela</span>
            <button type="button" className="lg-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => { addFilter(filterTermFor(same.text)); set({ tab: 'lines' }); }} title="Filtrar o log inteiro por este texto">
              <Icon name="filter" size={12} /><span>Filtrar</span>
            </button>
          </span>
        )}
        <span className="lg-muted lg-keys">↑↓ navegar · n/N erro · w aviso · m fixar · End fim · Ctrl+F buscar</span>
        <span className="lg-muted">{src.formatLabel} · {src.encoding}</span>
      </footer>
    </div>
  );
}
