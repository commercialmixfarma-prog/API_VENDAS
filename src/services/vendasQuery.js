const { getPool, sql } = require('../config/sqlServer');
const logger = require('../config/logger');
const { databaseName, getDatabasesPorUf } = require('../config/settings');

/**
 * Query de vendas v2 — UMA UF por execução.
 *
 * Por que não UNION ALL como antes: a v2 usa CTEs com ROW_NUMBER() e JOIN em
 * ItensPedido para obter a Sequencia_IPed (chave única da linha). Rodar uma UF
 * por vez mantém a query legível, permite log/erro por UF e reduz o pico de
 * memória no Node (metade das linhas por resultset).
 *
 * dbName e uf vêm de configuração administrativa validada por allowlist.
 * Datas sempre são parâmetros, nunca SQL fornecido por requisição HTTP.
 *
 * Saída: 54 colunas, mesmos nomes da API MIX Vendas v2 já validada
 * (id_linha, chave_tipo, sequencia_iped, ...24 colunas originais..., total_venda,
 * ..., operacao, ..., data_dia). Contrato preservado da consulta recebida.
 */
function buildVendasQuery(dbName, uf) {
  databaseName(dbName);
  if (!/^[A-Z]{2}$/.test(uf)) throw new Error('UF inválida.');
  const db = `[${dbName}].dbo`;
  return `
WITH p AS (
    SELECT
        pv.*,
        ROW_NUMBER() OVER (
            PARTITION BY pv.Empresa_Par, pv.id_cabped, pv.produto_iped
            ORDER BY pv.promocao_iped, pv.preco_iped
        ) AS rn
    FROM ${db}.painelvendas(@dataInicio, @dataFim) AS pv
),
i AS (
    SELECT
        it.Empresa_Iped, it.Numero_IPed, it.Produto_IPed, it.Sequencia_IPed,
        it.Desconto_IPed, it.Comissao_IPed, it.Oferta_IPed, it.Unidade_IPed, it.Conversao_IPed,
        ROW_NUMBER() OVER (
            PARTITION BY it.Empresa_Iped, it.Numero_IPed, it.Produto_IPed
            ORDER BY it.Promocao_IPed, it.Preco_IPed, it.Sequencia_IPed
        ) AS rn
    FROM ${db}.ItensPedido it
    WHERE EXISTS (
        SELECT 1 FROM p
        WHERE p.Empresa_Par = it.Empresa_Iped AND p.id_cabped = it.Numero_IPed
    )
)
SELECT
    CONCAT('${uf}', '|', p.Empresa_Par, '|', p.id_cabped, '|',
           COALESCE(CAST(i.Sequencia_IPed AS varchar(20)),
                    CONCAT('P', p.produto_iped, 'N', p.rn))) AS id_linha,
    CASE WHEN i.Sequencia_IPed IS NULL THEN 'FALLBACK' ELSE 'SEQ' END AS chave_tipo,
    i.Sequencia_IPed   AS sequencia_iped,

    ev.[supervisor_eqp],
    p.[Abrev_for]      AS abrev_for,
    p.[id_cabped],
    p.[Descricao_pro]  AS descricao_pro,
    p.[data],
    p.[preco_Iped]     AS preco_iped,
    p.[quantidade_Iped],
    p.[promocao_iped],
    p.[Operador]       AS operador,
    p.[Vendedor]       AS vendedor,
    ev.[Empresa_Eqp]   AS empresa_eqp,
    p.[Abrev_par]      AS abrev_par,
    c.[Nome_cli]       AS nome_cli,
    c.[CNPJ_cli]       AS cnpj_cli,
    c.[Grupo_Cli]      AS grupo_cli,
    gc.[Nome_GrupCom]  AS nome_grupcom,
    cv.[Id_Conv]       AS id_conv,
    cv.[Nome_Conv]     AS nome_conv,
    pr.[codBarra_pro]  AS cod_barra_pro,
    d.[Descricao_CProm] AS descricao_cprom,
    cp.[Canal]         AS canal,
    v.nome_Vnd         AS nome_vendedor,
    vt.nome_Vnd        AS nome_televenda,
    '${uf}'            AS UF,

    p.[TotalVenda]     AS total_venda,
    p.[TotDesco]       AS tot_desco,
    p.[Desco_IPed]     AS desco_iped,
    p.[Imposto_iped]   AS imposto_iped,
    p.[Outros_iped]    AS outros_iped,
    p.[TotalCMV]       AS total_cmv,
    p.[Spread]         AS spread,
    p.[OUTROSCUSTO]    AS TOTAL_ICMS,
    p.[CustoMedio_infpro]  AS CUSTO_MEDIO,

    i.Unidade_IPed     AS unidade_iped,
    i.Conversao_IPed   AS conversao_iped,
    i.Desconto_IPed    AS desconto_item,
    i.Oferta_IPed      AS oferta_iped,

    p.[Empresa_Par]    AS empresa_par,
    p.[produto_iped],
    p.[id_for],
    p.[cliente]        AS id_cliente,
    p.[Operacao]       AS operacao,
    p.[Tipo_Pro]       AS tipo_pro,
    p.[Hora]           AS hora,
    p.[PedidoPor]      AS pedido_por,
    p.[Equipe]         AS equipe,
    p.[condicao_cabped],
    cp.[Status_CabPed]   AS status_cabped,
    cp.[Operacao_CabPed] AS operacao_cabped,
    cp.[Nota_CabPed]     AS nota_cabped,
    CONVERT(varchar(10), p.[data], 23) AS data_dia
FROM p
LEFT JOIN i
    ON i.Empresa_Iped = p.Empresa_Par AND i.Numero_IPed = p.id_cabped
   AND i.Produto_IPed = p.produto_iped AND i.rn = p.rn
INNER JOIN ${db}.EquipeVenda ev
    ON ev.Empresa_Eqp = p.empresa_par AND ev.Id_Eqp = p.equipe
INNER JOIN ${db}.Produtos pr
    ON pr.Id_Pro = p.produto_iped
OUTER APPLY (
    SELECT TOP 1 nome_Vnd FROM ${db}.Vendedores
    WHERE Id_Vnd = p.Vendedor AND Empresa_Vnd = p.Empresa_Par
) v
OUTER APPLY (
    SELECT TOP 1 Nome_cli, CNPJ_cli, Convenio_cli, Grupo_Cli FROM ${db}.Clientes
    WHERE Id_Cli = p.cliente
) c
OUTER APPLY (
    SELECT TOP 1 Id_Conv, Nome_Conv FROM ${db}.Convenio
    WHERE Id_Conv = c.Convenio_cli
) cv
OUTER APPLY (
    SELECT TOP 1 Nome_GrupCom FROM ${db}.GrupoComercial
    WHERE Id_GrupCom = c.Grupo_Cli
) gc
OUTER APPLY (
    SELECT TOP 1 Descricao_CProm FROM ${db}.CabPromocao
    WHERE ID_CProm = p.promocao_iped
) d
OUTER APPLY (
    SELECT TOP 1
        Televenda_CabPed, Status_CabPed, Operacao_CabPed, Nota_CabPed,
        CASE PedidoPor_CabPed
            WHEN 9 THEN
                CASE Operador_CabPed
                    WHEN 'SERVCON' THEN Operador_CabPed
                    WHEN 'NEXFAR' THEN Operador_CabPed
                    WHEN 'RESULT MOBILE' THEN Operador_CabPed
                    WHEN 'RESULT WEBVENDAS' THEN Operador_CabPed
                    WHEN 'E-commerce' THEN 'E-COMMERCE'
                    ELSE 'EDI-VAN'
                END
            WHEN 0 THEN 'POR VENDEDOR'
            WHEN 1 THEN
                CASE Operador_CabPed
                    WHEN 'NEXFAR' THEN 'NEXFAR CALL CENTER'
                    ELSE 'CALL CENTER'
                END
            WHEN 2 THEN 'POR CLIENTE'
            WHEN 3 THEN 'POR PROMOTOR'
            ELSE 'CALL-CENTER'
        END AS Canal
    FROM ${db}.CabPedidos
    WHERE ID_CabPed = p.id_cabped AND Empresa_CabPed = p.Empresa_Par
) cp
OUTER APPLY (
    SELECT TOP 1 nome_Vnd FROM ${db}.Vendedores
    WHERE Id_Vnd = cp.Televenda_CabPed AND Empresa_Vnd = p.Empresa_Par
) vt
`;
}

