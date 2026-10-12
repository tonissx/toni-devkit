// Mínimo de Chrome DevTools Protocol para dirigir o Electron nas capturas (Node 22+: WebSocket global).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ userData, notes, port = 9333, root }) {
  const electron = require('electron'); // caminho do executável
  const child = spawn(electron, [root, `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, DEVKIT_NOTES_DIR: notes, ELECTRON_ENABLE_LOGGING: '0' }, stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { const r = await fetch(`http://127.0.0.1:${port}/json`); const t = await r.json(); if (t.some((x) => /index\.html/.test(x.url))) break; } catch { /* ainda subindo */ }
  }
  return { child, port, stop: () => { try { child.kill(); } catch { /* já saiu */ } } };
}

export async function targets(port) {
  return (await fetch(`http://127.0.0.1:${port}/json`)).json();
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const { res, rej } = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });

  const api = {
    send,
    close: () => ws.close(),
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file, fs) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(file, Buffer.from(r.data, 'base64'));
    },
    /** Tecla com modificadores: key('k', { ctrl: true }) · key('Enter') · key('F2'). */
    async key(key, { ctrl = false, alt = false, shift = false } = {}) {
      const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
      const special = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ' ': 32 };
      const code = special[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
      const text = key.length === 1 && !ctrl && !alt ? key : key === 'Enter' ? '\r' : undefined;
      const base = { modifiers, key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, code: key.length === 1 ? 'Key' + key.toUpperCase() : key };
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async type(text, delay = 0) {
      for (const ch of text) { await send('Input.insertText', { text: ch }); if (delay) await sleep(delay); }
    },
    async click(x, y) {
      for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    },
    async drag(x1, y1, x2, y2, steps = 12) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= steps; i++) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps, button: 'left', buttons: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
    },
    async move(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); },
  };
  return api;
}

export const pageTarget = async (port, re) => (await targets(port)).find((t) => t.type === 'page' && re.test(t.url));
export { path };
