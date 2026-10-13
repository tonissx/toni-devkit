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
import { useSameText, filterTermFor } from './sameText.js';

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
  const { q = '', levels = null, range = null, tab = 'lines', tlMode = 'all', tlFolded = false } = state;
  const set = (patch) => setState((s) => ({ ...s, ...patch }));

  const [sum, setSum] = React.useState(null);
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

  const cfg = useAiMode();
  const aiErr = useAiTask('logError', cfg);
  const aiInc = useAiTask('logIncident', cfg);

  const goTo = (index, align = 'center') => setScrollTo({ index, align, nonce: Math.random() });

  /* ─────────────── Consulta ─────────────── */
  const run = React.useCallback(async () => {
    const qid = ++QSEQ;
    latest.current = qid;
    const wasAppend = appended.current;
    appended.current = false;
    // Ao vivo não mostra "carregando": as linhas novas só aparecem (sem esmaecer a tela a cada gravação).
    if (!wasAppend) setLoading(true);
    try {
      const r = await api.query({ id, qid, q, levels, from: range ? range.from : null, to: range ? range.to : null, buckets: 120 });
      if (latest.current !== qid) return;
      const prev = sumRef.current;
      setSum({ ...r, viaAppend: wasAppend });
      if (first.current) {
        first.current = false;
        if (src.live && r.total) goTo(r.total - 1, 'end'); // como o tail -f: começa no fim
      } else if (wasAppend && prev && r.total > prev.total) {
        if (atBottomRef.current) goTo(r.total - 1, 'end');
        else setNewCount((n) => n + (r.total - prev.total));
      }
    } catch (e) {
      if (latest.current === qid) toast('Não foi possível filtrar', errText(e), 'error');
    } finally { if (latest.current === qid) setLoading(false); }
  }, [id, q, levels && levels.join(','), range && range.from, range && range.to]);
  const runRef = React.useRef(run);
  runRef.current = run;
  React.useEffect(() => { run(); }, [run]);

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
    api.locate({ id, qid: sum.qid, i: sel.i }).then((r) => {
      if (!r || r.stale) return;
      if (r.exact) { setSel((s) => (s && s.i === sel.i ? { ...s, pos: r.pos } : s)); if (!appended.current) goTo(r.pos); } else setSel((s) => (s && s.i === sel.i ? { ...s, pos: null } : s));
    }, () => {});
  }, [sum && sum.qid]);

  // Outra entrada: a explicação anterior não vale mais.
  React.useEffect(() => { aiErr.close(); }, [sel && sel.i]);

  /* ─────────────── Ações ─────────────── */
  const selectPos = async (pos) => {
    if (!sum || pos < 0 || pos >= sum.total) return;
    const r = await api.rows({ id, qid: sum.qid, from: pos, count: 1 });
    if (r && r.rows && r.rows[0]) { setSel({ pos, i: r.rows[0].i }); goTo(pos, 'nearest'); }
  };
  const nextLevel = async (dir, minLevel = 5) => {
    if (!sum) return;
    const from = sel && sel.pos != null ? sel.pos : dir > 0 ? -1 : sum.total;
    const r = await api.next({ id, qid: sum.qid, pos: from, dir, minLevel });
    if (r && r.pos >= 0) { if (tab !== 'lines') set({ tab: 'lines' }); selectPos(r.pos).then(() => goTo(r.pos)); } else toast(dir > 0 ? 'Nenhum erro depois daqui' : 'Nenhum erro antes daqui', '', 'ok');
  };
  const seek = async (t) => {
    if (!sum) return;
    const r = await api.seekTime({ id, qid: sum.qid, t });
    if (r && r.pos != null) { if (tab !== 'lines') set({ tab: 'lines' }); goTo(r.pos); selectPos(r.pos); }
  };
  const addFilter = (term, replace) => {
    const next = replace ? term : (q.split(/\s+/).includes(term) ? q : (q + ' ' + term).trim());
    set({ q: next, ...(replace ? { tab: 'lines' } : {}) });
  };
  const jumpToEntry = async (i) => {
    setSel({ pos: null, i });
    if (!sum) return;
    const r = await api.locate({ id, qid: sum.qid, i });
    if (r && r.exact) { setSel({ pos: r.pos, i }); goTo(r.pos); }
  };
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
    const r = await api.textOf({ id, qid: sum.qid, from: sel && sel.pos != null ? sel.pos : 0, count: 200 });
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
    else if (e.key === 'n') { e.preventDefault(); nextLevel(1); }
    else if (e.key === 'N') { e.preventDefault(); nextLevel(-1); }
    else if (e.key === 'w') { e.preventDefault(); nextLevel(1, 4); }
    else if (e.key === 'End') { e.preventDefault(); goTo(sum.total - 1, 'end'); }
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
        {tab === 'lines' && sum && sum.total > 0 && (
          <span className="lg-navs">
            <button type="button" className="lg-btn" onClick={() => nextLevel(-1)} title="Erro anterior (N)"><Icon name="chevron-up" size={13} /><span>Erro</span></button>
            <button type="button" className="lg-btn" onClick={() => nextLevel(1)} title="Próximo erro (n)"><Icon name="chevron-down" size={13} /><span>Erro</span></button>
          </span>
        )}
      </div>

      <div className="lg-body">
        <div className={'lg-main' + (dimmed && sum ? ' is-loading' : '')}>
          {!sum ? <div className="lg-muted lg-pad"><Spinner size={12} /> Filtrando…</div>
            : tab === 'lines' ? (
              <>
                <LogList id={id} summary={sum} res={res} http={src.http} selPos={sel ? sel.pos : null} listRef={listRef}
                  onSelect={(pos, row) => setSel({ pos, i: row.i })} scrollTo={scrollTo} onAtBottom={setAtBottom}
                  empty={(
                    <div className="lg-empty">
                      <Icon name="search-x" size={22} />
                      <b>Nada com esse filtro</b>
                      <span>{sum.n ? `O log tem ${fmtNum(sum.n)} entradas — afrouxe o filtro, os níveis ou o intervalo de tempo.` : 'O arquivo ainda está vazio.'}</span>
                      {(q || levels || range) && <button type="button" className="lg-btn is-accent" onClick={() => set({ q: '', levels: null, range: null })}><Icon name="filter-x" size={13} /><span>Limpar filtros</span></button>}
                    </div>
                  )} />
                {newCount > 0 && !atBottom && (
                  <button type="button" className="lg-newlines" onClick={() => { goTo(sum.total - 1, 'end'); setNewCount(0); }}>
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
          <Detail id={id} i={sel.i} res={res} http={src.http} toast={toast} onClose={() => setSel(null)}
            onAddFilter={addFilter} onJump={jumpToEntry}
            ai={aiOn(cfg) ? aiErr : null}
            aiSlot={aiOn(cfg) ? (entry) => <AiButton ai={aiErr} label="Explicar" onClick={() => explain(entry)} title="Explicar o erro com IA (o texto passa pelo filtro de segredos)" /> : null} />
        )}
      </div>

      <footer className="lg-status">
        {sum ? <span>{fmtNum(sum.total)} de {fmtNum(sum.n)} entradas{sum.total !== sum.n ? ' (filtro)' : ''}</span> : <span>…</span>}
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
        <span className="lg-muted lg-keys">↑↓ navegar · n/N erro · w aviso · End fim · Ctrl+F buscar</span>
        <span className="lg-muted">{src.formatLabel} · {src.encoding}</span>
      </footer>
    </div>
  );
}
