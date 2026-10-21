'use strict';
/**
 * Guarda o refresh token do Google cifrado pelo sistema (Electron safeStorage → DPAPI no Windows, Keychain no
 * macOS). Fica em userData — nunca na pasta das notas, que pode estar num sync ou no git (mesma regra do Vault).
 * `cipher` = { available(), encrypt(texto) → Buffer, decrypt(Buffer) → texto }; sem criptografia disponível o
 * token NÃO é gravado (melhor reconectar a cada abertura do que deixar a credencial em texto puro).
 */
const fs = require('node:fs/promises');
const { atomicWrite } = require('../lib/fsx.js');

function createTokenStore({ file, cipher }) {
  return {
    available: () => !!cipher.available(),
    /** → refresh token ou null (arquivo ausente, corrompido ou de outro usuário do sistema). */
    async load() {
      try {
        const j = JSON.parse(await fs.readFile(file, 'utf8'));
        if (j.v !== 1 || typeof j.data !== 'string') return null;
        return cipher.decrypt(Buffer.from(j.data, 'base64')) || null;
      } catch { return null; }
    },
    async save(refreshToken) {
      if (!cipher.available()) throw new Error('O sistema não oferece criptografia para guardar o acesso ao Google com segurança.');
      await atomicWrite(file, JSON.stringify({ v: 1, data: cipher.encrypt(String(refreshToken)).toString('base64') }));
    },
    clear: () => fs.rm(file, { force: true }),
  };
}

module.exports = { createTokenStore };
