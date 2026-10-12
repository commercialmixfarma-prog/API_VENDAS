const Decimal = require('decimal.js');
const { getPool, sql } = require('../config/sqlServer');
const logger = require('../config/logger');
const { databaseName, getDatabasesPorUf } = require('../config/settings');
const { buscarVendasUf } = require('./vendasQuery');
const { valorLinha } = require('./resumoVendas');
const { descreverStatus } = require('./pedidosStatus');

/**
 * Rota /pedidos — vendas + pedidos em qualquer status, UMA UF por execução.
 *
 * Por que duas consultas e não um UNION ALL:
 *  - painelvendas é criptografada e descarta pedidos rejeitados/abandonados
 *    (e, conforme o dia, outros status). Não há como alterá-la: acesso só leitura.
 *  - Referenciar a CTE da função duas vezes (SELECT + NOT EXISTS) executa a TVF
 *    duas vezes no SQL Server. Separar em duas consultas evita o custo dobrado.
 *  - A consulta de vendas (/vendas) é reutilizada SEM alteração, então o contrato
 *    do site de campanhas não muda. As linhas "PAINEL" aqui são idênticas às de /vendas.
 *
 * A segunda consulta lê CabPedidos + ItensPedido para o período SEM filtro de
 * status: literalmente todos os pedidos do dia. A deduplicação por pedido
 * (UF|empresa|id_cabped) é feita em memória: se a função já devolveu o pedido,
 * a linha de CabPedidos é descartada e vale a versão PAINEL (com CMV, imposto
 * etc.). Pedido que a função não devolveu, em qualquer status (inclusive '5'),
 * entra como CABPED. Assim nenhum pedido fica de fora e nunca há duplicidade.
 *
 * Custo: a segunda consulta devolve também os pedidos faturados que serão
 * descartados. Medir no SQL real (validacao/pedidos-validacao.sql, item 5).
 *
 * Saída: as 52 colunas de /vendas, com os mesmos nomes, mais
 *   rejeitado_motivo, obs_cancelamento (do cabeçalho),
 *   origem ('PAINEL' | 'CABPED'), valor_pedido_bruto, status_descricao, situacao.
 *
 * Diferenças conhecidas nas linhas CABPED (documentadas, não são bug):
 *  - total_venda, tot_desco, desco_iped, imposto_iped, outros_iped, total_cmv e
 *    spread vêm NULL: não existe venda faturada, logo não há valor líquido/CMV.
 *  - operacao é o Operacao_CabPed do cabeçalho (no painel é por item).
 *  - hora é derivada de Fim/Inicio/Data_CabPed em hh:mm:ss (não há coluna Hora).
 *  - equipe/supervisor vêm do cadastro atual do vendedor (Vendedores.equipe_vnd).
 */
