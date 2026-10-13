const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const logger = require('../config/logger');

/**
 * Proteções exclusivas das rotas /docs (Swagger UI + openapi.json).
 *
 * - Limiter próprio: os assets da UI não consomem a cota do generalLimiter da API.
 * - Basic Auth opcional (obrigatório em produção, validado em settings.getDocsSettings):
 *   usuário comparado em tempo constante, senha via bcrypt. O bcrypt roda sempre que
 *   há credencial, mesmo com usuário errado, para não revelar o usuário pelo tempo.
 * - Cache-Control: no-store e X-Robots-Tag: noindex em todas as respostas.
 * - Log de acesso e de 401, sem registrar o header Authorization nem credenciais.
 *
 * Não usa allowlist de IP: a porta é publicada em 127.0.0.1 atrás de proxy e, com
 * TRUST_PROXY_HOPS=0, req.ip é o IP do proxy, não do cliente.
 */
const MAX_AUTH_HEADER = 4096;

function docsHeaders(req, res, next) {
  res.set({
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  });
  next();
}

function docsAccessLog(req, res, next) {
  const inicio = Date.now();
  res.on('finish', () => logger.info(`DOCS ${req.method} ${req.originalUrl.split('?')[0]}`, {
    status: res.statusCode,
    durationMs: Date.now() - inicio,
    ip: req.ip,
  }));
  next();
}

function createDocsLimiter(max) {
  return rateLimit({
    windowMs: 60000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) { res.status(429).json({ erro: 'Muitas requisições. Tente novamente em instantes.' }); },
  });
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}
// Igualdade em tempo constante independente do tamanho das entradas.
function safeEqual(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

function parseBasic(header) {
  if (typeof header !== 'string' || header.length > MAX_AUTH_HEADER) return null;
  const match = header.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return null;
  return { user: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

function requireBasicAuth({ user, passwordHash }) {
  if (!user || !passwordHash) throw new Error('Basic Auth da documentação exige usuário e hash bcrypt.');
  return async function basicAuth(req, res, next) {
    try {
      const cred = parseBasic(req.headers.authorization);
      let ok = false;
      if (cred) {
        const userOk = safeEqual(cred.user, user);
        const passOk = await bcrypt.compare(cred.password, passwordHash);
        ok = userOk && passOk;
      }
      if (ok) return next();
      logger.warn('Acesso à documentação recusado (Basic Auth)', {
        motivo: cred ? 'credencial_invalida' : 'credencial_ausente',
        path: req.originalUrl.split('?')[0],
        ip: req.ip,
      });
      res.set('WWW-Authenticate', 'Basic realm="Documentacao da API", charset="UTF-8"');
      return res.status(401).json({ erro: 'Autenticação necessária para acessar a documentação.' });
    } catch (err) { return next(err); }
  };
}

module.exports = { docsHeaders, docsAccessLog, createDocsLimiter, requireBasicAuth, parseBasic, safeEqual };
