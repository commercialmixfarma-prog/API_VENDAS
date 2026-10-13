const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { buildSpec } = require('./index');
const { docsHeaders, docsAccessLog, createDocsLimiter, requireBasicAuth } = require('../middleware/docsGuard');
const { notFoundHandler } = require('../middleware/errorHandler');

/**
 * Rotas de documentação, montadas em /docs somente quando habilitadas (ver app.js).
 *
 *   GET /docs/              Swagger UI (HTML sem script inline; JS/CSS em arquivos próprios)
 *   GET /docs/openapi.json  especificação OpenAPI 3.0.3 (importável no Postman/Thunder Client)
 *   GET /docs/<asset>       apenas os 6 arquivos da UI listados em ASSETS; o resto cai no 404 da API
 *
 * O CSP global do helmet não é alterado: a UI funciona com script-src 'self' porque o
 * código de inicialização é servido como arquivo (swagger-ui-init.js), não inline.
 * Assets fora da allowlist (index.html de exemplo, oauth2-redirect, source maps, bundles ES)
 * não são servidos para não expor páginas com links externos.
 */
const ASSETS = new Set([
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js',
  'swagger-ui-init.js',
  'favicon-32x32.png',
  'favicon-16x16.png',
]);

function createDocsRouter({ serverUrl, rateLimitMax, basicAuthRequired, basicUser, basicPasswordHash }, { version }) {
  const spec = buildSpec({ serverUrl, version });
  const uiOptions = {
    customSiteTitle: `${spec.info.title} ${version}`,
    customRobots: 'noindex, nofollow',
    swaggerOptions: {
      persistAuthorization: false, // token nunca vai para localStorage
      validatorUrl: null,          // sem chamada ao validador externo
      layout: 'BaseLayout',        // sem barra de URL: a spec vem embutida, não de uma URL arbitrária
      deepLinking: true,
      displayRequestDuration: true,
      tryItOutEnabled: false,
      supportedSubmitMethods: ['get', 'post'],
      docExpansion: 'list',
      defaultModelsExpandDepth: 1,
    },
  };
  const html = swaggerUi.generateHTML(spec, uiOptions);
  // serveFiles devolve [init por instância, estático]; o estático é usado só para a allowlist.
  const [serveInit, serveStatic] = swaggerUi.serveFiles(spec, uiOptions);
  const specJson = JSON.stringify(spec);

  const router = express.Router();
  router.use(docsHeaders, createDocsLimiter(rateLimitMax), docsAccessLog);
  if (basicAuthRequired) router.use(requireBasicAuth({ user: basicUser, passwordHash: basicPasswordHash }));

  router.get('/', (req, res) => {
    // Assets são relativos ("./swagger-ui.css"); /docs precisa virar /docs/. Redireciona pelo
    // caminho de montagem (req.baseUrl), nunca por Host ou X-Forwarded-*.
    if (!req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(302, `${req.baseUrl}/`);
    return res.type('html').send(html);
  });
  router.get('/openapi.json', (req, res) => res.type('application/json').send(specJson));
  router.get('/:asset', (req, res, next) => {
    if (!ASSETS.has(req.params.asset)) return next();
    if (req.params.asset === 'swagger-ui-init.js') return serveInit(req, res, next);
    return serveStatic(req, res, next);
  });
  // Encerra aqui: caminho desconhecido sob /docs não desce para o generalLimiter da API.
  router.use(notFoundHandler);
  return router;
}

module.exports = { createDocsRouter, ASSETS };
