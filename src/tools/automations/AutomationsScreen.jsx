// Automações — gatilho + passos em sequência (estilo n8n, em lista). Passos fixos e confiáveis; o agente de IA entra só onde há julgamento.
// Cada passo enxerga o que os anteriores produziram ({{s1.text}}). Só rodam com o devkit aberto. O histórico guarda entrada, saída, duração e custo por passo.
import { DS } from '../../lib/ds.js';
import { errText, fmtDateTime, ago } from '../../lib/fmt.jsx';
import { RUN_MODES, describePermissions, runPolicy } from '../agents/agentForm.js';
import { DAY_NAMES, KINDS, describeRecurrence } from '../agents/recurrence.js';
import { STEP_TYPES, TYPE_LIST, RISK_LABEL, riskOf, describeAutomation } from './steps.js';

const { PageHeader, Button, IconButton, Input, Field, Textarea, Select, SegmentedControl, Modal, EmptyState, Badge, Icon, Spinner, Alert, Checkbox, Toggle } = DS;

const api = () => window.devkit.automations;
const STATUS = {
  running: { label: 'Rodando', variant: 'info', icon: 'loader' },
  ok: { label: 'Concluída', variant: 'ok', icon: 'circle-check' },
  error: { label: 'Falhou', variant: 'error', icon: 'circle-alert' },
  missed: { label: 'Perdida', variant: 'warn', icon: 'clock' },
  canceled: { label: 'Cancelada', variant: undefined, icon: 'ban' },
  pending: { label: 'Aguardando', variant: undefined, icon: 'circle' },
  skipped: { label: 'Pulado', variant: undefined, icon: 'skip-forward' },
};
const TONE_VARIANT = { ok: 'ok', warn: 'warn', danger: 'error' };
const RISK_VARIANT = { read: 'ok', write: 'warn', exec: 'error' };
const money = (n) => (n == null ? '—' : 'US$ ' + n.toFixed(n < 1 ? 3 : 2));
const dur = (r) => { if (!r.endedAt) return ''; const s = Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000)); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; };
const durMs = (ms) => (ms == null ? '' : ms < 1000 ? ms + ' ms' : ms < 60000 ? (ms / 1000).toFixed(1) + ' s' : Math.floor(ms / 60000) + ' min ' + Math.round((ms % 60000) / 1000) + ' s');

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.error;
  return <Badge size="sm" variant={s.variant}><Icon name={s.icon} size={11} /> {s.label}</Badge>;
}

const REC = { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5], everyMin: 60 };
const BLANK_STEP = {
  agent: { agent: '', cwd: '', prompt: '', mode: 'read', allowWrite: false, maxBudgetUsd: 1 },
  notify: { title: 'Automação', text: '' },
};
const nextId = (steps) => 's' + (steps.reduce((m, s) => Math.max(m, Number(String(s.id).slice(1)) || 0), 0) + 1);
const BLANK = { name: '', enabled: true, notify: true, trigger: { type: 'manual' }, steps: [] };

/** Botões que inserem `{{...}}` no campo: o gatilho e a saída (texto) dos passos anteriores. */
function RefChips({ before, onInsert }) {
  const refs = [{ ref: 'trigger.date', label: 'data' }, { ref: 'trigger.time', label: 'hora' }, ...before.map((s) => ({ ref: s.id + '.text', label: `${s.id} · ${s.name || STEP_TYPES[s.type].label}` }))];
  return (
    <div className="au-chips"><span className="ag-muted">Inserir:</span>
      {refs.map((r) => <button key={r.ref} type="button" className="au-chip" onClick={() => onInsert('{{' + r.ref + '}}')} title={'{{' + r.ref + '}}'}>{r.label}</button>)}
    </div>
  );
}

