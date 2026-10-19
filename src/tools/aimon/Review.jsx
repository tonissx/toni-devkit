// Monitor de IA — revisão automática: quando a sessão fica ociosa e há alterações, a IA LOCAL revisa o diff sozinha e o card
// ganha o selo "Revisado". Só com a IA em modo Local (o diff nunca sai da máquina sem você pedir) e só se você ligar aqui.
// O resultado fica na memória do app. Cálculo e fila: electron/aimon/review.js.
import { DS } from '../../lib/ds.js';
import { AiMarkdown, useAiMode } from '../../ai/ui.jsx';
import { errText, ago } from '../../lib/fmt.jsx';

const { Icon, Spinner } = DS;

const api = () => window.devkit.aimon;

/** Estado do selo de um cartão de sessão: null | { tone, icon, text, title }. `review`: { state, ts } da linha da sessão. */
export function reviewBadge(s) {
  const r = s && s.review;
  if (!r) return null;
  if (r.state === 'running') return { tone: 'run', icon: 'loader', text: 'Revisando…', title: 'A IA local está revisando as alterações desta sessão' };
  if (r.state === 'done') {
    const stale = (s.lastTs || 0) > r.ts + 1000;
    return stale
      ? { tone: 'stale', icon: 'shield-alert', text: 'Revisão desatualizada', title: 'Houve atividade depois da última revisão automática. Abra a aba Alterações para revisar de novo.' }
      : { tone: 'ok', icon: 'shield-check', text: 'Revisado', title: 'As alterações foram revisadas automaticamente pela IA local. Veja o resultado na aba Alterações.' };
  }
  if (r.state === 'error') return { tone: 'stale', icon: 'circle-alert', text: 'Revisão falhou', title: 'A revisão automática não terminou. Veja a aba Alterações.' };
  return null;
}

export function AutoReview({ session, toast }) {
  const cfg = useAiMode();
  const [on, setOn] = React.useState(false);
  const [rv, setRv] = React.useState(null);
  const key = session.key;
  const local = !!cfg && cfg.mode === 'local';

  const load = React.useCallback(() => { api().review(key).then(setRv, () => {}); }, [key]);
  React.useEffect(() => { setRv(null); load(); }, [key]);
  React.useEffect(() => { api().prefs().then((p) => setOn(!!(p && p.autoReview)), () => {}); }, []);
  React.useEffect(() => {
    let raf = 0;
    const off = api().onChanged(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; load(); }); });
    return () => { off(); if (raf) cancelAnimationFrame(raf); };
  }, [load]);

  const toggle = () => api().setAutoReview(!on).then((v) => {
    setOn(v);
    toast(v ? 'Revisão automática ligada' : 'Revisão automática desligada', v ? 'Quando uma sessão ficar ociosa com alterações, a IA local revisa o diff e o card ganha o selo “Revisado”.' : 'Nada será revisado sozinho.', 'ok');
  }, (e) => toast('Monitor de IA', errText(e), 'error'));
  const again = () => Promise.resolve().then(() => api().reviewRun(key)).then(load, (e) => toast('Revisão automática', errText(e), 'warn'));

  const stale = rv && rv.state === 'done' && (session.lastTs || 0) > rv.ts + 1000;
  return (
    <div className="am-rv">
      <div className="am-rv__bar">
        <button type="button" className={'lg-btn' + (on ? ' is-accent' : '')} aria-pressed={on} onClick={toggle} disabled={!local && !on}
          title={local || on ? 'Revisar sozinho as alterações quando a sessão ficar ociosa (só com a IA em modo Local)' : 'A revisão automática só funciona com a IA em modo Local (Configurações). Com a Nuvem, use “Revisar alterações”.'}>
          <Icon name="shield-check" size={12} /><span>{on ? 'Revisão automática: ligada' : 'Revisão automática'}</span>
        </button>
        {!local && on && <span className="lg-muted"><Icon name="info" size={11} /> pausada: a IA não está em modo Local</span>}
        {rv && rv.state === 'running' && <span className="lg-muted"><Spinner size={11} /> Revisando…</span>}
        {rv && rv.state === 'done' && <span className={'am-alert is-card ' + (stale ? '' : 'is-ok')}><Icon name={stale ? 'shield-alert' : 'shield-check'} size={11} />{stale ? 'Revisão desatualizada' : 'Revisado'} · {ago(rv.ts)}{rv.model ? ` · ${rv.model}` : ''}</span>}
        {rv && (rv.state === 'done' || rv.state === 'error' || rv.state === 'none') && <button type="button" className="lg-btn" disabled={!local} onClick={again} title={local ? 'Revisa de novo o diff atual com a IA local' : 'Só com a IA em modo Local'}><Icon name="refresh-cw" size={12} /><span>Revisar de novo</span></button>}
      </div>
      {rv && rv.state === 'error' && <div className="am-note"><Icon name="circle-alert" size={12} />A revisão automática falhou: {rv.error}</div>}
      {rv && rv.state === 'none' && <div className="am-note"><Icon name="info" size={12} />Sem alterações para revisar.</div>}
      {rv && rv.state === 'done' && rv.text && (
        <div className="ai-panel is-done am-priv"><div className="ai-panel__body tk-scroll"><AiMarkdown text={rv.text} /></div></div>
      )}
    </div>
  );
}
