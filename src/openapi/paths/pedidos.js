const periodo = [{ $ref: '#/components/parameters/dataInicio' }, { $ref: '#/components/parameters/dataFim' }];
const filtros = [{ $ref: '#/components/parameters/status' }, { $ref: '#/components/parameters/situacao' }, { $ref: '#/components/parameters/origem' }];
const seguranca = [{ bearerAuth: [] }];
const errosComuns = {
  401: { $ref: '#/components/responses/NaoAutenticado' },
  403: { $ref: '#/components/responses/SemPermissao' },
  429: { $ref: '#/components/responses/LimiteRequisicoes' },
  500: { $ref: '#/components/responses/ErroInterno' },
};
const errosLeitura = { ...errosComuns, 503: { $ref: '#/components/responses/LeituraIndisponivel' } };
const ok = (schema, description) => ({ description, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } });

const regraConsumo = 'Venda realizada = linhas com origem PAINEL. Nunca somar valor_pedido_bruto de PERDIDO ou EM_ANDAMENTO como venda. Pedido que muda de status depois não tem data de alteração: para D-1 consulte com 2 a 3 dias de retrocesso e faça upsert por id_linha.';

module.exports = {
  '/pedidos': {
    get: {
      tags: ['Pedidos'],
      summary: 'Todos os pedidos do período, em qualquer status',
      description: `Linhas de /vendas (origem PAINEL) mais todo pedido do período que a visão de vendas não devolveu, em qualquer status (origem CABPED), sem duplicidade por pedido. Filtros opcionais são aplicados em memória após a consulta. ${regraConsumo}`,
      operationId: 'getPedidos',
      security: seguranca,
      parameters: [...periodo, ...filtros],
      responses: { 200: ok('PedidosResposta', 'Linhas do período (após filtros).'), 400: { $ref: '#/components/responses/FiltrosOuPeriodoInvalido' }, ...errosLeitura },
    },
  },
  '/pedidos/resumo': {
    get: {
      tags: ['Pedidos'],
      summary: 'Pedidos, linhas e valores por status e situação, por UF',
      description: `Agrega as mesmas linhas de /pedidos (respeitando os filtros): venda realizada (somente PAINEL), valor bruto por situação e por status, e motivos de rejeição. ${regraConsumo}`,
      operationId: 'getPedidosResumo',
      security: seguranca,
      parameters: [...periodo, ...filtros],
      responses: { 200: ok('PedidosResumo', 'Resumo do período.'), 400: { $ref: '#/components/responses/FiltrosOuPeriodoInvalido' }, ...errosLeitura },
    },
  },
  '/pedidos/por-uf/{uf}': {
    get: {
      tags: ['Pedidos'],
      summary: 'Todos os pedidos de uma UF no período',
      description: `Mesmo conteúdo de /pedidos restrito à UF informada, consultando apenas a base dela. ${regraConsumo}`,
      operationId: 'getPedidosPorUf',
      security: seguranca,
      parameters: [...periodo, { $ref: '#/components/parameters/uf' }, ...filtros],
      responses: { 200: ok('PedidosUfResposta', 'Linhas da UF no período (após filtros).'), 400: { $ref: '#/components/responses/FiltrosOuPeriodoInvalido' }, ...errosLeitura },
    },
  },
  '/pedidos/status': {
    get: {
      tags: ['Pedidos'],
      summary: 'Dicionário de códigos de status e situações',
      description: 'Lista estática (não consulta o banco) dos códigos de status conhecidos, seu texto e a situação em que cada um é agrupado. Exige token como as demais rotas de dados.',
      operationId: 'getPedidosStatus',
      security: seguranca,
      responses: { 200: ok('PedidosStatusResposta', 'Dicionário de status.'), ...errosComuns },
    },
  },
};
