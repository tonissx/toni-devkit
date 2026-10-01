'use strict';
/**
 * Colar um snippet no programa que tinha o foco (Smart Binds → "Colar snippet").
 *
 * Sequência: guarda o clipboard → escreve o snippet já expandido ({{data}}, {{cursor}}, {{clipboard}}…) →
 * esconde a palette (o Windows devolve o foco ao programa anterior) → simula Ctrl+V (e ← até o {{cursor}}) →
 * restaura o clipboard. Se a simulação falhar (janela de administrador, terminal que bloqueia entrada
 * simulada, sistema sem suporte) o snippet fica copiado e o usuário é avisado para colar com Ctrl+V.
 * As dependências entram por parâmetro para a sequência ser testável em node.
 */
const { spawn } = require('node:child_process');
const { expandSnippet, templateVars } = require('../src/notes/templates.js');

const MAX_BACK = 2000;
const FOCUS_MS = 160;   // tempo para o foco voltar ao programa anterior depois de esconder a palette
const SETTLE_MS = 250;  // tempo para o programa ler o clipboard antes de restaurá-lo

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Teclas do SendKeys: Ctrl+V e, se há {{cursor}}, ← `back` vezes. Só texto fixo — nada do usuário entra aqui. */
const keysFor = (back) => '^v' + (back > 0 ? `{LEFT ${Math.min(back, MAX_BACK)}}` : '');

/** Simula teclas com o PowerShell (System.Windows.Forms.SendKeys), sem módulo nativo. */
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
 * hide(): esconde a palette · notify({ ok, message }) · sendKeys(keys) · sleep(ms) · now()
 */
function createPaster({ clipboard, hide, notify, sendKeys = sendKeysWindows, sleep = wait, now = () => new Date() }) {
  /** Cola `code` (já com as {{variáveis}}) no programa em foco. Devolve { pasted: boolean }. */
  async function paste({ code, title } = {}) {
    const prevText = clipboard.readText();
    // Clipboard só com imagem (print): guarda a imagem para devolvê-la depois.
    const prevImage = !prevText && clipboard.availableFormats && clipboard.availableFormats().some((f) => f.startsWith('image/'))
      ? clipboard.readImage() : null;
    const { text, back } = expandSnippet(code, templateVars(now(), { titulo: title || '', clipboard: prevText }));
    if (!text) throw new Error('O snippet está vazio');
    clipboard.writeText(text);
    hide();
    await sleep(FOCUS_MS);
    try {
      await sendKeys(keysFor(back));
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
  return { paste };
}

module.exports = { createPaster, keysFor, MAX_BACK };
