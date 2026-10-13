module.exports = {
  '/health': {
    get: {
      tags: ['Saúde'],
      summary: 'Verifica se o processo HTTP está no ar',
      description: 'Liveness apenas: não consulta o banco nem comprova acesso a ele. Sem autenticação e fora do limite de requisições da API.',
      operationId: 'getHealth',
      responses: {
        200: {
          description: 'Processo em execução.',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Health' } } },
        },
      },
    },
  },
};
