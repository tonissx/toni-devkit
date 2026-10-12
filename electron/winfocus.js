'use strict';
/**
 * Auxiliar do Windows para "Colar snippet": lembra qual janela estava ativa antes de a palette abrir, devolve o
 * foco a ela e simula teclas. O Electron não tem API para isso, e confiar que o Windows devolve o foco sozinho
 * quando a palette esconde falha em vários programas (ex.: SSMS) — então o foco é restaurado explicitamente.
 *
 * Um único PowerShell fica vivo (o tipo user32 é compilado uma vez) e conversa por linhas:
 *   fg            → "ok <hwnd>"   janela em primeiro plano agora
 *   focus <hwnd>  → "ok 1|0"      traz a janela de volta (1 = conseguiu)
 *   paste <n>     → "ok"          Ctrl+V e n× ← num único SendInput (0..2000); "err BLOQUEADO…" se o Windows recusar
 *   keys <teclas> → "ok"          SendKeys.SendWait (^v, {LEFT 3}…) — reserva do paste
 *   clip <base64> → "ok"          Vault: texto no clipboard fora do histórico do Windows e da nuvem
 * Respostas voltam na mesma ordem dos pedidos. Se o processo morrer, o próximo pedido sobe outro.
 */
const { spawn: nodeSpawn } = require('node:child_process');

const SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -TypeDefinition @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class DkWin {',
  '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
  '  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);',
  '  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);',
  '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);',
  '  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();',
  '  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);',
  // Colar + voltar o cursor: um SendInput só com TODOS os eventos, em vez de uma tecla por vez (o SendKeys do
  // .NET) — a fila do programa recebe tudo junto e a tela quase não repinta no caminho.
  '  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }',
  '  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }',
  '  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }',
  '  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }',
  '  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);',
  '  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint mapType);',
  '  static INPUT Key(ushort vk, bool up, bool ext) {',
  '    INPUT x = new INPUT(); x.type = 1;',
  '    x.u.ki.wVk = vk; x.u.ki.wScan = (ushort)MapVirtualKey(vk, 0);',
  '    x.u.ki.dwFlags = (uint)((up ? 2 : 0) | (ext ? 1 : 0));', // 1 = EXTENDEDKEY (setas; sem isso vira a seta do teclado numérico)
  '    return x;',
  '  }',
  // Devolve quantos eventos o Windows aceitou (4 + 2*back se tudo certo; 0 = bloqueado, ex.: janela elevada).
  '  public static int PasteAndBack(int back) {',
  '    int n = 4 + 2 * back;',
  '    INPUT[] all = new INPUT[n];',
  '    int i = 0;',
  '    all[i++] = Key(0x11, false, false); all[i++] = Key(0x56, false, false);', // Ctrl↓ V↓
  '    all[i++] = Key(0x56, true, false);  all[i++] = Key(0x11, true, false);',  // V↑ Ctrl↑
  '    for (int k = 0; k < back; k++) { all[i++] = Key(0x25, false, true); all[i++] = Key(0x25, true, true); }', // ←↓ ←↑
  '    int sent = 0;',
  '    while (sent < n) {',
  '      int chunk = Math.Min(1000, n - sent);',
  '      INPUT[] part = new INPUT[chunk];',
  '      Array.Copy(all, sent, part, 0, chunk);',
  '      int ok = (int)SendInput((uint)chunk, part, Marshal.SizeOf(typeof(INPUT)));',
  '      sent += ok;',
  '      if (ok != chunk) break;',
  '    }',
  '    return sent;',
  '  }',
  '  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);',
  // Ctrl+C num SendInput só. Devolve quantos eventos o Windows aceitou (4 = ok; 0 = bloqueado).
  '  public static int CopySel() {',
  '    INPUT[] all = new INPUT[4];',
  '    all[0] = Key(0x11, false, false); all[1] = Key(0x43, false, false);', // Ctrl↓ C↓
  '    all[2] = Key(0x43, true, false);  all[3] = Key(0x11, true, false);',  // C↑ Ctrl↑
  '    return (int)SendInput(4, all, Marshal.SizeOf(typeof(INPUT)));',
  '  }',
  '  [DllImport("user32.dll", EntryPoint="SystemParametersInfo")] public static extern bool SpiGet(uint a, uint p, ref uint v, uint f);',
  '  [DllImport("user32.dll", EntryPoint="SystemParametersInfo")] public static extern bool SpiSet(uint a, uint p, IntPtr v, uint f);',
  '}',
  '"@',
  'function Fg { [DkWin]::GetForegroundWindow().ToInt64() }',
  'function Focus($n) {',
  '  $h = [IntPtr][int64]$n',
  "  if (-not [DkWin]::IsWindow($h)) { return 'err janela fechada' }",
  '  if ([DkWin]::IsIconic($h)) { [void][DkWin]::ShowWindow($h, 9) }',
  '  if ((Fg) -eq $n) { return "ok 1" }',
  // 1ª tentativa: tira o "bloqueio de foreground" só durante a chamada (valor antigo é restaurado).
  '  $old = [uint32]0',
  '  [void][DkWin]::SpiGet(0x2000, 0, [ref]$old, 0)',
  '  [void][DkWin]::SpiSet(0x2001, 0, [IntPtr]::Zero, 0)',
  '  try { [void][DkWin]::SetForegroundWindow($h) } finally { [void][DkWin]::SpiSet(0x2001, 0, [IntPtr][int64]$old, 0) }',
  '  for ($i = 0; $i -lt 8; $i++) { if ((Fg) -eq $n) { return "ok 1" }; Start-Sleep -Milliseconds 25 }',
  // 2ª tentativa: um toque em F24 (tecla sem função em qualquer programa) conta como "entrada recente" do
  // processo, o que o Windows exige para deixá-lo mudar o foreground — sem o efeito colateral do Alt (menus).
  '  [DkWin]::keybd_event(0x87, 0, 0, [UIntPtr]::Zero); [DkWin]::keybd_event(0x87, 0, 2, [UIntPtr]::Zero)',
  '  [void][DkWin]::SetForegroundWindow($h)',
  '  for ($i = 0; $i -lt 8; $i++) { if ((Fg) -eq $n) { return "ok 1" }; Start-Sleep -Milliseconds 25 }',
  // 3ª tentativa: anexa a fila de entrada à da janela que está na frente.
  '  $pid0 = [uint32]0',
  '  $them = [DkWin]::GetWindowThreadProcessId([DkWin]::GetForegroundWindow(), [ref]$pid0)',
  '  $me = [DkWin]::GetCurrentThreadId()',
  '  [void][DkWin]::AttachThreadInput($me, $them, $true)',
  '  try { [void][DkWin]::SetForegroundWindow($h) } finally { [void][DkWin]::AttachThreadInput($me, $them, $false) }',
  '  for ($i = 0; $i -lt 8; $i++) { if ((Fg) -eq $n) { return "ok 1" }; Start-Sleep -Milliseconds 25 }',
  '  return "ok 0"',
  '}',
  "[Console]::Out.WriteLine('ready')",
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($null -eq $line) { break }',
  '  try {',
  "    $parts = $line.Split(' ', 2)",
  '    $arg = if ($parts.Length -gt 1) { $parts[1] } else { "" }',
  '    switch ($parts[0]) {',
  '      "fg" { $r = "ok " + (Fg) }',
  '      "focus" { $r = Focus ([int64]$arg) }',
  // Copiar a seleção: o atalho global ainda pode estar pressionado — sem esperar soltar, o Ctrl+C viraria Ctrl+Alt+Shift+C.
  '      "copy" {',
  '        $t0 = Get-Date',
  '        while (((Get-Date) - $t0).TotalMilliseconds -lt 1200) {',
  '          $down = $false',
  '          foreach ($vk in 0x10, 0x11, 0x12, 0x5B, 0x5C) { if (([DkWin]::GetAsyncKeyState($vk) -band 0x8000) -ne 0) { $down = $true } }',
  '          if (-not $down) { break }',
  '          Start-Sleep -Milliseconds 15',
  '        }',
  '        if ([DkWin]::CopySel() -ne 4) { throw "BLOQUEADO: o Windows recusou as teclas (janela de administrador?)" }',
  '        $r = "ok"',
  '      }',
  '      "keys" { [System.Windows.Forms.SendKeys]::SendWait($arg); $r = "ok" }',
  '      "paste" {',
  '        $b = [int]$arg',
  '        if ($b -lt 0 -or $b -gt 2000) { throw "back invalido" }',
  '        $sent = [DkWin]::PasteAndBack($b)',
  '        if ($sent -eq 0) { throw "BLOQUEADO: o Windows recusou as teclas (janela de administrador?)" }',
  '        if ($sent -ne (4 + 2 * $b)) { throw "SendInput aceitou so $sent eventos" }',
  '        $r = "ok"',
  '      }',
  // Vault: texto (UTF-8 em base64) no clipboard marcado para ficar fora do histórico (Win+V) e da nuvem.
  '      "clip" {',
  '        $t = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($arg))',
  '        $d = New-Object System.Windows.Forms.DataObject',
  '        $d.SetData([System.Windows.Forms.DataFormats]::UnicodeText, $t)',
  '        foreach ($f in @("ExcludeClipboardContentFromMonitorProcessing", "CanIncludeInClipboardHistory", "CanUploadToCloudClipboard")) {',
  '          $d.SetData($f, (New-Object System.IO.MemoryStream(,[byte[]]@(0,0,0,0))))',
  '        }',
  '        [System.Windows.Forms.Clipboard]::SetDataObject($d, $true, 5, 100)',
  '        $t = $null; $d = $null',
  '        $r = "ok"',
  '      }',
  '      default { $r = "err comando desconhecido" }',
  '    }',
  '  } catch { $r = "err " + ($_.Exception.Message -replace "[\\r\\n]+", " ") }',
  '  [Console]::Out.WriteLine($r)',
  '}',
].join('\n');

