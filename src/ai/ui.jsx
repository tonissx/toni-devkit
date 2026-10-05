// IA — peças de tela compartilhadas por todas as ferramentas: modo atual, execução de uma tarefa (com confirmação na
// Nuvem, streaming, Esc para parar), o painel de resultado ("Ver o que é enviado", ações) e o botão ✦.
// As tarefas (o que é enviado) ficam em src/ai/tasks.js; quem chama só monta a entrada e decide o que fazer com a saída.
import { DS } from '../lib/ds.js';
import { renderMarkdown } from '../notes/markdown.js';

const { Icon, Spinner } = DS;
const api = () => window.devkit.ai;
const CLOUD_OK = 'tk.ai.cloudOk';
let seq = 0;

export const aiErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
export const aiOn = (cfg) => !!cfg && cfg.mode !== 'off';
export const aiDest = (cfg) => (!cfg ? '' : cfg.mode === 'local' ? `Ollama nesta máquina · ${cfg.localModel}` : `API da Anthropic · ${cfg.cloudModel}`);
const secs = (ms) => (ms / 1000).toFixed(1).replace('.', ',') + ' s';

/** Configuração da IA (null até carregar); atualiza quando muda em qualquer janela. */
export function useAiMode() {
  const [cfg, setCfg] = React.useState(null);
  React.useEffect(() => {
    if (!window.devkit || !window.devkit.ai) return undefined;
    let alive = true;
    api().config().then((c) => { if (alive) setCfg(c); }, () => {});
    const off = api().onChanged((c) => setCfg(c));
    return () => { alive = false; off(); };
  }, []);
  return cfg;
}

/**
 * Executa uma tarefa da IA. start(gather): gather() → entrada (pode ser async). Na Nuvem, pede confirmação até a
 * pessoa dispensar. Callbacks opcionais: onStart(), onChunk(pedaço), onDone(resultado), onFail(mensagem).
 * → { st, busy, start, cancel, close, confirm, toggleReq, cfg }
 *   st: null | { phase: 'confirm'|'busy'|'done'|'error', req, input, text, data, ms, model, error, showReq }
 */
