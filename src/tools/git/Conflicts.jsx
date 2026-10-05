// Git — editor de conflitos. Para cada bloco em conflito: a sua versão e a deles lado a lado (e como era antes, se o
// git souber), com "ficar com o meu / o deles / os dois / editar". Quando todos têm escolha, "Marcar como resolvido"
// grava o arquivo e faz o git add. Também resolve o arquivo inteiro de um lado, ou conflitos de exclusão.
import { DS } from '../../lib/ds.js';
import { parseConflicts, resolveConflicts, conflictCount, hasMarkers } from '../../git/conflict.js';
import { gitApi, useRepoData, FilePath, OpButton } from './shared.jsx';
import { useAiMode, useAiTask, aiOn, AiButton, AiPanel, AiMarkdown } from '../../ai/ui.jsx';

const { Icon, Spinner } = DS;

const CHOICES = [
  { value: 'ours', label: 'Meu', icon: 'arrow-left' },
  { value: 'theirs', label: 'Deles', icon: 'arrow-right' },
  { value: 'both', label: 'Os dois', icon: 'rows-2' },
  { value: 'both-rev', label: 'Os dois (deles primeiro)', icon: 'arrow-down-up' },
];

function Lines({ lines, empty = '(nada)' }) {
  return <pre className="gt-cf__code">{lines.length ? lines.join('\n') : <span className="gt-cf__empty">{empty}</span>}</pre>;
}

/** Trecho sem conflito entre blocos: mostra só as pontas quando é longo. */
function Context({ lines }) {
  if (!lines.length) return null;
  const long = lines.length > 8;
  const shown = long ? [...lines.slice(0, 3), null, ...lines.slice(-3)] : lines;
  return (
    <pre className="gt-cf__ctx">
      {shown.map((l, i) => (l === null ? <span key={i} className="gt-cf__gap">⋯ {lines.length - 6} linhas iguais ⋯{'\n'}</span> : (l || ' ') + '\n'))}
    </pre>
  );
}

function Block({ block, n, total, choice, setChoice, labels, cfg, path, before, after }) {
  const editing = choice && typeof choice === 'object';
  const [draft, setDraft] = React.useState(() => block.ours.join('\n'));
  // IA: explica o que cada lado queria e propõe a versão combinada; "Usar" cai no modo Editar para revisar.
  const ai = useAiTask('conflictHelp', cfg);
  const suggest = () => ai.start(() => ({ path, ours: block.ours, theirs: block.theirs, base: block.base, before, after, labels }));
  const code = ai.st && ai.st.data && ai.st.data.code;
  return (
    <section className={'gt-cf__block' + (choice ? ' is-done' : '')}>
      <header className="gt-cf__head">
        <span className="gt-cf__n"><Icon name={choice ? 'circle-check' : 'circle-alert'} size={14} /> Conflito {n} de {total}</span>
        <span className="gt-cf__choices">
          {CHOICES.map((c) => (
            <button type="button" key={c.value} className={'gt-op is-sm' + (choice === c.value ? ' is-on is-accent' : ' is-ghost')} onClick={() => setChoice(c.value)} title={c.label}>
              <Icon name={c.icon} size={13} /><span>{c.label}</span>
            </button>
          ))}
          <button type="button" className={'gt-op is-sm' + (editing ? ' is-on is-accent' : ' is-ghost')} onClick={() => setChoice({ text: draft })}><Icon name="pencil" size={13} /><span>Editar</span></button>
          {aiOn(cfg) && !ai.st && <AiButton ai={ai} label="Sugerir combinação" onClick={suggest} />}
        </span>
      </header>
      {aiOn(cfg) && (
        <AiPanel ai={ai} className="gt-cf__ai"
          body={(st) => (st.phase === 'done' && st.data ? (
            <>
              {st.data.explanation && <AiMarkdown text={st.data.explanation} />}
              {st.data.code != null ? <pre className="gt-cf__code gt-cf__aicode">{st.data.code || ' '}</pre> : <div className="gt-hint">A resposta não trouxe um bloco de código utilizável — use as opções acima.</div>}
            </>
          ) : <AiMarkdown text={st.text} />)}
          actions={[{ label: 'Usar esta versão (revisar no Editar)', icon: 'check', primary: true, hidden: code == null, onClick: () => { setDraft(code); setChoice({ text: code }); ai.close(); } }]} />
      )}
      {editing ? (
        <textarea className="gt-cf__edit" value={choice.text} spellCheck={false} rows={Math.min(16, Math.max(3, choice.text.split('\n').length + 1))}
          onChange={(e) => { setDraft(e.target.value); setChoice({ text: e.target.value }); }} aria-label="Texto final deste bloco" />
      ) : (
        <div className={'gt-cf__sides' + (block.base ? ' has-base' : '')}>
          <div className={'gt-cf__side is-ours' + (choice === 'ours' || choice === 'both' || choice === 'both-rev' ? ' is-picked' : '')}>
            <div className="gt-cf__label">{labels.ours}</div><Lines lines={block.ours} />
          </div>
          {block.base && <div className="gt-cf__side is-base"><div className="gt-cf__label">Como era antes</div><Lines lines={block.base} /></div>}
          <div className={'gt-cf__side is-theirs' + (choice === 'theirs' || choice === 'both' || choice === 'both-rev' ? ' is-picked' : '')}>
            <div className="gt-cf__label">{labels.theirs}</div><Lines lines={block.theirs} />
          </div>
        </div>
      )}
    </section>
  );
}

