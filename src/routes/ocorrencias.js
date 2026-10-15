const express = require('express');
const { buscarOcorrencias } = require('../services/ocorrencias');
const { requireAuth } = require('../middleware/auth');
const { validatePeriod, limitReads } = require('../middleware/readLimits');
const router = express.Router();
router.use(requireAuth);

/**
 * GET /ocorrencias?dataInicio=YYYY-MM-DD&dataFim=YYYY-MM-DD (obrigatórios, até API_MAX_RANGE_DAYS)
 * Empresas 1 e 2 de MIX-AL, convênio 10, sem produto zerado.
 */
router.get('/', validatePeriod, limitReads, async (req, res, next) => {
  try {
    const periodo = { dataInicio: req.query.dataInicio, dataFim: req.query.dataFim };
    const data = await buscarOcorrencias(periodo);
    res.json({ success: true, total: data.length, periodo, data });
  } catch (err) { next(err); } finally { req.releaseReadSlot(); }
});

module.exports = router;