export function useAiTask(task, cfg, callbacks = {}) {
  const [st, setSt] = React.useState(null);
  const reqId = React.useRef(null);
  const cbs = React.useRef(callbacks);
  cbs.current = callbacks;
  React.useEffect(() => api().onChunk((p) => {
    if (p.requestId !== reqId.current) return;
    setSt((s) => (s ? { ...s, text: (s.text || '') + p.chunk } : s));
    if (cbs.current.onChunk) cbs.current.onChunk(p.chunk);
  }), []);
  React.useEffect(() => () => { if (reqId.current) api().cancel(reqId.current); }, []);

  const send = async (input, req) => {
    const id = `${task}-${Date.now()}-${++seq}`;
    reqId.current = id;
    setSt((s) => ({ phase: 'busy', req, input, text: '', showReq: !!(s && s.showReq) }));
    if (cbs.current.onStart) cbs.current.onStart();
    try {
      const r = await api().generate(id, task, input);
      if (reqId.current !== id) return;
      setSt((s) => ({ ...s, phase: 'done', text: r.text, data: r.data, ms: r.ms, model: r.model }));
      if (cbs.current.onDone) cbs.current.onDone(r);
    } catch (e) {
      if (reqId.current !== id) return;
      const msg = aiErr(e);
      if (cbs.current.onFail) cbs.current.onFail(msg);
      setSt((s) => (msg === 'Cancelado' ? null : { ...s, phase: 'error', error: msg }));
    } finally { if (reqId.current === id) reqId.current = null; }
  };
  const start = async (gather) => {
    if (reqId.current) return;
    try {
      const input = await gather();
      if (input == null) return;
      const req = await api().buildRequest(task, input);
      let ok = false;
      try { ok = localStorage.getItem(CLOUD_OK) === '1'; } catch { /* ignore */ }
      if (cfg && cfg.mode === 'cloud' && !ok) { setSt({ phase: 'confirm', req, input }); return; }
      send(input, req);
    } catch (e) { setSt({ phase: 'error', error: aiErr(e) }); }
  };
  const confirm = (always) => {
    if (always) { try { localStorage.setItem(CLOUD_OK, '1'); } catch { /* ignore */ } }
    if (st) send(st.input, st.req);
  };
  const cancel = () => { if (reqId.current) api().cancel(reqId.current); };
  const close = () => { cancel(); setSt(null); };
  const toggleReq = () => setSt((s) => (s ? { ...s, showReq: !s.showReq } : s));
  const busy = !!st && st.phase === 'busy';
  React.useEffect(() => {
    if (!busy) return undefined;
    const h = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [busy]);
  return { st, busy, start, cancel, close, confirm, toggleReq, cfg };
}

/** Markdown da resposta (HTML cru escapado pelo renderMarkdown). onLink(título) para os [[links]]. */
export function AiMarkdown({ text, onLink, resolve }) {
  const html = React.useMemo(() => renderMarkdown(String(text || ''), { resolve: resolve || (() => null) }).html, [text, resolve]);
  const click = (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.note && onLink) onLink(a.dataset.note);
    else if (/^https?:/.test(a.getAttribute('href') || '')) window.devkit.shell.openUrl(a.getAttribute('href'));
  };
  // eslint-disable-next-line react/no-danger
  return <div className="ai-md" onClick={click} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Botão ✦ da IA. Ocupado: vira "Parar". Desabilitado com motivo: o motivo aparece no próprio botão. */
export function AiButton({ ai, label, onClick, disabled, reason, className = '', title }) {
  const busy = ai && ai.busy;
  const off = !busy && disabled;
  return (
    <button type="button" className={'ai-btn ' + className + (busy ? ' is-on' : '')} disabled={off}
      title={busy ? 'Parar (Esc)' : off ? reason || title : title || `${label} com IA (${aiDest(ai && ai.cfg)})`}
      onClick={busy ? ai.cancel : onClick}>
      {busy ? <Spinner size={11} /> : <Icon name="sparkles" size={12} />}<span>{busy ? 'Parar' : off && reason ? reason : label}</span>
    </button>
  );
}

/**
 * Painel de resultado: status (destino, tempo, erro), "Ver o que é enviado", confirmação da Nuvem e ações.
 * body: 'markdown' (padrão) | 'none' | função (st) → nó. actions: [{ label, icon, onClick, primary, hidden }] — só com a
 * resposta pronta. extraLinks: [{ label, onClick }] na linha de status (ex.: Desfazer).
 */
export function AiPanel({ ai, body = 'markdown', actions = [], extraLinks = [], onLink, resolve, className = '' }) {
  const st = ai.st;
  if (!st) return null;
  const { req } = st;
  const dest = aiDest(ai.cfg);
  const icon = st.phase === 'error' ? 'circle-alert' : ai.cfg && ai.cfg.mode === 'local' ? 'cpu' : 'cloud';
  const showBody = (st.phase === 'busy' || st.phase === 'done') && body !== 'none';
  return (
    <div className={'ai-panel is-' + st.phase + ' ' + className}>
      <div className="ai-panel__line">
        <Icon name={icon} size={13} />
        <span className="ai-panel__text">
          {st.phase === 'confirm' && <>Enviar para a <b>{dest}</b>?{req && req.files ? ` Vão ${req.files.length} arquivo${req.files.length === 1 ? '' : 's'} do diff${req.omitted && req.omitted.length ? ` (${req.omitted.length} só pelo nome)` : ''}.` : ''} Confira em “Ver o que é enviado”.</>}
          {st.phase === 'busy' && <>{req ? req.label : 'Gerando'} com {dest}… <span className="ai-panel__muted">Esc para parar</span></>}
          {st.phase === 'done' && <>{req ? req.label : 'Pronto'} · {st.model} · {secs(st.ms)} <span className="ai-panel__muted">— revise antes de usar</span></>}
          {st.phase === 'error' && st.error}
        </span>
        {req && <button type="button" className="ai-panel__link" onClick={ai.toggleReq}>{st.showReq ? 'Ocultar pedido' : 'Ver o que é enviado'}</button>}
        {st.phase === 'done' && extraLinks.map((l) => <button key={l.label} type="button" className="ai-panel__link" onClick={l.onClick}>{l.label}</button>)}
        {st.phase === 'busy'
          ? <button type="button" className="ai-panel__link" onClick={ai.cancel}>Parar</button>
          : st.phase !== 'confirm' && <button type="button" className="ai-panel__x" title="Fechar" onClick={ai.close}><Icon name="x" size={12} /></button>}
      </div>
      {req && req.cloudHint && ai.cfg && ai.cfg.mode === 'local' && st.phase !== 'error' && (
        <div className="ai-panel__hint"><Icon name="info" size={12} /> O modelo local pode errar nesta tarefa; a Nuvem (Claude) vai melhor. Revise com cuidado.</div>
      )}
      {st.phase === 'confirm' && (
        <div className="ai-panel__actions">
          <button type="button" className="ai-act is-primary" onClick={() => ai.confirm(false)}><Icon name="send" size={12} /><span>Enviar</span></button>
          <button type="button" className="ai-act" onClick={() => ai.confirm(true)}>Enviar e não perguntar de novo</button>
          <button type="button" className="ai-act is-ghost" onClick={ai.close}>Cancelar</button>
        </div>
      )}
      {showBody && (
        <div className="ai-panel__body tk-scroll">
          {typeof body === 'function' ? body(st) : st.text ? <AiMarkdown text={st.text} onLink={onLink} resolve={resolve} /> : <span className="ai-panel__muted"><Spinner size={11} /> pensando…</span>}
        </div>
      )}
      {st.phase === 'done' && actions.some((a) => !a.hidden) && (
        <div className="ai-panel__actions">
          {actions.filter((a) => !a.hidden).map((a) => (
            <button key={a.label} type="button" className={'ai-act' + (a.primary ? ' is-primary' : '')} disabled={a.disabled} onClick={a.onClick}>
              {a.icon && <Icon name={a.icon} size={12} />}<span>{a.label}</span>
            </button>
          ))}
        </div>
      )}
      {req && st.showReq && (
        <div className="ai-panel__req tk-scroll">
          <div className="ai-panel__reqhead">Destino: {dest}{req.truncated ? ' · conteúdo cortado no limite de tamanho' : ''}</div>
          <div className="ai-panel__reqlabel">Instruções (system)</div>
          <pre>{req.system}</pre>
          <div className="ai-panel__reqlabel">Pedido</div>
          <pre>{req.user}</pre>
        </div>
      )}
    </div>
  );
}

/** Copia texto e avisa pelo toast (quando houver). */
export async function aiCopy(text, toast, what = 'Copiado') {
  await window.devkit.clipboard.write(String(text || ''));
  if (toast) toast(what, 'Na área de transferência');
}
