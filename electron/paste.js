'use strict';
/**
 * Colar um snippet no programa que tinha o foco (Smart Binds → "Colar snippet").
 *
 * Antes de a palette abrir, `capture()` guarda qual janela estava ativa. Na colagem: guarda o clipboard →
 * escreve o snippet já expandido ({{data}}, {{cursor}}, {{clipboard}}…) → esconde a palette → DEVOLVE o foco à
 * janela guardada (o Windows não faz isso de forma confiável) → Ctrl+V (e ← até o {{cursor}}) → restaura o
 * clipboard. Se a simulação falhar (janela de administrador, terminal que bloqueia entrada simulada, sistema
 * sem suporte) o snippet fica copiado e o usuário é avisado para colar com Ctrl+V.
 * As dependências entram por parâmetro para a sequência ser testável em node.
 */
const { spawn } = require('node:child_process');
const { expandSnippet, templateVars } = require('../src/notes/templates.js');

const MAX_BACK = 2000;
const FOCUS_MS = 120;   // tempo para a palette sumir antes de devolver o foco
const AFTER_FOCUS_MS = 80; // tempo para o programa receber o foco antes das teclas
const SETTLE_MS = 250;  // tempo para o programa ler o clipboard antes de restaurá-lo

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Teclas do SendKeys: Ctrl+V e, se há {{cursor}}, ← `back` vezes. Só texto fixo — nada do usuário entra aqui. */
const keysFor = (back) => '^v' + (back > 0 ? `{LEFT ${Math.min(back, MAX_BACK)}}` : '');

/** Reserva: simula teclas com um PowerShell avulso (usado se o auxiliar persistente não responder). */
function sendKeysWindows(keys) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') { reject(new Error('Colar automático só existe no Windows')); return; }
    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${keys}')`;
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || 'SendKeys falhou (' + code + ')'))));
  });
}

/**
 * clipboard: { readText, writeText, availableFormats?, readImage?, write? } (o do Electron)
 * hide(): esconde a palette · notify({ ok, message }) · sleep(ms) · now()
 * win: { foreground(), focus(hwnd), keys(keys) } (electron/winfocus.js) — opcional; sem ele só há o `sendKeys` avulso.
 */
function createPaster({ clipboard, hide, notify, win = null, sendKeys = sendKeysWindows, sleep = wait, now = () => new Date() }) {
  let target = null; // janela que estava ativa quando a palette foi aberta por atalho

  /** Chamar ANTES de mostrar a palette: guarda a janela ativa (o foco ainda não saiu dela). */
  async function capture() {
    target = win ? await win.foreground() : null;
    return target;
  }

  /** Esquece a janela guardada (palette aberta por outro caminho / fechada sem devolver o foco). */
  function forget() { target = null; }

  /** Devolve o foco à janela guardada (Esc na palette). Consome o alvo. */
  async function restoreFocus() {
    const t = target;
    target = null;
    if (!t || !win) return false;
    await sleep(40); // a palette precisa ter sumido
    return win.focus(t);
  }

  /** Cola `code` (com as {{variáveis}}) no programa em foco. Devolve { pasted: boolean }. */
  async function paste({ code, title } = {}) {
    const prevText = clipboard.readText();
    // Clipboard só com imagem (print): guarda a imagem para devolvê-la depois.
    const prevImage = !prevText && clipboard.availableFormats && clipboard.availableFormats().some((f) => f.startsWith('image/'))
      ? clipboard.readImage() : null;
    const { text, back } = expandSnippet(code, templateVars(now(), { titulo: title || '', clipboard: prevText }));
    if (!text) throw new Error('O snippet está vazio');
    clipboard.writeText(text);
    const t = target;
    target = null;
    hide();
    await sleep(FOCUS_MS);
    try {
      // Sem confirmação de foco (janela fechada, bloqueio do Windows) ainda tenta colar: pode ter dado certo.
      if (t && win) { await win.focus(t); await sleep(AFTER_FOCUS_MS); }
      const keys = keysFor(back);
      if (win) await win.keys(keys).catch(() => sendKeys(keys)); else await sendKeys(keys);
      await sleep(SETTLE_MS);
    } catch (e) {
      // Fica copiado: o usuário cola na mão.
      notify({ ok: true, message: 'Snippet copiado — cole com Ctrl+V' });
      return { pasted: false, error: String((e && e.message) || e) };
    }
    if (prevImage && clipboard.write) clipboard.write({ image: prevImage });
    else clipboard.writeText(prevText);
    return { pasted: true };
  }
  return { paste, capture, forget, restoreFocus };
}

module.exports = { createPaster, keysFor, MAX_BACK };
