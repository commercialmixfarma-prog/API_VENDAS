/**
 * Linha de venda: as 52 colunas devolvidas pela consulta de /vendas, na mesma ordem.
 * O teste tests/docs.test.js confere este objeto contra o SELECT real; ao alterar a
 * consulta, atualize aqui.
 *
 * Tipos: valores monetários/quantidades são number; identificadores do ERP são integer;
 * textos são string. Campos que podem vir vazios (junções opcionais ou devoluções) estão
 * marcados como nullable. Nenhum exemplo abaixo corresponde a cliente ou pedido real.
 */
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const nul = (schema) => ({ ...schema, nullable: true });

const VendaLinha = {
  type: 'object',
  description: 'Um item de pedido faturado. `id_linha` é a chave única da linha (UF|empresa|pedido|sequência).',
  properties: {
    id_linha: str('Chave única da linha: UF|empresa|pedido|sequência do item. Quando a sequência não é localizada, o sufixo passa a ser `P<produto>N<n>` (ver chave_tipo).', { example: 'AL|1|1234567|3' }),
    chave_tipo: str('SEQ quando a sequência do item foi localizada; FALLBACK quando a chave usa produto + ordem.', { enum: ['SEQ', 'FALLBACK'], example: 'SEQ' }),
    sequencia_iped: nul(int('Sequência do item dentro do pedido. Nulo em FALLBACK.', { example: 3 })),
    supervisor_eqp: nul(int('Código do supervisor da equipe de vendas.', { example: 12 })),
    abrev_for: nul(str('Abreviação do fornecedor/laboratório do produto.', { example: 'LAB EXEMPLO' })),
    id_cabped: int('Número do pedido.', { example: 1234567 }),
    descricao_pro: nul(str('Descrição do produto.', { example: 'PRODUTO EXEMPLO 500MG 30CPR' })),
    data: str('Data da venda (data/hora em ISO 8601).', { format: 'date-time', example: '2026-09-04T00:00:00.000Z' }),
    preco_iped: num('Preço unitário líquido praticado na linha. Em devolução (operacao 8) vem 0; use total_venda.', { example: 12.5 }),
    quantidade_Iped: num('Quantidade vendida na unidade final. Negativa em devolução.', { example: 10 }),
    promocao_iped: nul(int('Código da promoção aplicada (0 ou nulo quando não há).', { example: 0 })),
    operador: nul(str('Operador/sistema que registrou o pedido.', { example: 'EXEMPLO' })),
    vendedor: nul(int('Código do vendedor.', { example: 45 })),
    empresa_eqp: nul(int('Empresa da equipe de vendas.', { example: 1 })),
    abrev_par: nul(str('Abreviação da empresa (filial) emitente.', { example: 'FILIAL EXEMPLO' })),
    nome_cli: nul(str('Razão social do cliente.', { example: 'FARMACIA EXEMPLO LTDA' })),
    cnpj_cli: nul(str('CNPJ do cliente, conforme armazenado no ERP.')),
    grupo_cli: nul(int('Código do grupo comercial do cliente.', { example: 7 })),
    nome_grupcom: nul(str('Nome do grupo comercial.', { example: 'GRUPO EXEMPLO' })),
    id_conv: nul(int('Código do convênio do cliente.', { example: 3 })),
    nome_conv: nul(str('Nome do convênio.', { example: 'CONVENIO EXEMPLO' })),
    cod_barra_pro: nul(str('Código de barras (EAN) do produto.', { example: '7890000000000' })),
    descricao_cprom: nul(str('Descrição da promoção aplicada.', { example: 'CAMPANHA EXEMPLO' })),
    canal: nul(str('Canal de venda derivado da forma de captação do pedido (ex.: EDI-VAN, CALL CENTER, POR VENDEDOR, E-COMMERCE).', { example: 'CALL CENTER' })),
    nome_vendedor: nul(str('Nome do vendedor.', { example: 'VENDEDOR EXEMPLO' })),
    nome_televenda: nul(str('Nome do operador de televendas.', { example: 'TELEVENDAS EXEMPLO' })),
    UF: str('UF da base consultada.', { example: 'AL' }),
    total_venda: nul(num('Valor líquido total da linha. Negativo em devolução. Nulo nas linhas CABPED de /pedidos.', { example: 125 })),
    tot_desco: nul(num('Total de desconto informado pelo ERP (não é desconto de linha; uso informativo).', { example: 0 })),
    desco_iped: nul(num('Desconto do item informado pelo ERP (uso informativo).', { example: 0 })),
    imposto_iped: nul(num('Impostos da linha.', { example: 2.1 })),
    outros_iped: nul(num('Outros valores da linha.', { example: 0 })),
    total_cmv: nul(num('Custo da mercadoria vendida na linha.', { example: 98.3 })),
    spread: nul(num('Margem (spread) da linha.', { example: 26.7 })),
    unidade_iped: nul(num('Unidade do item conforme ERP (0 quando não aplicável).', { example: 0 })),
    conversao_iped: nul(num('Fator de conversão de unidade conforme ERP (0 quando não aplicável).', { example: 0 })),
    desconto_item: nul(num('Percentual de desconto do item (ex.: 10 = 10%).', { example: 10 })),
    oferta_iped: nul(num('Indicador/valor de oferta do item conforme ERP.', { example: 0 })),
    empresa_par: int('Código da empresa (filial).', { example: 1 }),
    produto_iped: nul(int('Código interno do produto.', { example: 55021 })),
    id_for: nul(int('Código do fornecedor/laboratório.', { example: 310 })),
    id_cliente: nul(int('Código do cliente.', { example: 8801 })),
    operacao: nul(int('Operação do item: 8 = devolução; demais códigos são vendas.', { example: 1 })),
    tipo_pro: nul(str('Tipo do produto conforme cadastro.', { example: 'M' })),
    hora: nul(str('Hora do pedido. Formato conforme o ERP (hh:mm:ss ou data/hora ISO).', { example: '08:15:30' })),
    pedido_por: nul(int('Forma de captação do pedido (ex.: 9 = integração/EDI, 1 = call center, 0 = vendedor).', { example: 9 })),
    equipe: nul(int('Código da equipe de vendas.', { example: 4 })),
    condicao_cabped: nul(int('Condição de pagamento do pedido.', { example: 30 })),
    status_cabped: nul(str('Código de status do pedido, sempre texto (ex.: `5`, `R`, `A`). Dicionário em GET /pedidos/status.', { example: '5' })),
    operacao_cabped: nul(int('Operação do cabeçalho do pedido.', { example: 1 })),
    nota_cabped: nul(int('Número da nota fiscal emitida (nulo sem nota).', { example: 987654 })),
    data_dia: str('Data da venda no formato YYYY-MM-DD.', { format: 'date', example: '2026-09-04' }),
  },
};

