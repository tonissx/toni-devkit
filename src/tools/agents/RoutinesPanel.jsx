// Rotinas dos Agentes — agenda um agente para rodar sozinho (`claude -p` em segundo plano), só com o devkit aberto.
// Cada rotina diz o que o agente pode fazer sem ninguém olhando (por padrão, só ler); o histórico guarda o resultado e liga à sessão no Monitor de IA.
import { DS } from '../../lib/ds.js';
import { errText, fmtDateTime, ago } from '../../lib/fmt.jsx';
import { RUN_MODES, describePermissions, runPolicy } from './agentForm.js';
import { DAY_NAMES, KINDS, describeRecurrence } from './recurrence.js';

const { Button, IconButton, Input, Field, Textarea, Select, SegmentedControl, Modal, EmptyState, Badge, Icon, Spinner, Alert, Checkbox, Toggle } = DS;

const api = () => window.devkit.agents;
const STATUS = {
  running: { label: 'Rodando', variant: 'info', icon: 'loader' },
  ok: { label: 'Concluída', variant: 'ok', icon: 'circle-check' },
  error: { label: 'Falhou', variant: 'error', icon: 'circle-alert' },
  missed: { label: 'Perdida', variant: 'warn', icon: 'clock' },
  canceled: { label: 'Cancelada', variant: undefined, icon: 'ban' },
};
const TONE_VARIANT = { ok: 'ok', warn: 'warn', danger: 'error' };
const money = (n) => (n == null ? '—' : 'US$ ' + n.toFixed(n < 1 ? 3 : 2));
const dur = (r) => { if (!r.endedAt) return ''; const s = Math.max(0, Math.round((r.endedAt - r.startedAt) / 1000)); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; };

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.error;
  return <Badge size="sm" variant={s.variant}><Icon name={s.icon} size={11} /> {s.label}</Badge>;
}

const BLANK = { name: '', agent: '', cwd: '', prompt: '', mode: 'read', recurrence: { kind: 'daily', time: '08:00', days: [1, 2, 3, 4, 5], everyMin: 60 }, maxBudgetUsd: 1, notify: true, enabled: true };

function RoutineModal({ initial, agents, onClose, onSaved, toast }) {
  const [d, setD] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const set = (p) => setD((x) => ({ ...x, ...p }));
  const setRec = (p) => setD((x) => ({ ...x, recurrence: { ...x.recurrence, ...p } }));
  const agent = agents.find((a) => a.name === d.agent) || null;
  const pol = agent ? runPolicy(agent, d.mode) : null;
  const pd = pol && pol.ok ? describePermissions(pol.perms) : null;
  const rec = d.recurrence;

  const pick = () => api().pickDir().then((p) => { if (p) set({ cwd: p }); }, (e) => toast('Não foi possível escolher a pasta', errText(e), 'error'));
  const save = async () => {
    setBusy(true);
    try { const s = await api().routineSave(d); toast('Rotina salva', describeRecurrence(s.recurrence), 'ok'); onSaved(); onClose(); } catch (e) { toast('Não foi possível salvar', errText(e), 'error'); } finally { setBusy(false); }
  };
  const toggleDay = (n) => setRec({ days: rec.days.includes(n) ? rec.days.filter((x) => x !== n) : [...rec.days, n] });

  return (
    <Modal open onClose={onClose} icon="calendar-clock" title={initial.id ? 'Editar rotina' : 'Nova rotina'} width={640}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" icon="save" disabled={busy || (pol && !pol.ok)} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</Button></>}>
      <div className="ag-form">
        <div className="ag-row">
          <Field label="Agente">
            <Select options={[{ value: '', label: agents.length ? 'Escolha…' : 'Crie um agente primeiro' }, ...agents.map((a) => ({ value: a.name, label: a.name }))]} value={d.agent} onChange={(v) => set({ agent: v })} />
          </Field>
          <Field label="Nome da rotina" hint="Opcional.">
            <Input value={d.name} placeholder={d.agent || 'ex.: Revisão da manhã'} onChange={(e) => set({ name: e.target.value })} />
          </Field>
        </div>
        <Field label="Pasta de trabalho" hint="Onde o agente roda (o projeto que ele vai ler).">
          <div className="ag-pick"><Input value={d.cwd} placeholder="C:\projetos\meu-repo" onChange={(e) => set({ cwd: e.target.value })} /><Button variant="secondary" icon="folder-open" onClick={pick}>Escolher…</Button></div>
        </Field>
        <Field label="O que fazer a cada execução" hint="Escreva como se estivesse pedindo na conversa.">
          <Textarea rows={4} value={d.prompt} placeholder="ex.: Revise os commits de ontem e liste riscos." onChange={(e) => set({ prompt: e.target.value })} />
        </Field>

        <Field label="Quando">
          <div className="ag-when">
            <Select options={KINDS} value={rec.kind} onChange={(v) => setRec({ kind: v })} style={{ width: 190 }} />
            {rec.kind === 'interval'
              ? <><span className="ag-muted">a cada</span><Input type="number" min={5} value={rec.everyMin} style={{ width: 90 }} onChange={(e) => setRec({ everyMin: e.target.value })} /><span className="ag-muted">minutos (mín. 5)</span></>
              : <><span className="ag-muted">às</span><Input type="time" value={rec.time} style={{ width: 120 }} onChange={(e) => setRec({ time: e.target.value })} /></>}
          </div>
          {rec.kind === 'weekly' && <div className="ag-days">{DAY_NAMES.map((n, i) => <Checkbox key={i} label={n} checked={rec.days.includes(i)} onChange={() => toggleDay(i)} />)}</div>}
        </Field>

        <Field label="O que ele pode fazer sozinho">
          <SegmentedControl size="sm" options={RUN_MODES.map((m) => ({ value: m.value, label: m.label }))} value={d.mode} onChange={(v) => set({ mode: v })} />
          <p className="ag-muted ag-hint">{RUN_MODES.find((m) => m.value === d.mode).hint}</p>
        </Field>
        {pol && !pol.ok && <Alert variant="error" title="Não dá para agendar assim">{pol.problem}</Alert>}
        {pd && <Alert variant={TONE_VARIANT[pd.tone]} title={pd.title}>{pd.text} Nada é perguntado em segundo plano: o que não estiver liberado é negado.</Alert>}

        <div className="ag-row">
          <Field label="Teto de custo por execução (US$)" hint="A execução para ao atingir.">
            <Input type="number" min={0.1} step={0.5} value={d.maxBudgetUsd} style={{ width: 120 }} onChange={(e) => set({ maxBudgetUsd: e.target.value })} />
          </Field>
          <Checkbox label="Avisar quando terminar" checked={d.notify} onChange={(v) => set({ notify: typeof v === 'boolean' ? v : !d.notify })} />
        </div>
        <p className="ag-muted"><Icon name="info" size={12} /> As rotinas só rodam enquanto o Toni Devkit está aberto (pode ficar na bandeja). Horários perdidos viram “Perdida” no histórico e não rodam atrasados.</p>
      </div>
    </Modal>
  );
}

