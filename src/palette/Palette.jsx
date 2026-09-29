import { DS } from '../lib/ds.js';
import { resolveTheme } from '../lib/themes.js';
import { CATEGORIES, COMMANDS, categoryName, abilityCommands, itemCommands } from '../commands/registry.js';
import { formatDuration } from '../devcore/engine/format.js';
import { rank, loadRecent, pushRecent, normalize } from '../commands/search.js';
import { draftMatches } from '../commands/providers.js';
import { paletteKey, keyHint } from '../commands/keys.js';
import { createNote, snippetCode } from '../notes/note.js';
import { recoverUnsaved, shortTime, cleanError } from '../notes/client.js';
import { QuickNote } from './QuickNote.jsx';
import { emit } from '../lib/events.js';

const { Icon, Kbd, Spinner } = DS;

const WEB_CMDS = COMMANDS.filter((c) => c.takesQuery);
const APP_CMDS = COMMANDS.filter((c) => !c.takesQuery);
const NOTE_KEYS = APP_CMDS.filter((c) => c.category === 'notes' && c.key);
const QUICK = APP_CMDS.find((c) => c.id === 'notes:quick');
const TASKS = APP_CMDS.find((c) => c.id === 'notes:tasks');
// "task: revisar PR" / "tarefa: …" / "t: …" → captura uma tarefa na nota Inbox.
const TASK_RE = /^(?:task|tarefa|t)\s*:\s*(.*)$/i;
const FALLBACK = ['web:google', 'web:github'].map((id) => COMMANDS.find((c) => c.id === id));
const catOf = (id) => CATEGORIES.find((c) => c.id === (id && id.startsWith('notes') ? 'notes' : id));
const SUB = { 'notes:pinned': 'Pinned', 'notes:recent': 'Recentes' };
const isNotesScope = (s) => !!s && s.startsWith('notes');
const readPrefs = () => { try { return JSON.parse(localStorage.getItem('tk.prefs')) || {}; } catch { return {}; } };

