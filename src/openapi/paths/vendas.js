const periodo = [{ $ref: '#/components/parameters/dataInicio' }, { $ref: '#/components/parameters/dataFim' }];
const seguranca = [{ bearerAuth: [] }];
const errosComuns = {
  401: { $ref: '#/components/responses/NaoAutenticado' },
  403: { $ref: '#/components/responses/SemPermissao' },
  429: { $ref: '#/components/responses/LimiteRequisicoes' },
  500: { $ref: '#/components/responses/ErroInterno' },
  503: { $ref: '#/components/responses/LeituraIndisponivel' },
};
const ok = (schema, description) => ({ description, content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } } });

module.exports = {
  '/vendas': {
    get: {
      tags: ['Vendas'],
      summary: 'Vendas faturadas de todas as UFs no período',
      description: 'Uma linha por item de pedido faturado, todas as UFs habilitadas. Para apurar valor use preço × quantidade nas vendas e `total_venda` nas devoluções (operacao 8), como faz /vendas/resumo.',
      operationId: 'getVendas',
      security: seguranca,
      parameters: periodo,
      responses: { 200: ok('VendasResposta', 'Linhas do período.'), 400: { $ref: '#/components/responses/PeriodoInvalido' }, ...errosComuns },
    },
  },
  '/vendas/resumo': {
    get: {
      tags: ['Vendas'],
      summary: 'Totais de venda por UF no período',
      description: 'Agrega as mesmas linhas de /vendas: itens, vendedores e clientes distintos, valor (2 casas), quantidade e distribuição por canal.',
      operationId: 'getVendasResumo',
      security: seguranca,
      parameters: periodo,
      responses: { 200: ok('VendasResumo', 'Resumo do período.'), 400: { $ref: '#/components/responses/PeriodoInvalido' }, ...errosComuns },
    },
  },
  '/vendas/por-uf/{uf}': {
    get: {
      tags: ['Vendas'],
      summary: 'Vendas faturadas de uma UF no período',
      description: 'Consulta apenas a base da UF informada (não filtra em memória). Preferir esta rota quando só uma UF interessa.',
      operationId: 'getVendasPorUf',
      security: seguranca,
      parameters: [...periodo, { $ref: '#/components/parameters/uf' }],
      responses: { 200: ok('VendasUfResposta', 'Linhas da UF no período.'), 400: { $ref: '#/components/responses/UfOuPeriodoInvalido' }, ...errosComuns },
    },
  },
};
