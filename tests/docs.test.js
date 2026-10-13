const {test}=require('node:test');
const assert=require('node:assert/strict');
const bcrypt=require('bcryptjs');
Object.assign(process.env,{
  NODE_ENV:'test',LOG_LEVEL:'error',SQLSERVER_HOST:'127.0.0.1',SQLSERVER_USER:'teste_simulado',SQLSERVER_PASSWORD:'sem_banco_real',
  SQLSERVER_AL_DATABASE:'MIX-AL',SQLSERVER_SE_DATABASE:'MIX-SE',VENDAS_UFS:'AL,SE',
  SERVICE_CLIENT_ID:'cliente-teste',SERVICE_CLIENT_SECRET:bcrypt.hashSync('senha-somente-teste',4),JWT_SECRET:'segredo-apenas-teste-local-1234567890',
  API_MAX_RANGE_DAYS:'7',API_MAX_CONCURRENT_READS:'2',RATE_LIMIT_MAX:'1000',LOGIN_RATE_LIMIT_MAX:'100',TRUST_PROXY_HOPS:'0',
});
for(const k of ['DOCS_ENABLED','DOCS_BASIC_USER','DOCS_BASIC_PASSWORD_HASH','DOCS_SERVER_URL','DOCS_RATE_LIMIT_MAX']) delete process.env[k];
// Mock na fronteira do banco, igual aos demais testes: nenhuma consulta chega a um SQL Server.
const fakePool={request(){return {input(){return this;},async query(){return {recordset:[]};}};}};
const sqlPath=require.resolve('../src/config/sqlServer');
require.cache[sqlPath]={id:sqlPath,filename:sqlPath,loaded:true,exports:{getPool:async()=>fakePool,closeAllPools:async()=>{},sql:{Date:'date'}}};
const settings=require('../src/config/settings');
const {createApp}=require('../src/app');
const {buildSpec}=require('../src/openapi');
const {ASSETS}=require('../src/openapi/router');
const {buildVendasQuery}=require('../src/services/vendasQuery');
const {buildPedidosCabPedQuery,enriquecer}=require('../src/services/pedidosQuery');
const pkg=require('../package.json');

// CSP emitido pelo helmet() padrão em /vendas ANTES da documentação existir. Não pode mudar.
const CSP_ANTERIOR="default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests";
const HELMET_HEADERS=['content-security-policy','cross-origin-opener-policy','cross-origin-resource-policy','origin-agent-cluster','referrer-policy','strict-transport-security','x-content-type-options','x-dns-prefetch-control','x-download-options','x-frame-options','x-permitted-cross-domain-policies','x-xss-protection'];
const DOCS_USER='doc-admin-teste', DOCS_PASS='senha-doc-somente-teste';

