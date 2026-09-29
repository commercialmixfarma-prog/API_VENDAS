const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const bcrypt=require('bcryptjs');
Object.assign(process.env,{
  NODE_ENV:'test',LOG_LEVEL:'error',SQLSERVER_HOST:'127.0.0.1',SQLSERVER_USER:'teste_simulado',SQLSERVER_PASSWORD:'sem_banco_real',
  SQLSERVER_AL_DATABASE:'MIX-AL',SQLSERVER_SE_DATABASE:'MIX-SE',VENDAS_UFS:'AL,SE',
  SERVICE_CLIENT_ID:'cliente-teste',SERVICE_CLIENT_SECRET:bcrypt.hashSync('senha-somente-teste',4),JWT_SECRET:'segredo-apenas-teste-local-1234567890',
  API_MAX_RANGE_DAYS:'7',API_MAX_CONCURRENT_READS:'2',RATE_LIMIT_MAX:'1000',LOGIN_RATE_LIMIT_MAX:'100',TRUST_PROXY_HOPS:'0',
});
const sample=[
  {UF:'AL',id_linha:'AL|1|10|1',vendedor:1,id_cliente:9,operacao:1,quantidade_Iped:2,preco_iped:10,total_venda:20,canal:'VENDEDOR'},
  {UF:'AL',id_linha:'AL|1|10|2',vendedor:1,id_cliente:9,operacao:8,quantidade_Iped:-1,preco_iped:0,total_venda:-10,canal:'VENDEDOR'},
];
const queries=[];
let gate=null;
// Mock na fronteira do banco: nenhum driver conecta e nenhuma consulta chega a um SQL Server.
const fakePool={request(){const params={};return {
  input(name,type,value){params[name]=value;return this;},
  async query(text){queries.push({text,params});if(gate) await gate;return {recordset:text.includes('[MIX-AL]')?sample:[]};},
};}};
require.cache[require.resolve('../src/config/sqlServer')]={id:require.resolve('../src/config/sqlServer'),filename:require.resolve('../src/config/sqlServer'),loaded:true,exports:{getPool:async()=>fakePool,closeAllPools:async()=>{},sql:{Date:'date'}}};
const settings=require('../src/config/settings');
const {buildVendasQuery}=require('../src/services/vendasQuery');
const {createApp}=require('../src/app');