function buildPedidosCabPedQuery(dbName, uf) {
  databaseName(dbName);
  if (!/^[A-Z]{2}$/.test(uf)) throw new Error('UF inválida.');
  const db = `[${dbName}].dbo`;
  return `
SELECT
    CONCAT('${uf}', '|', cp.Empresa_CabPed, '|', cp.ID_CabPed, '|',
           COALESCE(CAST(it.Sequencia_IPed AS varchar(20)), 'SEMITEM')) AS id_linha,
    CASE WHEN it.Sequencia_IPed IS NULL THEN 'FALLBACK' ELSE 'SEQ' END AS chave_tipo,
    it.Sequencia_IPed       AS sequencia_iped,

    ev.supervisor_eqp,
    f.Abrev_For             AS abrev_for,
    cp.ID_CabPed            AS id_cabped,
    pr.descricao_pro        AS descricao_pro,
    cp.Data_CabPed          AS [data],
    it.Preco_IPed           AS preco_iped,
    it.Quantidade_IPed      AS quantidade_Iped,
    it.Promocao_IPed        AS promocao_iped,
    cp.Operador_CabPed      AS operador,
    cp.Vendedor_CabPed      AS vendedor,
    ev.Empresa_Eqp          AS empresa_eqp,
    par.Abrev_Par           AS abrev_par,
    c.Nome_cli              AS nome_cli,
    c.CNPJ_cli              AS cnpj_cli,
    c.Grupo_Cli             AS grupo_cli,
    gc.Nome_GrupCom         AS nome_grupcom,
    cv.Id_Conv              AS id_conv,
    cv.Nome_Conv            AS nome_conv,
    pr.codbarra_pro         AS cod_barra_pro,
    d.Descricao_CProm       AS descricao_cprom,
    CASE cp.PedidoPor_CabPed
        WHEN 9 THEN
            CASE cp.Operador_CabPed
                WHEN 'SERVCON' THEN cp.Operador_CabPed
                WHEN 'NEXFAR' THEN cp.Operador_CabPed
                WHEN 'RESULT MOBILE' THEN cp.Operador_CabPed
                WHEN 'RESULT WEBVENDAS' THEN cp.Operador_CabPed
                WHEN 'E-commerce' THEN 'E-COMMERCE'
                ELSE 'EDI-VAN'
            END
        WHEN 0 THEN 'POR VENDEDOR'
        WHEN 1 THEN
            CASE cp.Operador_CabPed
                WHEN 'NEXFAR' THEN 'NEXFAR CALL CENTER'
                ELSE 'CALL CENTER'
            END
        WHEN 2 THEN 'POR CLIENTE'
        WHEN 3 THEN 'POR PROMOTOR'
        ELSE 'CALL-CENTER'
    END                     AS canal,
    v.nome_Vnd              AS nome_vendedor,
    vt.nome_Vnd             AS nome_televenda,
    '${uf}'                 AS UF,

    CAST(NULL AS float)     AS total_venda,
    CAST(NULL AS float)     AS tot_desco,
    CAST(NULL AS float)     AS desco_iped,
    CAST(NULL AS float)     AS imposto_iped,
    CAST(NULL AS float)     AS outros_iped,
    CAST(NULL AS float)     AS total_cmv,
    CAST(NULL AS float)     AS spread,

    it.Unidade_IPed         AS unidade_iped,
    it.Conversao_IPed       AS conversao_iped,
    it.Desconto_IPed        AS desconto_item,
    it.Oferta_IPed          AS oferta_iped,

    cp.Empresa_CabPed       AS empresa_par,
    it.Produto_IPed         AS produto_iped,
    f.ID_for                AS id_for,
    cp.Cliente_CabPed       AS id_cliente,
    cp.Operacao_CabPed      AS operacao,
    pr.tipo_pro             AS tipo_pro,
    CONVERT(varchar(8), COALESCE(cp.Fim_CabPed, cp.Inicio_CabPed, cp.Data_CabPed), 108) AS hora,
    cp.PedidoPor_CabPed     AS pedido_por,
    v.equipe_vnd            AS equipe,
    cp.Condicao_CabPed      AS condicao_cabped,
    cp.Status_CabPed        AS status_cabped,
    cp.Operacao_CabPed      AS operacao_cabped,
    cp.Nota_CabPed          AS nota_cabped,
    CONVERT(varchar(10), cp.Data_CabPed, 23) AS data_dia,

    cp.RejeitadoMotivo_CabPed AS rejeitado_motivo,
    cp.obsCancelamento_cabPed AS obs_cancelamento
FROM ${db}.CabPedidos cp
LEFT JOIN ${db}.ItensPedido it
    ON it.Empresa_Iped = cp.Empresa_CabPed AND it.Numero_IPed = cp.ID_CabPed
OUTER APPLY (
    SELECT TOP 1 descricao_pro, codbarra_pro, tipo_pro, fornec_pro
    FROM ${db}.Produtos WHERE Id_Pro = it.Produto_IPed
) pr
OUTER APPLY (
    SELECT TOP 1 ID_for, Abrev_For
    FROM ${db}.Fornecedor WHERE ID_for = pr.fornec_pro
) f
OUTER APPLY (
    SELECT TOP 1 nome_Vnd, equipe_vnd FROM ${db}.Vendedores
    WHERE Id_Vnd = cp.Vendedor_CabPed AND Empresa_Vnd = cp.Empresa_CabPed
) v
OUTER APPLY (
    SELECT TOP 1 Empresa_Eqp, supervisor_eqp FROM ${db}.EquipeVenda
    WHERE Empresa_Eqp = cp.Empresa_CabPed AND Id_Eqp = v.equipe_vnd
) ev
OUTER APPLY (
    SELECT TOP 1 Abrev_Par FROM ${db}.Parametros
    WHERE Empresa_Par = cp.Empresa_CabPed
) par
OUTER APPLY (
    SELECT TOP 1 Nome_cli, CNPJ_cli, Convenio_cli, Grupo_Cli FROM ${db}.Clientes
    WHERE Id_Cli = cp.Cliente_CabPed
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
    WHERE ID_CProm = it.Promocao_IPed
) d
OUTER APPLY (
    SELECT TOP 1 nome_Vnd FROM ${db}.Vendedores
    WHERE Id_Vnd = cp.Televenda_CabPed AND Empresa_Vnd = cp.Empresa_CabPed
) vt
WHERE cp.Data_CabPed >= @dataInicio
  AND cp.Data_CabPed <  DATEADD(DAY, 1, @dataFim)
`;
}

