import { request } from './httpClient';

// Chamadas de autenticacao.
export const authApi = {
  register: (payload) =>
    request('/auth/register', {
      method: 'POST',
      body: payload,
    }),

  login: (payload) =>
    request('/auth/login', {
      method: 'POST',
      body: payload,
    }),
};
