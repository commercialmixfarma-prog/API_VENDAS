/**
 * Schemas de /health e /auth/login. Sem exemplo nem default em client_secret.
 */
module.exports = {
  schemas: {
    Health: {
      type: 'object',
      required: ['status', 'timestamp'],
      properties: {
        status: { type: 'string', enum: ['ok'], example: 'ok' },
        timestamp: { type: 'string', format: 'date-time', example: '2026-09-01T12:00:00.000Z' },
      },
    },
    LoginRequisicao: {
      type: 'object',
      required: ['client_id', 'client_secret'],
      properties: {
        client_id: { type: 'string', minLength: 1, description: 'Identificador do cliente de serviço.', example: 'servico-exemplo' },
        client_secret: { type: 'string', minLength: 1, format: 'password', description: 'Segredo do cliente de serviço (texto original, não o hash). Nunca exponha em front-end.' },
      },
    },
    LoginResposta: {
      type: 'object',
      required: ['access_token', 'token_type', 'expires_in'],
      properties: {
        access_token: { type: 'string', description: 'JWT a enviar em `Authorization: Bearer <access_token>`.' },
        token_type: { type: 'string', enum: ['Bearer'], example: 'Bearer' },
        expires_in: { type: 'string', description: 'Prazo de validade conforme configurado no servidor, em notação de duração (ex.: `1h`). É texto, não segundos.', example: '1h' },
      },
    },
    ErroValidacaoLogin: {
      type: 'object',
      description: 'Corpo do login sem `client_id` ou `client_secret` válidos.',
      required: ['erro', 'detalhes'],
      properties: {
        erro: { type: 'string', example: 'Dados inválidos.' },
        detalhes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['campo', 'mensagem'],
            properties: {
              campo: { type: 'string', example: 'client_id' },
              mensagem: { type: 'string', example: 'Invalid value' },
            },
          },
        },
      },
    },
  },
};
