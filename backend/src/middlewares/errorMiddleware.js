// Resposta padrao para rotas inexistentes.
function notFoundHandler(req, res) {
  res.status(404).json({ message: 'Rota nao encontrada.' });
}

// Handler global de erros da API.
function errorHandler(error, req, res, next) {
  // Se ja comecou resposta, delega para o Express.
  if (res.headersSent) {
    return next(error);
  }

  // Erro de validacao do Zod vira 400 com detalhes.
  if (error?.name === 'ZodError') {
    return res.status(400).json({
      message: 'Dados de entrada invalidos.',
      issues: error.issues,
    });
  }

  // Erro customizado usa statusCode; resto vira 500.
  const statusCode = error?.statusCode || 500;
  const message = error?.message || 'Erro interno do servidor.';

  return res.status(statusCode).json({ message });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
