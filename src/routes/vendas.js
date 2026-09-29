const express = require('express');
const {buscarVendas,buscarVendasUf} = require('../services/vendasQuery');
const {summarize} = require('../services/resumoVendas');
const {requireAuth} = require('../middleware/auth');
const {validatePeriod,validateUf,limitReads} = require('../middleware/readLimits');
const router=express.Router();
router.use(requireAuth);
router.get('/',validatePeriod,limitReads,async(req,res,next)=>{
  try {
    const {dataInicio,dataFim}=req.query;
    const data=await buscarVendas(dataInicio,dataFim);
    res.json({success:true,total:data.length,data,periodo:{dataInicio,dataFim}});
  } catch(err) {next(err);} finally {req.releaseReadSlot();}
});
router.get('/resumo',validatePeriod,limitReads,async(req,res,next)=>{
  try {
    const {dataInicio,dataFim}=req.query;
    const data=await buscarVendas(dataInicio,dataFim);
    res.json(summarize(data,{dataInicio,dataFim}));
  } catch(err) {next(err);} finally {req.releaseReadSlot();}
});
router.get('/por-uf/:uf',validatePeriod,validateUf,limitReads,async(req,res,next)=>{
  try {
    const {dataInicio,dataFim}=req.query, uf=req.params.uf;
    // Consulta somente a UF autorizada, em vez de carregar todas e filtrar em memória.
    const data=await buscarVendasUf(uf,dataInicio,dataFim);
    res.json({success:true,total:data.length,uf,data,periodo:{dataInicio,dataFim}});
  } catch(err) {next(err);} finally {req.releaseReadSlot();}
});
module.exports=router;
