'use strict';
/**
 * Ponte de baixo nível para o binário `git` do sistema. Nenhum parsing aqui — só execução e
 * classificação de erro (ver electron/git/parse.js para os parsers e electron/git/service.js
 * para a orquestração).
 */
const { execFile } = require('node:child_process');

const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_MAX_BUFFER = 20 * 1024 * 1024;

class GitError extends Error {
  constructor(type, message, detail) {
    super(message);
    this.type = type; // 'git-not-found' | 'not-a-repo' | 'timeout' | 'git-error'
    this.detail = detail;
  }
}

function classify(err, stderr) {
  if (err && err.code === 'ENOENT') return new GitError('git-not-found', 'Git não encontrado no PATH');
  if (err && (err.killed || err.signal)) return new GitError('timeout', 'Comando git demorou demais para responder');
  const text = String(stderr || (err && err.message) || '');
  if (/not a git repository/i.test(text)) return new GitError('not-a-repo', 'Não é um repositório git', text);
  return new GitError('git-error', 'Erro ao executar git', text);
}

/** Roda `git <args>` em `cwd` e resolve com o stdout (string). Rejeita com um GitError tipado. */
function execGit(args, { cwd, timeout = DEFAULT_TIMEOUT, maxBuffer = DEFAULT_MAX_BUFFER } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf8', timeout, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(classify(err, stderr));
      resolve(stdout);
    });
  });
}

module.exports = { execGit, GitError };
