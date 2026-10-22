// Logs — detalhe de uma entrada: mensagem, campos, stack trace (frames do framework apagados, "Caused by" em
// destaque), contexto sem filtro (±50 entradas) e ações (copiar, copiar sem segredos, filtrar pelo grupo, Notes).
import { DS } from '../../lib/ds.js';
import { redact } from '../../logs/redact.js';
import { AiPanel } from '../../ai/ui.jsx';
import { logsApi, errText, LevelBadge, Highlight, fmtDateTime, fmtTime, fmtMs, fmtNum, copyText } from './shared.jsx';
import { displayText } from './LogList.jsx';
import { termFor } from '../../logs/query.js';

const { Icon, Spinner } = DS;

const FRAMEWORK = /^\s*at (?:java\.|javax\.|jakarta\.|sun\.|jdk\.|com\.sun\.|org\.jboss\.|org\.wildfly\.|io\.undertow\.|org\.hibernate\.|org\.springframework\.|org\.apache\.|com\.fasterxml\.|org\.eclipse\.|io\.netty\.|java\.base\/)/;

/** Stack com os frames "do usuário" em destaque; sequências longas de frames do framework ficam recolhidas. */
function Stack({ text, res }) {
  const [open, setOpen] = React.useState(false);
  const lines = String(text || '').split('\n');
  const out = [];
  let run = [];
  const flush = (k) => {
    if (!run.length) return;
    if (run.length > 3 && !open) {
      out.push(<div key={'f' + k} className="lg-stack__line is-fw is-fold" onClick={() => setOpen(true)} role="button" tabIndex={0}>… {run.length} frames do framework (clique para ver)</div>);
    } else run.forEach((l, j) => out.push(<div key={'f' + k + '-' + j} className="lg-stack__line is-fw"><Highlight text={l} res={res} /></div>));
    run = [];
  };
  lines.forEach((l, k) => {
    if (FRAMEWORK.test(l)) { run.push(l); return; }
    flush(k);
    const cls = /^\s*(Caused by:|Suppressed:)/.test(l) ? ' is-cause' : /^\s*at /.test(l) ? ' is-user' : /^\s*\.\.\. \d+/.test(l) ? ' is-fw' : '';
    out.push(<div key={k} className={'lg-stack__line' + cls}><Highlight text={l} res={res} /></div>);
  });
  flush('end');
  return <div className="lg-stack">{out}</div>;
}

