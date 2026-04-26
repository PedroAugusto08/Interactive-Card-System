import { request } from './httpClient';

export const matchApi = {
  getSnapshot: ({ roomId, token }) => request(`/match/${roomId}`, { token }),

  start: ({ roomId, token }) =>
    request(`/match/${roomId}/start`, {
      method: 'POST',
      token,
    }),

  draw: ({ roomId, token }) =>
    request(`/match/${roomId}/draw`, {
      method: 'POST',
      token,
    }),

  playCard: ({ roomId, cardId, token }) =>
    request(`/match/${roomId}/play-card`, {
      method: 'POST',
      token,
      body: { cardId },
    }),

  discardCard: ({ roomId, cardId, token }) =>
    request(`/match/${roomId}/discard-card`, {
      method: 'POST',
      token,
      body: { cardId },
    }),

  endTurn: ({ roomId, token }) =>
    request(`/match/${roomId}/end-turn`, {
      method: 'POST',
      token,
    }),
};
