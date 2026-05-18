import { request } from './httpClient';

export const characterApi = {
  getCatalog: ({ token }) => request('/characters/catalog', { token }),

  listImoCards: ({ token }) => request('/characters/imo-cards', { token }),

  createImoCard: ({ token, payload }) =>
    request('/characters/imo-cards', {
      method: 'POST',
      token,
      body: payload,
    }),

  listCharacters: ({ token }) => request('/characters', { token }),

  createCharacter: ({ token, payload }) =>
    request('/characters', {
      method: 'POST',
      token,
      body: payload,
    }),

  updateCharacter: ({ token, characterId, payload }) =>
    request(`/characters/${characterId}`, {
      method: 'PUT',
      token,
      body: payload,
    }),

  deleteCharacter: ({ token, characterId }) =>
    request(`/characters/${characterId}`, {
      method: 'DELETE',
      token,
    }),
};
