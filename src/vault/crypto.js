'use strict';
/**
 * Criptografia do Vault (cofre de dados sensíveis). Puro Node (`node:crypto`), sem Electron — testável no Node.
 *
 * - Chave: scrypt(senha mestra, salt aleatório de 16 bytes) → 32 bytes. N alto de propósito: cada tentativa de
 *   senha custa ~0,3 s e 128 MB, o que torna inviável testar senhas em massa a partir de uma cópia do arquivo.
 * - Conteúdo: AES-256-GCM, IV novo de 12 bytes a cada gravação. A tag GCM autentica o conteúdo E o cabeçalho
 *   (formato, versão e parâmetros do scrypt entram como AAD): senha errada e arquivo adulterado falham igual.
 * - O salt só muda ao trocar a senha mestra; a chave derivada fica em memória enquanto o cofre está aberto,
 *   então gravar não exige rodar o scrypt de novo.
 *
 * Envelope gravado em disco (JSON):
 *   { format: 'toni-devkit-vault', v: 1, kdf: { alg: 'scrypt', salt, N, r, p }, iv, tag, data }   (binários em base64)
 */
const crypto = require('node:crypto');

const FORMAT = 'toni-devkit-vault';
const VERSION = 1;
const KDF_DEFAULTS = { N: 2 ** 17, r: 8, p: 1 };
const MIN_PASSWORD = 8;

/** Erro de senha errada / arquivo adulterado (indistinguíveis de propósito). */
class WrongPasswordError extends Error {
  constructor() { super('Senha incorreta'); this.code = 'WRONG_PASSWORD'; }
}

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => Buffer.from(String(s || ''), 'base64');

/** Parâmetros novos do scrypt (salt aleatório). `params` sobrescreve N/r/p — só os testes usam um N menor. */
function newKdf(params = {}) {
  return { alg: 'scrypt', salt: b64(crypto.randomBytes(16)), ...KDF_DEFAULTS, ...params };
}

/** Senha mestra + parâmetros → chave AES de 32 bytes. */
function deriveKey(password, kdf) {
  if (!kdf || kdf.alg !== 'scrypt') return Promise.reject(new Error('Formato de cofre desconhecido'));
  const { N, r, p } = kdf;
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password).normalize('NFC'), unb64(kdf.salt), 32, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Cabeçalho autenticado: trocar qualquer parâmetro do envelope invalida a tag. */
const aad = (kdf) => Buffer.from(`${FORMAT}/v${VERSION}|${kdf.salt}|${kdf.N}|${kdf.r}|${kdf.p}`, 'utf8');

/** Objeto → envelope criptografado (IV novo a cada chamada). */
function seal(key, kdf, data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(kdf));
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return { format: FORMAT, v: VERSION, kdf, iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(enc) };
}

/** Envelope → objeto. Senha errada ou arquivo adulterado → WrongPasswordError. */
function open(key, env) {
  assertEnvelope(env);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64(env.iv));
    decipher.setAAD(aad(env.kdf));
    decipher.setAuthTag(unb64(env.tag));
    const text = Buffer.concat([decipher.update(unb64(env.data)), decipher.final()]).toString('utf8');
    return JSON.parse(text);
  } catch {
    throw new WrongPasswordError();
  }
}

function assertEnvelope(env) {
  if (!env || env.format !== FORMAT || !env.kdf || !env.iv || !env.tag || typeof env.data !== 'string') {
    throw new Error('O arquivo do cofre não é válido');
  }
  if (env.v > VERSION) throw new Error('O cofre foi criado por uma versão mais nova do Devkit');
}

/** Regra mínima da senha mestra → mensagem de erro ou null. */
function passwordProblem(password) {
  const s = String(password || '');
  if (s.length < MIN_PASSWORD) return `A senha mestra precisa de pelo menos ${MIN_PASSWORD} caracteres`;
  if (!s.trim()) return 'A senha mestra não pode ser só espaços';
  return null;
}

module.exports = { FORMAT, VERSION, KDF_DEFAULTS, MIN_PASSWORD, WrongPasswordError, newKdf, deriveKey, seal, open, assertEnvelope, passwordProblem };
