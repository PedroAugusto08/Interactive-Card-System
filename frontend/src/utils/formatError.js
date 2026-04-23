// Garante mensagem amigavel para qualquer erro de tela.
export function formatErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Ocorreu um erro inesperado.';
}