function RunModal({ id, onClose, toast }) {
  const [run, setRun] = React.useState(null);
  React.useEffect(() => { api().run(id).then(setRun, (e) => toast('Não foi possível abrir a execução', errText(e), 'error')); }, [id]);
  const openSession = () => { window.devkit.app.command({ type: 'go', route: 'aimon', params: { sel: 'claude:' + run.sessionId } }); onClose(); };
  return (
    <Modal open onClose={onClose} icon="history" title={run ? run.name : 'Execução'} width={720}
      footer={<>{run && run.sessionId && <Button variant="secondary" icon="bot" onClick={openSession}>Ver no Monitor de IA</Button>}<Button variant="ghost" onClick={onClose}>Fechar</Button></>}>
      {!run ? <Spinner size={18} /> : (
        <div className="ag-form">
          <div className="ag-meta"><StatusBadge status={run.status} /><span>{fmtDateTime(run.startedAt)}</span>{dur(run) && <span>{dur(run)}</span>}<span>{money(run.costUsd)}</span>{run.turns != null && <span>{run.turns} turno(s)</span>}<span className="ag-muted">{run.trigger === 'manual' ? 'Manual' : 'Agendada'}</span></div>
          <span className="ag-muted"><Icon name="folder" size={12} /> {run.cwd}</span>
          {run.error && <Alert variant={run.status === 'missed' ? 'warn' : 'error'} title={run.status === 'missed' ? 'Pulada' : 'Problema'}>{run.error}</Alert>}
          {run.result && <pre className="ag-result">{run.result}</pre>}
          {!run.result && !run.error && <p className="ag-muted">Sem texto de resposta.</p>}
        </div>
      )}
    </Modal>
  );
}

