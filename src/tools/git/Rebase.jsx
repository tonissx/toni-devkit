// Git — reorganizar commits (rebase interativo sem editor): os últimos commits da branch, do mais antigo (em cima) ao
// mais novo; arraste para reordenar e escolha o que fazer com cada um. A prévia mostra como a branch vai ficar.
import { DS } from '../../lib/ds.js';
import { validatePlan, previewPlan } from '../../git/rebase.js';
import { gitApi, useRepoData, errText, short, ago, OpButton } from './shared.jsx';

const { Icon, Spinner, Select } = DS;

const ACTIONS = [
  { value: 'pick', label: 'Manter' },
  { value: 'reword', label: 'Mudar mensagem' },
  { value: 'squash', label: 'Juntar ao de cima' },
  { value: 'fixup', label: 'Juntar (sem a msg)' },
  { value: 'drop', label: 'Remover' },
];
const COUNTS = (cur) => [...new Set([2, 3, 5, 10, 20, 30, cur])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `Últimos ${n}` }));

export function Rebase({ repo, status, run, focus }) {
  const [range, setRange] = React.useState({ count: 5 });
  const [plan, setPlan] = React.useState(null);
  const [drag, setDrag] = React.useState(null);
  const preset = React.useRef(null);
  // Receita "juntar meus últimos commits": chega com { squash: n }.
  React.useEffect(() => { if (focus && focus.squash) { preset.current = focus.squash; setRange({ count: focus.squash }); } }, [focus && focus.nonce]);
  const { data: info, error } = useRepoData(repo, (r) => gitApi().rebaseInfo(r, range), [range.count, range.base]);
  React.useEffect(() => {
    if (!info || !info.commits) return;
    const squash = preset.current;
    preset.current = null;
    setPlan(info.commits.map((c, i) => ({ hash: c.hash, action: squash && i > 0 ? 'squash' : 'pick', message: '' })));
  }, [info]);

  if (status.unborn) return <div className="gt-msg">Ainda não há commits.</div>;
  if (status.operation) return <div className="gt-msg"><Icon name="triangle-alert" size={14} /> Há um {status.operation} em andamento. Termine ou cancele antes de reorganizar.</div>;
  if (error) return <div className="gt-msg is-error">{error}</div>;
  const byHash = info ? Object.fromEntries(info.commits.map((c) => [c.hash, c])) : {};
  // Depois de aplicar, os commits mudam (hashes novos) antes de o plano ser refeito: até lá, só carregando.
  const stale = !plan || !info || plan.length !== info.commits.length || plan.some((s) => !byHash[s.hash]);
  if (stale) return <div className="gt-msg"><Spinner size={14} /> Lendo os commits…</div>;
  let problem = null;
  try { if (info.commits.length) validatePlan(plan, info.commits); } catch (e) { problem = errText(e); }
  if (info.hasMerges) problem = 'Há commits de merge neste intervalo — o rebase os desfaria. Escolha menos commits.';
  const result = previewPlan(plan, byHash);
  const changed = plan.some((s, i) => s.action !== 'pick' || s.hash !== info.commits[i].hash);
  const pushed = new Set(info.pushed);
  const touchesPushed = plan.some((s, i) => pushed.has(s.hash) && (s.action !== 'pick' || s.hash !== info.commits[i].hash));
  const set = (i, patch) => setPlan((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (from, to) => setPlan((p) => { if (to < 0 || to >= p.length) return p; const n = [...p]; const [x] = n.splice(from, 1); n.splice(to, 0, x); return n; });

  return (
    <div className="gt-rebase">
      <div className="gt-rebase__main tk-scroll">
        <div className="gt-toolbar">
          <Select size="sm" options={COUNTS(range.count || 5)} value={String(range.count || 5)} onChange={(v) => setRange({ count: +v })} style={{ width: 130 }} />
          <span className="gt-hint">sobre <code>{short(info.onto)}</code> {info.ontoSubject}</span>
          <span className="gt-toolbar__spacer" />
          <button type="button" className="gt-op is-ghost is-sm" onClick={() => setPlan(info.commits.map((c) => ({ hash: c.hash, action: 'pick', message: '' })))} disabled={!changed}><Icon name="rotate-ccw" size={13} /><span>Recomeçar</span></button>
        </div>
        {info.reason && <div className="gt-msg">{info.reason}</div>}
        <p className="gt-hint gt-rebase__help">Do mais antigo (em cima) ao mais novo. Arraste pela alça para mudar a ordem. “Juntar” une o commit ao de cima.</p>
        <ol className="gt-rb">
          {plan.map((s, i) => {
            const c = byHash[s.hash];
            return (
              <li key={s.hash} className={'gt-rb__item is-' + s.action + (drag === i ? ' is-drag' : '')} draggable
                onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { e.preventDefault(); if (drag != null && drag !== i) { move(drag, i); setDrag(i); } }}
                onDragEnd={() => setDrag(null)}>
                <span className="gt-rb__grip" title="Arraste para reordenar"><Icon name="grip-vertical" size={14} /></span>
                <span className="gt-rb__order">
                  <button type="button" className="gt-op is-ghost is-sm" aria-label="Subir" onClick={() => move(i, i - 1)} disabled={i === 0}><Icon name="arrow-up" size={12} /></button>
                  <button type="button" className="gt-op is-ghost is-sm" aria-label="Descer" onClick={() => move(i, i + 1)} disabled={i === plan.length - 1}><Icon name="arrow-down" size={12} /></button>
                </span>
                <div className="gt-rb__main">
                  <div className="gt-rb__subject"><code>{short(s.hash)}</code> {c.subject}{pushed.has(s.hash) && <span className="gt-tag is-gone" title="Este commit já está na branch remota (push)">já enviado</span>}</div>
                  <div className="gt-rb__meta">{c.author} · {ago(c.time)}</div>
                  {(s.action === 'reword' || s.action === 'squash') && (
                    <input className="gt-rb__msg" value={s.message} onChange={(e) => set(i, { message: e.target.value })}
                      placeholder={s.action === 'reword' ? 'Nova mensagem' : 'Mensagem do commit juntado (vazio = as duas mensagens somadas)'} />
                  )}
                </div>
                <Select size="sm" options={ACTIONS} value={s.action} onChange={(v) => set(i, { action: v, message: v === 'reword' && !s.message ? c.subject : s.message })} style={{ width: 170 }} />
              </li>
            );
          })}
        </ol>
      </div>
      <aside className="gt-rebase__side tk-scroll">
        <h3><Icon name="eye" size={14} /> Como a branch vai ficar</h3>
        <ol className="gt-rb__preview">
          {result.map((r, i) => (
            <li key={i} className={r.from.length > 1 || r.changed ? 'is-changed' : ''}>
              <span className="gt-rb__dot" />
              <span><b>{r.subject}</b>{r.from.length > 1 && <small>juntando {r.from.length} commits</small>}</span>
            </li>
          ))}
          <li className="is-base"><span className="gt-rb__dot" /><span>{info.ontoSubject} <small>(base, não muda)</small></span></li>
        </ol>
        {problem && <div className="gt-err">{problem}</div>}
        {touchesPushed && <div className="gt-hint gt-rb__warn"><Icon name="triangle-alert" size={12} /> Você está mudando commits que já foram enviados. Depois seria preciso um push forçado — evite em branches compartilhadas.</div>}
        <OpButton op={{ op: 'rebase.plan', onto: info.onto || 'HEAD', plan }} run={run} disabled={!changed || !!problem || !info.onto} icon="play" variant="primary" size="md">Aplicar</OpButton>
        <p className="gt-hint">Se aparecer conflito no meio, o git para: resolva em Mudanças e use Continuar (ou Cancelar para voltar como estava). O Devkit guarda um ponto de volta antes.</p>
      </aside>
    </div>
  );
}
