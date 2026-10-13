const fs = require('node:fs');
const path = require('node:path');

/**
 * Monta a especificação OpenAPI 3.0.3 a partir de objetos JS:
 *   paths/*.js    -> exporta { '/rota': { get: {...} } }
 *   schemas/*.js  -> exporta { schemas, parameters, responses, securitySchemes } (todos opcionais)
 *
 * Os arquivos são carregados automaticamente (ordem alfabética) e chaves duplicadas
 * derrubam o startup, para que uma rota nunca fique documentada duas vezes.
 * Sem swagger-jsdoc: a spec é código revisável, dentro de src/ (o Dockerfile copia só src).
 *
 * Regras de conteúdo: exemplos fictícios; sem segredos, dados reais, nomes de banco,
 * variáveis de ambiente ou objetos internos do ERP.
 */
const COMPONENT_KEYS = ['schemas', 'parameters', 'responses', 'securitySchemes'];

function loadDir(dir) {
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .sort()
    .map(f => ({ name: f, mod: require(path.join(dir, f)) }));
}

function mergeUnique(target, source, origem) {
  for (const [key, value] of Object.entries(source)) {
    if (Object.hasOwn(target, key)) throw new Error(`Definição OpenAPI duplicada "${key}" em ${origem}.`);
    target[key] = value;
  }
}

function buildSpec({ serverUrl = '/', version = '0.0.0' } = {}) {
  const paths = {};
  const components = Object.fromEntries(COMPONENT_KEYS.map(k => [k, {}]));
  for (const { name, mod } of loadDir(path.join(__dirname, 'paths'))) mergeUnique(paths, mod, `paths/${name}`);
  for (const { name, mod } of loadDir(path.join(__dirname, 'schemas'))) {
    for (const key of COMPONENT_KEYS) if (mod[key]) mergeUnique(components[key], mod[key], `schemas/${name}#${key}`);
  }
  const spec = {
    openapi: '3.0.3',
    info: {
      title: 'API Vendas MIX',
      version,
      description: [
        'API somente leitura de vendas e pedidos do ERP corporativo. Nenhuma rota altera dados.',
        '',
        '**Autenticação**: obtenha um token em `POST /auth/login` e envie `Authorization: Bearer <token>` nas rotas de dados.',
        'O token tem prazo de validade (`expires_in`); renove quando receber `401` com `erro: "Token expirado."`.',
        '',
        '**Formatos de erro** (dois formatos coexistem; trate ambos no consumidor):',
        '- `{ "erro": "..." }` em 401/403 de autenticação, 400 de login, 404, 413, 429 e 500.',
        '- `{ "success": false, "error": "..." }` em 400 de período/UF/filtros e em 503 (com header `Retry-After: 5`).',
        '',
        '**Limites**: período máximo por consulta configurado pelo administrador (padrão 7 dias, inclusive);',
        'número máximo de consultas simultâneas por processo (503 quando excedido); limite de requisições por minuto por IP (429).',
        'Divida consultas longas em janelas menores e respeite `Retry-After`.',
        '',
        'Rota inexistente responde `404 { "erro": "Rota não encontrada." }`.',
        '',
        'Para importar no Postman/Thunder Client use `GET /docs/openapi.json`. O campo `servers` é fixo e configurado pelo administrador;',
        'o padrão `/` significa "mesma origem onde esta documentação está publicada".',
      ].join('\n'),
    },
    servers: [{ url: serverUrl, description: serverUrl === '/' ? 'Mesma origem desta documentação' : 'Servidor configurado pelo administrador' }],
    tags: [
      { name: 'Saúde', description: 'Verificação de disponibilidade do processo HTTP (não consulta o banco).' },
      { name: 'Autenticação', description: 'Credencial de serviço (máquina para máquina). Não é login de usuário humano.' },
      { name: 'Vendas', description: 'Vendas faturadas por item de pedido. Fonte oficial para apuração de venda realizada.' },
      { name: 'Pedidos', description: 'Todos os pedidos do período, em qualquer status, com situação em tempo real.' },
    ],
    paths,
    components,
  };
  // Cópia profunda: a spec entregue à UI/rotas nunca compartilha referência com os módulos.
  return structuredClone(spec);
}

module.exports = { buildSpec, COMPONENT_KEYS };
