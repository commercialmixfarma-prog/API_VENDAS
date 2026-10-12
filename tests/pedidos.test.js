const {test}=require('node:test');
const assert=require('node:assert/strict');
const bcrypt=require('bcryptjs');
Object.assign(process.env,{
  NODE_ENV:'test',LOG_LEVEL:'error',SQLSERVER_HOST:'127.0.0.1',SQLSERVER_USER:'teste_simulado',SQLSERVER_PASSWORD:'sem_banco_real',
  SQLSERVER_AL_DATABASE:'MIX-AL',SQLSERVER_SE_DATABASE:'MIX-SE',VENDAS_UFS:'AL,SE',
  SERVICE_CLIENT_ID:'cliente-teste',SERVICE_CLIENT_SECRET:bcrypt.hashSync('senha-somente-teste',4),JWT_SECRET:'segredo-apenas-teste-local-1234567890',
  API_MAX_RANGE_DAYS:'7',API_MAX_CONCURRENT_READS:'2',RATE_LIMIT_MAX:'1000',LOGIN_RATE_LIMIT_MAX:'100',TRUST_PROXY_HOPS:'0',
});
// Linhas que a função painelvendas devolve (iguais às de /vendas).
const vendasAL=[
  {UF:'AL',id_linha:'AL|1|10|1',empresa_par:1,id_cabped:10,vendedor:1,id_cliente:9,operacao:1,quantidade_Iped:2,preco_iped:10,total_venda:20,status_cabped:'5',canal:'VENDEDOR',hora:'08:00:00'},
  {UF:'AL',id_linha:'AL|1|10|2',empresa_par:1,id_cabped:10,vendedor:1,id_cliente:9,operacao:8,quantidade_Iped:-1,preco_iped:0,total_venda:-10,status_cabped:'5',canal:'VENDEDOR',hora:'08:00:00'},
];
// Linhas de CabPedidos do período, TODOS os status. O pedido 10 (já no painel)
// deve ser descartado; o pedido 14 é faturado mas a função não o devolveu, então entra.
const pendentesAL=[
  {UF:'AL',id_linha:'AL|1|10|3',empresa_par:1,id_cabped:10,vendedor:1,id_cliente:9,operacao:1,quantidade_Iped:5,preco_iped:1,total_venda:null,status_cabped:'3',rejeitado_motivo:null},
  {UF:'AL',id_linha:'AL|1|11|7',empresa_par:1,id_cabped:11,vendedor:2,id_cliente:8,operacao:1,quantidade_Iped:3,preco_iped:4,total_venda:null,status_cabped:'R',rejeitado_motivo:'LIMITE DE CREDITO'},
  {UF:'AL',id_linha:'AL|1|12|SEMITEM',empresa_par:1,id_cabped:12,vendedor:2,id_cliente:7,operacao:null,quantidade_Iped:null,preco_iped:null,total_venda:null,status_cabped:'A',rejeitado_motivo:null},
  {UF:'AL',id_linha:'AL|1|13|9',empresa_par:1,id_cabped:13,vendedor:3,id_cliente:6,operacao:1,quantidade_Iped:12,preco_iped:31.78,desconto_item:85.04,total_venda:null,status_cabped:'2',rejeitado_motivo:null},
  {UF:'AL',id_linha:'AL|1|14|10',empresa_par:1,id_cabped:14,vendedor:3,id_cliente:5,operacao:1,quantidade_Iped:2,preco_iped:3,total_venda:null,status_cabped:'5',rejeitado_motivo:null},
];
const queries=[];
const fakePool={request(){const params={};return {
  input(name,type,value){params[name]=value;return this;},
  async query(text){
    queries.push({text,params});
    if(!text.includes('[MIX-AL]')) return {recordset:[]};
    return {recordset:text.includes('painelvendas')?vendasAL:pendentesAL};
  },
};}};
const sqlPath=require.resolve('../src/config/sqlServer');
require.cache[sqlPath]={id:sqlPath,filename:sqlPath,loaded:true,exports:{getPool:async()=>fakePool,closeAllPools:async()=>{},sql:{Date:'date'}}};
const {buildPedidosCabPedQuery}=require('../src/services/pedidosQuery');
const {buildVendasQuery}=require('../src/services/vendasQuery');
const {createApp}=require('../src/app');