/** Seções de resultados para o estado atual (comandos + notas vindas do processo principal). */
function buildSections(scope, query, recent, nd, extra = []) {
  const q = query.trim();
  const opts = { recent, categoryName };
  const cmdItem = (r, arg) => ({ key: r.cmd.id, kind: 'command', cmd: r.cmd, idx: r.idx || [], arg });
  const noteItem = (n, time) => ({ key: 'note:' + n.id + (time || ''), kind: 'note', note: n, time });
  const web = (list = WEB_CMDS) => list.map((cmd) => cmdItem({ cmd }, q));
  const quickWith = () => cmdItem({
    cmd: {
      id: 'notes:quick-with', name: `Criar Quick Note com “${q}”`, description: 'Guarda este texto como nota agora',
      icon: 'sticky-note', category: 'notes', dynamic: true, keepOpen: true, run: (ctx) => ctx.palette.quickNote(q),
    },
  });
  const hits = nd.hits.map((n) => noteItem(n));
  const terms = Math.max(1, normalize(q).split(/\s+/).filter(Boolean).length);
  const loading = nd.pending ? [{ title: 'Notes', loading: true, items: [] }] : [];

  // Tela inicial: digitar = buscar em tudo (comandos, notas, rascunhos e web).
  if (!scope) {
    const task = TASK_RE.exec(q);
    if (task) {
      const text = task[1].trim();
      if (!text) return [{ title: 'Nova tarefa', hint: 'Digite a tarefa — ela entra na nota Inbox', items: [cmdItem({ cmd: TASKS })] }];
      return [{
        title: 'Nova tarefa',
        items: [cmdItem({
          cmd: {
            id: 'notes:task-add', name: `Adicionar tarefa: ${text}`, description: 'Acrescenta “- [ ] …” à nota Inbox',
            icon: 'list-plus', category: 'notes', dynamic: true,
            run: async (ctx) => { await ctx.notes.appendTask(text); return 'Tarefa adicionada ao Inbox'; },
          },
        })],
      }];
    }
    if (!q) {
      const rec = recent.filter((id) => id !== QUICK.id) // Quick Note já está fixa em Categorias
        .map((id) => APP_CMDS.find((c) => c.id === id) || WEB_CMDS.find((c) => c.id === id)).filter(Boolean).slice(0, 5);
      return [
        { title: 'Categorias', items: [...CATEGORIES.map((cat) => ({ key: 'cat:' + cat.id, kind: 'category', cat })), cmdItem({ cmd: QUICK })] },
        rec.length && { title: 'Recentes', items: rec.map((cmd) => cmdItem({ cmd })) },
      ].filter(Boolean);
    }
    const ranked = rank([...APP_CMDS, ...extra], q, opts);
    const found = ranked.map((r) => cmdItem(r));
    const drafts = draftMatches(q, localStorage).map((cmd) => cmdItem({ cmd }));
    if (!found.length && !hits.length && !drafts.length) {
      return nd.pending ? loading : [{ title: 'Sugestões', empty: true, items: [quickWith(), ...web()] }];
    }
    const cmdTop = ranked.length ? ranked[0].score : 0;
    const noteTop = nd.hits.length ? nd.hits[0].score / terms : 0;
    const notesFirst = hits.length && (noteTop >= 20 ? cmdTop < 100 : cmdTop < 60);
    const main = [found.length && { title: 'Comandos', items: found }, hits.length && { title: 'Notes', items: hits }].filter(Boolean);
    return [
      ...(notesFirst ? main.reverse() : main),
      ...(!hits.length && nd.pending ? loading : []),
      drafts.length && { title: 'Rascunhos das ferramentas', items: drafts },
      { title: 'Web', items: web() },
    ].filter(Boolean);
  }

  // Notes: digitar busca nas notas.
  if (scope === 'notes') {
    if (!q) {
      const recentNotes = nd.recent ? mergeRecent(nd.recent).slice(0, 5) : [];
      return [
        { title: 'Notes', items: [...NOTE_KEYS, TASKS].map((cmd) => cmdItem({ cmd })) },
        nd.pinned.length && { title: '📌 Pinned', items: nd.pinned.slice(0, 5).map((n) => noteItem(n)) },
        recentNotes.length && { title: 'Recentes', items: recentNotes.map((n) => noteItem(n, n.time)) },
      ].filter(Boolean);
    }
    const cmds = rank(APP_CMDS.filter((c) => c.category === 'notes'), q, opts).map((r) => cmdItem(r));
    const secs = [hits.length && { title: 'Notes', items: hits }, cmds.length && { title: 'Comandos', items: cmds }].filter(Boolean);
    return secs.length ? secs : nd.pending ? loading : [{ title: 'Sugestões', empty: true, items: [quickWith()] }];
  }

  if (isNotesScope(scope)) {
    let items;
    if (q) items = hits;
    else if (scope === 'notes:pinned') items = nd.pinned.map((n) => noteItem(n));
    else if (scope === 'notes:recent' && nd.recent) {
      return [
        { title: 'Recently Edited', items: nd.recent.edited.map((n) => noteItem(n, n.updated)) },
        { title: 'Recently Viewed', items: nd.recent.viewed.map((n) => noteItem(n, n.viewedAt)) },
      ].filter((s) => s.items.length);
    } else items = [];
    if (items.length) return [{ title: SUB[scope], items }];
    if (nd.pending) return loading;
    if (!q) return [{ title: SUB[scope], hint: 'Nada aqui ainda', items: [] }];
    return [{ title: 'Sugestões', empty: true, items: [quickWith()] }];
  }

  const inCat = APP_CMDS.filter((c) => c.category === scope);
  if (!q) return [{ title: catOf(scope).name, items: inCat.map((cmd) => cmdItem({ cmd })) }];
  const found = rank(inCat, q, opts).map((r) => cmdItem(r));
  return found.length ? [{ title: catOf(scope).name, items: found }] : [{ title: 'Buscar na web', empty: true, items: web(FALLBACK) }];
}

/** Editadas + vistas, sem repetir, mais recentes primeiro. */
function mergeRecent(rec) {
  const seen = new Map();
  for (const n of rec.edited) seen.set(n.id, { ...n, time: n.updated });
  for (const n of rec.viewed) if (!seen.has(n.id) || n.viewedAt > seen.get(n.id).time) seen.set(n.id, { ...n, time: n.viewedAt });
  return [...seen.values()].sort((a, b) => String(b.time).localeCompare(String(a.time)));
}

function Hl({ text, idx }) {
  if (!idx || !idx.length) return text;
  const set = new Set(idx);
  const out = [];
  let buf = '', on = false;
  const flush = (k) => { if (buf) out.push(on ? <mark key={k} className="tk-hl">{buf}</mark> : buf); buf = ''; };
  [...text].forEach((ch, i) => { const m = set.has(i); if (m !== on) { flush(i); on = m; } buf += ch; });
  flush('end');
  return out;
}