function withEnv(vars,fn){
  const previous={};
  for(const k of Object.keys(vars)) previous[k]=process.env[k];
  try { for(const [k,v] of Object.entries(vars)) { if(v===undefined) delete process.env[k]; else process.env[k]=v; } return fn(); }
  finally { for(const [k,v] of Object.entries(previous)) { if(v===undefined) delete process.env[k]; else process.env[k]=v; } }
}
async function listen(t,vars={}){
  const app=withEnv(vars,()=>createApp());
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  return {app,request:(url,options={})=>fetch(base+url,{signal:AbortSignal.timeout(5000),redirect:'manual',...options})};
}
// Rotas reais registradas no Express (método + caminho), excluindo a própria documentação.
function expressRoutes(app){
  const out=new Set();
  const walk=(stack,prefix)=>{
    for(const layer of stack){
      if(layer.route){ for(const m of Object.keys(layer.route.methods)) out.add(`${m.toUpperCase()} ${prefix}${layer.route.path}`); }
      else if(layer.name==='router'&&layer.handle.stack){
        const m=layer.regexp.source.match(/^\^\\\/([A-Za-z0-9_-]+)\\\/\?\(\?=\\\/\|\$\)/);
        const mount=prefix+(m?`/${m[1]}`:'');
        if(mount==='/docs') continue;
        walk(layer.handle.stack,mount);
      }
    }
  };
  walk(app._router.stack,'');
  return [...out].map(r=>r.replace(/:([A-Za-z_]+)/g,'{$1}').replace(/\/$/,'')).sort();
}
function specRoutes(spec){
  const out=[];
  for(const [p,ops] of Object.entries(spec.paths)) for(const m of Object.keys(ops)) out.push(`${m.toUpperCase()} ${p}`);
  return out.sort();
}
function collectRefs(node,acc=[]){
  if(Array.isArray(node)) node.forEach(n=>collectRefs(n,acc));
  else if(node&&typeof node==='object'){ for(const [k,v] of Object.entries(node)){ if(k==='$ref') acc.push(v); else collectRefs(v,acc); } }
  return acc;
}
function resolveRef(spec,ref){
  assert.match(ref,/^#\//,ref);
  return ref.slice(2).split('/').reduce((o,k)=>o&&o[k],spec);
}
const colunasSql=(sql,ini,fim)=>{
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

test('Documentação OpenAPI/Swagger: segurança e consistência',async t=>{
  await t.test('DOCS_ENABLED padrão: ligado fora de produção, desligado em produção',()=>{
    assert.equal(withEnv({NODE_ENV:'test'},()=>settings.getDocsSettings().enabled),true);
    assert.equal(withEnv({NODE_ENV:'production'},()=>settings.getDocsSettings().enabled),false);
    assert.throws(()=>withEnv({DOCS_ENABLED:'sim'},()=>settings.getDocsSettings()),/DOCS_ENABLED/);
  });
  await t.test('produção com docs ligados exige Basic Auth no startup',()=>{
    assert.throws(()=>withEnv({NODE_ENV:'production',DOCS_ENABLED:'true'},()=>settings.validateStartup()),/DOCS_BASIC_USER/);
    assert.throws(()=>withEnv({NODE_ENV:'production',DOCS_ENABLED:'true',DOCS_BASIC_USER:DOCS_USER},()=>settings.validateStartup()),/em conjunto/);
    assert.throws(()=>withEnv({NODE_ENV:'production',DOCS_ENABLED:'true',DOCS_BASIC_USER:DOCS_USER,DOCS_BASIC_PASSWORD_HASH:'senha-em-texto'},()=>settings.validateStartup()),/bcrypt/);
    assert.doesNotThrow(()=>withEnv({NODE_ENV:'production',DOCS_ENABLED:'true',DOCS_BASIC_USER:DOCS_USER,DOCS_BASIC_PASSWORD_HASH:bcrypt.hashSync(DOCS_PASS,4)},()=>settings.validateStartup()));
    assert.doesNotThrow(()=>withEnv({NODE_ENV:'production'},()=>settings.validateStartup()),'produção com docs desligados não exige credenciais');
  });
  await t.test('DOCS_SERVER_URL fixa e validada; DOCS_RATE_LIMIT_MAX inteiro',()=>{
    assert.equal(settings.docsServerUrl(undefined),'/');
    assert.equal(settings.docsServerUrl('/api'),'/api');
    assert.equal(settings.docsServerUrl('https://api.exemplo.invalid/vendas'),'https://api.exemplo.invalid/vendas');
    for(const bad of ['ftp://x','https://user:pass@host','https://host/?a=1','https://host/#f','javascript:alert(1)','//host','/com espaco','http://h ost']) assert.throws(()=>settings.docsServerUrl(bad),bad);
    assert.throws(()=>withEnv({DOCS_RATE_LIMIT_MAX:'0'},()=>settings.getDocsSettings()),/DOCS_RATE_LIMIT_MAX/);
    assert.throws(()=>withEnv({DOCS_RATE_LIMIT_MAX:'abc'},()=>settings.getDocsSettings()),/DOCS_RATE_LIMIT_MAX/);
  });

  await t.test('DOCS_ENABLED=false: nenhuma rota de docs existe (404 do notFoundHandler)',async()=>{
    const {app,request}=await listen(t,{DOCS_ENABLED:'false'});
    for(const url of ['/docs','/docs/','/docs/openapi.json','/docs/swagger-ui.css']){
      const res=await request(url);assert.equal(res.status,404,url);assert.deepEqual(await res.json(),{erro:'Rota não encontrada.'});
    }
    assert.equal(app._router.stack.some(l=>l.regexp&&/docs/.test(l.regexp.source)),false,'nenhum layer /docs montado');
  });

  await t.test('docs ligados: UI, openapi.json, headers, allowlist de assets e limiter próprio',async()=>{
    const {app,request}=await listen(t,{DOCS_ENABLED:'true',DOCS_RATE_LIMIT_MAX:'60'});
    const vendasAntes=await request('/vendas?dataInicio=2026-09-04&dataFim=2026-09-04');await vendasAntes.json();
    const remainingAntes=Number(vendasAntes.headers.get('ratelimit-remaining'));

    let res=await request('/docs');assert.equal(res.status,302);assert.equal(res.headers.get('location'),'/docs/');await res.text();
    res=await request('/docs/');assert.equal(res.status,200);
    const html=await res.text();
    assert.match(res.headers.get('content-type'),/text\/html/);
    assert.equal(res.headers.get('cache-control'),'no-store');
    assert.match(res.headers.get('x-robots-tag'),/noindex/);
    assert.equal(res.headers.get('ratelimit-limit'),'60','limiter próprio de /docs');
    assert.equal(res.headers.get('content-security-policy'),CSP_ANTERIOR,'CSP do helmet global inalterado em /docs');
    assert.equal((html.match(/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/g)||[]).length,0,'sem script inline');
    assert.doesNotMatch(html,/https?:\/\/(?!www\.w3\.org\/)/,'sem links externos (apenas namespaces SVG)');
    assert.match(html,/<meta name="robots" content="noindex, nofollow"/);

    res=await request('/docs/openapi.json');assert.equal(res.status,200);
    assert.match(res.headers.get('content-type'),/application\/json/);
    assert.equal(res.headers.get('cache-control'),'no-store');
    const spec=await res.json();
    assert.equal(spec.openapi,'3.0.3');assert.equal(spec.info.version,pkg.version);assert.deepEqual(spec.servers,[{url:'/',description:spec.servers[0].description}]);

    res=await request('/docs/swagger-ui-init.js');assert.equal(res.status,200);
    const init=await res.text();
    assert.match(init,/"persistAuthorization": false/);assert.match(init,/"validatorUrl": null/);assert.match(init,/"layout": "BaseLayout"/);
    assert.doesNotMatch(init,/localStorage/);

    for(const asset of ASSETS){ const r=await request(`/docs/${asset}`);assert.equal(r.status,200,asset);assert.equal(r.headers.get('cache-control'),'no-store',asset);await r.arrayBuffer(); }
    for(const url of ['/docs/index.html','/docs/swagger-ui-bundle.js.map','/docs/oauth2-redirect.html','/docs/swagger-initializer.js','/docs/package.json','/docs/swagger-ui-es-bundle.js','/docs/qualquer']){
      const r=await request(url);assert.equal(r.status,404,url);assert.deepEqual(await r.json(),{erro:'Rota não encontrada.'});
      assert.equal(r.headers.get('ratelimit-limit'),'60',`404 sob /docs não desce ao generalLimiter: ${url}`);
    }

    const vendasDepois=await request('/vendas?dataInicio=2026-09-04&dataFim=2026-09-04');await vendasDepois.json();
    assert.equal(Number(vendasDepois.headers.get('ratelimit-remaining')),remainingAntes-1,'assets de /docs não consomem a cota da API');
    assert.equal(expressRoutes(app).length>0,true);
  });

  await t.test('limiter de /docs devolve 429 no formato {erro}',async()=>{
    const {request}=await listen(t,{DOCS_ENABLED:'true',DOCS_RATE_LIMIT_MAX:'2'});
    for(let i=0;i<2;i++){const r=await request('/docs/openapi.json');assert.equal(r.status,200);await r.text();}
    const r=await request('/docs/openapi.json');assert.equal(r.status,429);assert.deepEqual(await r.json(),{erro:'Muitas requisições. Tente novamente em instantes.'});
  });

  await t.test('produção + Basic Auth: sem credencial 401, errada 401, correta 200',async()=>{
    const hash=bcrypt.hashSync(DOCS_PASS,4);
    const {request}=await listen(t,{NODE_ENV:'production',DOCS_ENABLED:'true',DOCS_BASIC_USER:DOCS_USER,DOCS_BASIC_PASSWORD_HASH:hash});
    const basic=(u,p)=>({headers:{Authorization:`Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`}});
    for(const url of ['/docs/','/docs/openapi.json','/docs/swagger-ui-bundle.js']){
      let res=await request(url);assert.equal(res.status,401,url);
      assert.match(res.headers.get('www-authenticate'),/^Basic realm=/);assert.deepEqual(await res.json(),{erro:'Autenticação necessária para acessar a documentação.'});
      res=await request(url,basic(DOCS_USER,'senha-errada'));assert.equal(res.status,401,url);await res.json();
      res=await request(url,basic('outro-usuario',DOCS_PASS));assert.equal(res.status,401,url);await res.json();
      res=await request(url,{headers:{Authorization:'Bearer abc'}});assert.equal(res.status,401,url);await res.json();
      res=await request(url,basic(DOCS_USER,DOCS_PASS));assert.equal(res.status,200,url);await res.arrayBuffer();
    }
    const res=await request('/health');assert.equal(res.status,200);await res.json();
  });

  await t.test('produção com docs ligados e sem credenciais não sobe',()=>{
    assert.throws(()=>withEnv({NODE_ENV:'production',DOCS_ENABLED:'true'},()=>createApp()),/DOCS_BASIC_USER/);
  });

  await t.test('todas as rotas reais do Express estão documentadas e não há doc órfã',async()=>{
    const {app}=await listen(t,{DOCS_ENABLED:'true'});
    const reais=expressRoutes(app), documentadas=specRoutes(buildSpec());
    assert.deepEqual(documentadas,reais);
    assert.equal(reais.length,9);
  });

  await t.test('spec OpenAPI 3.0.3 estruturalmente válida, $refs resolvem, sem duplicidade',()=>{
    const spec=buildSpec({serverUrl:'/',version:pkg.version});
    assert.equal(spec.openapi,'3.0.3');
    assert.ok(spec.info.title&&spec.info.version);
    assert.ok(Array.isArray(spec.servers)&&spec.servers.length===1);
    const refs=collectRefs(spec);
    assert.ok(refs.length>20);
    for(const ref of refs) assert.ok(resolveRef(spec,ref),`$ref não resolve: ${ref}`);
    const tags=new Set(spec.tags.map(x=>x.name));
    for(const [p,ops] of Object.entries(spec.paths)){
      assert.match(p,/^\/[A-Za-z0-9/{}_-]*$/,p);
      for(const [m,op] of Object.entries(ops)){
        assert.ok(['get','post'].includes(m),`${m} ${p}`);
        assert.ok(op.operationId&&op.summary&&op.responses&&Object.keys(op.responses).length,`${m} ${p}`);
        for(const tag of op.tags) assert.ok(tags.has(tag),tag);
        for(const code of Object.keys(op.responses)) assert.match(code,/^[1-5]\d\d$/,code);
        const params=(op.parameters||[]).map(x=>x.$ref?resolveRef(spec,x.$ref):x);
        for(const prm of params){ assert.ok(prm.name&&prm.in&&prm.schema,`${p} ${prm.name}`); if(prm.in==='path') assert.equal(prm.required,true); }
        for(const seg of p.match(/\{([^}]+)\}/g)||[]) assert.ok(params.some(x=>x.in==='path'&&`{${x.name}}`===seg),`parâmetro de caminho ${seg} em ${p}`);
        if(op.security) for(const s of op.security) for(const k of Object.keys(s)) assert.ok(spec.components.securitySchemes[k],k);
      }
    }
    const ids=Object.values(spec.paths).flatMap(ops=>Object.values(ops).map(o=>o.operationId));
    assert.equal(new Set(ids).size,ids.length,'operationId únicos');
    for(const key of ['schemas','parameters','responses','securitySchemes']) assert.ok(Object.keys(spec.components[key]).length>0,key);
    // Rotas autenticadas documentam 401/403 em {erro} e período em {success:false,error}.
    for(const p of ['/vendas','/vendas/resumo','/vendas/por-uf/{uf}','/pedidos','/pedidos/resumo','/pedidos/por-uf/{uf}']){
      const r=spec.paths[p].get.responses;
      assert.equal(resolveRef(spec,r[401].$ref).content['application/json'].schema.$ref,'#/components/schemas/ErroPadrao',p);
      assert.equal(resolveRef(spec,r[400].$ref).content['application/json'].schema.$ref,'#/components/schemas/ErroOperacao',p);
      assert.ok(resolveRef(spec,r[503].$ref).headers['Retry-After'],p);
      assert.deepEqual(spec.paths[p].get.security,[{bearerAuth:[]}]);
    }
    assert.equal(spec.paths['/health'].get.security,undefined);
    assert.equal(spec.paths['/auth/login'].post.security,undefined);
    assert.equal(resolveRef(spec,spec.paths['/vendas'].get.responses[500].$ref).content['application/json'].example.erro,'Erro interno do servidor.');
  });

  await t.test('erros de /pedidos/por-uf correspondem às validações reais (UF e filtros em {success:false})',async()=>{
    const {request}=await listen(t,{DOCS_ENABLED:'true'});
    const jwt=require('jsonwebtoken');
    const token=jwt.sign({sub:'cliente-teste',scope:'vendas:read'},process.env.JWT_SECRET,{algorithm:'HS256',expiresIn:'5m'});
    const auth={headers:{Authorization:`Bearer ${token}`}};
    let res=await request('/pedidos/por-uf/XX?dataInicio=2026-09-04&dataFim=2026-09-04',auth);assert.equal(res.status,400);assert.deepEqual(await res.json(),{success:false,error:'UF não configurada.'});
    res=await request('/pedidos?dataInicio=2026-09-04&dataFim=2026-09-04&situacao=INVALIDA',auth);assert.equal(res.status,400);assert.deepEqual(await res.json(),{success:false,error:'Parâmetro situacao inválido.'});
    res=await request('/pedidos/status');assert.equal(res.status,401);assert.deepEqual(await res.json(),{erro:'Token de autenticação ausente ou mal formatado.'});
  });

  await t.test('schemas de linha derivam das colunas reais das consultas',()=>{
    const spec=buildSpec();
    const vendasCols=colunasSql(buildVendasQuery('MIX-AL','AL'),')\nSELECT','\nFROM p\n');
    assert.equal(vendasCols.length,52);
    assert.deepEqual(Object.keys(spec.components.schemas.VendaLinha.properties),vendasCols);
    const cabpedCols=colunasSql(buildPedidosCabPedQuery('MIX-AL','AL'),'SELECT','\nFROM [MIX-AL].dbo.CabPedidos');
    const linhaCabped=Object.fromEntries(cabpedCols.map(c=>[c,null]));
    const extras=Object.keys(enriquecer(linhaCabped,'CABPED')).filter(k=>!vendasCols.includes(k));
    const pedido=spec.components.schemas.PedidoLinha;
    assert.equal(pedido.allOf[0].$ref,'#/components/schemas/VendaLinha');
    assert.deepEqual(Object.keys(pedido.allOf[1].properties),extras);
    assert.deepEqual(spec.components.schemas.PedidosStatusResposta.properties.situacoes.items.enum,require('../src/services/pedidosStatus').SITUACOES);
  });

  await t.test('spec não expõe segredos, infraestrutura, nomes internos nem links externos',()=>{
    const json=JSON.stringify(buildSpec({serverUrl:'/',version:pkg.version}));
    for(const proibido of ['MIX-AL','MIX-SE','painelvendas','CabPedidos','ItensPedido','Status_CabPed','SQLSERVER','SERVICE_CLIENT','JWT_SECRET','API_MAX_RANGE_DAYS','DOCS_','RATE_LIMIT','mixfarma','10.4.0.1','localhost','eyJ','http://','https://','.lan']) assert.equal(json.includes(proibido),false,proibido);
    const secret=buildSpec().components.schemas.LoginRequisicao.properties.client_secret;
    assert.equal(secret.example,undefined);assert.equal(secret.default,undefined);assert.equal(secret.format,'password');
    assert.equal(buildSpec().components.schemas.LoginResposta.properties.access_token.example,undefined);
  });

  await t.test('DOCS_SERVER_URL vai fixa para servers e nunca vem de Host/X-Forwarded-*',async()=>{
    const {request}=await listen(t,{DOCS_ENABLED:'true',DOCS_SERVER_URL:'https://api.exemplo.invalid/base'});
    const res=await request('/docs/openapi.json',{headers:{Host:'atacante.invalid',"X-Forwarded-Host":'atacante.invalid','X-Forwarded-Proto':'https'}});
    const spec=await res.json();
    assert.equal(spec.servers[0].url,'https://api.exemplo.invalid/base');
    assert.doesNotMatch(JSON.stringify(spec),/atacante/);
    assert.throws(()=>withEnv({DOCS_ENABLED:'true',DOCS_SERVER_URL:'https://u:p@h/'},()=>createApp()),/DOCS_SERVER_URL/);
  });

  await t.test('headers do helmet continuam em /health e /vendas; CSP de /vendas idêntico ao anterior',async()=>{
    const {request}=await listen(t,{DOCS_ENABLED:'true'});
    for(const url of ['/health','/vendas?dataInicio=2026-09-04&dataFim=2026-09-04']){
      const res=await request(url);await res.json();
      for(const h of HELMET_HEADERS) assert.ok(res.headers.get(h),`${h} em ${url}`);
      assert.equal(res.headers.get('content-security-policy'),CSP_ANTERIOR,url);
      assert.equal(res.headers.get('x-powered-by'),null);
    }
  });
});
