const Decimal = require('decimal.js');
const { descreverStatus, SITUACOES } = require('./pedidosStatus');
const { chavePedido } = require('./pedidosQuery');

function dec(value) {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  const d = new Decimal(value);
  return d.isFinite() ? d : new Decimal(0);
}

/**
 * Resumo da rota /pedidos: contagem de pedidos e linhas por status/situação, por UF.
 *
 * valorVendaRealizada: só linhas origem PAINEL (mesma regra de /vendas/resumo).
 * valorBruto por situação: preco × quantidade de todas as linhas, inclusive
 * perdidas. Para PERDIDO isso é "valor em risco", nunca venda.
 */
function summarizePedidos(linhas, periodo) {
  const porUf = new Map();
  const pedidosGeral = new Set();

  for (const row of linhas) {
    const uf = row.UF || 'Desconhecido';
    if (!porUf.has(uf)) {
      porUf.set(uf, {
        empresa: uf, totalLinhas: 0, pedidos: new Set(),
        porStatus: new Map(), porSituacao: new Map(),
        valorVendaRealizada: new Decimal(0), motivosRejeicao: new Map(),
      });
    }
    const g = porUf.get(uf);
    const chave = chavePedido(row);
    const st = row.status_descricao ? { status: row.status_cabped == null ? null : String(row.status_cabped).trim().toUpperCase(), status_descricao: row.status_descricao, situacao: row.situacao } : descreverStatus(row.status_cabped);
    const codigo = st.status ?? 'SEM_STATUS';
    const valor = dec(row.valor_pedido_bruto);

    g.totalLinhas++;
    g.pedidos.add(chave);
    pedidosGeral.add(chave);

    if (!g.porStatus.has(codigo)) g.porStatus.set(codigo, { status: st.status, descricao: st.status_descricao, situacao: st.situacao, pedidos: new Set(), linhas: 0, valorBruto: new Decimal(0) });
    const s = g.porStatus.get(codigo);
    s.pedidos.add(chave); s.linhas++; s.valorBruto = s.valorBruto.plus(valor);

    if (!g.porSituacao.has(st.situacao)) g.porSituacao.set(st.situacao, { pedidos: new Set(), linhas: 0, valorBruto: new Decimal(0) });
    const si = g.porSituacao.get(st.situacao);
    si.pedidos.add(chave); si.linhas++; si.valorBruto = si.valorBruto.plus(valor);

    if (row.origem === 'PAINEL') g.valorVendaRealizada = g.valorVendaRealizada.plus(valor);

    if (st.situacao === 'PERDIDO') {
      const motivo = (row.rejeitado_motivo || '').toString().trim() || 'Sem motivo informado';
      if (!g.motivosRejeicao.has(motivo)) g.motivosRejeicao.set(motivo, new Set());
      g.motivosRejeicao.get(motivo).add(chave);
    }
  }

  const ufs = Array.from(porUf.values(), g => ({
    empresa: g.empresa,
    totalLinhas: g.totalLinhas,
    totalPedidos: g.pedidos.size,
    valorVendaRealizada: Number(g.valorVendaRealizada.toFixed(2)),
    porSituacao: SITUACOES.map(sit => {
      const v = g.porSituacao.get(sit);
      return { situacao: sit, pedidos: v ? v.pedidos.size : 0, linhas: v ? v.linhas : 0, valorBruto: v ? Number(v.valorBruto.toFixed(2)) : 0 };
    }),
    porStatus: Array.from(g.porStatus.values(), s => ({
      status: s.status, descricao: s.descricao, situacao: s.situacao,
      pedidos: s.pedidos.size, linhas: s.linhas, valorBruto: Number(s.valorBruto.toFixed(2)),
    })).sort((a, b) => String(a.status).localeCompare(String(b.status))),
    motivosRejeicao: Array.from(g.motivosRejeicao, ([motivo, set]) => ({ motivo, pedidos: set.size }))
      .sort((a, b) => b.pedidos - a.pedidos),
  }));

  const totalVenda = ufs.reduce((acc, g) => acc.plus(g.valorVendaRealizada), new Decimal(0));
  return {
    success: true,
    periodo,
    totalLinhasGeral: linhas.length,
    totalPedidosGeral: pedidosGeral.size,
    valorVendaRealizadaGeral: Number(totalVenda.toFixed(2)),
    porUf: ufs,
  };
}

module.exports = { summarizePedidos };
