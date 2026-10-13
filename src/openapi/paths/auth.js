module.exports = {
  '/auth/login': {
    post: {
      tags: ['Autenticação'],
      summary: 'Emite token de acesso para o cliente de serviço',
      description: [
        'Autentica a credencial de máquina (`client_id` + `client_secret`) e devolve um JWT com escopo de leitura.',
        'Use o `access_token` no header `Authorization: Bearer <token>` das rotas de dados.',
        'Possui limite próprio de tentativas por minuto por IP (429). Credencial inválida sempre responde o mesmo 401, sem indicar qual campo falhou.',
      ].join(' '),
      operationId: 'postAuthLogin',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequisicao' } } },
      },
      responses: {
        200: {
          description: 'Token emitido.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResposta' } } },
        },
        400: {
          description: 'Campos ausentes/inválidos (`{erro, detalhes}`) ou corpo JSON mal formado (`{erro}` com a mensagem do parser).',
          content: {
            'application/json': {
              schema: { oneOf: [{ $ref: '#/components/schemas/ErroValidacaoLogin' }, { $ref: '#/components/schemas/ErroPadrao' }] },
              example: { erro: 'Dados inválidos.', detalhes: [{ campo: 'client_secret', mensagem: 'Invalid value' }] },
            },
          },
        },
        401: {
          description: 'Credenciais inválidas.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErroPadrao' }, example: { erro: 'Credenciais inválidas.' } } },
        },
        413: {
          description: 'Corpo maior que o limite aceito (1 MB).',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErroPadrao' }, example: { erro: 'request entity too large' } } },
        },
        429: { $ref: '#/components/responses/LimiteRequisicoes' },
        500: {
          description: 'Falha inesperada ou autenticação não configurada no servidor. Mensagem genérica.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ErroPadrao' }, example: { erro: 'Erro interno do servidor.' } } },
        },
      },
    },
  },
};
