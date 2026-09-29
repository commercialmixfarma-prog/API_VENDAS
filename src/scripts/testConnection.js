// Verificações de LEITURA. Não cria objetos nem modifica registros.
require('dotenv').config();
const {getPool,closeAllPools}=require('../config/sqlServer');
const {getDatabasesPorUf}=require('../config/settings');
async function main(){
  const databases=getDatabasesPorUf();
  const pool=await getPool();
  await pool.request().query('SELECT 1 AS conexao_ok');
  console.log('Conexão SQL Server: OK');
  let failed=false;
  for(const [uf,database] of Object.entries(databases)){
    try {
      // Nomes aceitos só após validação em settings; não interpolar input HTTP.
      await pool.request().query(`SELECT TOP (1) 1 AS acesso_ok FROM [${database}].dbo.EquipeVenda`);
      console.log(`Leitura de EquipeVenda ${uf}: OK`);
    } catch(err){
      failed=true;
      console.error(`Leitura ${uf}: falhou (${err.code || 'SQL_ERROR'}). Verifique permissões/conectividade com TI.`);
    }
  }
  if(failed) process.exitCode=1;
  console.log('Este teste não comprova a consulta completa de vendas nem os privilégios efetivos somente leitura.');
}
if(require.main===module) main().catch(err=>{
  console.error('Codigo:', err.code || err.name);
  console.error('Detalhe:', err.message);
  if (err.originalError) console.error('Causa:', err.originalError.message);
  process.exitCode=1;
}).finally(closeAllPools);
module.exports={main};