const sqlCache = new Map();
function getSqlPorUf(uf, database) {
  const key = `${uf}:${database}`;
  if (!sqlCache.has(key)) sqlCache.set(key, buildVendasQuery(database, uf));
  return sqlCache.get(key);
}

/**
 * Busca as vendas de UMA UF no período. Retorna as linhas cruas do SQL Server.
 */
async function buscarVendasUf(uf, dataInicio, dataFim) {
  const database = getDatabasesPorUf()[uf];
  if (!database) throw new Error(`UF "${uf}" não configurada em ETL_UFS`);

  const pool = await getPool();
  const request = pool.request();
  request.input('dataInicio', sql.Date, dataInicio);
  request.input('dataFim', sql.Date, dataFim);

  const start = Date.now();
  const result = await request.query(getSqlPorUf(uf, database));
  logger.debug(`Consulta de vendas ${uf} ${dataInicio} -> ${dataFim}`, {
    linhas: result.recordset.length,
    durationMs: Date.now() - start,
  });
  return result.recordset;
}

/**
 * Busca as vendas de TODAS as UFs configuradas (sequencial, uma UF por vez).
 * Mantido para compatibilidade com quem chamava buscarVendas(dataInicio, dataFim).
 */
async function buscarVendas(dataInicio, dataFim) {
  const ufs = Object.keys(getDatabasesPorUf());
  const tudo = [];
  for (const uf of ufs) {
    const linhas = await buscarVendasUf(uf, dataInicio, dataFim);
    for (const linha of linhas) tudo.push(linha);
  }
  return tudo;
}

module.exports = { buildVendasQuery, buscarVendas, buscarVendasUf, getDatabasesPorUf };
