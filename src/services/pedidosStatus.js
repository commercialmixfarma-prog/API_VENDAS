/**
 * Dicionário de status do pedido (CabPedidos.Status_CabPed, coluna nvarchar).
 *
 * Os códigos são texto no ERP: comparar sempre com '5', nunca com 5 (número),
 * porque a coluna também guarda 'R' e 'A' e a conversão implícita quebraria.
 *
 * situacao agrupa os códigos para o consumidor:
 *   FATURADO      -> nota emitida (venda realizada)
 *   EM_ANDAMENTO  -> pedido ainda no fluxo (liberação, OS, separação, NFe)
 *   PERDIDO       -> rejeitado ou abandonado
 *   OUTRO         -> código não mapeado (manter visível, não esconder)
 */
const STATUS_FATURADO = '5';

const STATUS_PEDIDO = Object.freeze({
  '0': { descricao: 'Aguardando liberação', situacao: 'EM_ANDAMENTO' },
  '1': { descricao: 'Aguardando liberação', situacao: 'EM_ANDAMENTO' },
  '2': { descricao: 'Aguardando OS', situacao: 'EM_ANDAMENTO' },
  '3': { descricao: 'Separando', situacao: 'EM_ANDAMENTO' },
  '4': { descricao: 'Aguardando NFe', situacao: 'EM_ANDAMENTO' },
  '5': { descricao: 'Nota emitida', situacao: 'FATURADO' },
  'R': { descricao: 'Rejeitado', situacao: 'PERDIDO' },
  'A': { descricao: 'Abandonado', situacao: 'PERDIDO' },
});

const SITUACOES = Object.freeze(['FATURADO', 'EM_ANDAMENTO', 'PERDIDO', 'OUTRO']);

function normalizarStatus(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toUpperCase();
  return s === '' ? null : s;
}

function descreverStatus(value) {
  const codigo = normalizarStatus(value);
  const info = codigo !== null ? STATUS_PEDIDO[codigo] : undefined;
  return {
    status: codigo,
    status_descricao: info ? info.descricao : (codigo === null ? 'Sem status' : `Status ${codigo}`),
    situacao: info ? info.situacao : 'OUTRO',
  };
}

module.exports = { STATUS_FATURADO, STATUS_PEDIDO, SITUACOES, normalizarStatus, descreverStatus };