const MAX_BACK = 2000; // quantas setas ← no máximo depois de colar (mesmo limite de electron/paste.js)
const isHandle = (h) => /^\d+$/.test(String(h)) && String(h) !== '0';

function createWinHelper({ spawn = nodeSpawn, platform = process.platform, timeoutMs = 4000 } = {}) {
  let proc = null;
  let readyP = null;
  let pending = [];   // { resolve, reject, timer } na ordem dos pedidos
  let buf = '';

  function reset(err) {
    const list = pending;
    pending = []; proc = null; readyP = null; buf = '';
    for (const p of list) { clearTimeout(p.timer); p.reject(err); }
  }

  function start() {
    if (platform !== 'win32') return Promise.reject(new Error('Disponível só no Windows'));
    if (readyP) return readyP;
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand',
      Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: true });
    proc = p;
    readyP = new Promise((resolve, reject) => {
      let isReady = false;
      const timer = setTimeout(() => { if (!isReady) { try { p.kill(); } catch { /* já saiu */ } reject(new Error('Auxiliar do Windows não iniciou')); } }, 15000);
      p.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, i).replace(/\r$/, '');
          buf = buf.slice(i + 1);
          if (!isReady) { if (line === 'ready') { isReady = true; clearTimeout(timer); resolve(); } continue; }
          const waiting = pending.shift();
          if (waiting) { clearTimeout(waiting.timer); waiting.resolve(line); }
        }
      });
      p.on('error', (e) => { clearTimeout(timer); reject(e); reset(e); });
      p.on('exit', () => { clearTimeout(timer); const e = new Error('Auxiliar do Windows encerrou'); if (!isReady) reject(e); reset(e); });
    });
    readyP.catch(() => {}); // a rejeição chega a quem pediu; sem isto o Node reclama de "unhandled"
    return readyP;
  }

  async function send(line, { wait = timeoutMs } = {}) {
    await start();
    const current = proc;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        // Resposta fora de hora desalinharia a fila: derruba o processo e recomeça no próximo pedido.
        try { current.kill(); } catch { /* já saiu */ }
        reset(new Error('Auxiliar do Windows não respondeu'));
      }, wait);
      pending.push(entry);
      current.stdin.write(line + '\n');
    }).then((r) => {
      if (r.startsWith('err ')) throw new Error(r.slice(4));
      return r;
    });
  }

  return {
    /** Sobe o processo em segundo plano (para o 1º uso já encontrá-lo pronto). Nunca rejeita. */
    warm: () => { start().catch(() => {}); },
    /** Janela em primeiro plano agora (string de dígitos) ou null se o auxiliar ainda não está pronto. */
    async foreground({ wait = 800 } = {}) {
      try {
        const r = await Promise.race([send('fg'), new Promise((res) => setTimeout(() => res(null), wait))]);
        const h = r && r.startsWith('ok ') ? r.slice(3).trim() : null;
        return isHandle(h) ? h : null;
      } catch { return null; }
    },
    /** Traz a janela de volta ao primeiro plano. true = conseguiu; false = não confirmou (ou janela fechada). */
    async focus(hwnd) {
      if (!isHandle(hwnd)) return false;
      try { return (await send('focus ' + hwnd)) === 'ok 1'; } catch { return false; }
    },
    /** SendKeys.SendWait. Rejeita se o auxiliar não existir/falhar. */
    keys: (keys) => send('keys ' + keys, { wait: 8000 }).then(() => undefined),
    /**
     * Ctrl+V seguido de `back` setas ← num único SendInput. Rejeita se o auxiliar falhar; se o Windows RECUSAR
     * as teclas (janela elevada), o erro vem com `code === 'BLOCKED'` — aí cair no SendKeys não adianta.
     */
    async paste(back = 0) {
      const n = Number(back);
      if (!Number.isInteger(n) || n < 0 || n > MAX_BACK) throw new Error('Posição do cursor inválida');
      try { await send('paste ' + n, { wait: 8000 }); } catch (e) {
        if (/BLOQUEADO/.test(String((e && e.message) || e))) e.code = 'BLOCKED';
        throw e;
      }
    },
    /** Ctrl+C na janela em foco (espera os modificadores do atalho global serem soltos). `code === 'BLOCKED'` se o Windows recusar. */
    async copy() {
      try { await send('copy', { wait: 4000 }); } catch (e) {
        if (/BLOQUEADO/.test(String((e && e.message) || e))) e.code = 'BLOCKED';
        throw e;
      }
    },
    /** Vault: grava o texto no clipboard fora do histórico do Windows (Win+V) e da sincronização na nuvem. */
    secretClip: (text) => send('clip ' + Buffer.from(String(text), 'utf8').toString('base64')).then(() => undefined),
    dispose() { if (proc) { try { proc.kill(); } catch { /* já saiu */ } } reset(new Error('encerrado')); },
  };
}

module.exports = { createWinHelper, isHandle, SCRIPT };
