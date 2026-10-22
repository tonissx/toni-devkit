'use strict';
/**
 * Login do Google para app de desktop: OAuth 2.0 com PKCE e redirecionamento para 127.0.0.1 (o app sobe um
 * servidor local por alguns instantes, abre o navegador do usuário e recebe o código). Só pede o escopo
 * `drive.appdata` (pasta privada do app no Drive).
 *
 * O Google exige o `client_secret` do cliente "App para computador" na troca do código, mas ele não é
 * confidencial (é o mesmo para todos que instalam o app) — por isso pode ficar na configuração local.
 */
const http = require('node:http');
const crypto = require('node:crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Par PKCE: verifier aleatório e challenge = base64url(SHA-256(verifier)). */
function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

function authUrl({ clientId, redirectUri, challenge, state }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    code_challenge: challenge, code_challenge_method: 'S256', state,
    access_type: 'offline', prompt: 'consent', // consent: garante o refresh_token mesmo numa reconexão
  });
  return AUTH_URL + '?' + q;
}

const PAGE = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div><h2>${title}</h2><p>${text}</p></div>`;

/** POST no endpoint de token; devolve o JSON. Erro vira exceção com `.code` (ex.: 'invalid_grant'). */
async function tokenRequest(params, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  let data = {};
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const e = new Error(`Google: ${data.error_description || data.error || res.statusText} (${res.status})`);
    e.code = data.error;
    throw e;
  }
  return data;
}

/** Renova o access token. → { accessToken, expiresAt (ms) }. */
async function refresh({ clientId, clientSecret, refreshToken, fetchImpl = fetch, now = Date.now }) {
  const d = await tokenRequest({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }, fetchImpl);
  return { accessToken: d.access_token, expiresAt: now() + (Number(d.expires_in) || 3600) * 1000 };
}

/**
 * Abre o login no navegador e espera o retorno. `openExternal(url)` abre o navegador (shell.openExternal).
 * → { refreshToken, accessToken, expiresAt }. Rejeita se o usuário negar, demorar demais ou o Google não devolver refresh_token.
 */
function authorize({ clientId, clientSecret, openExternal, fetchImpl = fetch, timeoutMs = 3 * 60 * 1000, now = Date.now }) {
  const { verifier, challenge } = pkcePair();
  const state = b64url(crypto.randomBytes(16));
  return new Promise((resolve, reject) => {
    let done = false;
    const server = http.createServer();
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); server.close(); fn(v); };
    const timer = setTimeout(() => finish(reject, new Error('Tempo esgotado: o login no Google não foi concluído.')), timeoutMs);

    server.on('request', async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404).end(); return; }
      const reply = (code, title, text) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE(title, text)); };
      if (u.searchParams.get('state') !== state) { reply(400, 'Link inválido', 'Volte ao Devkit e tente conectar de novo.'); return; }
      const err = u.searchParams.get('error');
      if (err) { reply(200, 'Conexão cancelada', 'Você pode fechar esta janela.'); finish(reject, new Error(err === 'access_denied' ? 'Você não autorizou o acesso ao Google Drive.' : 'Google: ' + err)); return; }
      const code = u.searchParams.get('code');
      if (!code) { reply(400, 'Link inválido', 'O Google não devolveu o código.'); return; }
      try {
        const redirectUri = `http://127.0.0.1:${server.address().port}`;
        const d = await tokenRequest({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }, fetchImpl);
        if (!d.refresh_token) throw new Error('O Google não devolveu a permissão de uso contínuo. Remova o acesso do Devkit em myaccount.google.com/permissions e conecte de novo.');
        reply(200, 'Devkit conectado ao Google Drive', 'Pode fechar esta janela e voltar ao Devkit.');
        finish(resolve, { refreshToken: d.refresh_token, accessToken: d.access_token, expiresAt: now() + (Number(d.expires_in) || 3600) * 1000 });
      } catch (e) { reply(500, 'Não deu certo', 'Volte ao Devkit para ver o motivo.'); finish(reject, e); }
    });
    server.on('error', (e) => finish(reject, e));
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}`;
      Promise.resolve(openExternal(authUrl({ clientId, redirectUri, challenge, state }))).catch((e) => finish(reject, e));
    });
  });
}

module.exports = { authorize, refresh, pkcePair, authUrl, SCOPE };
