'use strict';
/**
 * Monitor de IA — "retomar com um clique": abre um terminal na pasta de uma sessão já rodando `claude --resume <id>`
 * (ou `codex resume <id>`), ou a ferramenta pura para uma sessão nova. O comando é sempre fixo (nada do texto das sessões
 * entra nele); só o id da sessão e a pasta vêm de fora, e ambos são validados. Nada é executado além de abrir o terminal.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BIN = { claude: 'claude', codex: 'codex' };
const ID = /^[0-9A-Za-z][0-9A-Za-z-]{7,79}$/;
// Caracteres que não passam por um terminal sem escape (aspas, ; do wt, quebras de linha, & e % do cmd…).
const UNSAFE_CWD = /["'`;&|<>^%$!\r\n\0]/;

/** → { bin, args, cwd } ou lança Error com o motivo (em português). */
function plan({ provider, sessionId, cwd, mode = 'resume' }) {
  const bin = BIN[provider];
  if (!bin) throw new Error('Ferramenta de IA desconhecida');
  if (mode !== 'resume' && mode !== 'new') throw new Error('Modo inválido');
  if (typeof cwd !== 'string' || !cwd || !path.isAbsolute(cwd)) throw new Error('A pasta da sessão não é conhecida');
  if (UNSAFE_CWD.test(cwd)) throw new Error('O caminho da pasta tem caracteres que não dá para abrir com segurança no terminal');
  let st = null;
  try { st = fs.statSync(cwd); } catch { /* some abaixo */ }
  if (!st || !st.isDirectory()) throw new Error('A pasta desta sessão não existe mais');
  if (mode === 'new') return { bin, args: [], cwd };
  if (typeof sessionId !== 'string' || !ID.test(sessionId)) throw new Error('Identificador de sessão inválido');
  return { bin, args: provider === 'codex' ? ['resume', sessionId] : ['--resume', sessionId], cwd };
}

/** Resolve quando o processo nasceu; rejeita se o executável não existe. */
function launch(file, args, opts) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(file, args, { detached: true, stdio: 'ignore', ...opts }); } catch (e) { reject(e); return; }
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** Abre o terminal. `run` existe para os testes trocarem o spawn. */
async function open(input, { platform = process.platform, run = launch } = {}) {
  const { bin, args, cwd } = plan(input);
  const line = [bin, ...args].join(' ');
  if (platform === 'win32') {
    try { await run('wt.exe', ['-d', cwd, 'cmd', '/k', line], {}); return { terminal: 'wt', command: line }; } catch { /* sem Windows Terminal */ }
    await run('cmd.exe', ['/c', 'start', '', 'cmd', '/k', line], { cwd });
    return { terminal: 'cmd', command: line };
  }
  if (platform === 'darwin') {
    const script = `tell application "Terminal"\nactivate\ndo script "cd '${cwd}' && ${line}"\nend tell`;
    await run('osascript', ['-e', script], {});
    return { terminal: 'Terminal', command: line };
  }
  for (const [file, a] of [['gnome-terminal', [`--working-directory=${cwd}`, '--', bin, ...args]], ['konsole', ['--workdir', cwd, '-e', bin, ...args]], ['xterm', ['-e', bin, ...args]]]) {
    try { await run(file, a, { cwd }); return { terminal: file, command: line }; } catch { /* tenta o próximo */ }
  }
  throw new Error('Nenhum terminal conhecido foi encontrado');
}

module.exports = { plan, open, ID };
