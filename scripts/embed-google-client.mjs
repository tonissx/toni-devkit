// Embute o cliente OAuth do Google no build: lê DEVKIT_GOOGLE_CLIENT_ID e DEVKIT_GOOGLE_CLIENT_SECRET e grava
// electron/sync/google-client.generated.json (fora do git), que o electron-builder empacota junto com electron/**.
// Sem as variáveis (fork, build local) não faz nada e não falha: o app cai no formulário de credenciais próprias.
//   uso: node scripts/embed-google-client.mjs [arquivo-de-saida]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { valid, FILE, ID_RE } = require('../electron/sync/google-client.js');

const out = process.argv[2] || FILE;
const client = {
  clientId: String(process.env.DEVKIT_GOOGLE_CLIENT_ID || '').trim(),
  clientSecret: String(process.env.DEVKIT_GOOGLE_CLIENT_SECRET || '').trim(),
};

if (!client.clientId && !client.clientSecret) {
  console.log('[embed-google-client] DEVKIT_GOOGLE_CLIENT_ID/SECRET não definidos — o app sai sem cliente embutido (o usuário informa as próprias credenciais).');
} else if (!valid(client)) {
  // Segredo mal copiado: melhor quebrar o build do que publicar um instalador com "Conectar" que nunca funciona.
  console.error(`[embed-google-client] credenciais inválidas: o ID do cliente deve casar com ${ID_RE} e a chave não pode ser vazia.`);
  process.exit(1);
} else {
  writeFileSync(out, JSON.stringify(client));
  console.log('[embed-google-client] cliente OAuth embutido em ' + out);
}