function StepEditor({ step, index, total, before, agents, onChange, onMove, onRemove, toast }) {
  const c = step.config;
  const set = (p) => onChange({ ...step, config: { ...c, ...p } });
  const T = STEP_TYPES[step.type];
  const risk = riskOf(step);
  const agent = step.type === 'agent' ? agents.find((a) => a.name === c.agent) || null : null;
  const pol = agent ? runPolicy(agent, c.mode) : null;
  const pd = pol && pol.ok ? describePermissions(pol.perms) : null;
  const pick = () => window.devkit.agents.pickDir().then((p) => { if (p) set({ cwd: p }); }, (e) => toast('Não foi possível escolher a pasta', errText(e), 'error'));
  const add = (field) => (txt) => set({ [field]: (c[field] || '') + txt });

  return (
    <div className="au-step">
      <div className="au-step__top">
        <Icon name={T.icon} size={14} />
        <b>{index + 1}. {T.label}</b>
        <code className="au-step__id">{step.id}</code>
        <Badge size="sm" variant={RISK_VARIANT[risk]}>{RISK_LABEL[risk]}</Badge>
        <span className="ag-sc__sp" />
        <IconButton icon="arrow-up" label="Subir" size="sm" disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton icon="arrow-down" label="Descer" size="sm" disabled={index === total - 1} onClick={() => onMove(1)} />
        <IconButton icon="trash-2" label="Remover passo" size="sm" onClick={onRemove} />
      </div>
      <Field label="Nome do passo" hint="Opcional.">
        <Input value={step.name} placeholder={T.label} onChange={(e) => onChange({ ...step, name: e.target.value })} />
      </Field>
      {step.type === 'agent' && <>
        <div className="ag-row">
          <Field label="Agente">
            <Select options={[{ value: '', label: agents.length ? 'Escolha…' : 'Crie um agente primeiro' }, ...agents.map((a) => ({ value: a.name, label: a.name }))]} value={c.agent} onChange={(v) => set({ agent: v })} />
          </Field>
          <Field label="Teto de custo (US$)" hint="Para ao atingir.">
            <Input type="number" min={0.1} step={0.5} value={c.maxBudgetUsd} style={{ width: 110 }} onChange={(e) => set({ maxBudgetUsd: e.target.value })} />
          </Field>
        </div>
        <Field label="Pasta de trabalho" hint="Onde o agente roda (o projeto que ele vai ler).">
          <div className="ag-pick"><Input value={c.cwd} placeholder="C:\projetos\meu-repo" onChange={(e) => set({ cwd: e.target.value })} /><Button variant="secondary" icon="folder-open" onClick={pick}>Escolher…</Button></div>
        </Field>
        <Field label="O que o agente deve fazer" hint="O agente só vê este texto. Use os botões para trazer o resultado dos passos anteriores.">
          <Textarea rows={4} value={c.prompt} placeholder="ex.: Resuma o que está atrasado:\n{{s1.text}}" onChange={(e) => set({ prompt: e.target.value })} />
          <RefChips before={before} onInsert={add('prompt')} />
        </Field>
        <Field label="O que ele pode fazer sozinho">
          <SegmentedControl size="sm" options={RUN_MODES.map((m) => ({ value: m.value, label: m.label }))} value={c.mode} onChange={(v) => set({ mode: v, allowWrite: v === 'agent' ? c.allowWrite : false })} />
          <p className="ag-muted ag-hint">{RUN_MODES.find((m) => m.value === c.mode).hint}</p>
        </Field>
        {pol && !pol.ok && <Alert variant="error" title="Não dá para rodar assim">{pol.problem}</Alert>}
        {pd && <Alert variant={TONE_VARIANT[pd.tone]} title={pd.title}>{pd.text} Nada é perguntado em segundo plano: o que não estiver liberado é negado.</Alert>}
        {c.mode === 'agent' && <Checkbox label="Entendo que este passo pode alterar arquivos sem ninguém olhando, e aprovo." checked={!!c.allowWrite} onChange={(v) => set({ allowWrite: typeof v === 'boolean' ? v : !c.allowWrite })} />}
      </>}
      {step.type === 'notify' && <>
        <Field label="Título"><Input value={c.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Texto do aviso">
          <Textarea rows={3} value={c.text} placeholder="ex.: {{s1.text}}" onChange={(e) => set({ text: e.target.value })} />
          <RefChips before={before} onInsert={add('text')} />
        </Field>
      </>}
    </div>
  );
}

function AutomationModal({ initial, agents, onClose, onSaved, toast }) {
  const [d, setD] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const set = (p) => setD((x) => ({ ...x, ...p }));
  const setStep = (i, st) => setD((x) => ({ ...x, steps: x.steps.map((s, j) => (j === i ? st : s)) }));
  const move = (i, dir) => setD((x) => { const a = [...x.steps]; const j = i + dir; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, steps: a }; });
  const addStep = (type) => setD((x) => ({ ...x, steps: [...x.steps, { id: nextId(x.steps), type, name: '', config: { ...BLANK_STEP[type], agent: type === 'agent' && agents[0] ? agents[0].name : '' } }] }));
  const removeStep = (i) => setD((x) => ({ ...x, steps: x.steps.filter((_, j) => j !== i) }));
  const trig = d.trigger;
  const rec = trig.recurrence || REC;
  const setTrig = (p) => set({ trigger: { ...trig, ...p } });
  const setRec = (p) => setTrig({ recurrence: { ...rec, ...p } });
  const toggleDay = (n) => setRec({ days: rec.days.includes(n) ? rec.days.filter((x) => x !== n) : [...rec.days, n] });
  const summary = d.steps.length ? describeAutomation(d) : null;

  const save = async () => {
    setBusy(true);
    try {
      const a = await api().save(d);
      toast('Automação salva', a.trigger.type === 'schedule' ? describeRecurrence(a.trigger.recurrence) : 'Só roda quando você mandar', 'ok');
      onSaved(); onClose();
    } catch (e) { toast('Não foi possível salvar', errText(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} icon="workflow" title={initial.id ? 'Editar automação' : 'Nova automação'} width={760}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" icon="save" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</Button></>}>
      <div className="ag-form">
        <Field label="Nome da automação"><Input value={d.name} placeholder="ex.: Resumo da manhã" onChange={(e) => set({ name: e.target.value })} /></Field>

        <Field label="Gatilho — quando roda">
          <div className="ag-when">
            <Select options={[{ value: 'manual', label: 'Só quando eu mandar' }, { value: 'schedule', label: 'Em um horário' }]} value={trig.type} style={{ width: 200 }}
              onChange={(v) => set({ trigger: v === 'schedule' ? { type: 'schedule', recurrence: rec } : { type: 'manual' } })} />
            {trig.type === 'schedule' && <>
              <Select options={KINDS} value={rec.kind} onChange={(v) => setRec({ kind: v })} style={{ width: 190 }} />
              {rec.kind === 'interval'
                ? <><span className="ag-muted">a cada</span><Input type="number" min={5} value={rec.everyMin} style={{ width: 90 }} onChange={(e) => setRec({ everyMin: e.target.value })} /><span className="ag-muted">minutos (mín. 5)</span></>
                : <><span className="ag-muted">às</span><Input type="time" value={rec.time} style={{ width: 120 }} onChange={(e) => setRec({ time: e.target.value })} /></>}
            </>}
          </div>
          {trig.type === 'schedule' && rec.kind === 'weekly' && <div className="ag-days">{DAY_NAMES.map((n, i) => <Checkbox key={i} label={n} checked={rec.days.includes(i)} onChange={() => toggleDay(i)} />)}</div>}
        </Field>

        <div className="au-steps">
          <b>Passos</b>
          {!d.steps.length && <p className="ag-muted">Nenhum passo ainda. Cada passo recebe o que os anteriores produziram.</p>}
          {d.steps.map((s, i) => (
            <StepEditor key={s.id} step={s} index={i} total={d.steps.length} before={d.steps.slice(0, i)} agents={agents} toast={toast}
              onChange={(st) => setStep(i, st)} onMove={(dir) => move(i, dir)} onRemove={() => removeStep(i)} />
          ))}
          <div className="au-add">
            {TYPE_LIST.map((t) => <Button key={t} size="sm" variant="secondary" icon={STEP_TYPES[t].icon} onClick={() => addStep(t)} title={STEP_TYPES[t].hint}>+ {STEP_TYPES[t].label}</Button>)}
          </div>
        </div>

        {summary && <Alert variant={TONE_VARIANT[{ read: 'ok', write: 'warn', exec: 'danger' }[summary.risk]]} title={'Esta automação faz: ' + RISK_LABEL[summary.risk].toLowerCase()}>{summary.text}</Alert>}
        <Checkbox label="Avisar quando terminar" checked={d.notify} onChange={(v) => set({ notify: typeof v === 'boolean' ? v : !d.notify })} />
        <p className="ag-muted"><Icon name="info" size={12} /> Só rodam enquanto o Toni Devkit está aberto (pode ficar na bandeja). Horários perdidos viram “Perdida” no histórico e não rodam atrasados. Se um passo falhar, os seguintes não rodam.</p>
      </div>
    </Modal>
  );
}

function RunModal({ id, onClose, toast }) {
  const [run, setRun] = React.useState(null);
  const [open, setOpen] = React.useState({});
  React.useEffect(() => { api().run(id).then(setRun, (e) => toast('Não foi possível abrir a execução', errText(e), 'error')); }, [id]);
  const goSession = (sid) => { window.devkit.app.command({ type: 'go', route: 'aimon', params: { sel: 'claude:' + sid } }); onClose(); };
  return (
    <Modal open onClose={onClose} icon="history" title={run ? run.name : 'Execução'} width={760} footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
      {!run ? <Spinner size={18} /> : (
        <div className="ag-form">
          <div className="ag-meta"><StatusBadge status={run.status} /><span>{fmtDateTime(run.startedAt)}</span>{dur(run) && <span>{dur(run)}</span>}<span>{money(run.costUsd)}</span><span className="ag-muted">{run.trigger === 'manual' ? 'Manual' : 'Agendada'}</span></div>
          {run.error && <Alert variant={run.status === 'missed' ? 'warn' : 'error'} title={run.status === 'missed' ? 'Pulada' : 'Problema'}>{run.error}</Alert>}
          <ol className="au-tl">
            {run.steps.map((s) => (
              <li key={s.id} className={'au-tl__item is-' + s.status}>
                <div className="au-tl__head">
                  <StatusBadge status={s.status} />
                  <b>{s.name}</b><code className="au-step__id">{s.id}</code>
                  <span className="ag-muted">{durMs(s.durationMs)}</span>
                  {s.costUsd != null && <span className="ag-muted">{money(s.costUsd)}</span>}
                  <span className="ag-sc__sp" />
                  {s.sessionId && <Button size="sm" variant="ghost" icon="bot" onClick={() => goSession(s.sessionId)}>Ver no Monitor de IA</Button>}
                  {(s.input || s.output) && <Button size="sm" variant="ghost" icon={open[s.id] ? 'chevron-up' : 'chevron-down'} onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>{open[s.id] ? 'Recolher' : 'Entrada e saída'}</Button>}
                </div>
                {s.error && <p className="au-tl__err">{s.error}</p>}
                {open[s.id] && <>
                  {s.input && <><span className="ag-muted">Entrada</span><pre className="ag-result">{s.input}</pre></>}
                  {s.output && <><span className="ag-muted">Saída</span><pre className="ag-result">{s.output}</pre></>}
                </>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}

export function AutomationsScreen({ toast, request }) {
  const [data, setData] = React.useState(null);
  const [agents, setAgents] = React.useState([]);
  const [edit, setEdit] = React.useState(null);
  const [viewRun, setViewRun] = React.useState(null);
  const [del, setDel] = React.useState(null);
  const fail = (title) => (e) => toast(title, errText(e), 'error');

  const load = React.useCallback(() => api().list().then(setData, fail('Não foi possível carregar as automações')), []);
  React.useEffect(() => { load(); window.devkit.agents.list().then(setAgents, () => {}); }, []);
  React.useEffect(() => { let raf = 0; const off = api().onChanged(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; load(); }); }); return () => { off(); if (raf) cancelAnimationFrame(raf); }; }, [load]);
  React.useEffect(() => { if (request && request.run) setViewRun(request.run); }, [request && request.nonce]);

  const runningRun = (aid) => data && data.runs.find((r) => r.automationId === aid && r.status === 'running');

  return (
    <div className="ag">
      <PageHeader icon="workflow" title="Automações" subtitle={data ? `${data.automations.length} automação(ões) — passos fixos; o agente de IA só onde precisa` : 'Carregando…'}
        actions={<Button variant="primary" icon="plus" onClick={() => setEdit(JSON.parse(JSON.stringify(BLANK)))}>Nova automação</Button>} />
      {!data ? <div className="ag-center"><Spinner size={18} /></div> : (
        <div className="ag-routines">
          <span className="ag-muted"><Icon name="info" size={12} /> Rodam só com o devkit aberto.</span>
          {!data.automations.length ? (
            <EmptyState icon="workflow" title="Nenhuma automação ainda" description="Monte um gatilho e uma sequência de passos — por exemplo, todo dia às 8h um agente resume algo e você recebe um aviso. Por padrão tudo só lê." />
          ) : (
            <div className="ag-sched">
              {data.automations.map((a) => {
                const live = runningRun(a.id);
                const sum = describeAutomation(a);
                return (
                  <div key={a.id} className={'ag-sc' + (a.enabled ? '' : ' is-off')}>
                    <div className="ag-sc__top">
                      <b>{a.name}</b>
                      <Badge size="sm" variant={RISK_VARIANT[sum.risk]}>{RISK_LABEL[sum.risk]}</Badge>
                      <span className="ag-sc__sp" />
                      {a.trigger.type === 'schedule' && <Toggle checked={a.enabled} aria-label="Ligada" onChange={(v) => api().enabled(a.id, typeof v === 'boolean' ? v : !a.enabled).then(load, fail('Não foi possível alterar'))} />}
                    </div>
                    <div className="ag-sc__meta"><Icon name="repeat" size={12} /> {a.trigger.type === 'schedule' ? describeRecurrence(a.trigger.recurrence) : 'Só quando você mandar'}</div>
                    <div className="ag-sc__meta"><Icon name="list-ordered" size={12} /> {sum.text}</div>
                    <div className="ag-sc__meta">
                      {a.trigger.type === 'schedule' && (a.enabled && a.nextRunAt ? <>Próxima: {fmtDateTime(a.nextRunAt)}</> : <>Desligada</>)}
                      {a.lastStatus && <> {a.trigger.type === 'schedule' ? '· ' : ''}Última: <StatusBadge status={a.lastStatus} /> {a.lastRunAt ? ago(a.lastRunAt) : ''}</>}
                    </div>
                    <div className="ag-sc__act">
                      {live
                        ? <Button size="sm" variant="secondary" icon="square" onClick={() => api().runCancel(live.id).then(load, fail('Não foi possível cancelar'))}>Cancelar execução</Button>
                        : <Button size="sm" variant="secondary" icon="play" onClick={() => api().runNow(a.id).then((r) => { if (r.status === 'error') toast('A execução falhou', r.error, 'error'); load(); }, fail('Não foi possível rodar'))}>Rodar agora</Button>}
                      <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEdit(JSON.parse(JSON.stringify(a)))}>Editar</Button>
                      <Button size="sm" variant="ghost" icon="trash-2" onClick={() => setDel(a)}>Excluir</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="ag-hist__head"><b>Histórico</b>{data.runs.length > 0 && <Button size="sm" variant="ghost" icon="eraser" onClick={() => api().historyClear().then(load, fail('Não foi possível limpar'))}>Limpar</Button>}</div>
          {!data.runs.length ? <p className="ag-muted ag-pad">Nada rodou ainda.</p> : (
            <div className="ag-hist">
              {data.runs.map((r) => (
                <button key={r.id} type="button" className="ag-run" onClick={() => setViewRun(r.id)}>
                  <StatusBadge status={r.status} />
                  <b>{r.name}</b>
                  <span className="ag-muted">{fmtDateTime(r.startedAt)}</span>
                  <span className="ag-muted">{dur(r)}</span>
                  <span className="ag-muted">{money(r.costUsd)}</span>
                  <span className="ag-muted">{r.steps.filter((s) => s.status === 'ok').length}/{r.steps.length} passos</span>
                  {r.trigger === 'manual' && <span className="ag-muted">manual</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {edit && <AutomationModal initial={edit} agents={agents} onClose={() => setEdit(null)} onSaved={load} toast={toast} />}
      {viewRun && <RunModal id={viewRun} onClose={() => setViewRun(null)} toast={toast} />}
      {del && (
        <Modal open onClose={() => setDel(null)} icon="trash-2" title={`Excluir “${del.name}”?`} width={440}
          description="A automação deixa de rodar. O histórico das execuções já feitas continua."
          footer={<><Button variant="ghost" onClick={() => setDel(null)}>Cancelar</Button><Button variant="destructive" icon="trash-2" onClick={() => api().remove(del.id).then(() => { setDel(null); load(); }, fail('Não foi possível excluir'))}>Excluir</Button></>} />
      )}
    </div>
  );
}
