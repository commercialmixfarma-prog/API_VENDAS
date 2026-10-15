const { getPool, sql } = require('../config/sqlServer');
const logger = require('../config/logger');
const { databaseName, getDatabasesPorUf } = require('../config/settings');

/**
 * Ocorrências de VAN (MIX-AL): FuncOcorrenciasVan para as empresas 1 e 2,
 * clientes do convênio 10, sem produto zerado. Consulta recebida verbatim,
 * exceto pelas datas, que viram parâmetros @dataDe / @dataAte.
 */
function buildOcorrenciasQuery(dbAl) {
  databaseName(dbAl);
  const al = `[${dbAl}].dbo`;
  const bloco = (empresa) => `
SELECT
    p.CodPro AS [COD. PROD],
    P.Descricao AS DESCRICAO,
    P.Fornec AS FORNECEDOR,
    p.EAN,
    p.QtdPed AS [QTD. PED],
    p.QtdAtd AS [QTD. ATD],
    p.QtdNAted AS [QTD. N ATD],
    p.Preco AS [PRECO],
    UPPER(p.Motivo) AS [MOTIVO],
    p.Pedido AS [PEDIDO],
    p.CodCli AS [COD. CLIENTE],
    p.NomeCli AS [RAZÃO SOCIAL],
    p.Data AS [DATA],
    p.VAN,
    C.Convenio_Cli AS [CONVENIO],
    'AL' AS UF
FROM ${al}.FuncOcorrenciasVan(${empresa}, @dataDe, @dataAte, '') AS p
INNER JOIN ${al}.Clientes AS C
    ON p.CodCli = C.id_cli
WHERE C.Convenio_Cli = 10
    AND p.CodPro <> 0`;
  return `${bloco(1)}\n\nUNION ALL\n${bloco(2)};`;
}

let sqlCache = null;
function cachedQuery() {
  const AL = getDatabasesPorUf().AL;
  if (!AL) throw new Error('Banco da UF AL não configurado.');
  if (!sqlCache || sqlCache.key !== AL) sqlCache = { key: AL, sql: buildOcorrenciasQuery(AL) };
  return sqlCache.sql;
}

/** periodo: { dataInicio, dataFim } já validados por readLimits.validatePeriod. */
async function buscarOcorrencias(periodo) {
  const pool = await getPool();
  const request = pool.request();
  request.input('dataDe', sql.Date, periodo.dataInicio);
  request.input('dataAte', sql.Date, periodo.dataFim);
  const start = Date.now();
  const result = await request.query(cachedQuery());
  logger.debug('Consulta ocorrências', { ...periodo, linhas: result.recordset.length, durationMs: Date.now() - start });
  return result.recordset;
}

module.exports = { buildOcorrenciasQuery, buscarOcorrencias };