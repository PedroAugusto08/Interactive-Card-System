const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Cliente HTTP base para chamadas da API.
export async function request(path, { method = 'GET', body, token } = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };

  // Envia JWT quando a rota exige autenticacao.
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  // Padroniza erro para as paginas consumirem de forma simples.
  if (!response.ok) {
    throw new Error(data?.message || 'Falha na comunicacao com a API.');
  }

  return data;
}
