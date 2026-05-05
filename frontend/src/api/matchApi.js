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
    selectedTargetHandCardId,
    pairedCardId,
    pairedTargetUserId,
    pairedSelectedExileCardId,
    pairedSelectedTargetHandCardId,
    token,
  }) =>
    request(`/match/${roomId}/play-card`, {
      method: 'POST',
      token,
      body: {
        cardId,
        targetUserId,
        selectedExileCardId,
        selectedTargetHandCardId,
        pairedCardId,
        pairedTargetUserId,
        pairedSelectedExileCardId,
        pairedSelectedTargetHandCardId,
      },
    }),

  discardCard: ({ roomId, cardId, targetUserId, selectedExileCardId, selectedTargetHandCardId, token }) =>
    request(`/match/${roomId}/discard-card`, {
      method: 'POST',
      token,
      body: { cardId, targetUserId, selectedExileCardId, selectedTargetHandCardId },
    }),

  endTurn: ({ roomId, token }) =>
    request(`/match/${roomId}/end-turn`, {
      method: 'POST',
      token,
    }),
};
