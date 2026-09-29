// Aplica no <textarea> o resultado { value, start, end } das funções de edit.js / markup.js
// preservando o desfazer nativo (Ctrl+Z): só o trecho que mudou é substituído, via
// execCommand('insertText') — que também dispara o onChange do React. Se o navegador recusar,
// cai no fallback(valor) (troca o valor inteiro; perde o Ctrl+Z daquela edição, mas nada quebra).

export function applyToTextarea(t, r, fallback) {
  const old = t.value, next = r.value;
  if (old !== next) {
    let a = 0;
    while (a < old.length && a < next.length && old[a] === next[a]) a++;
    let b = 0;
    while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
    const mid = next.slice(a, next.length - b);
    let ok = false;
    try {
      if (document.activeElement !== t) t.focus();
      t.setSelectionRange(a, old.length - b);
      ok = mid ? document.execCommand('insertText', false, mid) : document.execCommand('delete');
    } catch { ok = false; }
    if (!ok || t.value !== next) fallback(next);
  }
  t.setSelectionRange(r.start, r.end);
  // O React pode re-renderizar depois (fallback): reaplica a seleção no próximo quadro.
  requestAnimationFrame(() => { if (t.value === next) t.setSelectionRange(r.start, r.end); });
}