const PorUfVendas = {
  type: 'object',
  properties: {
    empresa: str('UF do agrupamento.', { example: 'AL' }),
    totalItens: int('Quantidade de linhas (itens).', { example: 9205 }),
    totalVendedores: int('Vendedores distintos.', { example: 41 }),
    totalClientes: int('Clientes distintos.', { example: 612 }),
    totalVendaValor: num('Valor de venda (preço × quantidade; devoluções abatem pelo total_venda), 2 casas.', { example: 184230.57 }),
    totalQuantidade: num('Soma das quantidades (devoluções negativas).', { example: 30210 }),
    canalDistribuicao: {
      type: 'array',
      items: { type: 'object', properties: { canal: str('Canal de venda.', { example: 'EDI-VAN' }), count: int('Linhas no canal.', { example: 7102 }) } },
    },
  },
};

module.exports = {
  schemas: {
    VendaLinha,
    VendasResposta: {
      type: 'object',
      required: ['success', 'total', 'data', 'periodo'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        total: int('Quantidade de linhas em data.', { example: 12509 }),
        data: { type: 'array', items: { $ref: '#/components/schemas/VendaLinha' } },
        periodo: { $ref: '#/components/schemas/Periodo' },
      },
    },
    VendasUfResposta: {
      type: 'object',
      required: ['success', 'total', 'uf', 'data', 'periodo'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        total: int('Quantidade de linhas em data.', { example: 9205 }),
        uf: str('UF consultada (normalizada em maiúsculas).', { example: 'AL' }),
        data: { type: 'array', items: { $ref: '#/components/schemas/VendaLinha' } },
        periodo: { $ref: '#/components/schemas/Periodo' },
      },
    },
    VendasResumo: {
      type: 'object',
      required: ['success', 'periodo', 'totalItensGeral', 'totalVendedoresGeral', 'totalClientesGeral', 'totalVendaValorGeral', 'totalQuantidadeGeral', 'porUf'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        periodo: { $ref: '#/components/schemas/Periodo' },
        totalItensGeral: int('Linhas em todas as UFs.', { example: 12509 }),
        totalVendedoresGeral: int('Vendedores distintos (UF|código).', { example: 63 }),
        totalClientesGeral: int('Clientes distintos (UF|código).', { example: 840 }),
        totalVendaValorGeral: num('Valor de venda total, 2 casas.', { example: 251877.9 }),
        totalQuantidadeGeral: num('Quantidade total (devoluções abatem).', { example: 41002 }),
        porUf: { type: 'array', items: PorUfVendas },
      },
    },
  },
};