test('Rota /pedidos — vendas + pedidos em qualquer status',async t=>{
  await t.test('consulta de pendentes é somente leitura, parametrizada e rejeita identificadores arbitrários',()=>{
    const sql=buildPedidosCabPedQuery('MIX-AL','AL');
    assert.match(sql,/@dataInicio/);assert.match(sql,/@dataFim/);
    assert.doesNotMatch(sql,/Status_CabPed\s*(<>|=|!=|IN)/i,'não pode filtrar por status: todos os pedidos devem voltar');
    assert.match(sql,/FROM \[MIX-AL\]\.dbo\.CabPedidos cp/);
    assert.doesNotMatch(sql,/painelvendas/);
    assert.doesNotMatch(sql,/\b(DROP|TRUNCATE|INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|GRANT|REVOKE|EXEC|EXECUTE|INTO|BACKUP|RESTORE|DBCC)\b/i);
    assert.throws(()=>buildPedidosCabPedQuery('MIX-AL]; DELETE FROM x;--','AL'));
    assert.throws(()=>buildPedidosCabPedQuery('MIX-AL',"AL';DELETE"));
  });
  await t.test('consulta de pendentes expõe as mesmas colunas de /vendas, na mesma ordem, mais as extras',()=>{
    // Extrai os nomes de saída do SELECT principal (alias "AS nome" ou "tabela.coluna").
    const colunas=(sql,ini,fim)=>{
      const bloco=sql.slice(sql.indexOf(ini)+ini.length,sql.indexOf(fim));
      const nomes=[];
      for(const bruta of bloco.split('\n')){
        const linha=bruta.trim().replace(/,$/,'');
        if(!linha) continue;
        let m=linha.match(/\bAS\s+\[?([A-Za-z_][A-Za-z0-9_]*)\]?$/);
        if(!m&&!/^(CASE|WHEN|ELSE|END)\b/.test(linha)) m=linha.match(/\.\[?([A-Za-z_][A-Za-z0-9_]*)\]?$/);
        if(m) nomes.push(m[1]);
      }
      return nomes;
    };
    const vendas=colunas(buildVendasQuery('MIX-AL','AL'),')\nSELECT','\nFROM p\n');
    const pendentes=colunas(buildPedidosCabPedQuery('MIX-AL','AL'),'SELECT','\nFROM [MIX-AL].dbo.CabPedidos');
    assert.equal(vendas.length,52);
    assert.deepEqual(pendentes.slice(0,52),vendas);
    assert.deepEqual(pendentes.slice(52),['rejeitado_motivo','obs_cancelamento']);
  });
  const server=await new Promise(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(url,options={})=>fetch(base+url,{signal:AbortSignal.timeout(5000),...options});
  let token;
  const options=()=>({headers:{Authorization:`Bearer ${token}`}});
  const period='?dataInicio=2026-10-08&dataFim=2026-10-08';
  await t.test('sem autenticação não consulta banco',async()=>{
    const before=queries.length;const res=await request('/pedidos'+period);assert.equal(res.status,401);await res.json();assert.equal(queries.length,before);
  });
  await t.test('login',async()=>{
    const res=await request('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:'cliente-teste',client_secret:'senha-somente-teste'})});
    assert.equal(res.status,200);token=(await res.json()).access_token;
  });
  await t.test('dicionário de status disponível',async()=>{
    const res=await request('/pedidos/status',options());const body=await res.json();assert.equal(res.status,200);
    assert.ok(body.status.find(s=>s.status==='R'&&s.situacao==='PERDIDO'));
  });
  await t.test('por-uf: duas consultas por UF, deduplica por pedido, enriquece status e valor',async()=>{
    const before=queries.length;
    const res=await request('/pedidos/por-uf/AL'+period,options());const body=await res.json();assert.equal(res.status,200);
    assert.equal(queries.length-before,2);
    assert.match(queries.at(-2).text,/painelvendas/);assert.match(queries.at(-1).text,/CabPedidos cp/);
    assert.equal(queries.at(-1).params.statusFaturado,undefined);assert.equal(queries.at(-1).params.dataFim,'2026-10-08');
    // 2 linhas do painel + 4 de CabPedidos (a linha do pedido 10 em CabPedidos foi descartada)
    assert.equal(body.total,6);assert.deepEqual(body.contagem,{linhasPainel:2,linhasCabPed:4,linhasCabPedFaturadas:1});
    const fat=body.data.find(r=>r.id_linha==='AL|1|14|10');assert.equal(fat.origem,'CABPED');assert.equal(fat.situacao,'FATURADO');assert.equal(fat.valor_pedido_bruto,6);
    assert.equal(body.data.find(r=>r.id_linha==='AL|1|10|3'),undefined);
    const painel=body.data.find(r=>r.id_linha==='AL|1|10|1');
    assert.equal(painel.origem,'PAINEL');assert.equal(painel.status_descricao,'Nota emitida');assert.equal(painel.situacao,'FATURADO');assert.equal(painel.valor_pedido_bruto,20);assert.equal(painel.hora,'08:00:00');
    const devol=body.data.find(r=>r.id_linha==='AL|1|10|2');assert.equal(devol.valor_pedido_bruto,-10);
    const rej=body.data.find(r=>r.id_linha==='AL|1|11|7');
    assert.equal(rej.origem,'CABPED');assert.equal(rej.status_descricao,'Rejeitado');assert.equal(rej.situacao,'PERDIDO');assert.equal(rej.valor_pedido_bruto,12);assert.equal(rej.total_venda,null);assert.equal(rej.rejeitado_motivo,'LIMITE DE CREDITO');
    const aband=body.data.find(r=>r.id_linha==='AL|1|12|SEMITEM');assert.equal(aband.situacao,'PERDIDO');assert.equal(aband.valor_pedido_bruto,null);
  });
  await t.test('filtros status, situacao e origem funcionam e rejeitam valores fora da allowlist',async()=>{
    let res=await request('/pedidos/por-uf/AL'+period+'&status=R,A',options());let body=await res.json();assert.equal(body.total,2);
    res=await request('/pedidos/por-uf/AL'+period+'&situacao=EM_ANDAMENTO',options());body=await res.json();assert.equal(body.total,1);assert.equal(body.data[0].status_cabped,'2');assert.equal(body.data[0].valor_pedido_bruto,57.05,'desconto percentual aplicado');
    res=await request('/pedidos/por-uf/AL'+period+'&origem=PAINEL',options());body=await res.json();assert.equal(body.total,2);
    res=await request('/pedidos/por-uf/AL'+period+'&status=5',options());body=await res.json();assert.equal(body.total,3);
    const before=queries.length;
    for(const q of ['&status=R%27;DELETE','&situacao=QUALQUER','&origem=X']){res=await request('/pedidos/por-uf/AL'+period+q,options());assert.equal(res.status,400,q);await res.json();}
    assert.equal(queries.length,before);
  });
  await t.test('resumo separa venda realizada de valor em risco e conta pedidos distintos',async()=>{
    const res=await request('/pedidos/resumo'+period,options());const body=await res.json();assert.equal(res.status,200);
    assert.equal(body.totalPedidosGeral,5);assert.equal(body.totalLinhasGeral,6);assert.equal(body.valorVendaRealizadaGeral,10);
    const al=body.porUf.find(g=>g.empresa==='AL');
    const perdido=al.porSituacao.find(s=>s.situacao==='PERDIDO');assert.equal(perdido.pedidos,2);assert.equal(perdido.valorBruto,12);
    const faturado=al.porSituacao.find(s=>s.situacao==='FATURADO');assert.equal(faturado.pedidos,2);assert.equal(faturado.linhas,3);
    assert.deepEqual(al.motivosRejeicao,[{motivo:'LIMITE DE CREDITO',pedidos:1},{motivo:'Sem motivo informado',pedidos:1}]);
  });
  await t.test('/vendas continua intocada: uma consulta, sem colunas extras',async()=>{
    const before=queries.length;const res=await request('/vendas/por-uf/AL'+period,options());const body=await res.json();assert.equal(res.status,200);
    assert.equal(queries.length-before,1);assert.equal(body.total,2);assert.equal(body.data[0].origem,undefined);assert.equal(body.data[0].status_descricao,undefined);
  });
  await t.test('período inválido e UF não configurada não consultam banco',async()=>{
    const before=queries.length;
    for(const url of ['/pedidos?dataInicio=2026-10-01&dataFim=2026-10-30','/pedidos/por-uf/XX'+period]){const res=await request(url,options());assert.equal(res.status,400,url);await res.json();}
    assert.equal(queries.length,before);
  });
});