export function ConflictEditor({ repo, path, operation, run }) {
  const { data: cf, error } = useRepoData(repo, (r) => gitApi().conflictFile(r, path), [path]);
  const parsed = React.useMemo(() => (cf && cf.merged != null ? parseConflicts(cf.merged) : null), [cf && cf.merged]);
  const [choices, setChoices] = React.useState([]);
  const [showResult, setShowResult] = React.useState(false);
  const cfg = useAiMode();
  React.useEffect(() => { setChoices([]); setShowResult(false); }, [path, cf && cf.merged]);

  if (error) return <div className="gt-msg is-error">{error}</div>;
  if (!cf) return <div className="gt-msg"><Spinner size={14} /> Lendo o conflito…</div>;

  // No rebase os lados se invertem: "ours" é a base nova; "theirs" é o seu commit sendo reaplicado.
  const rebase = operation === 'rebase';
  const labels = { ours: rebase ? 'Base (onde o rebase está aplicando)' : 'Meu (branch atual)', theirs: rebase ? 'Seu commit (sendo reaplicado)' : 'Deles (o que está entrando)' };
  const whole = (
    <div className="gt-cf__whole">
      <OpButton op={{ op: 'conflict.take', path, side: 'ours' }} run={run} icon="arrow-left">Arquivo inteiro: {rebase ? 'base' : 'meu'}</OpButton>
      <OpButton op={{ op: 'conflict.take', path, side: 'theirs' }} run={run} icon="arrow-right">Arquivo inteiro: {rebase ? 'seu commit' : 'deles'}</OpButton>
    </div>
  );

  // Conflitos sem marcadores: um lado excluiu, arquivo binário.
  if (cf.deletedBy || cf.binary || cf.merged == null || !parsed || conflictCount(parsed) === 0) {
    return (
      <div className="gt-cf">
        <div className="gt-diffhead"><FilePath path={path} /><span className="gt-diffhead__area">em conflito · {cf.code}</span></div>
        <div className="gt-cf__special">
          {cf.deletedBy === 'us' && <p><b>{rebase ? 'A base' : 'Você'} excluiu este arquivo</b> e {rebase ? 'o seu commit' : 'o outro lado'} o modificou.</p>}
          {cf.deletedBy === 'them' && <p><b>{rebase ? 'O seu commit' : 'O outro lado'} excluiu este arquivo</b> e {rebase ? 'a base' : 'você'} o modificou.</p>}
          {cf.binary && <p><b>Arquivo binário</b>: não dá para juntar linha a linha — escolha uma das versões inteiras.</p>}
          {!cf.deletedBy && !cf.binary && parsed && conflictCount(parsed) === 0 && <p>O arquivo não tem mais marcadores de conflito. Se ele já está como deve, marque como resolvido.</p>}
          <div className="gt-cf__whole">
            {cf.ours != null && <OpButton op={{ op: 'conflict.take', path, side: 'ours' }} run={run} icon="arrow-left">Manter {rebase ? 'a da base' : 'a minha'}</OpButton>}
            {cf.theirs != null && <OpButton op={{ op: 'conflict.take', path, side: 'theirs' }} run={run} icon="arrow-right">Manter {rebase ? 'a do commit' : 'a deles'}</OpButton>}
            {cf.deletedBy && <OpButton op={{ op: 'conflict.delete', path }} run={run} icon="trash-2" variant="danger">Excluir o arquivo</OpButton>}
            {!cf.deletedBy && !cf.binary && <OpButton op={{ op: 'stage', paths: [path] }} run={run} icon="check" variant="accent">Marcar como resolvido</OpButton>}
          </div>
        </div>
      </div>
    );
  }

  const total = conflictCount(parsed);
  const decided = choices.filter(Boolean).length;
  const result = resolveConflicts(parsed, choices);
  const all = decided === total;
  const setAll = (v) => setChoices(Array(total).fill(v));
  let k = 0;
  return (
    <div className="gt-cf">
      <div className="gt-diffhead">
        <FilePath path={path} />
        <span className="gt-diffhead__area">{decided}/{total} decidido{total === 1 ? '' : 's'}</span>
      </div>
      <div className="gt-cf__bar">
        <span className="gt-hint">Todos os blocos:</span>
        <button type="button" className="gt-op is-ghost is-sm" onClick={() => setAll('ours')}><Icon name="arrow-left" size={13} /><span>{rebase ? 'base' : 'meu'}</span></button>
        <button type="button" className="gt-op is-ghost is-sm" onClick={() => setAll('theirs')}><Icon name="arrow-right" size={13} /><span>{rebase ? 'seu commit' : 'deles'}</span></button>
        <span className="gt-toolbar__spacer" />
        {whole}
      </div>
      {rebase && <div className="gt-hint gt-cf__note"><Icon name="info" size={12} /> No rebase os lados se invertem: “base” é onde seus commits estão sendo reaplicados; “seu commit” é a sua mudança.</div>}
      <div className="gt-cf__body">
        {parsed.parts.map((p, i) => {
          if (p.type === 'text') return <Context key={i} lines={p.lines} />;
          const idx = k++;
          const prev = parsed.parts[i - 1], next = parsed.parts[i + 1];
          return <Block key={i} block={p} n={idx + 1} total={total} labels={labels} choice={choices[idx]} setChoice={(v) => setChoices((c) => { const n = [...c]; n[idx] = v; return n; })}
            cfg={cfg} path={path} before={prev && prev.type === 'text' ? prev.lines.slice(-20) : []} after={next && next.type === 'text' ? next.lines.slice(0, 20) : []} />;
        })}
      </div>
      <div className="gt-cf__foot">
        <button type="button" className="gt-op is-ghost is-sm" onClick={() => setShowResult((v) => !v)}><Icon name="eye" size={13} /><span>{showResult ? 'Esconder' : 'Ver'} o resultado</span></button>
        <span className="gt-toolbar__spacer" />
        {!all && <span className="gt-hint">Escolha uma opção em cada bloco ({total - decided} faltando).</span>}
        <OpButton op={{ op: 'conflict.save', path, content: result }} run={run} disabled={!all || hasMarkers(result)} icon="check" variant="primary" size="md">Marcar como resolvido</OpButton>
      </div>
      {showResult && <pre className="gt-cf__result tk-scroll">{result}</pre>}
    </div>
  );
}
