import { request } from './httpClient';

// Chamadas HTTP para regras, catalogo e CRUD de decks.
export const deckApi = {
  getRules: ({ token }) => request('/decks/rules', { token }),

  getCatalog: ({ token }) => request('/decks/catalog', { token }),

  listImoCards: ({ token }) => request('/decks/imo-cards', { token }),

  createImoCard: ({ token, payload }) =>
    request('/decks/imo-cards', {
      method: 'POST',
      token,
      body: payload,
    }),

  listDecks: ({ token }) => request('/decks', { token }),

  createDeck: ({ token, payload }) =>
    request('/decks', {
      method: 'POST',
      token,
      body: payload,
    }),

  updateDeck: ({ token, deckId, payload }) =>
    request(`/decks/${deckId}`, {
      method: 'PUT',
      token,
      body: payload,
    }),

  deleteDeck: ({ token, deckId }) =>
    request(`/decks/${deckId}`, {
      method: 'DELETE',
      token,
    }),
};
