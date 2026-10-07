import { DS, mod } from '../lib/ds.js';
import { usePersisted } from '../lib/store.js';
import { TOOLS } from '../tools/registry.js';
import { THEMES, resolveTheme } from '../lib/themes.js';
import { isoDate } from '../notes/edit.js';
import { cleanError, shortTime } from '../notes/client.js';
import { needsValue } from '../links/link.js';
import { PriorityTag } from '../tools/notes/PriorityTag.jsx';
import { formatNum } from '../devcore/engine/format.js';
import { greeting, longDate, dueLabel, agenda, daySummaryParts, recentNotes, dashboardLinks, repoAttention, repoStatusChip, PANELS } from '../home/dashboard.js';

const { PageHeader, ToolCard, Button, Card, Icon, Badge, Checkbox, EmptyState, Spinner } = DS;

// Cor de cada grupo de ferramentas — a mesma do painel correspondente (ver .home-tool em app.css).
const GROUP_HUE = { 'Texto & código': 'code', Conhecimento: 'know', DevCore: 'core' };

/** Assina um evento "changed" de um serviço e recarrega com debounce (várias gravações seguidas = 1 leitura). */
function useLive(load, subscribe, delay = 120) {
  React.useEffect(() => {
    load();
    let t = null;
    const off = subscribe(() => { clearTimeout(t); t = setTimeout(load, delay); });
    return () => { off(); clearTimeout(t); };
  }, []);
}

/** Relógio que vira a cada minuto (saudação, "hoje" das tarefas, contador do DevCore). */
function useMinute() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60e3);
    return () => clearInterval(id);
  }, []);
  return now;
}

/* ─────────────── Tema ─────────────── */

/**
 * Miniatura de um tema: o próprio data-theme no elemento aplica os tokens daquele tema só ali dentro,
 * então fundo, cartão e pontos de cor são os de verdade (o padrão "dark" é :root e tem fallback no app.css).
 */
function ThemeSwatch({ value }) {
  return (
    <span className="home-theme__sw" data-theme={resolveTheme(value)} aria-hidden="true">
      <span className="home-theme__card">
        <i style={{ background: 'var(--tk-accent)' }} /><i style={{ background: 'var(--tk-syn-keyword)' }} />
        <i style={{ background: 'var(--tk-syn-string)' }} /><i style={{ background: 'var(--tk-syn-number)' }} />
      </span>
    </span>
  );
}