function Excerpt({ ex }) {
  const out = [];
  let pos = 0;
  ex.ranges.forEach(([s, e], k) => {
    if (s < pos) return;
    out.push(ex.text.slice(pos, s), <mark key={k} className="tk-hl">{ex.text.slice(s, e)}</mark>);
    pos = e;
  });
  out.push(ex.text.slice(pos));
  return out;
}

/** Linha de apoio de uma nota: trecho com o termo (busca) ou prévia — sem repetir o título. */
function noteDesc(note, q) {
  const key = (t) => normalize(t).replace(/#\S+/g, '').replace(/[…\s]+/g, ' ').trim();
  const same = (t) => key(t).startsWith(key(note.title));
  if (q && note.excerpt && !same(note.excerpt.text)) return <Excerpt ex={note.excerpt} />;
  const rest = String(note.preview || '').split(' · ').filter((p) => !same(p)).join(' · ');
  return rest || (note.type === 'snippet' ? 'Snippet · Enter copia' : note.quick ? 'Quick Note' : '');
}

const EMPTY_NOTES ={ key: '', hits: [], pinned: [], recent: null, pending: false };

export function Palette() {
  const [scope, setScope] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [hi, setHi] = React.useState(0);
  const [busy, setBusy] = React.useState(null);     // id do item em execução
  const [error, setError] = React.useState(null);   // { id, name, message }
  const [done, setDone] = React.useState(null);     // mensagem de sucesso
  const [recent, setRecent] = React.useState(() => loadRecent(localStorage));
  const [openKey, setOpenKey] = React.useState(0);
  const [quick, setQuick] = React.useState(null);   // nota da Quick Note em edição
  const [nd, setNd] = React.useState(EMPTY_NOTES);  // dados de notas para o estado atual
  const [notesTick, setNotesTick] = React.useState(0);
  const [abilities, setAbilities] = React.useState([]); // habilidades dos DevPets (dinâmicas)
  const [items, setItems] = React.useState([]);         // consumíveis em estoque (dinâmicos)
  const inputRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const listRef = React.useRef(null);

  const close = () => window.devkit.palette.hide();
  const enterScope = (id) => { setScope(id); setQuery(''); setHi(0); setError(null); };
  const startQuick = (text = '') => { setError(null); setQuick(createNote({ quick: true, content: text })); };

  /** API disponível para os comandos (ver src/commands/registry.js). */
  const ctx = React.useMemo(() => {
    const d = window.devkit;
    return {
      openApp: (route, params) => d.app.open(route, params),
      devcore: d.devcore,
      appCommand: (cmd) => {
        if (cmd.type === 'theme') {
          // Grava já, para a palette (e a janela principal, se ainda não existir) usarem o tema novo.
          try { localStorage.setItem('tk.prefs', JSON.stringify({ ...readPrefs(), theme: cmd.value })); } catch { /* ignore */ }
          document.documentElement.dataset.theme = resolveTheme(cmd.value);
        }
        d.app.command(cmd);
      },
      openUrl: (url) => d.shell.openUrl(url),
      clipboard: d.clipboard,
      sql: d.sql,
      storage: localStorage,
      quit: () => d.app.quit(),
      notes: d.notes,
      openNote: (payload) => d.notes.open(payload),
      palette: { quickNote: startQuick, enter: enterScope, search: (text) => { setScope(null); setQuery(text); setHi(0); } },
    };
  }, []);

  // Notas para o estado atual: busca (com texto) ou pinned/recentes (dentro de Notes). Assíncrono, via IPC.
  const q = query.trim();
  const ndKey = scope + '|' + q + '|' + notesTick + '|' + openKey;
  React.useEffect(() => {
    const api = window.devkit.notes;
    const wants = q ? (!scope || isNotesScope(scope)) : isNotesScope(scope);
    if (!wants) { setNd({ ...EMPTY_NOTES, key: ndKey }); return undefined; }
    let alive = true;
    setNd((d) => ({ ...d, key: ndKey, pending: true }));
    const filter = scope === 'notes:pinned' ? { pinned: true } : undefined;
    const job = q ? api.search(q, { limit: isNotesScope(scope) ? 30 : 6, filter }).then((hits) => ({ hits }))
      : scope === 'notes:recent' ? api.recent().then((rec) => ({ recent: rec }))
      : scope === 'notes:pinned' ? api.list({ pinned: true }).then((pinned) => ({ pinned }))
      : scope === 'notes' ? Promise.all([api.list({ pinned: true }), api.recent()]).then(([pinned, rec]) => ({ pinned, recent: rec }))
      : Promise.resolve({});
    job.then(
      (r) => { if (alive) setNd({ ...EMPTY_NOTES, ...r, key: ndKey }); },
      () => { if (alive) setNd({ ...EMPTY_NOTES, key: ndKey }); },
    );
    return () => { alive = false; };
  }, [ndKey]);
  React.useEffect(() => window.devkit.notes.onChanged(() => setNotesTick((t) => t + 1)), []);

  const abilityCmds = React.useMemo(() => [...abilityCommands(abilities, formatDuration), ...itemCommands(items)], [abilities, items]);
  const sections = React.useMemo(() => buildSections(scope, query, recent, nd, abilityCmds), [scope, query, recent, nd, abilityCmds]);
  const flat = React.useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const cur = Math.min(hi, flat.length - 1);
  const curItem = flat[cur];

  // Cada abertura começa do zero: campo vazio, tela inicial, tema atual, foco no campo.
  React.useEffect(() => window.devkit.palette.onOpened(() => {
    emit('palette.opened');
    window.devkit.devcore.abilities().then(setAbilities, () => setAbilities([]));
    window.devkit.devcore.items().then(setItems, () => setItems([]));
    setScope(null); setQuery(''); setHi(0); setBusy(null); setError(null); setDone(null); setQuick(null);
    setRecent(loadRecent(localStorage));
    document.documentElement.dataset.theme = resolveTheme(readPrefs().theme || 'dark');
    setOpenKey((k) => k + 1);
    recoverUnsaved().catch(() => {});
    requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
  }), []);

  // A janela acompanha a altura do painel.
  React.useEffect(() => {
    const el = panelRef.current;
    if (!el) return undefined;
    const send = () => window.devkit.palette.resize(el.getBoundingClientRect().height + 24);
    const ro = new ResizeObserver(send);
    ro.observe(el);
    send();
    return () => ro.disconnect();
  }, [openKey, !!quick]);

  React.useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('[aria-selected="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [cur, sections]);

  const fail = (id, name, e) => { setBusy(null); setError({ id, name, message: cleanError(e) }); };

  /** Nota: Enter abre · snippet: Enter copia o código e Ctrl+Enter abre. */
  const runNote = async (n, ctrl) => {
    setError(null); setDone(null); setBusy('note:' + n.id);
    try {
      if (n.type === 'snippet' && !ctrl) {
        const full = await window.devkit.notes.get(n.id);
        if (!full) throw new Error('A nota não existe mais');
        await window.devkit.clipboard.write(snippetCode(full));
        window.devkit.notes.markViewed(n.id);
        setBusy(null);
        setDone('Snippet copiado: ' + n.title);
        setTimeout(close, 650);
      } else {
        setBusy(null);
        window.devkit.notes.open({ id: n.id });
      }
    } catch (e) { fail('note:' + n.id, n.title, e); }
  };

  const run = async (item, { ctrl = false } = {}) => {
    if (!item || busy) return;
    if (item.kind === 'category') { enterScope(item.cat.id); return; }
    if (item.kind === 'note') { runNote(item.note, ctrl); return; }
    const { cmd } = item;
    setError(null); setDone(null); setBusy(cmd.id);
    try {
      const msg = await cmd.run(ctx, item.arg);
      if (!cmd.dynamic) {
        setRecent(pushRecent(localStorage, cmd.id));
        emit('command.executed', { id: cmd.id });
        if (cmd.id.startsWith('clipboard:')) emit('clipboard.formatted', { tool: cmd.id.slice(10) });
      }
      setBusy(null);
      if (typeof msg === 'string' && msg) { setDone(msg); setTimeout(close, 700); } else if (!cmd.keepOpen) close();
    } catch (e) { fail(cmd.id, cmd.name, e); }
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    const n = flat.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) setHi((cur + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      if (n) setHi(Math.max(0, Math.min(n - 1, cur + (e.key === 'PageDown' ? 5 : -5))));
    } else if ((e.key === 'Home' || e.key === 'End') && !query) {
      e.preventDefault();
      setHi(e.key === 'Home' ? 0 : n - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(curItem, { ctrl: e.ctrlKey || e.metaKey });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Backspace' && !query && scope) {
      e.preventDefault();
      enterScope(isNotesScope(scope) && scope !== 'notes' ? 'notes' : null);
    } else if (e.key === 'Tab') {
      e.preventDefault(); // o foco fica sempre no campo
    } else {
      // Letras são sempre texto; Alt+letra navega (ver src/commands/keys.js).
      const act = paletteKey(e, scope);
      if (!act) return;
      e.preventDefault();
      if (act.type === 'scope') enterScope(act.scope);
      else run({ kind: 'command', cmd: APP_CMDS.find((c) => c.id === act.id) });
    }
  };

  const scopeCat = catOf(scope);
  const placeholder = scope === 'notes' ? 'Buscar nas notas…'
    : isNotesScope(scope) ? 'Buscar em ' + SUB[scope].toLowerCase() + '…'
    : scopeCat ? 'Filtrar ' + scopeCat.name.toLowerCase() + '…'
    : 'Buscar comandos, notas e web…';
  const count = flat.filter((it) => it.kind !== 'category').length;
  const countLabel = count + (count === 1 ? ' resultado' : ' resultados');
  const announce = done || (error ? 'Erro: ' + error.message : (sections[0] && sections[0].empty ? 'Nada encontrado' : countLabel));
  const snippetSel = curItem && curItem.kind === 'note' && curItem.note.type === 'snippet';
  let n = -1;

  const rowFor = (it) => {
    n++;
    const i = n, sel = i === cur;
    if (it.kind === 'note') {
      const note = it.note;
      const id = 'note:' + note.id;
      const isErr = error && error.id === id;
      return (
        <div key={it.key} id={'pl-opt-' + i} role="option" aria-selected={sel}
          className={'tk-menu__item pl-item' + (sel ? ' is-hi' : '') + (isErr ? ' is-error' : '')}
          onMouseMove={(e) => { if ((e.movementX || e.movementY) && !sel) setHi(i); }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => run(it, { ctrl: e.ctrlKey || e.metaKey })}>
          <span className="pl-item__icon"><Icon name={isErr ? 'circle-alert' : note.type === 'snippet' ? 'braces' : note.quick ? 'sticky-note' : 'file-text'} size={16} /></span>
          <span className="pl-item__main">
            <span className="pl-item__name"><Hl text={note.title} idx={note.titleIdx} />{note.pinned && <Icon name="pin" size={11} className="pl-item__pin" />}</span>
            <span className="pl-item__desc">{noteDesc(note, q)}</span>
          </span>
          {note.tags.length > 0 && <span className="pl-item__tags">{note.tags.slice(0, 3).map((t) => '#' + t).join(' ')}</span>}
          {it.time && <span className="pl-item__time">{shortTime(it.time)}</span>}
          {!scope && q && <span className="pl-item__cat">{note.type === 'snippet' ? 'Snippet' : 'Note'}</span>}
          {busy === id ? <Spinner size={14} /> : sel ? <Kbd size="sm">{note.type === 'snippet' ? '↵ copiar' : '↵'}</Kbd> : null}
        </div>
      );
    }
    const cmd = it.cmd;
    const isErr = error && cmd && error.id === cmd.id;
    const name = it.kind === 'category' ? it.cat.name
      : cmd.takesQuery && it.arg ? <>Buscar “<b>{it.arg}</b>” no {cmd.name}</>
      : <Hl text={cmd.name} idx={it.idx} />;
    const desc = it.kind === 'category' ? it.cat.description : cmd.description;
    const hintKey = it.kind === 'category' ? it.cat.key : cmd.key && (!q || scope) ? cmd.key : null;
    return (
      <div key={it.key} id={'pl-opt-' + i} role="option" aria-selected={sel}
        className={'tk-menu__item pl-item' + (sel ? ' is-hi' : '') + (isErr ? ' is-error' : '')}
        // Só movimento real do mouse: quando a lista muda sob um cursor parado, o Chromium também
        // dispara mousemove (sem deslocamento) — isso não pode roubar a seleção do teclado.
        onMouseMove={(e) => { if ((e.movementX || e.movementY) && !sel) setHi(i); }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => run(it)}>
        <span className="pl-item__icon"><Icon name={isErr ? 'circle-alert' : it.kind === 'category' ? it.cat.icon : cmd.icon} size={16} /></span>
        <span className="pl-item__main">
          <span className="pl-item__name">{name}</span>
          {desc && <span className="pl-item__desc">{desc}</span>}
        </span>
        {!scope && q && cmd && <span className="pl-item__cat">{categoryName(cmd.category)}</span>}
        {busy && cmd && busy === cmd.id
          ? <Spinner size={14} />
          : hintKey ? <Kbd size="sm">{keyHint(hintKey)}</Kbd>
          : cmd.shortcut ? <Kbd size="sm">{cmd.shortcut}</Kbd>
          : sel ? <Kbd size="sm">↵</Kbd> : null}
      </div>
    );
  };

  return (
    <div className="pl-root">
      <div key={openKey} ref={panelRef} className="tk-palette pl-panel" role="dialog" aria-label="Command palette" aria-busy={!!busy}>
        {quick ? (
          <QuickNote key={quick.id} initial={quick} onClose={close} onOpenInApp={(id) => window.devkit.notes.open({ id })} />
        ) : (<>
          <div className="tk-palette__search">
            <Icon name={scopeCat ? scopeCat.icon : 'search'} size={16} />
            {scopeCat && (
              <button type="button" className="pl-chip" onClick={() => enterScope(null)} title="Voltar (Backspace)" tabIndex={-1}>
                {scopeCat.name}{SUB[scope] && <><Icon name="chevron-right" size={12} />{SUB[scope]}</>}<Icon name="chevron-right" size={12} />
              </button>
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHi(0); setError(null); }}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              spellCheck={false}
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls="pl-list"
              aria-autocomplete="list"
              aria-activedescendant={cur >= 0 ? 'pl-opt-' + cur : undefined}
              aria-label="Buscar comandos e notas"
            />
            <Kbd size="sm">Esc</Kbd>
          </div>

          <div ref={listRef} id="pl-list" className="pl-list tk-scroll" role="listbox" aria-label="Resultados">
            {sections.map((s, si) => (
              <div key={s.title + si} role="group" aria-labelledby={'pl-sec-' + si}>
                {s.empty && <div className="pl-empty"><Icon name="search-x" size={16} />Nada encontrado para “{q}”{scope ? ' em ' + scopeCat.name : ''}</div>}
                <div id={'pl-sec-' + si} className="tk-menu__heading">{s.title}{s.hint && <span className="pl-heading-hint"> · {s.hint}</span>}</div>
                {s.loading && <div className="pl-loading"><Spinner size={12} /> Buscando nas notas…</div>}
                {s.items.map(rowFor)}
              </div>
            ))}
          </div>

          {error && (
            <div className="pl-status is-error" role="alert">
              <Icon name="circle-alert" size={14} /><span><b>{error.name}:</b> {error.message}</span>
            </div>
          )}
          {done && (
            <div className="pl-status is-ok" role="status">
              <Icon name="circle-check" size={14} /><span>{done}</span>
            </div>
          )}

          <div className="tk-palette__foot">
            {/* Um "Alt" seguido das letras cabe na largura: Alt + T A N */}
            {!scope && !q ? <><span><Kbd size="sm">Alt</Kbd>+<Kbd size="sm">T</Kbd><Kbd size="sm">A</Kbd><Kbd size="sm">N</Kbd> categorias</span><span><Kbd size="sm">Alt</Kbd>+<Kbd size="sm">Q</Kbd> Quick Note</span></>
              : scope === 'notes' && !q ? <><span><Kbd size="sm">Alt</Kbd>+<Kbd size="sm">Q</Kbd><Kbd size="sm">N</Kbd><Kbd size="sm">P</Kbd><Kbd size="sm">R</Kbd></span><span><Kbd size="sm">⌫</Kbd> voltar</span></>
              : scope && !q ? <span><Kbd size="sm">⌫</Kbd> voltar</span> : null}
            {!(!q && (!scope || scope === 'notes')) && <span><Kbd size="sm">↑</Kbd><Kbd size="sm">↓</Kbd> navegar</span>}
            {snippetSel
              ? <><span><Kbd size="sm">↵</Kbd> copiar</span><span><Kbd size="sm">Ctrl+↵</Kbd> abrir</span></>
              : (q || (scope && scope !== 'notes')) && <span><Kbd size="sm">↵</Kbd> executar</span>}
            <span><Kbd size="sm">Esc</Kbd> fechar</span>
            {(scope || q) && <span style={{ marginLeft: 'auto' }}>{countLabel}</span>}
          </div>
        </>)}
        <div className="pl-sr" aria-live="polite">{quick ? '' : announce}</div>
      </div>
    </div>
  );
}
