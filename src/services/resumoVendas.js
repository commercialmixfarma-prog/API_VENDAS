const Decimal = require('decimal.js');
function decimal(value) {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  const d = new Decimal(value);
  if (!d.isFinite()) throw new Error('Valor numérico inválido no retorno de vendas.');
  return d;
}
function valorLinha(venda) {
  return Number(venda.operacao) === 8
    ? decimal(venda.total_venda)
    : decimal(venda.preco_iped).times(decimal(venda.quantidade_Iped));
}
function identifier(row, field) {
  const value = row[field];
  return value == null || value === '' ? null : `${row.UF}|${value}`;
}
function summarize(vendas,periodo) {
  const porUf = new Map(), vendedores = new Set(), clientes = new Set();
  let total = new Decimal(0), quantidade = new Decimal(0);
  for (const row of vendas) {
    const uf = row.UF || 'Desconhecido';
    if (!porUf.has(uf)) porUf.set(uf,{empresa:uf,totalItens:0,vendedores:new Set(),clientes:new Set(),canais:new Map(),valor:new Decimal(0),quantidade:new Decimal(0)});
    const group = porUf.get(uf), valor = valorLinha(row), unidades = decimal(row.quantidade_Iped);
    const vendedor = identifier(row,'vendedor'), cliente = identifier(row,'id_cliente');
    if (vendedor) {group.vendedores.add(vendedor);vendedores.add(vendedor);}
    if (cliente) {group.clientes.add(cliente);clientes.add(cliente);}
    group.totalItens++;
    group.valor = group.valor.plus(valor);
    group.quantidade = group.quantidade.plus(unidades);
    const canal = row.canal || 'Desconhecido';
    group.canais.set(canal,(group.canais.get(canal)||0)+1);
    total=total.plus(valor);quantidade=quantidade.plus(unidades);
  }
  return {
    success:true,periodo,totalItensGeral:vendas.length,
    totalVendedoresGeral:vendedores.size,totalClientesGeral:clientes.size,
    totalVendaValorGeral:Number(total.toFixed(2)),totalQuantidadeGeral:quantidade.toNumber(),
    porUf:Array.from(porUf.values(),g=>({
      empresa:g.empresa,totalItens:g.totalItens,totalVendedores:g.vendedores.size,totalClientes:g.clientes.size,
      totalVendaValor:Number(g.valor.toFixed(2)),totalQuantidade:g.quantidade.toNumber(),
      canalDistribuicao:Array.from(g.canais,([canal,count])=>({canal,count})),
    })),
  };
}
module.exports = {summarize,valorLinha};