function Fields({ entry, onFollow }) {
  const p = entry.parsed;
  const rows = [];
  if (p.logger) rows.push(['logger', p.logger]);
  if (p.thread) rows.push(['thread', p.thread]);
  if (p.http) {
    const h = p.http;
    rows.push(['requisição', `${h.method} ${h.path}${h.query ? '?' + h.query : ''}`]);
    rows.push(['status', String(h.status) + (h.sub && h.sub !== '0' ? `.${h.sub}` : '') + (h.win32 && h.win32 !== '0' ? ` (win32 ${h.win32})` : '')]);
    if (Number.isFinite(h.ms)) rows.push(['tempo', fmtMs(h.ms)]);
    if (h.ip) rows.push(['ip', h.ip]);
    if (h.user) rows.push(['usuário', h.user]);
    if (h.bytes) rows.push(['bytes', fmtNum(h.bytes)]);
    if (h.referer) rows.push(['referer', h.referer]);
    if (h.ua) rows.push(['user agent', h.ua]);
  } else if (p.fields) {
    for (const [k, v] of Object.entries(p.fields)) {
      if (rows.length > 60) break;
      if (p.json && ['msg', 'message', 'level', 'time', 'timestamp', '@timestamp', 'logger', 'name', 'thread'].includes(k)) continue;
      rows.push([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    }
  }
  if (!rows.length) return null;
  return (
    <table className="lg-fields"><tbody>
      {rows.map(([k, v]) => {
        const term = onFollow ? termFor(k, v) : '';
        return (
          <tr key={k}>
            <th>{k}</th>
            <td>
              {v}
              {term && <button type="button" className="lg-follow" onClick={() => onFollow(term)} title={`Seguir: filtrar por ${term}`} aria-label={`Filtrar por ${k}`}><Icon name="filter" size={11} /></button>}
            </td>
          </tr>
        );
      })}
    </tbody></table>
  );
}

function Context({ id, i, res, onJump, http }) {
  const [rows, setRows] = React.useState(null);
  const at = React.useRef(null);
  React.useEffect(() => {
    let alive = true;
    logsApi().context({ id, i, before: 50, after: 50 }).then((r) => { if (alive) setRows(r.rows); }, () => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [id, i]);
  React.useEffect(() => { if (at.current) at.current.scrollIntoView({ block: 'center' }); }, [rows]);
  if (!rows) return <div className="lg-muted"><Spinner size={12} /> Carregando o contexto…</div>;
  return (
    <div className="lg-context tk-scroll">
      {rows.map((r) => (
        <div key={r.i} ref={r.i === i ? at : null} className={'lg-ctx lv-' + r.level + (r.i === i ? ' is-at' : '')} onClick={() => r.i !== i && onJump(r.i)} title="Abrir esta entrada">
          <span className="lg-ctx__time">{fmtTime(r.ts)}</span>
          <LevelBadge level={r.level} compact />
          <span className="lg-ctx__text"><Highlight text={displayText(r, http)} res={res} /></span>
          {r.lines > 1 && <span className="lg-row__more"><Icon name="chevrons-down" size={11} />{r.lines - 1}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * props: id, i (entrada), res, http, onClose, onAddFilter(term), onJump(i), toast, aiSlot(entry) (botão/painel da IA)
 */
// Erro que fala de banco: vale perguntar ao Banco o que estava acontecendo naquela hora.
const DB_HINT = /\b(sql|jdbc|timeout|deadlock|lock request|database|banco|connection|conex[aã]o|ORA-\d|SQLException|SQLTimeout|tedious|sqlserver|mssql)/i;

export function Detail({ id, i, res, http, onClose, onFold, pinned, onPin, onFollow, onAddFilter, onJump, toast, aiSlot, ai, dbServers }) {
  const [entry, setEntry] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [tab, setTab] = React.useState('entry');
  React.useEffect(() => {
    let alive = true;
    setError(null);
    logsApi().entry({ id, i }).then((e) => { if (alive) setEntry(e); }, (e) => { if (alive) setError(errText(e)); });
    return () => { alive = false; };
  }, [id, i]);

  const toNotes = async () => {
    if (!entry) return;
    const p = entry.parsed;
    const title = (`Log: ${(p.msg || entry.text).split('\n')[0]}`).slice(0, 120);
    const content = [
      `**${entry.levelLabel}** · ${fmtDateTime(entry.ts)} · \`${entry.segment}\`${p.logger ? ` · \`${p.logger}\`` : ''}`,
      entry.group ? `\nGrupo: ${entry.group.title} — ${entry.group.total} ocorrência(s)` : '',
      '\n```\n' + entry.text + '\n```\n',
    ].join('\n');
    try {
      await window.devkit.notes.create({ title, content, tags: ['logs'], type: 'note', source: 'logs' });
      toast('Enviado para Notes', title, 'ok');
    } catch (e) { toast('Não foi possível criar a nota', errText(e), 'error'); }
  };

  if (error) return <aside className="lg-detail"><div className="lg-detail__head"><span className="lg-err">{error}</span><button type="button" className="lg-icon" onClick={onClose}><Icon name="x" size={14} /></button></div></aside>;
  if (!entry || entry.i !== i) return <aside className="lg-detail"><div className="lg-muted"><Spinner size={12} /> Carregando…</div></aside>;
  const p = entry.parsed;
  const g = entry.group;
  const msg = p.msg != null && p.msg !== '' ? p.msg : entry.text.split('\n')[0];

  return (
    <aside className="lg-detail" aria-label="Detalhe da entrada">
      <div className="lg-detail__head">
        <LevelBadge level={entry.level} />
        <span className="lg-detail__when" title={entry.segment}>{fmtDateTime(entry.ts)}{Number.isFinite(entry.ts) && <small>.{String(new Date(entry.ts).getMilliseconds()).padStart(3, '0')}</small>}</span>
        <span className="lg-detail__file" title={entry.segment}><Icon name="file-text" size={11} /> {entry.segment}</span>
        <span className="lg-grow" />
        {onPin && <button type="button" className={'lg-icon' + (pinned ? ' is-on' : '')} onClick={() => onPin(entry)} aria-pressed={!!pinned} title={pinned ? 'Soltar esta entrada (m)' : 'Fixar esta entrada para voltar depois (m)'} aria-label={pinned ? 'Soltar entrada' : 'Fixar entrada'}><Icon name="pin" size={14} /></button>}
        {onFold && <button type="button" className="lg-icon" onClick={onFold} title="Recolher o detalhe" aria-label="Recolher detalhe"><Icon name="chevron-right" size={14} /></button>}
        <button type="button" className="lg-icon" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar detalhe"><Icon name="x" size={14} /></button>
      </div>
      <div className="lg-detail__actions">
        <button type="button" className="lg-btn" onClick={() => copyText(entry.text, toast, 'Entrada copiada')}><Icon name="copy" size={13} /><span>Copiar</span></button>
        <button type="button" className="lg-btn" onClick={() => { const r = redact(entry.text); copyText(r.text, toast, r.count ? `Copiado sem ${r.count} segredo(s)` : 'Copiado (nada para esconder)'); }} title="Troca senhas, tokens, e-mails e CPFs por ‹oculto›"><Icon name="shield" size={13} /><span>Copiar sem segredos</span></button>
        <button type="button" className="lg-btn" onClick={toNotes}><Icon name="notebook-pen" size={13} /><span>Notes</span></button>
        {onFollow && p.thread && termFor('thread', p.thread) && (
          <button type="button" className="lg-btn" onClick={() => onFollow(termFor('thread', p.thread))} title={`Filtrar por ${termFor('thread', p.thread)} — vê tudo o que essa thread fez`}><Icon name="route" size={13} /><span>Seguir thread</span></button>
        )}
        {aiSlot && aiSlot(entry)}
        {dbServers > 0 && Number.isFinite(entry.ts) && DB_HINT.test(entry.text.slice(0, 20000)) && (
          <button type="button" className="lg-btn" title="Abre o histórico do Banco (monitor de SQL Server) neste horário"
            onClick={() => window.devkit.app.command({ type: 'go', route: 'db', params: { at: entry.ts } })}>
            <Icon name="database-zap" size={13} /><span>O que o banco fazia?</span>
          </button>
        )}
      </div>
      {g && (
        <div className="lg-group-card">
          <div className="lg-group-card__title"><Icon name="layers" size={13} /> <b>{g.title}</b></div>
          <div className="lg-group-card__meta">
            {fmtNum(g.total)} ocorrência{g.total === 1 ? '' : 's'} no log · primeira {fmtTime(g.first, { date: true, millis: false })} · última {fmtTime(g.last, { date: true, millis: false })}
          </div>
          <div className="lg-group-card__acts">
            <button type="button" className="lg-btn" onClick={() => onAddFilter('group:' + g.key, true)}><Icon name="filter" size={12} /><span>Só este problema</span></button>
            <button type="button" className="lg-btn" onClick={() => onAddFilter('-group:' + g.key)}><Icon name="eye-off" size={12} /><span>Esconder</span></button>
          </div>
        </div>
      )}
      <div className="lg-detail__tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'entry'} className={tab === 'entry' ? 'is-on' : ''} onClick={() => setTab('entry')}>Entrada</button>
        <button type="button" role="tab" aria-selected={tab === 'context'} className={tab === 'context' ? 'is-on' : ''} onClick={() => setTab('context')}>Contexto (±50, sem filtro)</button>
        <button type="button" role="tab" aria-selected={tab === 'raw'} className={tab === 'raw' ? 'is-on' : ''} onClick={() => setTab('raw')}>Original</button>
      </div>
      <div className="lg-detail__body tk-scroll">
        {ai && <AiPanel ai={ai} className="lg-ai" />}
        {tab === 'entry' && (
          <>
            <div className="lg-msg"><Highlight text={msg} res={res} /></div>
            <Fields entry={entry} onFollow={onFollow} />
            {p.stack && <Stack text={p.stack} res={res} />}
            {entry.cut && <div className="lg-muted">Entrada muito grande: mostrando os primeiros 2 MB.</div>}
          </>
        )}
        {tab === 'context' && <Context id={id} i={i} res={res} http={http} onJump={onJump} />}
        {tab === 'raw' && <pre className="lg-raw"><Highlight text={entry.text} res={res} /></pre>}
      </div>
    </aside>
  );
}
