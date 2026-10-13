/**
 * Linha de pedido: as 52 colunas de VendaLinha mais as 6 colunas acrescentadas pela
 * rota /pedidos (duas lidas do cabeçalho do pedido e quatro derivadas em memória).
 */
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const nul = (schema) => ({ ...schema, nullable: true });

const SITUACOES = ['FATURADO', 'EM_ANDAMENTO', 'PERDIDO', 'OUTRO'];

const PedidoLinhaExtras = {
  type: 'object',
  properties: {
    rejeitado_motivo: nul(str('Motivo de rejeição registrado no pedido. Sempre nulo nas linhas PAINEL.', { example: 'LIMITE DE CREDITO' })),
    obs_cancelamento: nul(str('Observação de cancelamento registrada no pedido. Sempre nulo nas linhas PAINEL.', { example: null })),
    origem: str('PAINEL = venda faturada (idêntica a /vendas); CABPED = pedido lido do cabeçalho, em qualquer status, que a visão de vendas não devolveu.', { enum: ['PAINEL', 'CABPED'], example: 'CABPED' }),
    valor_pedido_bruto: nul(num('PAINEL: mesma regra de /vendas/resumo (venda = preço × quantidade; devolução = total_venda). CABPED: preço × quantidade × (1 − desconto_item/100), 2 casas. Em PERDIDO/EM_ANDAMENTO é valor em risco, não venda.', { example: 57.05 })),
    status_descricao: str('Texto do status (ex.: Nota emitida, Rejeitado). Código desconhecido vem como `Status X`; sem status vem `Sem status`.', { example: 'Rejeitado' }),
    situacao: str('Agrupamento do status.', { enum: SITUACOES, example: 'PERDIDO' }),
  },
};

const Contagem = {
  type: 'object',
  required: ['linhasPainel', 'linhasCabPed', 'linhasCabPedFaturadas'],
  properties: {
    linhasPainel: int('Linhas de venda faturada (origem PAINEL).', { example: 9205 }),
    linhasCabPed: int('Linhas lidas do cabeçalho (origem CABPED), qualquer status.', { example: 318 }),
    linhasCabPedFaturadas: int('Subconjunto de linhasCabPed com status faturado: pedido faturado que a visão de vendas não devolveu nesta data.', { example: 12 }),
  },
};

const PorUfPedidos = {
  type: 'object',
  properties: {
    empresa: str('UF do agrupamento.', { example: 'AL' }),
    totalLinhas: int('Linhas (itens) na UF.', { example: 9523 }),
    totalPedidos: int('Pedidos distintos na UF.', { example: 1210 }),
    valorVendaRealizada: num('Soma de valor_pedido_bruto apenas das linhas PAINEL, 2 casas.', { example: 184230.57 }),
    porSituacao: {
      type: 'array',
      description: 'Sempre as quatro situações, nesta ordem, mesmo com zero.',
      items: {
        type: 'object',
        properties: {
          situacao: str('Situação.', { enum: SITUACOES, example: 'PERDIDO' }),
          pedidos: int('Pedidos distintos.', { example: 14 }),
          linhas: int('Linhas.', { example: 96 }),
          valorBruto: num('Soma de valor_pedido_bruto, 2 casas (em PERDIDO é valor em risco).', { example: 4310.2 }),
        },
      },
    },
    porStatus: {
      type: 'array',
      description: 'Um item por código de status presente, ordenado pelo código.',
      items: {
        type: 'object',
        properties: {
          status: nul(str('Código de status (texto). Nulo quando o pedido não tem status.', { example: 'R' })),
          descricao: str('Texto do status.', { example: 'Rejeitado' }),
          situacao: str('Situação.', { enum: SITUACOES, example: 'PERDIDO' }),
          pedidos: int('Pedidos distintos.', { example: 9 }),
          linhas: int('Linhas.', { example: 61 }),
          valorBruto: num('Soma de valor_pedido_bruto, 2 casas.', { example: 2880.75 }),
        },
      },
    },
    motivosRejeicao: {
      type: 'array',
      description: 'Motivos das linhas PERDIDO, do mais frequente ao menos frequente.',
      items: {
        type: 'object',
        properties: {
          motivo: str('Motivo registrado ou `Sem motivo informado`.', { example: 'LIMITE DE CREDITO' }),
          pedidos: int('Pedidos distintos com o motivo.', { example: 5 }),
        },
      },
    },
  },
};

module.exports = {
  schemas: {
    PedidoLinha: {
      description: 'Linha de /pedidos: VendaLinha mais as colunas de origem/situação. Nas linhas CABPED, total_venda, tot_desco, desco_iped, imposto_iped, outros_iped, total_cmv e spread vêm nulos; hora vem em hh:mm:ss; pedido sem item vem com id_linha terminado em `SEMITEM`, chave_tipo FALLBACK e valores nulos.',
      allOf: [{ $ref: '#/components/schemas/VendaLinha' }, PedidoLinhaExtras],
    },
    PedidosResposta: {
      type: 'object',
      required: ['success', 'total', 'contagem', 'data', 'periodo'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        total: int('Linhas em data (após filtros).', { example: 12827 }),
        contagem: Contagem,
        data: { type: 'array', items: { $ref: '#/components/schemas/PedidoLinha' } },
        periodo: { $ref: '#/components/schemas/Periodo' },
      },
    },
    PedidosUfResposta: {
      type: 'object',
      required: ['success', 'total', 'uf', 'contagem', 'data', 'periodo'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        total: int('Linhas em data (após filtros).', { example: 9523 }),
        uf: str('UF consultada (normalizada em maiúsculas).', { example: 'AL' }),
        contagem: Contagem,
        data: { type: 'array', items: { $ref: '#/components/schemas/PedidoLinha' } },
        periodo: { $ref: '#/components/schemas/Periodo' },
      },
    },
    PedidosResumo: {
      type: 'object',
      required: ['success', 'periodo', 'totalLinhasGeral', 'totalPedidosGeral', 'valorVendaRealizadaGeral', 'porUf'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        periodo: { $ref: '#/components/schemas/Periodo' },
        totalLinhasGeral: int('Linhas em todas as UFs (após filtros).', { example: 12827 }),
        totalPedidosGeral: int('Pedidos distintos em todas as UFs.', { example: 1655 }),
        valorVendaRealizadaGeral: num('Venda realizada (somente linhas PAINEL), 2 casas.', { example: 251877.9 }),
        porUf: { type: 'array', items: PorUfPedidos },
      },
    },
    PedidosStatusResposta: {
      type: 'object',
      required: ['success', 'situacoes', 'status'],
      properties: {
        success: { type: 'boolean', enum: [true] },
        situacoes: { type: 'array', items: { type: 'string', enum: SITUACOES }, example: SITUACOES },
        status: {
          type: 'array',
          description: 'Dicionário dos códigos conhecidos. Qualquer outro código aparece nas respostas como `Status X` / OUTRO.',
          items: {
            type: 'object',
            required: ['status', 'descricao', 'situacao'],
            properties: {
              status: str('Código (texto).', { example: 'R' }),
              descricao: str('Texto do status.', { example: 'Rejeitado' }),
              situacao: str('Situação.', { enum: SITUACOES, example: 'PERDIDO' }),
            },
          },
        },
      },
    },
  },
};
