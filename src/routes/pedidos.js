const express = require('express');
const { buscarPedidos, buscarPedidosUf } = require('../services/pedidosQuery');
const { summarizePedidos } = require('../services/resumoPedidos');
const { STATUS_PEDIDO, SITUACOES, normalizarStatus } = require('../services/pedidosStatus');
const { requireAuth } = require('../middleware/auth');
const { validatePeriod, validateUf, limitReads } = require('../middleware/readLimits');

/**
 * /pedidos — vendas faturadas (mesmas linhas de /vendas) + pedidos em qualquer
 * outro status (em andamento, rejeitado, abandonado), com status em tempo real.
 *
 * /vendas permanece intocada: é a fonte do site de campanhas.
 *
 * Filtros opcionais (aplicados em memória após a consulta, allowlist):
 *   ?status=R,A              códigos de Status_CabPed
 *   ?situacao=PERDIDO        FATURADO | EM_ANDAMENTO | PERDIDO | OUTRO
 *   ?origem=CABPED           PAINEL | CABPED
 */
const router = express.Router();
router.use(requireAuth);

function parseLista(value, validar, nome) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string') throw erro400(`Parâmetro ${nome} inválido.`);
  const itens = value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!itens.length || itens.some(v => !validar(v))) throw erro400(`Parâmetro ${nome} inválido.`);
  return new Set(itens);
}
function erro400(msg) { const e = new Error(msg); e.status = 400; return e; }

function validateFiltros(req, res, next) {
  try {
    const status = parseLista(req.query.status, v => /^[0-9A-Z]{1,2}$/.test(v), 'status');
    const situacao = parseLista(req.query.situacao, v => SITUACOES.includes(v), 'situacao');
    const origem = parseLista(req.query.origem, v => v === 'PAINEL' || v === 'CABPED', 'origem');
    req.filtros = { status, situacao, origem };
    next();
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
}

function aplicarFiltros(linhas, { status, situacao, origem }) {
  if (!status && !situacao && !origem) return linhas;
  return linhas.filter(r =>
    (!status || status.has(normalizarStatus(r.status_cabped) ?? '')) &&
    (!situacao || situacao.has(r.situacao)) &&
    (!origem || origem.has(r.origem)));
}

function contagem(linhas) {
  const c = { linhasPainel: 0, linhasCabPed: 0, linhasCabPedFaturadas: 0 };
  for (const r of linhas) {
    if (r.origem === 'PAINEL') c.linhasPainel++;
    else { c.linhasCabPed++; if (r.situacao === 'FATURADO') c.linhasCabPedFaturadas++; }
  }
  return c;
}

router.get('/status', (req, res) => {
  res.json({ success: true, situacoes: SITUACOES, status: Object.entries(STATUS_PEDIDO).map(([codigo, v]) => ({ status: codigo, ...v })) });
});

router.get('/', validatePeriod, validateFiltros, limitReads, async (req, res, next) => {
  try {
    const { dataInicio, dataFim } = req.query;
    const data = aplicarFiltros(await buscarPedidos(dataInicio, dataFim), req.filtros);
    res.json({ success: true, total: data.length, contagem: contagem(data), data, periodo: { dataInicio, dataFim } });
  } catch (err) { next(err); } finally { req.releaseReadSlot(); }
});

router.get('/resumo', validatePeriod, validateFiltros, limitReads, async (req, res, next) => {
  try {
    const { dataInicio, dataFim } = req.query;
    const data = aplicarFiltros(await buscarPedidos(dataInicio, dataFim), req.filtros);
    res.json(summarizePedidos(data, { dataInicio, dataFim }));
  } catch (err) { next(err); } finally { req.releaseReadSlot(); }
});

router.get('/por-uf/:uf', validatePeriod, validateUf, validateFiltros, limitReads, async (req, res, next) => {
  try {
    const { dataInicio, dataFim } = req.query, uf = req.params.uf;
    const data = aplicarFiltros(await buscarPedidosUf(uf, dataInicio, dataFim), req.filtros);
    res.json({ success: true, total: data.length, uf, contagem: contagem(data), data, periodo: { dataInicio, dataFim } });
  } catch (err) { next(err); } finally { req.releaseReadSlot(); }
});

module.exports = router;
