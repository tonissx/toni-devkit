// Agentes — monte e gerencie subagentes do Claude Code sem editar arquivo na mão. Cada agente é um .md em ~/.claude/agents
// (formato nativo da ferramenta: funciona também no terminal). Cada um declara o que pode fazer; a tela mostra isso em palavras.
import { DS } from '../../lib/ds.js';
import { errText } from '../../lib/fmt.jsx';
import { agentKey, mergeRows, scopeLabel } from './agentScope.js';
import { COLORS, EFFORTS, MEMORY_SCOPES, MODELS, MODEL_CUSTOM, PERMISSION_MODES, PRESETS, TEMPLATES, TOOL_CHOICES, colorHex, describePermissions, draftOf, isStdModel, permissions, presetOf, sameDraft, toolsForPreset } from './agentForm.js';
import { TagPicker } from './TagPicker.jsx';

const { PageHeader, Button, Input, Field, Textarea, Select, SegmentedControl, Modal, EmptyState, Badge, Icon, Spinner, Alert, Checkbox, Toggle } = DS;

const api = () => window.devkit.agents;
const TONE_VARIANT = { ok: 'ok', warn: 'warn', danger: 'error' };
const TONE_ICON = { ok: 'shield-check', warn: 'shield-alert', danger: 'shield-alert' };

function PermBadge({ perms }) {
  const d = describePermissions(perms);
  return <Badge size="sm" variant={TONE_VARIANT[d.tone]} title={d.text}>{d.title}</Badge>;
}

