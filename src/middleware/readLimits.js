const { intEnv, getDatabasesPorUf } = require('../config/settings');

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) return null;
  if (Number(value.slice(0,4)) < 1) return null;
  return parsed;
}
function validatePeriod(req,res,next) {
  const {dataInicio,dataFim} = req.query;
  const start = parseDate(dataInicio), end = parseDate(dataFim);
  if (!start || !end || end < start) return res.status(400).json({success:false,error:'Informe datas reais no formato YYYY-MM-DD e dataFim igual ou posterior a dataInicio.'});
  const maxDays = intEnv('API_MAX_RANGE_DAYS',7,1,366);
  const days = Math.round((end-start)/86400000)+1;
  if (days > maxDays) return res.status(400).json({success:false,error:`Período máximo de ${maxDays} dias por consulta (inclusive). Divida a consulta em janelas menores.`});
  next();
}
function validateUf(req,res,next) {
  if (!req.params.uf) return next();
  const uf = req.params.uf.toUpperCase();
  if (!Object.hasOwn(getDatabasesPorUf(),uf)) return res.status(400).json({success:false,error:'UF não configurada.'});
  req.params.uf = uf;
  next();
}
// Limite por processo e somente sobre consultas HTTP de vendas. Não é lock distribuído.
let active = 0;
function limitReads(req,res,next) {
  const max = intEnv('API_MAX_CONCURRENT_READS',2,1,20);
  if (active >= max) {
    res.set('Retry-After','5');
    return res.status(503).json({success:false,error:'Consultas simultâneas no limite. Tente novamente após alguns segundos.'});
  }
  active++;
  // Soltar no fim do handler, não no close do cliente: o SQL pode continuar rodando.
  let released = false;
  req.releaseReadSlot = () => { if (!released) { released = true; active--; } };
  next();
}
module.exports = {validatePeriod,validateUf,limitReads,parseDate};
