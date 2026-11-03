// Logs — modo Investigação: entradas guardadas num caso, revisadas como um passo a passo (hora, intervalo desde o passo
// anterior, etiqueta, anotação), com ferramentas (contexto, ordem, exportar, Banco) e IA que analisa o caso inteiro.
// Os casos são salvos em disco (logs.json) com cópia do texto: continuam mesmo que o log rotacione.
import { DS } from '../../lib/ds.js';
import { AiPanel, AiButton, aiOn, useAiTask } from '../../ai/ui.jsx';
import { usePersisted } from '../../lib/store.js';
import { redact } from '../../logs/redact.js';
import { TAGS, TAG_LABEL, STATUS_LABEL, searchCases, relatedCases, normalizeCase, addItem, removeItem, patchItem, moveItem, steps, summary, fmtDelta, fmtStamp, headline, toMarkdown, dbHint } from '../../logs/investigation.js';
import { logsApi, errText, LevelBadge, copyText } from './shared.jsx';

const { Icon } = DS;

const LEVEL_NAME = ['—', 'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

/** Seletor de casos: em aberto e resolvidos em grupos separados. */
function CaseSelect({ cases, value, onChange, placeholder, className = 'lg-select' }) {
  const open = cases.filter((x) => x.status !== 'done');
  const done = cases.filter((x) => x.status === 'done');
  const opts = (list) => list.map((x) => <option key={x.id} value={x.id}>{x.title} ({x.items.length})</option>);
  return (
    <select className={className} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Investigação">
      {placeholder && <option value="">{placeholder}</option>}
      {done.length === 0 ? opts(open) : <>
        {open.length > 0 && <optgroup label={`${STATUS_LABEL.open} (${open.length})`}>{opts(open)}</optgroup>}
        <optgroup label={`${STATUS_LABEL.done} (${done.length})`}>{opts(done)}</optgroup>
      </>}
    </select>
  );
}

/** Histórico: busca em tudo o que foi guardado (título, hipótese, conclusão, passos) e abre o caso. */
function History({ cases, onActive, onCreate }) {
  const [q, setQ] = React.useState('');
  const res = React.useMemo(() => searchCases(cases, q), [cases, q]);
  return (
    <div className="lg-case lg-case--empty lg-hist">
      <Icon name="clipboard-list" size={24} />
      <b>{cases.length ? 'Histórico de investigações' : 'Nenhuma investigação ainda'}</b>
      {cases.length === 0 && <span>Guarde entradas do log num caso para revisar o passo a passo, anotar e pedir uma análise à IA. Na aba <b>Linhas</b>, selecione uma entrada e aperte <kbd>i</kbd> (ou <b>Investigar</b> no detalhe).</span>}
      {cases.length > 0 && (
        <>
          <input className="lg-case__ask lg-hist__q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar em títulos, conclusões e passos…" aria-label="Buscar nas investigações" autoFocus />
          <div className="lg-hist__list" role="list">
            {res.length === 0 && <span className="lg-muted">Nada encontrado para “{q}”.</span>}
            {res.map(({ c, where, snippet }) => (
              <button key={c.id} type="button" role="listitem" className="lg-hist__row" onClick={() => onActive(c.id)}>
                <span className="lg-hist__top">
                  <b>{c.title}</b>
                  <span className={'lg-badge' + (c.status === 'done' ? ' is-done' : '')}>{STATUS_LABEL[c.status]}</span>
                  <span className="lg-muted">{c.items.length} passo{c.items.length === 1 ? '' : 's'}</span>
                </span>
                {snippet && <span className="lg-hist__snip"><i>{where}:</i> {snippet}</span>}
                {!snippet && !q && c.conclusion.trim() && <span className="lg-hist__snip"><i>conclusão:</i> {c.conclusion.trim().replace(/\s+/g, ' ').slice(0, 110)}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      <button type="button" className="lg-btn is-accent" onClick={onCreate}><Icon name="plus" size={13} /><span>Nova investigação</span></button>
    </div>
  );
}

/**
 * props: cases, activeId, onActive(id), onCases(fn(lista) → lista), logKey (identifica o log aberto), openId (id do log aberto),
 * cfg (IA), dbServers, onJump(item), onFilter(q), toast
 */
export function Investigation({ cases, activeId, onActive, onCases, logKey, openId, cfg, dbServers, onJump, onFilter, toast }) {
  const api = logsApi();
  const c = cases.find((x) => x.id === activeId) || null;
  const [pref, setPref] = usePersisted('logs.caseOrder', { mode: 'time', ctx: 5 });
  const mode = pref.mode === 'added' ? 'added' : 'time';
  const [open, setOpen] = React.useState(() => new Set());
  const [question, setQuestion] = React.useState('');
  const [renaming, setRenaming] = React.useState(false);
  const [armDel, setArmDel] = React.useState(false);
  const ai = useAiTask('logInvestigation', cfg);
  React.useEffect(() => { setArmDel(false); setRenaming(false); setQuestion(''); ai.close(); }, [activeId]);
  React.useEffect(() => { if (!armDel) return undefined; const t = setTimeout(() => setArmDel(false), 3000); return () => clearTimeout(t); }, [armDel]);

  const update = (patch) => onCases((list) => list.map((x) => (x.id === activeId ? { ...x, ...patch, updatedAt: Date.now() } : x)));
  const setItems = (fn) => update({ items: fn(c.items) });
  const create = () => {
    const nc = normalizeCase({ title: `Investigação ${cases.length + 1}` });
    onCases((list) => [...list, nc]);
    onActive(nc.id);
    setRenaming(true);
  };
  /* O caso já é gravado a cada edição; "salvar" o marca como resolvido (fica no histórico) e limpa a tela. */
  const save = () => {
    if (!c.conclusion.trim()) return;
    update({ status: 'done' });
    toast('Investigação resolvida', `${c.title} — fica no histórico.`, 'ok');
    onActive(null);
  };
  const reopen = () => update({ status: 'open' });
  const remove = () => {
    if (!armDel) { setArmDel(true); return; }
    onCases((list) => list.filter((x) => x.id !== activeId));
    onActive(null);
  };
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  /* ─────────────── Ferramentas ─────────────── */
  const addContext = async (it) => {
    if (!openId || it.i == null || it.path !== logKey) return;
    try {
      const n = pref.ctx || 5;
      const r = await api.context({ id: openId, i: it.i, before: n, after: n });
      let items = c.items; let added = 0;
      for (const row of r.rows) {
        if (row.i === it.i) continue;
        const res = addItem(items, { i: row.i, ts: row.ts, level: row.level, text: row.text, log: it.log, path: it.path, group: row.group || null });
        if (res.added) { items = res.items; added++; }
      }
      update({ items });
      toast(added ? `+${added} entrada${added === 1 ? '' : 's'} de contexto` : 'Nada novo para acrescentar', added ? 'Entraram no passo a passo.' : 'As vizinhas já estão no caso.', 'ok');
    } catch (e) { toast('Não foi possível buscar o contexto', errText(e), 'error'); }
  };
  const md = (safe) => toMarkdown(c, { mode, redact: safe ? (t) => redact(t).text : undefined });
  const toNotes = async () => {
    try {
      await window.devkit.notes.create({ title: `Investigação: ${c.title}`.slice(0, 120), content: md(true), tags: ['logs', 'investigacao'], type: 'note', source: 'logs' });
      toast('Enviado para Notes', c.title, 'ok');
    } catch (e) { toast('Não foi possível criar a nota', errText(e), 'error'); }
  };

  /* ─────────────── IA ─────────────── */
  const analyze = () => ai.start(() => ({
    title: c.title, hypothesis: c.hypothesis, conclusion: c.conclusion, question,
    steps: steps(c.items, mode).list.map((s) => ({
      n: s.n, time: fmtStamp(s.item.ts), level: LEVEL_NAME[s.item.level], delta: s.delta != null ? fmtDelta(s.delta) : '',
      tag: s.item.tag ? TAG_LABEL[s.item.tag] : '', repeat: s.repeat, log: s.item.log, text: s.item.text, note: s.item.note,
    })),
  }));

  if (!c) return <History cases={cases} onActive={onActive} onCreate={create} />;

  const st = steps(c.items, mode);
  const related = relatedCases(cases, c.items, c.id);
  const days = new Set(st.list.map((s) => (s.item.ts != null ? fmtStamp(s.item.ts).slice(0, 10) : ''))).size;
  const filters = ai.st && ai.st.phase === 'done' && ai.st.data && ai.st.data.filters ? ai.st.data.filters : [];

  return (
    <div className="lg-case tk-scroll">
      <div className="lg-case__bar">
        <CaseSelect cases={cases} value={c.id} onChange={onActive} />
        <span className={'lg-badge' + (c.status === 'done' ? ' is-done' : '')}>{STATUS_LABEL[c.status]}</span>
        {renaming
          ? <input className="lg-case__title" autoFocus value={c.title} onChange={(e) => update({ title: e.target.value })} onBlur={() => { if (!c.title.trim()) update({ title: 'Investigação' }); setRenaming(false); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }} aria-label="Nome da investigação" />
          : <button type="button" className="lg-icon" onClick={() => setRenaming(true)} title="Renomear" aria-label="Renomear"><Icon name="pencil" size={14} /></button>}
        <button type="button" className="lg-icon" onClick={() => onActive(null)} title="Histórico e busca" aria-label="Histórico e busca"><Icon name="history" size={14} /></button>
        <button type="button" className="lg-icon" onClick={create} title="Nova investigação" aria-label="Nova investigação"><Icon name="plus" size={15} /></button>
        <button type="button" className={'lg-icon' + (armDel ? ' is-danger' : '')} onClick={remove} title={armDel ? 'Clique de novo para excluir' : 'Excluir esta investigação'} aria-label="Excluir investigação"><Icon name="trash-2" size={14} /></button>
        <span className="lg-grow" />
        <div className="lg-seg" role="group" aria-label="Ordem dos passos">
          <button type="button" className={mode === 'time' ? 'is-on' : ''} onClick={() => setPref({ ...pref, mode: 'time' })} title="Por hora do log">Cronológica</button>
          <button type="button" className={mode === 'added' ? 'is-on' : ''} onClick={() => setPref({ ...pref, mode: 'added' })} title="Na ordem em que foram guardadas (dá para reordenar)">Coleta</button>
        </div>
        <select className="lg-select" value={pref.ctx || 5} onChange={(e) => setPref({ ...pref, ctx: Number(e.target.value) })} title="Quantas entradas vizinhas trazer ao pedir contexto de um passo" aria-label="Contexto">
          {[3, 5, 10, 20].map((n) => <option key={n} value={n}>± {n} de contexto</option>)}
        </select>
        <button type="button" className="lg-btn" disabled={!c.items.length} onClick={() => copyText(md(false), toast, 'Relatório copiado')} title="Copiar o relatório em Markdown"><Icon name="copy" size={13} /><span>Copiar</span></button>
        <button type="button" className="lg-btn" disabled={!c.items.length} onClick={() => copyText(md(true), toast, 'Copiado sem segredos')} title="Senhas, tokens, e-mails e CPFs viram ‹oculto›"><Icon name="shield" size={13} /><span>Sem segredos</span></button>
        <button type="button" className="lg-btn" disabled={!c.items.length} onClick={toNotes} title="Cria uma nota com o relatório (sem segredos)"><Icon name="notebook-pen" size={13} /><span>Notes</span></button>
      </div>

      <div className="lg-case__sum">{summary(c.items, mode)}</div>
      {related.length > 0 && (
        <div className="lg-case__related">
          <span className="lg-muted">Parecido com:</span>
          {related.slice(0, 4).map(({ c: r, shared }) => (
            <button key={r.id} type="button" className="lg-chip" onClick={() => onActive(r.id)} title={`${shared} falha${shared === 1 ? '' : 's'} em comum · ${STATUS_LABEL[r.status]}${r.conclusion.trim() ? ' — ' + r.conclusion.trim().slice(0, 140) : ''}`}>
              <Icon name={r.status === 'done' ? 'check' : 'clipboard-list'} size={11} />{r.title}<span className="lg-muted">· {shared}</span>
            </button>
          ))}
        </div>
      )}

      <div className="lg-case__texts">
        <label><span>Hipótese</span><textarea value={c.hypothesis} onChange={(e) => update({ hypothesis: e.target.value })} placeholder="O que você acha que aconteceu?" rows={2} /></label>
        <label><span>Conclusão</span><textarea value={c.conclusion} onChange={(e) => update({ conclusion: e.target.value })} placeholder="Causa confirmada e o que fazer" rows={2} /></label>
        <div className="lg-case__save">
          {c.status === 'done'
            ? <button type="button" className="lg-btn" onClick={reopen} title="Volta o caso para Em aberto"><Icon name="rotate-ccw" size={13} /><span>Reabrir caso</span></button>
            : <button type="button" className="lg-btn is-accent" disabled={!c.conclusion.trim()} onClick={save} title="Marca como resolvido, guarda no histórico e limpa a tela para uma nova investigação"><Icon name="check" size={13} /><span>Resolvido</span></button>}
        </div>
      </div>

      {aiOn(cfg) && (
        <div className="lg-case__ai">
          <input className="lg-case__ask" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && c.items.length && !ai.busy) analyze(); }}
            placeholder="Perguntar sobre esta investigação (opcional) — ex.: o banco explica o timeout?" aria-label="Pergunta para a IA" />
          <AiButton ai={ai} label={question.trim() ? 'Perguntar' : 'Analisar'} onClick={analyze} disabled={!c.items.length} reason="Sem passos"
            title="A IA lê o passo a passo inteiro (o texto passa pelo filtro de segredos)" />
        </div>
      )}
      {aiOn(cfg) && (
        <AiPanel ai={ai} className="lg-ai"
          actions={[{ label: 'Usar como conclusão', icon: 'file-pen', onClick: () => update({ conclusion: String(ai.st.text || '').trim().slice(0, 4000) }) }]} />
      )}
      {filters.length > 0 && (
        <div className="lg-case__filters">
          <span className="lg-muted">Filtros sugeridos:</span>
          {filters.map((f) => <button key={f} type="button" className="lg-chip" onClick={() => onFilter(f)} title="Aplicar este filtro no log"><Icon name="filter" size={11} /><code>{f}</code></button>)}
        </div>
      )}

      {!c.items.length
        ? <div className="lg-muted lg-pad">Nenhum passo ainda. Na aba <b>Linhas</b>, selecione uma entrada e aperte <kbd>i</kbd> (ou <b>Investigar</b> no detalhe).</div>
        : (
          <ol className="lg-steps">
            {st.list.map((s) => {
              const it = s.item;
              const isOpen = open.has(it.id);
              const here = it.path === logKey && it.i != null;
              const stamp = fmtStamp(it.ts);
              return (
                <li key={it.id} className={'lg-step' + (it.tag ? ' tag-' + it.tag : '')}>
                  <span className="lg-step__n" aria-hidden="true">{s.n}</span>
                  <div className="lg-step__main">
                    <div className="lg-step__head" onClick={() => toggle(it.id)} role="button" tabIndex={0} aria-expanded={isOpen}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(it.id); } }}>
                      <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />
                      <span className="lg-step__time" title={stamp}>{days > 1 ? stamp : stamp.slice(11)}</span>
                      {s.delta != null && <span className="lg-step__delta" title="Tempo desde o passo anterior">{fmtDelta(s.delta)}</span>}
                      <LevelBadge level={it.level} compact={false} />
                      {it.tag && <span className={'lg-step__tag is-' + it.tag}>{TAG_LABEL[it.tag]}</span>}
                      {s.repeat > 0 && <span className="lg-pill" title="O mesmo grupo de falha aparece em mais passos deste caso">mesma falha ×{s.repeat}</span>}
                      {it.log && <span className="lg-muted lg-step__log" title={it.path}>{it.log}</span>}
                    </div>
                    <div className="lg-step__line" title={headline(it, 1000)}>{headline(it, 240)}</div>
                    {isOpen && <pre className="lg-step__text tk-scroll">{it.text}</pre>}
                    {(isOpen || it.note) && (
                      <textarea className="lg-step__note" rows={isOpen ? 2 : 1} value={it.note} placeholder="Anotação deste passo"
                        onChange={(e) => setItems((l) => patchItem(l, it.id, { note: e.target.value }))} aria-label={`Anotação do passo ${s.n}`} />
                    )}
                    <div className="lg-step__acts">
                      {TAGS.map((t) => (
                        <button key={t} type="button" className={'lg-tagbtn is-' + t + (it.tag === t ? ' is-on' : '')} aria-pressed={it.tag === t}
                          onClick={() => setItems((l) => patchItem(l, it.id, { tag: it.tag === t ? '' : t }))}>{TAG_LABEL[t]}</button>
                      ))}
                      <span className="lg-grow" />
                      <button type="button" className="lg-btn" disabled={!here} onClick={() => onJump(it)}
                        title={here ? 'Abrir esta entrada no log' : `Este passo é de outro log${it.log ? ` (${it.log})` : ''} — abra-o para navegar`}><Icon name="locate-fixed" size={12} /><span>Ir ao log</span></button>
                      <button type="button" className="lg-btn" disabled={!here || !openId} onClick={() => addContext(it)}
                        title={here ? `Trazer as ${pref.ctx || 5} entradas antes e depois para o caso` : 'Só para passos do log aberto'}><Icon name="rows-3" size={12} /><span>± contexto</span></button>
                      {dbServers > 0 && it.ts != null && dbHint(it.text) && (
                        <button type="button" className="lg-btn" title="Abre o histórico do Banco (monitor de SQL Server) neste horário"
                          onClick={() => window.devkit.app.command({ type: 'go', route: 'db', params: { at: it.ts } })}><Icon name="database-zap" size={12} /><span>Banco</span></button>
                      )}
                      {mode === 'added' && (
                        <>
                          <button type="button" className="lg-icon" onClick={() => setItems((l) => moveItem(l, it.id, -1))} title="Subir" aria-label="Subir"><Icon name="arrow-up" size={13} /></button>
                          <button type="button" className="lg-icon" onClick={() => setItems((l) => moveItem(l, it.id, 1))} title="Descer" aria-label="Descer"><Icon name="arrow-down" size={13} /></button>
                        </>
                      )}
                      <button type="button" className="lg-icon" onClick={() => setItems((l) => removeItem(l, it.id))} title="Tirar do caso" aria-label="Tirar do caso"><Icon name="x" size={13} /></button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
    </div>
  );
}