// Todos os subtestes abaixo são sequenciais para proteger o estado dos mocks.
test('API SQL Server somente leitura — testes isolados',async t=>{
  await t.test('configuração de teste completa válida',()=>assert.doesNotThrow(()=>settings.validateStartup()));
  await t.test('nomes de bancos e UF rejeitam interpolação arbitrária',()=>{
    assert.throws(()=>buildVendasQuery('MIX-AL]; DELETE FROM x;--','AL'));
    assert.throws(()=>buildVendasQuery('MIX-AL',"AL';DELETE"));
    assert.doesNotThrow(()=>buildVendasQuery('MIX-AL','AL'));
  });
  await t.test('query é de consulta e usa datas parametrizadas',()=>{
    const sql=buildVendasQuery('MIX-AL','AL');
    assert.match(sql,/WITH p AS/);assert.match(sql,/@dataInicio/);assert.match(sql,/@dataFim/);
    assert.doesNotMatch(sql,/\b(DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|GRANT|REVOKE|EXEC|EXECUTE|INTO|BACKUP|RESTORE|DBCC)\b/i);
  });
  await t.test('bloco PostgreSQL/ETL e scripts de escrita não são distribuídos',()=>{
    for(const file of ['src/config/postgres.js','src/services/etlService.js','src/services/controlService.js','src/jobs','src/routes/etl.js','src/scripts/initSchema.js','src/scripts/fullHistoricalLoad.js','src/scripts/runIncrementalOnce.js','sql']) assert.equal(fs.existsSync(path.join(__dirname,'..',file)),false,file);
    const pkg=require('../package.json');
    for(const name of ['pg','node-cron','p-retry','p-limit']) assert.equal(pkg.dependencies[name],undefined);
    for(const name of ['db:init','load:full','load:incremental']) assert.equal(pkg.scripts[name],undefined);
  });
  const server=await new Promise(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  let token;
  const request=(url,options={})=>fetch(base+url,{signal:AbortSignal.timeout(5000),...options});
  const options=()=>({headers:{Authorization:`Bearer ${token}`}});
  const period='?dataInicio=2026-09-04&dataFim=2026-09-04';
  await t.test('health não consulta banco',async()=>{
    const before=queries.length;const res=await request('/health');assert.equal(res.status,200);assert.equal((await res.json()).status,'ok');assert.equal(queries.length,before);
  });
  await t.test('vendas sem autenticação não consulta banco',async()=>{
    const before=queries.length;const res=await request('/vendas'+period);assert.equal(res.status,401);await res.json();assert.equal(queries.length,before);
  });
  await t.test('login bcrypt emite token de leitura',async()=>{
    const res=await request('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:'cliente-teste',client_secret:'senha-somente-teste'})});
    assert.equal(res.status,200);token=(await res.json()).access_token;assert.ok(token);
  });
  await t.test('consulta mantém envelope e campos originais',async()=>{
    const res=await request('/vendas'+period,options());assert.equal(res.status,200);const body=await res.json();assert.equal(body.total,2);assert.equal(body.data[0].quantidade_Iped,2);assert.equal(body.data[0].UF,'AL');
    assert.equal(queries.at(-1).params.dataInicio,'2026-09-04');
  });
  await t.test('resumo aplica devolução, quantidade e UF corretas',async()=>{
    const res=await request('/vendas/resumo'+period,options());const body=await res.json();assert.equal(res.status,200);assert.equal(body.totalVendaValorGeral,10);assert.equal(body.totalQuantidadeGeral,1);assert.equal(body.porUf[0].empresa,'AL');assert.equal(body.totalVendedoresGeral,1);assert.equal(body.totalClientesGeral,1);
  });
  await t.test('filtro UF consulta somente o database correspondente',async()=>{
    const before=queries.length;const res=await request('/vendas/por-uf/al'+period,options());const body=await res.json();assert.equal(res.status,200);assert.equal(body.total,2);assert.equal(queries.length-before,1);assert.match(queries.at(-1).text,/\[MIX-AL\]/);
  });
  await t.test('datas inexistentes, invertidas, longas e SQL em parâmetros são rejeitados',async()=>{
    const before=queries.length;
    for(const query of ['?dataInicio=2026-02-30&dataFim=2026-03-01','?dataInicio=2026-09-05&dataFim=2026-09-04','?dataInicio=2026-09-01&dataFim=2026-09-30','?dataInicio=2026-09-04%27%3BDELETE&dataFim=2026-09-04','?dataInicio[]=2026-09-04&dataFim=2026-09-04']){
      const res=await request('/vendas'+query,options());assert.equal(res.status,400,query);await res.json();
    }
    assert.equal(queries.length,before);
  });
  await t.test('UF não autorizada não consulta banco',async()=>{const before=queries.length;const res=await request('/vendas/por-uf/XX'+period,options());assert.equal(res.status,400);await res.json();assert.equal(queries.length,before);});
  await t.test('rota ETL não existe',async()=>{const res=await request('/etl/trigger/incremental',{...options(),method:'POST'});assert.equal(res.status,404);await res.json();});
  await t.test('limita consultas em voo e devolve slot após conclusão',async()=>{
    let release;gate=new Promise(resolve=>{release=resolve;});const before=queries.length;
    const a=request('/vendas/por-uf/AL'+period,options()), b=request('/vendas/por-uf/AL'+period,options());
    try{
      for(let i=0;i<100 && queries.length<before+2;i++) await new Promise(r=>setTimeout(r,5));
      assert.equal(queries.length,before+2);
      const res=await request('/vendas/por-uf/AL'+period,options());assert.equal(res.status,503);assert.equal(res.headers.get('retry-after'),'5');await res.json();
    } finally {gate=null;release();await Promise.all([a,b]).then(rs=>Promise.all(rs.map(r=>r.json())));}
    const res=await request('/vendas/por-uf/AL'+period,options());assert.equal(res.status,200);await res.json();
  });
  await t.test('pool recupera após primeira tentativa de conexão falhar',async()=>{
    let attempts=0;
    class Pool {constructor(){this.connected=false;}on(){}async connect(){if(++attempts===1)throw Error('falha simulada');this.connected=true;}async close(){this.connected=false;}}
    const file=path.join(__dirname,'../src/config/sqlServer.js');const module={exports:{}};
    vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,process,require(name){if(name==='mssql')return {ConnectionPool:Pool};if(name==='./logger')return {error(){},warn(){},info(){}};if(name==='./settings')return settings;throw Error(name);}});
    await assert.rejects(module.exports.getPool(),/falha simulada/);const pool=await module.exports.getPool();assert.equal(pool.connected,true);assert.equal(attempts,2);await module.exports.closeAllPools();
  });
});