export function AgentsScreen({ toast }) {
  const [rows, setRows] = React.useState(null);   // agentes dos dois escopos (cada linha tem .scope)
  const [dirs, setDirs] = React.useState({ user: '~/.claude/agents', project: '' });
  const [repos, setRepos] = React.useState([]);    // repositórios do Git do devkit: candidatos a "projeto"
  const [project, setProject] = React.useState(() => { try { return localStorage.getItem('agents.project') || ''; } catch { return ''; } });
  const [newScope, setNewScope] = React.useState(null); // escopo de um agente ainda não salvo
  const [catalog, setCatalog] = React.useState({ skills: [], mcp: [], worktreeBan: null }); // skills, servidores MCP e CLAUDE.md do projeto
  const [advOpen, setAdvOpen] = React.useState(false);
  const [modelCustom, setModelCustom] = React.useState(false);
  React.useEffect(() => { setModelCustom(false); }, [sel]);
  const [sel, setSel] = React.useState(null);      // chave (escopo:nome) em edição, ou null
  const [saved, setSaved] = React.useState(null);  // versão em disco do agente aberto (null = novo)
  const [draft, setDraft] = React.useState(null);  // o que está no formulário
  const [busy, setBusy] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [filter, setFilter] = React.useState('');
  const [raw, setRaw] = React.useState(null);      // arquivo inválido aberto como texto cru: { id, text, orig, rev, error }

  const fail = (title) => (e) => toast(title, errText(e), 'error');
  const reload = React.useCallback(() => api().list(project || null).then((r) => {
    setRows(mergeRows(r));
    setDirs({ user: r.user.dir, project: r.project ? r.project.dir : '' });
  }, (e) => {
    // Projeto que sumiu do disco: volta só para o escopo do usuário em vez de travar a tela.
    if (project) { setProject(''); } else fail('Não foi possível listar os agentes')(e);
  }), [project]);
  React.useEffect(() => { reload(); }, [reload]);
  React.useEffect(() => { api().catalog(project || null).then(setCatalog, () => setCatalog({ skills: [], mcp: [], worktreeBan: null })); }, [project]);
  React.useEffect(() => { try { localStorage.setItem('agents.project', project); } catch { /* sem armazenamento */ } }, [project]);
  React.useEffect(() => {
    window.devkit.git.list().then((r) => setRepos((r && r.repos) || []), () => {});
  }, []);
  const ctxOf = (scope) => ({ scope: scope || 'user', root: project });
  // A lista reflete o disco: relê ao voltar para a janela (arquivos criados, editados ou apagados fora do devkit).
  React.useEffect(() => {
    const on = () => { if (document.visibilityState !== 'hidden') reload(); };
    window.addEventListener('focus', on); document.addEventListener('visibilitychange', on);
    return () => { window.removeEventListener('focus', on); document.removeEventListener('visibilitychange', on); };
  }, [reload]);

  const rawDirty = !!raw && raw.text !== raw.orig;
  const dirty = rawDirty || (!!draft && (!saved || !sameDraft(draft, saved)));
  const guard = () => !dirty || window.confirm('Há alterações não salvas neste agente. Descartar?');

  const open = (row) => {
    const name = row.name;
    const key = agentKey(row);
    if (key === sel && (saved || raw)) return;
    if (!guard()) return;
    if (row.invalid) {
      api().rawGet(row.id, ctxOf(row.scope)).then((r) => { setSel(key); setSaved(null); setDraft(null); setRaw({ ...r, scope: row.scope, orig: r.text }); }, fail('Não foi possível abrir o arquivo'));
      return;
    }
    api().get(name, ctxOf(row.scope)).then((a) => { setSel(key); setRaw(null); setSaved({ ...a, scope: row.scope }); setDraft(draftOf(a)); }, fail('Não foi possível abrir o agente'));
  };
  const startNew = (tpl = TEMPLATES[0]) => {
    if (!guard()) return;
    setSel(null); setSaved(null); setRaw(null); setDraft(draftOf(tpl.agent));
    setNewScope(project ? 'project' : 'user'); // com projeto escolhido, o padrão é criar nele
  };
  const saveRaw = async (force) => {
    setBusy(true);
    try {
      const r = await api().rawSave(raw.id, raw.text, { rev: raw.rev, force }, ctxOf(raw.scope));
      if (r && r.conflict) { if (window.confirm('Este arquivo mudou no disco desde que você o abriu. Sobrescrever com o seu texto?')) return saveRaw(true); return; }
      toast('Arquivo salvo', raw.id + '.md', 'ok');
      setSel(null); setRaw(null); reload();
    } catch (e) { toast('Não foi possível salvar', errText(e), 'error'); } finally { setBusy(false); }
  };
  const removeRaw = () => api().remove(raw.id, ctxOf(raw.scope)).then(() => { toast('Arquivo excluído', raw.id + '.md'); setConfirmDel(false); setSel(null); setRaw(null); reload(); }, fail('Não foi possível excluir'));
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const save = async (force) => {
    setBusy(true);
    try {
      const scope = saved ? saved.scope : newScope;
      const a = await api().save(draft, saved ? saved.name : null, { rev: saved ? saved.rev : '', force: force === true }, ctxOf(scope));
      if (a && a.conflict) {
        if (window.confirm('Este agente mudou no disco desde que você o abriu (edição fora do devkit). Sobrescrever com a sua versão?')) return save(true);
        return;
      }
      setSel(agentKey({ scope, name: a.name })); setSaved({ ...a, scope }); setDraft(draftOf(a));
      toast('Agente salvo', `${a.name}.md (${scopeLabel(scope).toLowerCase()})`, 'ok');
      reload();
    } catch (e) { toast('Não foi possível salvar', errText(e), 'error'); } finally { setBusy(false); }
  };
  const duplicate = () => api().duplicate(saved.name, ctxOf(saved.scope)).then((a) => { toast('Agente duplicado', a.name, 'ok'); setSel(agentKey({ scope: saved.scope, name: a.name })); setSaved({ ...a, scope: saved.scope }); setDraft(draftOf(a)); reload(); }, fail('Não foi possível duplicar'));
  const remove = () => api().remove(saved.name, ctxOf(saved.scope)).then(() => { toast('Agente excluído', saved.name); setConfirmDel(false); setSel(null); setSaved(null); setDraft(null); reload(); }, fail('Não foi possível excluir'));
  const launch = () => api().launch(saved.name, undefined, ctxOf(saved.scope)).then((r) => { if (r && r.launched) toast('Terminal aberto', `claude --agent ${saved.name} em ${r.cwd}`, 'ok'); }, fail('Não foi possível abrir o agente'));

  const invalidCount = (rows || []).filter((a) => a.invalid).length;
  const count = (scope) => (rows || []).filter((a) => a.scope === scope && !a.invalid).length;
  const projectNames = new Set((rows || []).filter((a) => a.scope === 'project').map((a) => a.name));
  const userNames = new Set((rows || []).filter((a) => a.scope === 'user').map((a) => a.name));
  const projectName = (repos.find((r) => r.path === project) || {}).name || project.split(/[\\/]/).filter(Boolean).pop() || '';
  const curScope = saved ? saved.scope : raw ? raw.scope : newScope;
  const list = (rows || []).filter((a) => !filter.trim() || (a.name + ' ' + a.description).toLowerCase().includes(filter.trim().toLowerCase()));
  const perms = draft ? permissions(draft.tools, draft.disallowedTools) : null;
  const pmode = draft ? PERMISSION_MODES.find((m) => m.value === draft.permissionMode) : null;
  const memScope = draft ? MEMORY_SCOPES.find((m) => m.value === draft.memory) : null;
  const freeTools = draft && draft.tools ? draft.tools.filter((t) => !TOOL_CHOICES.some((c) => c.name === t)) : [];
  const skillOpts = catalog.skills.map((k) => ({ name: k.name, hint: k.source + (k.description ? ' — ' + k.description : '') }));
  const mcpOpts = catalog.mcp.map((k) => ({ name: k.name, hint: k.source }));
  const toolOpts = TOOL_CHOICES.map((t) => ({ name: t.name, hint: t.hint }));
  const modelSel = modelCustom || (draft && !isStdModel(draft.model)) ? MODEL_CUSTOM : (draft ? draft.model : '');
  const pd = describePermissions(perms);
  const preset = draft ? presetOf(draft.tools) : 'all';
  const extraLines = draft && draft.extra ? draft.extra.split('\n').filter(Boolean).length : 0;

  return (
    <div className="ag">
      <PageHeader icon="sparkles" title="Agentes" subtitle={rows ? `${count('user')} do usuário em ${dirs.user}${dirs.project ? ` · ${count('project')} do projeto em ${dirs.project}` : ''}${invalidCount ? ` · ${invalidCount} arquivo(s) inválido(s)` : ''}` : 'Carregando…'}
        actions={<Button variant="primary" icon="plus" onClick={() => startNew()}>Novo agente</Button>} />
      {!rows ? <div className="ag-center"><Spinner size={18} /></div> : (
        <div className="ag-body">
          <aside className="ag-side">
            <div className="ag-side__search">
              <Select size="sm" value={project} style={{ width: '100%', marginBottom: 6 }} title="Projeto cujos agentes (.claude/agents) aparecem junto com os do usuário"
                options={[{ value: '', label: 'Sem projeto (só usuário)' }, ...repos.map((r) => ({ value: r.path, label: 'Projeto: ' + (r.name || r.path) })), ...(project && !repos.some((r) => r.path === project) ? [{ value: project, label: 'Projeto: ' + projectName }] : [])]}
                onChange={(v) => { if (guard()) { setProject(v); setSel(null); setSaved(null); setRaw(null); setDraft(null); } }} />
              <Input size="sm" type="search" placeholder="Buscar agente…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
            <div className="ag-list">
              {list.map((a) => (
                <button key={agentKey(a)} type="button" className={'ag-card' + (agentKey(a) === sel ? ' is-sel' : '')} onClick={() => open(a)}>
                  <span className="ag-card__top"><b>{colorHex(a.color) && <i className="ag-dot" style={{ background: colorHex(a.color) }} title={a.color} />}{a.name}</b><Badge size="sm" variant={a.scope === 'project' ? 'info' : 'neutral'} title={a.scope === 'project' ? dirs.project : dirs.user}>{scopeLabel(a.scope)}</Badge></span>
                  <span className="ag-card__top">{a.invalid ? <Badge size="sm" variant="error" title={a.error}>inválido</Badge> : <PermBadge perms={a.permissions} />}{!a.invalid && a.scope === 'user' && projectNames.has(a.name) && <Badge size="sm" variant="warn" title="Existe um agente com este nome no projeto, e o do projeto prevalece: este não será usado nesse projeto.">sobreposto</Badge>}{!a.invalid && a.scope === 'project' && userNames.has(a.name) && <Badge size="sm" variant="info" title="Há um agente do usuário com este nome; este (do projeto) prevalece.">prevalece</Badge>}</span>
                  <span className="ag-card__desc">{a.invalid ? a.error : (a.description || 'Sem descrição')}</span>
                  {a.model && <span className="ag-card__meta"><Icon name="cpu" size={11} /> {a.model}</span>}
                </button>
              ))}
              {!list.length && <p className="ag-muted ag-pad">{rows.length ? 'Nenhum agente com esse texto.' : 'Nenhum agente ainda.'}</p>}
            </div>
          </aside>
          <main className="ag-main">
            {raw ? (
              <div className="ag-form">
                <Alert variant="error" title={`${raw.id}.md não é um agente válido`} icon="shield-alert">{raw.error || 'Corrigido? Salve para o agente voltar à lista.'}</Alert>
                <Field label="Texto do arquivo" hint="Frontmatter entre linhas “---” (name e description obrigatórios), depois o prompt.">
                  <Textarea rows={22} className="ag-prompt" value={raw.text} onChange={(e) => setRaw((r) => ({ ...r, text: e.target.value }))} />
                </Field>
                <div className="ag-actions">
                  <Button variant="primary" icon="save" disabled={busy || !rawDirty} onClick={() => saveRaw(false)}>{busy ? 'Salvando…' : 'Salvar arquivo'}</Button>
                  <Button variant="ghost" icon="trash-2" onClick={() => setConfirmDel(true)}>Excluir</Button>
                  {rawDirty && <span className="ag-muted">Alterações não salvas</span>}
                </div>
              </div>
            ) : !draft ? (
              <div className="ag-start">
                <EmptyState icon="sparkles" title="Monte um agente" description="Um agente é um especialista com prompt, ferramentas e regras próprias. Comece por um modelo ou em branco." />
                <div className="ag-tpls">
                  {TEMPLATES.map((t) => <button key={t.id} type="button" className="ag-tpl" onClick={() => startNew(t)}><Icon name={t.icon} size={16} /><span>{t.label}</span></button>)}
                </div>
              </div>
            ) : (
              <div className="ag-form">
                {!saved && (
                  <Field label="Onde salvar" hint={newScope === 'project' ? `${dirs.project || '<projeto>/.claude/agents'} — vale só neste projeto e pode ir para o git.` : `${dirs.user} — vale em todos os seus projetos.`}>
                    <SegmentedControl size="sm" value={newScope || 'user'} onChange={(v) => { if (v === 'user' || project) setNewScope(v); }}
                      options={[{ value: 'user', label: 'Usuário' }, { value: 'project', label: project ? `Projeto (${projectName})` : 'Projeto (escolha um na lista)', disabled: !project }]} />
                  </Field>
                )}
                {!saved && draft.name && newScope && rows && rows.some((a) => a.scope !== newScope && a.name === draft.name) && (
                  <p className="ag-muted"><Icon name="info" size={12} /> Já existe “{draft.name}” no escopo {scopeLabel(newScope === 'project' ? 'user' : 'project').toLowerCase()}; o do projeto prevalece sobre o do usuário.</p>
                )}
                {!saved && (
                  <div className="ag-tpls is-inline">
                    <span className="ag-muted">Começar de:</span>
                    {TEMPLATES.map((t) => <button key={t.id} type="button" className="ag-tpl is-sm" onClick={() => setDraft(draftOf(t.agent))}><Icon name={t.icon} size={13} /><span>{t.label}</span></button>)}
                  </div>
                )}
                <div className="ag-row">
                  <Field label="Nome" hint="Minúsculas, números e hífens. É o nome do arquivo.">
                    <Input value={draft.name} placeholder="ex.: revisor-fluig" onChange={(e) => set({ name: e.target.value })} />
                  </Field>
                  <Field label="Modelo">
                    <Select options={MODELS} value={modelSel} style={{ width: 210 }}
                      onChange={(v) => { if (v === MODEL_CUSTOM) { setModelCustom(true); if (isStdModel(draft.model)) set({ model: '' }); } else { setModelCustom(false); set({ model: v }); } }} />
                    {modelSel === MODEL_CUSTOM && <Input size="sm" style={{ marginTop: 6, width: 210 }} value={draft.model} placeholder="ex.: claude-opus-5-5" onChange={(e) => set({ model: e.target.value })} />}
                  </Field>
                  <Field label="Cor" hint="Aparece na lista e na interface do Claude Code.">
                    <div className="ag-colors">
                      <button type="button" className={'ag-color is-none' + (!draft.color ? ' is-on' : '')} title="Sem cor" aria-label="Sem cor" onClick={() => set({ color: '' })} />
                      {COLORS.map((c) => <button key={c.value} type="button" className={'ag-color' + (draft.color === c.value ? ' is-on' : '')} style={{ background: c.hex }} title={c.value} aria-label={c.value} onClick={() => set({ color: c.value })} />)}
                    </div>
                    {draft.color && !colorHex(draft.color) && <p className="ag-muted"><Icon name="info" size={12} /> “{draft.color}” não é uma das cores da documentação; é mantida como está.</p>}
                  </Field>
                </div>
                <Field label="Quando usar" hint="O Claude escolhe chamar o agente com base nesta frase. Seja específico.">
                  <Textarea rows={2} value={draft.description} placeholder="ex.: Revisa datasets do Fluig antes do deploy" onChange={(e) => set({ description: e.target.value })} />
                </Field>

                <Field label="O que ele pode fazer">
                  <SegmentedControl size="sm" options={PRESETS.map((p) => ({ value: p.value, label: p.label }))} value={preset} onChange={(v) => set({ tools: toolsForPreset(v, draft.tools) })} />
                </Field>
                {draft.tools && (
                  <>
                    <div className="ag-tools">
                      {TOOL_CHOICES.map((t) => (
                        <Checkbox key={t.name} label={`${t.name} — ${t.hint}`} checked={draft.tools.includes(t.name)}
                          onChange={(v) => { const on = typeof v === 'boolean' ? v : !draft.tools.includes(t.name); set({ tools: on ? [...draft.tools, t.name] : draft.tools.filter((x) => x !== t.name) }); }} />
                      ))}
                    </div>
                    <Field label="Outras ferramentas" hint="Para as que a lista não conhece, inclusive de servidores MCP (mcp__servidor__ferramenta). Tecle Enter para adicionar.">
                      <TagPicker value={freeTools} placeholder="ex.: mcp__github__create_issue" onChange={(v) => set({ tools: [...draft.tools.filter((t) => TOOL_CHOICES.some((c) => c.name === t)), ...v] })} />
                    </Field>
                  </>
                )}
                <Field label="Ferramentas bloqueadas (disallowedTools)" hint="Vale mais com “Tudo (herda)”: o agente herda tudo, menos isto. É aplicado antes da lista acima.">
                  <TagPicker value={draft.disallowedTools} options={toolOpts} placeholder="ex.: Bash, PowerShell" onChange={(v) => set({ disallowedTools: v })} />
                </Field>
                <Alert variant={TONE_VARIANT[pd.tone]} title={pd.title} icon={TONE_ICON[pd.tone]}>{pd.text}</Alert>
                {perms && perms.level === 'exec' && !perms.all && <Alert variant="error" title="Atenção: este agente roda comandos" icon="shield-alert">Bash/PowerShell marcado. Confira o prompt e use só em pastas em que você confia.</Alert>}

                <div className="ag-grid">
                  <Field label="Modo de permissão (permissionMode)" hint={pmode ? pmode.text : undefined}>
                    <Select options={PERMISSION_MODES.map((m) => ({ value: m.value, label: m.label }))} value={draft.permissionMode} style={{ width: '100%' }}
                      onChange={(v) => set({ permissionMode: v })} />
                  </Field>
                  <Field label="Máximo de turnos (maxTurns)" hint="Para o agente depois desse número de passos, com o que já tiver. Vazio = sem limite.">
                    <Input size="sm" type="number" min={1} value={draft.maxTurns} placeholder="ex.: 20" onChange={(e) => set({ maxTurns: e.target.value })} />
                  </Field>
                  <Field label="Memória (memory)" hint={memScope ? memScope.text : undefined}>
                    <Select options={MEMORY_SCOPES.map((m) => ({ value: m.value, label: m.label }))} value={draft.memory} style={{ width: '100%' }} onChange={(v) => set({ memory: v })} />
                  </Field>
                </div>
                {draft.permissionMode === 'bypassPermissions' && <Alert variant="error" title="bypassPermissions: sem nenhuma confirmação" icon="shield-alert">O agente executa tudo o que a lista de ferramentas permite sem perguntar. Prefira um modo mais restrito.</Alert>}

                <Field label="Skills (skills)" hint={`Carregadas por inteiro no início do agente (máx. 32). ${catalog.skills.length} encontrada(s) em usuário, projeto e plugins; dá para digitar outra.`}>
                  <TagPicker value={draft.skills} options={skillOpts} max={32} placeholder="Buscar skill…" onChange={(v) => set({ skills: v })} />
                </Field>
                <Field label="Servidores MCP (mcpServers)" hint={`Nomes de servidores configurados (${catalog.mcp.length} encontrado(s)). Configuração inline continua no arquivo e é preservada.`}>
                  <TagPicker value={draft.mcpServers} options={mcpOpts} placeholder="Buscar servidor…" onChange={(v) => set({ mcpServers: v })} />
                </Field>

                <div className="ag-adv">
                  <button type="button" className="ag-adv__head" aria-expanded={advOpen} onClick={() => setAdvOpen((o) => !o)}><Icon name={advOpen ? 'chevron-down' : 'chevron-right'} size={14} /> Avançado</button>
                  {advOpen && (
                    <div className="ag-adv__body">
                      <Field label="Em segundo plano (background)" hint="Mantém o agente rodando em segundo plano, mesmo quando o Claude espera por ele.">
                        <Toggle checked={draft.background} label={draft.background ? 'Ligado' : 'Desligado'} onChange={(v) => set({ background: typeof v === 'boolean' ? v : !draft.background })} />
                      </Field>
                      <div className="ag-grid">
                        <Field label="Esforço (effort)" hint="Depende do modelo. Vazio = padrão.">
                          <Select options={EFFORTS.map((e) => ({ value: e, label: e || 'Padrão (não escrever)' }))} value={draft.effort} style={{ width: '100%' }} onChange={(v) => set({ effort: v })} />
                        </Field>
                        <Field label="Isolamento (isolation)" hint="worktree roda o agente numa cópia temporária do repositório.">
                          <Select options={[{ value: '', label: 'Nenhum (não escrever)' }, { value: 'worktree', label: 'worktree' }]} value={draft.isolation} style={{ width: '100%' }} onChange={(v) => set({ isolation: v })} />
                        </Field>
                      </div>
                      {draft.isolation === 'worktree' && catalog.worktreeBan && <Alert variant="warn" title="Este projeto proíbe worktrees" icon="shield-alert">O CLAUDE.md do projeto diz: “{catalog.worktreeBan}”. Com isolation: worktree o agente cria uma.</Alert>}
                      {/^hooks:/m.test(draft.extra || '') && <p className="ag-muted"><Icon name="info" size={12} /> Este agente tem <code>hooks</code> no arquivo: não são editáveis aqui, mas são preservados ao salvar.</p>}
                    </div>
                  )}
                </div>

                <Field label="Prompt" hint="As instruções do agente. Pode citar skills, regras e o jeito de responder.">
                  <Textarea rows={14} className="ag-prompt" value={draft.prompt} onChange={(e) => set({ prompt: e.target.value })} />
                </Field>
                {extraLines > 0 && <p className="ag-muted"><Icon name="info" size={12} /> {extraLines} linha(s) do arquivo que a tela não edita (como hooks ou campos novos) são preservadas ao salvar.</p>}

                <div className="ag-actions">
                  <Button variant="primary" icon="save" disabled={busy || !dirty} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</Button>
                  {saved && <>
                    <Button variant="secondary" icon="terminal" disabled={dirty} title={dirty ? 'Salve antes de chamar' : 'Abre um terminal numa pasta que você escolhe, já com este agente'} onClick={launch}>Chamar no terminal</Button>
                    <Button variant="ghost" icon="copy" onClick={duplicate}>Duplicar</Button>
                    <Button variant="ghost" icon="trash-2" onClick={() => setConfirmDel(true)}>Excluir</Button>
                  </>}
                  {dirty && <span className="ag-muted">Alterações não salvas</span>}
                </div>
              </div>
            )}
          </main>
        </div>
      )}
      {confirmDel && (saved || raw) && (
        <Modal open onClose={() => setConfirmDel(false)} icon="trash-2" title={`Excluir “${(saved || raw).name || raw.id}”?`} width={440}
          description={`O arquivo ${saved ? saved.name : raw.id}.md sai de ${(curScope === 'project' ? dirs.project : dirs.user) || '~/.claude/agents'}. Não há como desfazer.`}
          footer={<><Button variant="ghost" onClick={() => setConfirmDel(false)}>Cancelar</Button><Button variant="destructive" icon="trash-2" onClick={saved ? remove : removeRaw}>Excluir</Button></>} />
      )}
    </div>
  );
}
