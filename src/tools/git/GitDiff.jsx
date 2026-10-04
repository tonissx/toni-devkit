// Git — diff de um arquivo, por trechos (hunks), com destaque do que mudou dentro da linha (motor do Diff Checker)
// e botões por trecho: preparar / tirar do stage / descartar. Patches grandes mostram só o começo.
import { DS } from '../../lib/ds.js';
import { parsePatch, hunkPatch } from '../../git/parse.js';
import { diffInline } from '../diff-checker/engine.js';
import { OpButton } from './shared.jsx';

const { Icon } = DS;
const MAX_LINES = 4000;

/** Pares de linhas removidas/adicionadas em sequência → segmentos alterados de cada uma. */
function inlineMarks(lines) {
  const marks = new Map(); // índice da linha → [[ini, fim, mudou], …]
  for (let i = 0; i < lines.length;) {
    if (lines[i].t !== '-') { i++; continue; }
    let j = i;
    while (j < lines.length && lines[j].t === '-') j++;
    let k = j;
    while (k < lines.length && lines[k].t === '+') k++;
    const n = Math.min(j - i, k - j);
    for (let p = 0; p < n; p++) {
      const a = lines[i + p].text, b = lines[j + p].text;
      if (a.length > 2000 || b.length > 2000) continue;
      const r = diffInline(a, b, 'smart');
      if (r) { marks.set(i + p, r[0]); marks.set(j + p, r[1]); }
    }
    i = k;
  }
  return marks;
}

function LineText({ text, segs }) {
  if (!segs) return <span className="gt-dl__text">{text || ' '}</span>;
  return <span className="gt-dl__text">{segs.map(([a, b, ch], i) => <span key={i} className={ch ? 'is-chg' : undefined}>{text.slice(a, b)}</span>)}</span>;
}

/**
 * patch: texto do diff · mode: 'unstaged' | 'staged' | 'untracked' | 'readonly' · run(op) executa uma operação.
 */
export function GitDiff({ patch, mode = 'readonly', run, truncated, empty = 'Sem diferenças.' }) {
  const files = React.useMemo(() => parsePatch(patch), [patch]);
  if (!String(patch || '').trim()) return <div className="gt-diff__empty">{empty}</div>;
  let budget = MAX_LINES;
  return (
    <div className="gt-diff">
      {truncated && <div className="gt-diff__note"><Icon name="scissors" size={13} /> Diff muito grande — mostrando só o começo.</div>}
      {files.map((f, fi) => (
        <div key={fi} className="gt-diff__file">
          {files.length > 1 && <div className="gt-diff__fname">{f.newPath || f.oldPath}</div>}
          {f.binary && <div className="gt-diff__empty">Arquivo binário — sem diff de texto.</div>}
          {!f.binary && !f.hunks.length && <div className="gt-diff__empty">{/new file mode/.test(f.header.join('\n')) ? 'Arquivo novo vazio.' : /deleted file/.test(f.header.join('\n')) ? 'Arquivo excluído.' : 'Só mudou o modo/permissão do arquivo.'}</div>}
          {f.hunks.map((h, hi) => {
            if (budget <= 0) return hi === 0 ? null : null;
            const lines = h.lines.slice(0, budget);
            budget -= lines.length;
            const marks = inlineMarks(lines);
            const p = mode !== 'readonly' && mode !== 'untracked' ? hunkPatch(f, h) : null;
            return (
              <section key={hi} className="gt-hunk">
                <header className="gt-hunk__head">
                  <span className="gt-hunk__range">@@ −{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@</span>
                  {h.context && <span className="gt-hunk__ctx">{h.context}</span>}
                  <span className="gt-hunk__actions">
                    {mode === 'unstaged' && <>
                      <OpButton op={{ op: 'discardHunk', patch: p }} run={run} icon="undo-2" variant="danger">Descartar trecho</OpButton>
                      <OpButton op={{ op: 'stageHunk', patch: p }} run={run} icon="plus" variant="accent">Preparar trecho</OpButton>
                    </>}
                    {mode === 'staged' && <OpButton op={{ op: 'unstageHunk', patch: p }} run={run} icon="minus">Tirar trecho do stage</OpButton>}
                  </span>
                </header>
                <div className="gt-hunk__body">
                  {lines.map((l, li) => (
                    <div key={li} className={'gt-dl' + (l.t === '+' ? ' is-add' : l.t === '-' ? ' is-del' : l.t === '\\' ? ' is-meta' : '')}>
                      <span className="gt-dl__n">{l.old ?? ''}</span>
                      <span className="gt-dl__n">{l.new ?? ''}</span>
                      <span className="gt-dl__sign">{l.t === '\\' ? '' : l.t}</span>
                      {l.t === '\\' ? <span className="gt-dl__text">sem quebra de linha no fim do arquivo</span> : <LineText text={l.text} segs={marks.get(li)} />}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ))}
      {budget <= 0 && <div className="gt-diff__note"><Icon name="scissors" size={13} /> Mais de {MAX_LINES} linhas — o resto foi omitido aqui.</div>}
    </div>
  );
}
