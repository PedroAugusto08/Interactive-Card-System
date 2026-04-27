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

  playCard: ({
    roomId,
    cardId,
    targetUserId,
    selectedExileCardId,
    pairedCardId,
    pairedTargetUserId,
    pairedSelectedExileCardId,
    token,
  }) =>
    request(`/match/${roomId}/play-card`, {
      method: 'POST',
      token,
      body: {
        cardId,
        targetUserId,
        selectedExileCardId,
        pairedCardId,
        pairedTargetUserId,
        pairedSelectedExileCardId,
      },
    }),

  discardCard: ({ roomId, cardId, targetUserId, selectedExileCardId, token }) =>
    request(`/match/${roomId}/discard-card`, {
      method: 'POST',
      token,
      body: { cardId, targetUserId, selectedExileCardId },
    }),

  endTurn: ({ roomId, token }) =>
    request(`/match/${roomId}/end-turn`, {
      method: 'POST',
      token,
    }),
};