function ThemePicker({ theme, setTheme }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const cur = THEMES.find((t) => t.value === theme) || THEMES[0];
  React.useEffect(() => {
    if (!open) return undefined;
    const click = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="home-theme" ref={ref}>
      <button type="button" className="home-theme__btn" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} title="Mudar o tema">
        <ThemeSwatch value={cur.value} /> <span>{cur.label.replace(' (padrão)', '')}</span> <Icon name="chevron-down" size={13} />
      </button>
      {open && (
        <div className="home-theme__pop" role="listbox" aria-label="Tema">
          {THEMES.map((t) => (
            <button type="button" key={t.value} role="option" aria-selected={t.value === cur.value}
              className={'home-theme__opt' + (t.value === cur.value ? ' is-on' : '')} onClick={() => { setTheme(t.value); setOpen(false); }}>
              <ThemeSwatch value={t.value} />
              <span className="home-theme__name">{t.label}</span>
              {t.value === 'system' && <Icon name="monitor" size={12} />}
              {t.value === cur.value && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Faixa de status ─────────────── */

function StatusChip({ icon, tone, children, title, onClick }) {
  return (
    <button type="button" className={'home-chip' + (tone ? ' is-' + tone : '')} title={title} onClick={onClick}>
      <Icon name={icon} size={13} /> <span>{children}</span>
    </button>
  );
}

function StatusStrip({ noteCount, vault, palette, updater, go, open, repos }) {
  const up = updater && updater.mode !== 'unsupported' ? updater : null;
  return (
    <div className="home-status" role="status">
      {noteCount != null && (
        <StatusChip icon="notebook-pen" tone="notes" title="Abrir Notes" onClick={() => go('notes')}>
          {noteCount === 1 ? '1 nota' : `${noteCount} notas`}
        </StatusChip>
      )}
      {repos && (() => {
        const chip = repoStatusChip(repos);
        const first = chip && repos[0];
        return chip && (
          <StatusChip icon={chip.tone === 'error' ? 'git-merge' : 'git-branch'} tone={chip.tone} title="Abrir a ferramenta Git" onClick={() => open('git', { repo: first.path, tab: first.tab })}>
            {chip.text}
          </StatusChip>
        );
      })()}
      {vault && (vault.unlocked
        ? <StatusChip icon="lock-open" tone="warn" title="Cofre aberto — clique para bloquear" onClick={() => window.devkit.vault.lock()}>
            Cofre aberto{vault.count != null ? ` · ${vault.count} ${vault.count === 1 ? 'entrada' : 'entradas'}` : ''}
          </StatusChip>
        : <StatusChip icon={vault.exists ? 'lock' : 'vault'} tone="vault" title="Abrir o Vault" onClick={() => go('vault')}>
            {vault.exists ? 'Cofre bloqueado' : 'Criar cofre'}
          </StatusChip>)}
      {palette && !palette.registered && (
        <StatusChip icon="keyboard" tone="error" title="Outro programa usa o atalho — veja em Configurações" onClick={() => go('settings')}>
          Ctrl+Alt+Space em uso por outro app
        </StatusChip>
      )}
      {up && up.status === 'available' && (
        <StatusChip icon="download" tone="accent" title="Baixar a nova versão"
          onClick={() => (up.mode === 'check-only' ? window.devkit.shell.openUrl(up.releaseUrl) : window.devkit.updater.download())}>
          Versão {up.latestVersion} disponível
        </StatusChip>
      )}
      {up && up.status === 'downloading' && (
        <StatusChip icon="loader" tone="accent" onClick={() => go('settings')}>
          Baixando atualização{up.progress ? ` · ${Math.round(up.progress.percent)}%` : '…'}
        </StatusChip>
      )}
      {up && up.status === 'downloaded' && (
        <StatusChip icon="rotate-cw" tone="accent" title="Reinicia o Devkit já na versão nova" onClick={() => window.devkit.updater.install()}>
          Reiniciar e atualizar para {up.latestVersion}
        </StatusChip>
      )}
    </div>
  );
}

/* ─────────────── Tarefas ─────────────── */

function TasksPanel({ tasks, today, open, toast }) {
  const [text, setText] = React.useState('');
  const { items, counts } = agenda(tasks || [], today);

  const toggle = async (t) => {
    try { await window.devkit.notes.toggleTask(t.noteId, t.index); }
    catch (e) { toast('Não foi possível atualizar a tarefa', cleanError(e), 'error'); }
  };
  const add = async (e) => {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    try { await window.devkit.notes.appendTask(v); setText(''); toast('Tarefa adicionada', 'Na nota Inbox'); }
    catch (err) { toast('Não foi possível adicionar a tarefa', cleanError(err), 'error'); }
  };

  return (
    <Card className="home-panel is-tasks" padding={16} icon="list-checks" title="Tarefas"
      subtitle={tasks ? (counts.open ? `${counts.open} ${counts.open === 1 ? 'aberta' : 'abertas'}` : 'Nenhuma aberta') : ''}
      actions={<Button size="sm" variant="ghost" onClick={() => open('notes', { view: 'tasks' })}>Ver todas</Button>}>
      <form className="home-add" onSubmit={add}>
        <Icon name="plus" size={14} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nova tarefa para o Inbox — @hoje, @amanha e !1 funcionam" aria-label="Nova tarefa" />
      </form>
      {!tasks && <div className="home-msg"><Spinner size={14} /> Carregando…</div>}
      {tasks && items.length === 0 && (
        <div className="home-msg">{counts.open ? 'Nada com prazo nos próximos 7 dias.' : 'Tudo em dia. Capture uma tarefa acima ou com task: na palette.'}</div>
      )}
      <div className="home-list">
        {items.map((t) => (
          <div key={t.noteId + ':' + t.index} className="nts-task">
            <input type="checkbox" className="md-task" checked={false} onChange={() => toggle(t)} aria-label="Concluir tarefa" />
            <div className="nts-task__main">
              <button type="button" className="nts-task__text" onClick={() => open('notes', { id: t.noteId })} title="Abrir a nota">{t.text || '(sem texto)'}</button>
              <div className="nts-task__meta">
                <PriorityTag priority={t.priority} />
                {t.due && <span className={'nts-pill is-due' + (t.bucket === 'late' ? ' is-late' : '')} title={t.due}><Icon name="calendar" size={11} /> {dueLabel(t.due, today)}</span>}
                <span className="nts-task__note"><Icon name="file-text" size={11} /> {t.noteTitle}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ─────────────── Notas ─────────────── */

function NotesPanel({ recent, pinned, open, toast }) {
  const list = recentNotes(recent, 6);
  const hasPinned = pinned && pinned.length > 0;
  return (
    <Card className="home-panel is-notes" padding={16} icon="notebook-pen" title="Notas"
      actions={<Button size="sm" variant="ghost" icon="file-plus" onClick={() => open('notes', { new: true })}>Nova</Button>}>
      {/* Fixadas primeiro: são as escolhidas de propósito, ficam sempre no mesmo lugar; as recentes mudam o tempo todo. */}
      {hasPinned && (
        <div className="home-pinned">
          <span className="home-section__title">Fixadas</span>
          <div className="home-pinned__list">
            {pinned.slice(0, 8).map((n) => (
              <button type="button" key={n.id} className="home-pill" onClick={() => open('notes', { id: n.id })} title={n.title}>
                <Icon name="pin" size={11} /> {n.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {hasPinned && list.length > 0 && <span className="home-section__title">Recentes</span>}
      {!recent && <div className="home-msg"><Spinner size={14} /> Carregando…</div>}
      {recent && list.length === 0 && <div className="home-msg">Nenhuma nota ainda. Capture uma com a Quick Note: Ctrl+Alt+Space → Q.</div>}
      <div className="home-list">
        {list.map((n) => (
          <div key={n.id} className="home-row-wrap">
            <button type="button" className="home-row" onClick={() => open('notes', { id: n.id })}>
              <Icon name={n.type === 'snippet' ? 'braces' : n.pinned ? 'pin' : 'file-text'} size={14} />
              <span className="home-row__main">
                <span className="home-row__title">{n.title}</span>
                {(n.folder || n.preview) && <span className="home-row__sub">{n.folder ? n.folder + ' · ' : ''}{n.preview}</span>}
              </span>
              <span className="home-row__aside">{shortTime(n.viewedAt && !recent.edited.some((e) => e.id === n.id) ? n.viewedAt : n.updated)}</span>
            </button>
            <button type="button" className="home-row__stick" title="Fixar na tela (sticky note)" aria-label={'Fixar na tela: ' + n.title}
              onClick={() => window.devkit.stickies.open(n.id).catch((e) => toast('Não foi possível fixar na tela', cleanError(e), 'error'))}>
              <Icon name="sticky-note" size={13} />
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ─────────────── Repositórios git ─────────────── */

const LEVEL_ICON = { conflict: 'triangle-alert', changes: 'file-diff', ahead: 'arrow-up-circle', stash: 'archive', clean: 'circle-check', error: 'circle-x' };

/** Repositórios da ferramenta Git com o que pede atenção primeiro; clicar abre o Git no repositório e na aba certa. */
function GitPanel({ repos, open }) {
  if (!repos || !repos.length) return null;
  const pending = repos.filter((r) => r.level !== 'clean').length;
  return (
    <Card className="home-panel is-git" padding={16} icon="git-branch" title="Repositórios"
      subtitle={pending ? `${pending} com algo pendente` : 'Tudo commitado'}
      actions={<Button size="sm" variant="ghost" onClick={() => open('git', {})}>Abrir Git</Button>}>
      <div className="home-list">
        {repos.slice(0, 6).map((r) => (
          <button type="button" key={r.path} className={'home-row home-repo is-' + r.level} onClick={() => open('git', { repo: r.path, tab: r.tab })} title={r.path}>
            <Icon name={LEVEL_ICON[r.level]} size={14} />
            <span className="home-row__main">
              <span className="home-row__title">{r.name}</span>
              <span className="home-row__sub">
                <span className="home-repo__branch"><Icon name="git-branch" size={10} /> {r.detached ? 'HEAD solto' : r.branch || '—'}</span>
                {r.notes.length ? ' · ' + r.notes.join(' · ') : ' · tudo commitado'}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}

/* ─────────────── Links rápidos ─────────────── */

function LinkRow({ link, toast }) {
  const [value, setValue] = React.useState('');
  const param = needsValue(link);
  const go = async (v) => {
    try { await window.devkit.links.open(link.id, v); setValue(''); }
    catch (e) { toast('Não foi possível abrir', cleanError(e), 'error'); }
  };
  return (
    <div className="home-link">
      <button type="button" className="home-link__head" onClick={() => (param ? null : go())} disabled={param} title={param ? link.url : 'Abrir ' + link.url}>
        <Badge size="sm" mono>{link.alias}</Badge>
        <span className="home-link__name">{link.name || link.url}</span>
        {!param && <Icon name="external-link" size={12} />}
      </button>
      {param && (
        <div className="home-link__body">
          <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) go(value.trim()); }}>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={link.param || 'valor'} aria-label={(link.param || 'Valor') + ' para ' + link.alias} />
          </form>
          {(link.recent || []).slice(0, 3).map((v) => (
            <button type="button" key={v} className="home-pill is-mono" onClick={() => go(v)} title="Abrir de novo">{v}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function LinksPanel({ links, go, toast }) {
  const list = dashboardLinks(links, 6);
  return (
    <Card className="home-panel is-links" padding={16} icon="link" title="Links rápidos"
      actions={<Button size="sm" variant="ghost" onClick={() => go('settings')}>Gerenciar</Button>}>
      {!links && <div className="home-msg"><Spinner size={14} /> Carregando…</div>}
      {links && list.length === 0 && (
        <div className="home-msg">Uma URL atrás de um alias (ex.: <code>solic</code> → solicitação do Fluig pelo número). Cadastre em Configurações → Links rápidos.</div>
      )}
      <div className="home-list">{list.map((l) => <LinkRow key={l.id} link={l} toast={toast} />)}</div>
    </Card>
  );
}

/* ─────────────── DevCore ─────────────── */

function DevCorePanel({ snap, now, go }) {
  if (!snap) return null;
  const amount = snap.amount + snap.rate * Math.max(0, now - (snap.receivedAt || now)) / 1000;
  const quests = snap.quests && snap.quests.items ? snap.quests.items : [];
  const done = quests.filter((q) => q.done).length;
  const ops = snap.ops || {};
  return (
    <Card className="home-panel is-dc is-click" padding={16} icon="cpu" title="DevCore" interactive onClick={() => go('devcore')}
      actions={snap.hasNews ? <Badge size="sm" variant="accent" dot>novidade</Badge> : null}>
      <div className="home-dc">
        <div className="home-dc__stat"><span className="home-dc__value is-hue">{formatNum(amount)}</span><span className="home-dc__label">Compute · +{formatNum(snap.rate, { rate: true })}/s</span></div>
        <div className="home-dc__stat"><span className="home-dc__value">{snap.tier ? snap.tier.name : '—'}</span><span className="home-dc__label">Tier atual</span></div>
        {quests.length > 0 && <div className="home-dc__stat"><span className="home-dc__value">{done}/{quests.length}</span><span className="home-dc__label">Missões de hoje</span></div>}
      </div>
      {ops.active && !ops.active.contained && <div className="home-dc__alert is-bad"><Icon name="triangle-alert" size={13} /> {ops.active.villain.name} atacando: {ops.active.name}</div>}
      {!ops.active && ops.forecast && !ops.forecast.hidden && (
        <div className={'home-dc__alert' + (ops.forecast.covered ? ' is-ok' : '')}>
          <Icon name={ops.forecast.covered ? 'shield-check' : 'shield-alert'} size={13} /> {ops.forecast.villain.name} chega em breve — {ops.forecast.covered ? 'defesa pronta' : ops.forecast.counterText}
        </div>
      )}
    </Card>
  );
}

/* ─────────────── Tela ─────────────── */

/**
 * Início: painel do dia. Tarefas com prazo, notas recentes e fixadas, links rápidos, status do cofre/atualização,
 * resumo do DevCore e as ferramentas. Tudo atualiza sozinho pelos eventos "changed" dos serviços; os painéis
 * podem ser escondidos em Personalizar (lista em src/home/dashboard.js).
 */
export function Home({ go, open, openPalette, updater, toast, theme, setTheme }) {
  const [fav, setFav] = usePersisted('favorites', { ids: [] });
  const [layout, setLayout] = usePersisted('home', { hidden: [] });
  const [editing, setEditing] = React.useState(false);
  const now = useMinute();
  const today = isoDate(now);

  const [tasks, setTasks] = React.useState(null);
  const [recent, setRecent] = React.useState(null);
  const [pinned, setPinned] = React.useState(null);
  const [noteCount, setNoteCount] = React.useState(null);
  const [links, setLinks] = React.useState(null);
  const [vault, setVault] = React.useState(null);
  const [palette, setPalette] = React.useState(null);
  const [dc, setDc] = React.useState(null);
  const [repos, setRepos] = React.useState(null);
  const [tick, setTick] = React.useState(() => Date.now());

  const notes = window.devkit.notes;
  useLive(() => {
    notes.tasks({ status: 'open' }).then(setTasks, () => setTasks([]));
    notes.recent().then(setRecent, () => setRecent({ edited: [], viewed: [] }));
    notes.list({ pinned: true }).then(setPinned, () => setPinned([]));
    notes.info().then((i) => setNoteCount(i.count), () => {});
  }, notes.onChanged);
  useLive(() => window.devkit.links.list().then(setLinks, () => setLinks([])), window.devkit.links.onChanged);
  // Repositórios git: o serviço avisa das mudanças feitas pelo Devkit e no repositório aberto; o que muda por fora
  // (terminal, VS Code) aparece ao voltar para a janela e a cada minuto.
  const loadRepos = () => window.devkit.git.summaries().then((s) => setRepos(repoAttention(s)), () => setRepos([]));
  useLive(loadRepos, window.devkit.git.onChanged, 400);
  React.useEffect(() => {
    window.addEventListener('focus', loadRepos);
    const id = setInterval(loadRepos, 60e3);
    return () => { window.removeEventListener('focus', loadRepos); clearInterval(id); };
  }, []);
  useLive(() => window.devkit.vault.status().then(setVault, () => {}), window.devkit.vault.onChanged, 0);
  React.useEffect(() => { window.devkit.palette.status().then(setPalette, () => {}); }, []);

  const hidden = layout.hidden || [];
  const shows = (id) => !hidden.includes(id);
  const toggleShown = (id) => setLayout((l) => ({ ...l, hidden: (l.hidden || []).includes(id) ? l.hidden.filter((x) => x !== id) : [...(l.hidden || []), id] }));

  // DevCore só é consultado com o painel visível; o contador anda a cada 5 s, interpolado (sem IPC).
  const showDc = shows('devcore');
  React.useEffect(() => {
    if (!showDc) return undefined;
    const set = (s) => setDc({ ...s, receivedAt: Date.now() });
    window.devkit.devcore.get().then(set, () => {});
    const off = window.devkit.devcore.onChanged((msg) => msg.snapshot && set(msg.snapshot));
    const id = setInterval(() => setTick(Date.now()), 5e3);
    return () => { off(); clearInterval(id); };
  }, [showDc]);

  const toggleFav = (id) => setFav((f) => ({ ids: f.ids.includes(id) ? f.ids.filter((x) => x !== id) : [...f.ids, id] }));
  const sorted = [...TOOLS].sort((a, b) => fav.ids.includes(b.id) - fav.ids.includes(a.id));
  const summary = tasks ? daySummaryParts(agenda(tasks, today).counts) : [];

  return (
    <div className="home">
      <PageHeader icon="layout-dashboard" title={greeting(now)}
        subtitle={<span className="home-sub">{longDate(now)}{summary.map((p) => <React.Fragment key={p.tone}><span className="home-sub__sep">·</span><span className={'home-sub__part is-' + p.tone}>{p.text}</span></React.Fragment>)}</span>}
        actions={<>
          <ThemePicker theme={theme} setTheme={setTheme} />
          <Button variant="ghost" icon="sliders-horizontal" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>Personalizar</Button>
          <Button variant="secondary" icon="search" kbd={mod('K')} onClick={openPalette}>Buscar</Button>
        </>} />

      {editing && (
        <div className="home-custom">
          <span className="home-section__title">Mostrar no Início</span>
          {PANELS.map((p) => <Checkbox key={p.id} label={p.name} checked={shows(p.id)} onChange={() => toggleShown(p.id)} />)}
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Pronto</Button>
        </div>
      )}

      <StatusStrip noteCount={noteCount} vault={vault} palette={palette} updater={updater} go={go} open={open} repos={shows('git') ? repos : null} />

      <div className="home-dash">
        {shows('tasks') && <TasksPanel tasks={tasks} today={today} open={open} toast={toast} />}
        {shows('notes') && <NotesPanel recent={recent} pinned={pinned} open={open} toast={toast} />}
        {shows('git') && <GitPanel repos={repos} open={open} />}
        {shows('links') && <LinksPanel links={links} go={go} toast={toast} />}
        {showDc && <DevCorePanel snap={dc} now={tick} go={go} />}
      </div>

      {shows('tools') && (
        <div className="home-section">
          <span className="home-section__title">Ferramentas</span>
          <div className="home-grid">
            {sorted.map((t) => (
              <ToolCard key={t.id} className={'home-tool is-' + (GROUP_HUE[t.group] || 'code')} icon={t.icon} name={t.name} description={t.desc} category={t.group}
                shortcut={t.shortcutKey ? mod(t.shortcutKey) : undefined}
                favorite={fav.ids.includes(t.id)} onToggleFavorite={() => toggleFav(t.id)} onClick={() => go(t.id)} />
            ))}
          </div>
        </div>
      )}

      {PANELS.every((p) => !shows(p.id)) && (
        <EmptyState title="Início vazio" description="Todos os painéis estão escondidos." animate="none"
          action={<Button variant="secondary" onClick={() => setLayout({ hidden: [] })}>Mostrar tudo</Button>} />
      )}
    </div>
  );
}