const sqlCache = new Map();
function getSqlPorUf(uf, database) {
  const key = `${uf}:${database}`;
  if (!sqlCache.has(key)) sqlCache.set(key, buildPedidosCabPedQuery(database, uf));
  return sqlCache.get(key);
}

function chavePedido(row) {
  return `${row.UF}|${row.empresa_par}|${row.id_cabped}`;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Decimal(value);
  return d.isFinite() ? Number(d.toFixed(4)) : null;
}

/**
 * Linhas CABPED: ItensPedido.Preco_IPed é o preço BRUTO e Desconto_IPed é
 * percentual. Validado contra painelvendas em 08/10/2026 (ex.: 31,78 × 12 ×
 * (1 − 85,04/100) = 57,05 = TotalVenda do painel). Sem o desconto o valor
 * ficaria ~7× maior nesse caso.
 */
function valorBrutoCabPed(row) {
  if (row.preco_iped == null || row.quantidade_Iped == null) return null;
  const desconto = row.desconto_item == null ? new Decimal(0) : new Decimal(row.desconto_item);
  const fator = new Decimal(1).minus(desconto.div(100));
  // Arredondado a 2 casas, como o TotalVenda da função.
  return Number(new Decimal(row.preco_iped).times(new Decimal(row.quantidade_Iped)).times(fator).toFixed(2));
}

/**
 * Acrescenta as colunas derivadas sem alterar as originais.
 * Linhas PAINEL usam a mesma regra de valor da /vendas/resumo (valorLinha):
 * devolução (operacao 8) usa total_venda; venda usa preco × quantidade.
 */
function enriquecer(row, origem) {
  const st = descreverStatus(row.status_cabped);
  const valor = origem === 'PAINEL' ? toNumber(valorLinha(row)) : valorBrutoCabPed(row);
  return {
    ...row,
    rejeitado_motivo: origem === 'PAINEL' ? null : (row.rejeitado_motivo ?? null),
    obs_cancelamento: origem === 'PAINEL' ? null : (row.obs_cancelamento ?? null),
    origem,
    valor_pedido_bruto: valor,
    status_descricao: st.status_descricao,
    situacao: st.situacao,
  };
}

async function buscarPedidosCabPedUf(uf, dataInicio, dataFim) {
  const database = getDatabasesPorUf()[uf];
  if (!database) throw new Error(`UF "${uf}" não configurada em VENDAS_UFS`);
  const pool = await getPool();
  const request = pool.request();
  request.input('dataInicio', sql.Date, dataInicio);
  request.input('dataFim', sql.Date, dataFim);
  const start = Date.now();
  const result = await request.query(getSqlPorUf(uf, database));
  logger.debug(`Consulta de pedidos (CabPedidos) ${uf} ${dataInicio} -> ${dataFim}`, {
    linhas: result.recordset.length,
    durationMs: Date.now() - start,
  });
  return result.recordset;
}

/**
 * Vendas (painel) + pedidos em outros status, de UMA UF, já deduplicados por pedido.
 */
async function buscarPedidosUf(uf, dataInicio, dataFim) {
  const vendas = await buscarVendasUf(uf, dataInicio, dataFim);
  const cabped = await buscarPedidosCabPedUf(uf, dataInicio, dataFim);

  const pedidosNoPainel = new Set();
  const saida = [];
  for (const row of vendas) {
    pedidosNoPainel.add(chavePedido(row));
    saida.push(enriquecer(row, 'PAINEL'));
  }
  let descartadas = 0;
  for (const row of cabped) {
    if (pedidosNoPainel.has(chavePedido(row))) { descartadas++; continue; }
    saida.push(enriquecer(row, 'CABPED'));
  }
  if (descartadas) {
    logger.debug(`Pedidos ${uf}: ${descartadas} linha(s) de CabPedidos descartada(s) por já constarem no painel.`);
  }
  return saida;
}

async function buscarPedidos(dataInicio, dataFim) {
  const tudo = [];
  for (const uf of Object.keys(getDatabasesPorUf())) {
    const linhas = await buscarPedidosUf(uf, dataInicio, dataFim);
    for (const linha of linhas) tudo.push(linha);
  }
  return tudo;
}

module.exports = { buildPedidosCabPedQuery, buscarPedidos, buscarPedidosUf, buscarPedidosCabPedUf, enriquecer, chavePedido };
