import { DS } from '../lib/ds.js';
import { resolveTheme } from '../lib/themes.js';
import { CATEGORIES, COMMANDS, categoryName } from '../commands/registry.js';
import { rank, loadRecent, pushRecent } from '../commands/search.js';
import { draftMatches } from '../commands/providers.js';

const { Icon, Kbd, Spinner } = DS;

const WEB_CMDS = COMMANDS.filter((c) => c.takesQuery);
const APP_CMDS = COMMANDS.filter((c) => !c.takesQuery);
const FALLBACK = ['web:google', 'web:github'].map((id) => COMMANDS.find((c) => c.id === id));
const catOf = (id) => CATEGORIES.find((c) => c.id === id);
const readPrefs = () => { try { return JSON.parse(localStorage.getItem('tk.prefs')) || {}; } catch { return {}; } };
const cleanError = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/** API disponível para os comandos (ver src/commands/registry.js). */
function makeCtx() {
  const d = window.devkit;
  return {
    openApp: (route) => d.app.open(route),
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
  };
}

/**
 * Seções de resultados para o estado atual.
 * Item: { key, kind: 'category'|'command', cat?, cmd?, idx?, arg? } — arg é a consulta passada a comandos takesQuery.
 */
function buildSections(scope, query, recent) {
  const q = query.trim();
  const opts = { recent, categoryName };
  const cmdItem = (r, arg) => ({ key: r.cmd.id, kind: 'command', cmd: r.cmd, idx: r.idx || [], arg });
  const web = (list = WEB_CMDS) => list.map((cmd) => cmdItem({ cmd }, q));

  if (!scope) {
    if (!q) {
      const rec = recent.map((id) => APP_CMDS.find((c) => c.id === id) || WEB_CMDS.find((c) => c.id === id)).filter(Boolean).slice(0, 5);
      return [
        { title: 'Categorias', items: CATEGORIES.map((cat) => ({ key: 'cat:' + cat.id, kind: 'category', cat })) },
        rec.length && { title: 'Recentes', items: rec.map((cmd) => cmdItem({ cmd })) },
      ].filter(Boolean);
    }
    const found = rank(COMMANDS, q, opts).map((r) => cmdItem(r)); // web pelo nome: Enter abre o site (para buscar, use S)
    return found.length ? [{ title: 'Resultados', items: found }] : [{ title: 'Buscar na web', empty: true, items: web(FALLBACK) }];
  }

  if (scope === 'search') {
    if (!q) return [{ title: 'Buscar na web', hint: 'Digite o que procurar', items: web() }];
    const inApp = [...rank(APP_CMDS, q, opts).slice(0, 6).map((r) => cmdItem(r)), ...draftMatches(q, localStorage).map((cmd) => cmdItem({ cmd }))];
    const top = rank(APP_CMDS, q, opts)[0];
    const sections = [{ title: 'Web', items: web() }, inApp.length && { title: 'No app', items: inApp }].filter(Boolean);
    return top && top.score >= 80 ? sections.reverse() : sections;
  }

  const inCat = APP_CMDS.filter((c) => c.category === scope);
  if (!q) return [{ title: catOf(scope).name, items: inCat.map((cmd) => cmdItem({ cmd })) }];
  const found = rank(inCat, q, opts).map((r) => cmdItem(r));
  return found.length ? [{ title: catOf(scope).name, items: found }] : [{ title: 'Buscar na web', empty: true, items: web(FALLBACK) }];
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

export function Palette() {
  const [scope, setScope] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [hi, setHi] = React.useState(0);
  const [busy, setBusy] = React.useState(null);     // id do comando em execução
  const [error, setError] = React.useState(null);   // { id, name, message }
  const [done, setDone] = React.useState(null);     // mensagem de sucesso
  const [recent, setRecent] = React.useState(() => loadRecent(localStorage));
  const [openKey, setOpenKey] = React.useState(0);
  const inputRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const listRef = React.useRef(null);
  const ctx = React.useMemo(makeCtx, []);

  const sections = React.useMemo(() => buildSections(scope, query, recent), [scope, query, recent]);
  const flat = React.useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const cur = Math.min(hi, flat.length - 1);

  const close = () => window.devkit.palette.hide();

  // Cada abertura começa do zero: campo vazio, tela inicial, tema atual, foco no campo.
  React.useEffect(() => window.devkit.palette.onOpened(() => {
    setScope(null); setQuery(''); setHi(0); setBusy(null); setError(null); setDone(null);
    setRecent(loadRecent(localStorage));
    document.documentElement.dataset.theme = resolveTheme(readPrefs().theme || 'dark');
    setOpenKey((k) => k + 1);
    requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
  }), []);

  // A janela acompanha a altura do painel.
  React.useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const send = () => window.devkit.palette.resize(el.getBoundingClientRect().height + 24);
    const ro = new ResizeObserver(send);
    ro.observe(el);
    send();
    return () => ro.disconnect();
  }, [openKey]);

  React.useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('[aria-selected="true"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [cur, sections]);

  const enterScope = (id) => { setScope(id); setQuery(''); setHi(0); setError(null); };

  const run = async (item) => {
    if (!item || busy) return;
    if (item.kind === 'category') { enterScope(item.cat.id); return; }
    const { cmd } = item;
    setError(null); setDone(null); setBusy(cmd.id);
    try {
      const msg = await cmd.run(ctx, item.arg);
      if (!cmd.dynamic) setRecent(pushRecent(localStorage, cmd.id));
      setBusy(null);
      if (typeof msg === 'string' && msg) { setDone(msg); setTimeout(close, 700); } else close();
    } catch (e) {
      setBusy(null);
      setError({ id: cmd.id, name: cmd.name, message: cleanError(e) });
    }
  };

  const onKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    const n = flat.length;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
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
      run(flat[cur]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Backspace' && !query && scope) {
      e.preventDefault();
      enterScope(null);
    } else if (e.key === 'Tab') {
      e.preventDefault(); // o foco fica sempre no campo
    } else if (plain && !query && !scope && e.key.length === 1) {
      // S / T / A só com o campo vazio na tela inicial; depois do 1º caractere tudo é texto.
      const cat = CATEGORIES.find((c) => c.key === e.key.toLowerCase());
      if (cat) { e.preventDefault(); enterScope(cat.id); }
    }
  };

  const scopeCat = scope && catOf(scope);
  const q = query.trim();
  const placeholder = scope === 'search' ? 'Buscar na web e no app…' : scopeCat ? 'Filtrar ' + scopeCat.name.toLowerCase() + '…' : 'Buscar comandos…  (S · T · A)';
  const count = flat.filter((it) => it.kind === 'command').length;
  const countLabel = count + (count === 1 ? ' resultado' : ' resultados');
  const announce = done || (error ? 'Erro: ' + error.message : (sections[0] && sections[0].empty ? 'Nada encontrado' : countLabel));
  let n = -1;

  return (
    <div className="pl-root">
      <div key={openKey} ref={panelRef} className="tk-palette pl-panel" role="dialog" aria-label="Command palette" aria-busy={!!busy}>
        <div className="tk-palette__search">
          <Icon name={scopeCat ? scopeCat.icon : 'search'} size={16} />
          {scopeCat && (
            <button type="button" className="pl-chip" onClick={() => enterScope(null)} title="Voltar (Backspace)" tabIndex={-1}>
              {scopeCat.name}<Icon name="chevron-right" size={12} />
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
            aria-label="Buscar comandos"
          />
          <Kbd size="sm">Esc</Kbd>
        </div>

        <div ref={listRef} id="pl-list" className="pl-list tk-scroll" role="listbox" aria-label="Resultados">
          {sections.map((s, si) => (
            <div key={s.title} role="group" aria-labelledby={'pl-sec-' + si}>
              {s.empty && <div className="pl-empty"><Icon name="search-x" size={16} />Nada encontrado para “{q}”{scope ? ' em ' + scopeCat.name : ''}</div>}
              <div id={'pl-sec-' + si} className="tk-menu__heading">{s.title}{s.hint && <span className="pl-heading-hint"> · {s.hint}</span>}</div>
              {s.items.map((it) => {
                n++;
                const i = n, sel = i === cur;
                const cmd = it.cmd;
                const isErr = error && cmd && error.id === cmd.id;
                const name = it.kind === 'category' ? it.cat.name
                  : cmd.takesQuery && it.arg ? <>Buscar “<b>{it.arg}</b>” no {cmd.name}</>
                  : <Hl text={cmd.name} idx={it.idx} />;
                const desc = it.kind === 'category' ? it.cat.description : cmd.description;
                return (
                  <div
                    key={it.key}
                    id={'pl-opt-' + i}
                    role="option"
                    aria-selected={sel}
                    className={'tk-menu__item pl-item' + (sel ? ' is-hi' : '') + (isErr ? ' is-error' : '')}
                    // Só movimento real do mouse: quando a lista muda sob um cursor parado, o Chromium também
                    // dispara mousemove (sem deslocamento) — isso não pode roubar a seleção do teclado.
                    onMouseMove={(e) => { if ((e.movementX || e.movementY) && !sel) setHi(i); }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => run(it)}
                  >
                    <span className="pl-item__icon"><Icon name={isErr ? 'circle-alert' : it.kind === 'category' ? it.cat.icon : cmd.icon} size={16} /></span>
                    <span className="pl-item__main">
                      <span className="pl-item__name">{name}</span>
                      {desc && <span className="pl-item__desc">{desc}</span>}
                    </span>
                    {!scope && q && cmd && <span className="pl-item__cat">{categoryName(cmd.category)}</span>}
                    {busy && cmd && busy === cmd.id
                      ? <Spinner size={14} />
                      : it.kind === 'category' ? <Kbd size="sm">{it.cat.key.toUpperCase()}</Kbd>
                      : cmd.shortcut ? <Kbd size="sm">{cmd.shortcut}</Kbd>
                      : sel ? <Kbd size="sm">↵</Kbd> : null}
                  </div>
                );
              })}
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
          {!scope && !q
            ? <span><Kbd size="sm">S</Kbd><Kbd size="sm">T</Kbd><Kbd size="sm">A</Kbd> categorias</span>
            : scope && !q ? <span><Kbd size="sm">⌫</Kbd> voltar</span> : null}
          <span><Kbd size="sm">↑</Kbd><Kbd size="sm">↓</Kbd> navegar</span>
          <span><Kbd size="sm">↵</Kbd> executar</span>
          <span><Kbd size="sm">Esc</Kbd> fechar</span>
          {(scope || q) && <span style={{ marginLeft: 'auto' }}>{countLabel}</span>}
        </div>
        <div className="pl-sr" aria-live="polite">{announce}</div>
      </div>
    </div>
  );
}
