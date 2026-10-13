// Banco — aba Deadlocks: os deadlocks que o system_health registrou (lidos pelo coletor, sem repetir) e o desenho de
// cada um: processos em cima, recursos embaixo; seta tracejada = espera o recurso, contínua = segura o recurso.
// A vítima (o processo que o SQL Server derrubou) vem com ícone e rótulo, não só cor.
import { DS } from '../../lib/ds.js';
import { useAiMode, useAiTask, AiButton, AiPanel, aiOn } from '../../ai/ui.jsx';
import { dbApi, errText, fmtTime, fmtDur, ago, copyText, oneLine } from './shared.jsx';

const { Icon, Spinner } = DS;

const BOX_W = 210;
const BOX_H = 64;
const RES_W = 190;
const RES_H = 50;

function DeadlockGraph({ g }) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(760);
  React.useEffect(() => {
    const el = ref.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const P = g.processes; const R = g.resources;
  const n = Math.max(P.length, R.length, 1);
  const width = Math.max(w, n * (BOX_W + 24));
  const px = (i, cnt, bw) => (width / cnt) * i + (width / cnt - bw) / 2;
  const pos = {};
  P.forEach((p, i) => { pos[p.id] = { x: px(i, P.length, BOX_W), y: 10 }; });
  const rpos = {};
  R.forEach((r, i) => { rpos[r.id] = { x: px(i, R.length, RES_W), y: 170 }; });
  const H = 170 + RES_H + 14;
  const arrows = [];
  R.forEach((r) => {
    const rp = rpos[r.id];
    r.waiters.forEach((wt) => { const p = pos[wt.process]; if (p) arrows.push({ kind: 'wait', from: { x: p.x + BOX_W * 0.35, y: p.y + BOX_H }, to: { x: rp.x + RES_W * 0.35, y: rp.y }, label: `espera ${wt.mode}` }); });
    r.holders.forEach((h) => { const p = pos[h.process]; if (p) arrows.push({ kind: 'hold', from: { x: rp.x + RES_W * 0.65, y: rp.y }, to: { x: p.x + BOX_W * 0.65, y: p.y + BOX_H }, label: `segura ${h.mode}` }); });
  });
  return (
    <div className="db-dlgraph tk-scroll" ref={ref}>
      <svg width={width} height={H} role="img" aria-label={`Deadlock entre ${P.length} processos em ${R.length} recursos`}>
        <defs>
          <marker id="dl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" className="db-dl-arrowhead" /></marker>
        </defs>
        {arrows.map((a, k) => {
          const my = (a.from.y + a.to.y) / 2;
          return (
            <g key={k}>
              <path d={`M${a.from.x},${a.from.y} C${a.from.x},${my} ${a.to.x},${my} ${a.to.x},${a.to.y}`} className={'db-dl-edge is-' + a.kind} markerEnd="url(#dl-arrow)" />
              <text x={(a.from.x + a.to.x) / 2 + 4} y={my} className="db-dl-edgelabel">{a.label}</text>
            </g>
          );
        })}
        {P.map((p) => {
          const { x, y } = pos[p.id];
          return (
            <g key={p.id} className={'db-dl-proc' + (p.victim ? ' is-victim' : '')}>
              <rect x={x} y={y} width={BOX_W} height={BOX_H} rx="6" />
              <text x={x + 10} y={y + 19} className="db-dl-title">{p.victim ? '☠ ' : ''}Sessão {p.spid || '?'}{p.victim ? ' — vítima' : ''}</text>
              <text x={x + 10} y={y + 36} className="db-dl-sub">{[p.app, p.login].filter(Boolean).join(' · ').slice(0, 34)}</text>
              <text x={x + 10} y={y + 52} className="db-dl-sub">{p.lockMode ? `pede ${p.lockMode}` : ''}{p.waitMs ? ` · esperou ${fmtDur(p.waitMs)}` : ''}</text>
            </g>
          );
        })}
        {R.map((r) => {
          const { x, y } = rpos[r.id];
          return (
            <g key={r.id} className="db-dl-res">
              <rect x={x} y={y} width={RES_W} height={RES_H} rx="4" />
              <text x={x + 10} y={y + 19} className="db-dl-title">{(r.object.split('.').pop() || r.label).slice(0, 26)}</text>
              <text x={x + 10} y={y + 36} className="db-dl-sub">{r.label}{r.index ? ` · ${r.index}`.slice(0, 26) : ''}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ProcessCard({ p, toast }) {
  const sql = (p.frames.find((f) => f.text) || {}).text || p.inputBuffer;
  return (
    <div className={'db-dlcard' + (p.victim ? ' is-victim' : '')}>
      <div className="db-dlcard__head">
        <b>Sessão {p.spid}</b>
        {p.victim && <span className="db-tone is-error"><Icon name="skull" size={11} />vítima (o SQL Server desfez esta)</span>}
        <span className="lg-grow" />
        <button type="button" className="lg-icon" onClick={() => copyText(sql, toast, 'SQL copiado')} title="Copiar o SQL"><Icon name="copy" size={13} /></button>
      </div>
      <div className="db-facts is-compact">
        <span>Programa</span><b>{p.app || '—'}</b>
        <span>Login</span><b>{p.login || '—'}{p.host ? ` @ ${p.host}` : ''}</b>
        <span>Banco</span><b>{p.db || '—'}</b>
        <span>Pedia</span><b>{p.lockMode || '—'} em <span className="is-mono">{p.waitResource || '—'}</span></b>
        <span>Isolamento</span><b>{p.isolation || '—'}</b>
        {p.transaction && <><span>Transação</span><b>{p.transaction}{p.tranCount ? ` (${p.tranCount} aberta(s))` : ''}</b></>}
      </div>
      {p.frames.filter((f) => f.proc).length > 0 && (
        <div className="db-dlcard__frames">
          {p.frames.filter((f) => f.proc).slice(0, 4).map((f, k) => <div key={k} className="is-mono"><Icon name="file-code-2" size={11} /> {f.proc}{f.line ? `:${f.line}` : ''}</div>)}
        </div>
      )}
      <pre className="db-sql is-small">{sql || '(sem texto)'}</pre>
    </div>
  );
}

export function Deadlocks({ server, toast }) {
  const [list, setList] = React.useState(null);
  const [sel, setSel] = React.useState(null);
  const [inc, setInc] = React.useState(null);
  const cfg = useAiMode();
  const ai = useAiTask('dbDeadlock', cfg);
  React.useEffect(() => { ai.close(); }, [sel && sel.id]);
  const procSql = (p) => (p.frames.find((f) => f.text) || {}).text || p.inputBuffer;
  const explain = (g) => ai.start(() => ({
    processes: g.processes.map((p) => ({ spid: p.spid, victim: p.victim, app: p.app, login: p.login, isolation: p.isolation, lockMode: p.lockMode, waitResource: p.waitResource, sql: procSql(p) })),
    resources: g.resources.map((r) => ({ type: r.type, object: r.object, index: r.index, holders: r.holders.map((h) => String((g.processes.find((p) => p.id === h.process) || {}).spid || '?')), waiters: r.waiters.map((w) => String((g.processes.find((p) => p.id === w.process) || {}).spid || '?')) })),
  }));
  const toNotes = async (i, g) => {
    const lines = [`**Deadlock** · ${fmtTime(i.t, { date: true })} · ${server.name || server.label}`, '', i.title.replace(/^Deadlock: /, ''), ''];
    for (const p of g.processes) lines.push(`### Sessão ${p.spid}${p.victim ? ' (vítima)' : ''} — ${[p.app, p.login].filter(Boolean).join(' · ')}`, `Pedia ${p.lockMode} em \`${p.waitResource}\` · ${p.isolation}`, '```sql', procSql(p), '```', '');
    try { await window.devkit.notes.create({ title: `Deadlock ${fmtTime(i.t, { date: true, millis: false })} — ${server.name || server.label}`.slice(0, 120), content: lines.join('\n'), tags: ['banco', 'deadlock'], type: 'note', source: 'db' }); toast('Enviado para Notes', 'Deadlock salvo como nota', 'ok'); } catch (e) { toast('Não foi possível criar a nota', errText(e), 'error'); }
  };
  const load = React.useCallback(async () => {
    try { const l = await dbApi().deadlocks(server.id, { from: Date.now() - 7 * 86400e3 }); setList(l); if (l.length && !sel) setSel(l[0]); } catch (e) { setList([]); toast('Deadlocks', errText(e), 'error'); }
  }, [server.id]);
  React.useEffect(() => { setList(null); setSel(null); setInc(null); load(); }, [server.id]);
  React.useEffect(() => dbApi().onChanged((e) => { if (e.id === server.id && e.type === 'sample' && e.incidents && e.incidents.some((i) => i.kind === 'deadlock')) load(); }), [server.id, load]);
  React.useEffect(() => {
    if (!sel) { setInc(null); return undefined; }
    let alive = true;
    setInc({ busy: true });
    dbApi().incident(server.id, sel.id, sel.t).then((i) => { if (alive) setInc(i); }, (e) => { if (alive) setInc({ error: errText(e) }); });
    return () => { alive = false; };
  }, [sel && sel.id]);

  if (!list) return <div className="lg-muted lg-pad"><Spinner size={12} /> Lendo o histórico…</div>;
  if (!list.length) {
    return (
      <div className="lg-empty">
        <Icon name="shield-alert" size={22} />
        <b>Nenhum deadlock nos últimos 7 dias</b>
        <span>O monitor lê os deadlocks que o próprio SQL Server registra (sessão system_health) a cada minuto, enquanto estiver conectado. Os que aparecerem ficam aqui com o desenho e o SQL de cada lado.</span>
      </div>
    );
  }
  const g = inc && inc.graph;
  return (
    <div className="db-split">
      <div className="db-split__list tk-scroll" role="list">
        {list.map((d) => (
          <button key={d.id} type="button" role="listitem" className={'db-item' + (sel && sel.id === d.id ? ' is-sel' : '')} onClick={() => setSel(d)}>
            <Icon name="skull" size={14} />
            <span className="db-item__main">
              <b>{fmtTime(d.t, { date: true, millis: false })}</b>
              <small>{oneLine(d.title.replace(/^Deadlock: /, ''), 90)}</small>
            </span>
            <span className="lg-muted">{ago(d.t)}</span>
          </button>
        ))}
      </div>
      <div className="db-split__body tk-scroll">
        {!inc || inc.busy ? <div className="lg-muted lg-pad"><Spinner size={12} /> Carregando…</div>
          : inc.error ? <div className="lg-err lg-pad">{inc.error}</div>
            : !g ? <div className="lg-err lg-pad">Não deu para ler o grafo: {inc.graphError || 'XML vazio'}</div> : (
              <>
                <div className="db-split__head">
                  <h3>{inc.title.replace(/^Deadlock: /, '')}</h3>
                  <span className="lg-grow" />
                  <button type="button" className="lg-btn" onClick={() => copyText(inc.data.xml, toast, 'XML copiado')}><Icon name="copy" size={13} /><span>Copiar XML</span></button>
                  <button type="button" className="lg-btn" onClick={async () => { const f = await dbApi().savePlan(inc.data.xml, `deadlock-${fmtTime(inc.t, { millis: false }).replace(/:/g, '')}`, 'xdl'); if (f) toast('Deadlock salvo', `${f} — abra no SSMS para ver o desenho dele`, 'ok'); }}><Icon name="download" size={13} /><span>Salvar .xdl</span></button>
                  <button type="button" className="lg-btn" onClick={() => toNotes(inc, g)}><Icon name="notebook-pen" size={13} /><span>Notes</span></button>
                  {aiOn(cfg) && <AiButton ai={ai} label="Explicar" title="Explicar o deadlock com IA (o SQL passa pelo filtro de segredos)" onClick={() => explain(g)} />}
                </div>
                {aiOn(cfg) && <AiPanel ai={ai} className="lg-ai" />}
                <DeadlockGraph g={g} />
                <div className="db-legend"><span><i className="is-line is-dash" />espera o recurso</span><span><i className="is-line" />segura o recurso</span><span><Icon name="skull" size={11} /> vítima</span></div>
                <div className="db-dlcards">{g.processes.map((p) => <ProcessCard key={p.id} p={p} toast={toast} />)}</div>
              </>
            )}
      </div>
    </div>
  );
}
