'use strict';
/**
 * Cliente OAuth do Google que vem junto com o app, para o usuário só clicar em "Conectar" (sem criar projeto no
 * Google Cloud). Fontes, da mais forte para a mais fraca:
 *   1. variáveis de ambiente DEVKIT_GOOGLE_CLIENT_ID / DEVKIT_GOOGLE_CLIENT_SECRET (desenvolvimento, testes)
 *   2. google-client.generated.json, gerado no build por scripts/embed-google-client.mjs a partir dos segredos
 *      do repositório (fora do git; entra no instalador)
 * O que o usuário digitar nas configurações (credenciais próprias) continua mandando sobre isto — ver manager.js.
 *
 * O `client_secret` de um app de desktop não é confidencial para o Google (qualquer instalação o contém); ele só
 * identifica o app. Por isso é aceitável embuti-lo, mas ele fica extraível do instalador.
 */
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, 'google-client.generated.json');
const ID_RE = /^[\w-]+(\.[\w-]+)*\.apps\.googleusercontent\.com$/;

const clean = (c) => ({ clientId: String((c && c.clientId) || '').trim(), clientSecret: String((c && c.clientSecret) || '').trim() });
/** ID no formato do Google e chave presente. */
const valid = (c) => ID_RE.test(c.clientId) && !!c.clientSecret;

/** → { clientId, clientSecret, source: 'env' | 'build' | null }. Nunca lança: sem cliente válido, devolve vazio. */
function loadDefaultClient({ env = process.env, file = FILE, readFile = fs.readFileSync } = {}) {
  const fromEnv = clean({ clientId: env.DEVKIT_GOOGLE_CLIENT_ID, clientSecret: env.DEVKIT_GOOGLE_CLIENT_SECRET });
  if (valid(fromEnv)) return { ...fromEnv, source: 'env' };
  try {
    const fromBuild = clean(JSON.parse(readFile(file, 'utf8')));
    if (valid(fromBuild)) return { ...fromBuild, source: 'build' };
  } catch { /* sem arquivo (build sem segredos, ou desenvolvimento) */ }
  return { clientId: '', clientSecret: '', source: null };
}

module.exports = { loadDefaultClient, valid, FILE, ID_RE };