export function RoutinesPanel({ toast, agents, request }) {
  const [data, setData] = React.useState(null);
  const [edit, setEdit] = React.useState(null);
  const [viewRun, setViewRun] = React.useState(null);
  const [del, setDel] = React.useState(null);
  const fail = (title) => (e) => toast(title, errText(e), 'error');

  const load = React.useCallback(() => api().routines().then(setData, fail('Não foi possível carregar as rotinas')), []);
  React.useEffect(() => { load(); }, []);
  React.useEffect(() => { let raf = 0; const off = api().onChanged(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; load(); }); }); return () => { off(); if (raf) cancelAnimationFrame(raf); }; }, [load]);
  React.useEffect(() => { if (request && request.run) setViewRun(request.run); }, [request && request.nonce]);

  if (!data) return <div className="ag-center"><Spinner size={18} /></div>;
  const { schedules, runs } = data;
  const runningRun = (sid) => runs.find((r) => r.scheduleId === sid && r.status === 'running');

  return (
    <div className="ag-routines">
      <div className="ag-routines__bar">
        <Button variant="primary" icon="plus" onClick={() => setEdit({ ...BLANK, agent: agents[0] ? agents[0].name : '' })}>Nova rotina</Button>
        <span className="ag-muted"><Icon name="info" size={12} /> Rodam só com o devkit aberto.</span>
      </div>

      {!schedules.length ? (
        <EmptyState icon="calendar-clock" title="Nenhuma rotina ainda" description="Agende um agente para rodar sozinho — por exemplo, uma revisão toda manhã. Por padrão ele só lê." />
      ) : (
        <div className="ag-sched">
          {schedules.map((s) => {
            const live = runningRun(s.id);
            return (
              <div key={s.id} className={'ag-sc' + (s.enabled ? '' : ' is-off')}>
                <div className="ag-sc__top">
                  <b>{s.name}</b>
                  <Badge size="sm">{s.mode === 'read' ? 'Só leitura' : 'Como o agente'}</Badge>
                  <span className="ag-sc__sp" />
                  <Toggle checked={s.enabled} aria-label="Ligada" onChange={(v) => api().routineEnabled(s.id, typeof v === 'boolean' ? v : !s.enabled).then(load, fail('Não foi possível alterar'))} />
                </div>
                <div className="ag-sc__meta"><Icon name="bot" size={12} /> {s.agent} · <Icon name="repeat" size={12} /> {describeRecurrence(s.recurrence)}</div>
                <div className="ag-sc__meta"><Icon name="folder" size={12} /> {s.cwd}</div>
                <div className="ag-sc__meta">
                  {s.enabled && s.nextRunAt ? <>Próxima: {fmtDateTime(s.nextRunAt)}</> : <>Desligada</>}
                  {s.lastStatus && <> · Última: <StatusBadge status={s.lastStatus} /> {s.lastRunAt ? ago(s.lastRunAt) : ''}</>}
                </div>
                <div className="ag-sc__act">
                  {live
                    ? <Button size="sm" variant="secondary" icon="square" onClick={() => api().runCancel(live.id).then(load, fail('Não foi possível cancelar'))}>Cancelar execução</Button>
                    : <Button size="sm" variant="secondary" icon="play" onClick={() => api().routineRun(s.id).then((r) => { if (r.status === 'error') toast('A execução falhou', r.error, 'error'); load(); }, fail('Não foi possível rodar'))}>Rodar agora</Button>}
                  <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEdit({ ...s })}>Editar</Button>
                  <Button size="sm" variant="ghost" icon="trash-2" onClick={() => setDel(s)}>Excluir</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="ag-hist__head"><b>Histórico</b>{runs.length > 0 && <Button size="sm" variant="ghost" icon="eraser" onClick={() => api().historyClear().then(load, fail('Não foi possível limpar'))}>Limpar</Button>}</div>
      {!runs.length ? <p className="ag-muted ag-pad">Nada rodou ainda.</p> : (
        <div className="ag-hist">
          {runs.map((r) => (
            <button key={r.id} type="button" className="ag-run" onClick={() => setViewRun(r.id)}>
              <StatusBadge status={r.status} />
              <b>{r.name}</b>
              <span className="ag-muted">{fmtDateTime(r.startedAt)}</span>
              <span className="ag-muted">{dur(r)}</span>
              <span className="ag-muted">{money(r.costUsd)}</span>
              {r.trigger === 'manual' && <span className="ag-muted">manual</span>}
            </button>
          ))}
        </div>
      )}

      {edit && <RoutineModal initial={edit} agents={agents} onClose={() => setEdit(null)} onSaved={load} toast={toast} />}
      {viewRun && <RunModal id={viewRun} onClose={() => setViewRun(null)} toast={toast} />}
      {del && (
        <Modal open onClose={() => setDel(null)} icon="trash-2" title={`Excluir “${del.name}”?`} width={440}
          description="A rotina deixa de rodar. O histórico das execuções já feitas continua."
          footer={<><Button variant="ghost" onClick={() => setDel(null)}>Cancelar</Button><Button variant="destructive" icon="trash-2" onClick={() => api().routineRemove(del.id).then(() => { setDel(null); load(); }, fail('Não foi possível excluir'))}>Excluir</Button></>} />
      )}
    </div>
  );
}
