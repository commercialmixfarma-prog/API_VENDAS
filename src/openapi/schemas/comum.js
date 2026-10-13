/**
 * Componentes compartilhados: segurança, parâmetros de período/UF/filtros e os dois
 * formatos de erro que a API realmente devolve (não unificar; ver descrição em info).
 */
const erroPadrao = (exemplo) => ({
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErroPadrao' }, example: { erro: exemplo } } },
});
const erroOperacao = (exemplo) => ({
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErroOperacao' }, example: { success: false, error: exemplo } } },
});

module.exports = {
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Token emitido por `POST /auth/login`. Cole apenas o valor de `access_token` (sem o prefixo Bearer).',
    },
  },
  schemas: {
    ErroPadrao: {
      type: 'object',
      description: 'Formato de erro das camadas de autenticação, rota inexistente, limite de requisições e erro interno.',
      required: ['erro'],
      properties: { erro: { type: 'string', example: 'Token inválido.' } },
    },
    ErroOperacao: {
      type: 'object',
      description: 'Formato de erro das validações de período, UF e filtros e da indisponibilidade temporária (503).',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', enum: [false], example: false },
        error: { type: 'string', example: 'UF não configurada.' },
      },
    },
    Periodo: {
      type: 'object',
      required: ['dataInicio', 'dataFim'],
      properties: {
        dataInicio: { type: 'string', format: 'date', example: '2026-09-01' },
        dataFim: { type: 'string', format: 'date', example: '2026-09-07' },
      },
    },
  },
  parameters: {
    dataInicio: {
      name: 'dataInicio', in: 'query', required: true,
      description: 'Primeiro dia do período (inclusive), formato YYYY-MM-DD. Data inexistente (ex.: 30/02) é rejeitada.',
      schema: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', example: '2026-09-01' },
    },
    dataFim: {
      name: 'dataFim', in: 'query', required: true,
      description: 'Último dia do período (inclusive), formato YYYY-MM-DD, igual ou posterior a dataInicio. O intervalo não pode exceder o máximo configurado (padrão 7 dias).',
      schema: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$', example: '2026-09-07' },
    },
    uf: {
      name: 'uf', in: 'path', required: true,
      description: 'Sigla da UF (duas letras, maiúsculas ou minúsculas). Apenas UFs habilitadas pelo administrador; outras respondem 400.',
      schema: { type: 'string', pattern: '^[A-Za-z]{2}$', example: 'AL' },
    },
    status: {
      name: 'status', in: 'query', required: false,
      description: 'Filtro por código de status do pedido, separados por vírgula (ex.: `R,A` ou `5`). Códigos conhecidos em `GET /pedidos/status`. Aplicado após a consulta.',
      schema: { type: 'string', pattern: '^[0-9A-Za-z]{1,2}(,[0-9A-Za-z]{1,2})*$', example: 'R,A' },
    },
    situacao: {
      name: 'situacao', in: 'query', required: false,
      description: 'Filtro por situação, separadas por vírgula. Valores: FATURADO, EM_ANDAMENTO, PERDIDO, OUTRO.',
      schema: { type: 'string', pattern: '^(FATURADO|EM_ANDAMENTO|PERDIDO|OUTRO)(,(FATURADO|EM_ANDAMENTO|PERDIDO|OUTRO))*$', example: 'PERDIDO' },
    },
    origem: {
      name: 'origem', in: 'query', required: false,
      description: 'Filtro por origem da linha, separadas por vírgula. PAINEL = venda faturada (mesmas linhas de /vendas); CABPED = pedido lido do cabeçalho, em qualquer status.',
      schema: { type: 'string', pattern: '^(PAINEL|CABPED)(,(PAINEL|CABPED))*$', example: 'CABPED' },
    },
  },
  responses: {
    NaoAutenticado: {
      ...erroPadrao('Token de autenticação ausente ou mal formatado.'),
      description: 'Bearer ausente/mal formatado, token inválido ou expirado (`erro: "Token expirado."`).',
    },
    SemPermissao: {
      ...erroPadrao('Token sem permissão de leitura.'),
      description: 'Token válido, mas emitido para outro cliente ou sem o escopo de leitura.',
    },
    PeriodoInvalido: {
      ...erroOperacao('Informe datas reais no formato YYYY-MM-DD e dataFim igual ou posterior a dataInicio.'),
      description: 'Datas ausentes, inválidas, invertidas ou período maior que o máximo configurado.',
    },
    UfOuPeriodoInvalido: {
      ...erroOperacao('UF não configurada.'),
      description: 'Período inválido (ver PeriodoInvalido) ou UF não habilitada.',
    },
    FiltrosOuPeriodoInvalido: {
      ...erroOperacao('Parâmetro situacao inválido.'),
      description: 'Período inválido, UF não habilitada ou filtro `status`/`situacao`/`origem` fora da lista permitida.',
    },
    LimiteRequisicoes: {
      ...erroPadrao('Muitas requisições. Tente novamente em instantes.'),
      description: 'Limite de requisições por minuto por IP excedido. Observe os headers `RateLimit-*`.',
    },
    ErroInterno: {
      ...erroPadrao('Erro interno do servidor.'),
      description: 'Falha inesperada (inclusive indisponibilidade do banco). A mensagem é sempre genérica; detalhes ficam só no log do servidor.',
    },
    LeituraIndisponivel: {
      ...erroOperacao('Consultas simultâneas no limite. Tente novamente após alguns segundos.'),
      description: 'Número máximo de consultas simultâneas atingido. Repita após o tempo indicado em `Retry-After`.',
      headers: {
        'Retry-After': { description: 'Segundos sugeridos para nova tentativa.', schema: { type: 'string', example: '5' } },
      },
    },
  },
};
