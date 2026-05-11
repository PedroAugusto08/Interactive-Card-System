import { request } from './httpClient';

export const matchApi = {
  getSnapshot: ({ roomId, token }) => request(`/match/${roomId}`, { token }),

  start: ({ roomId, token }) =>
    request(`/match/${roomId}/start`, {
      method: 'POST',
      token,
    }),

  draw: ({ roomId, actingParticipantId, token }) =>
    request(`/match/${roomId}/draw`, {
      method: 'POST',
      token,
      body: { actingParticipantId },
    }),

  playCard: ({
    roomId,
    actingParticipantId,
    cardId,
    targetParticipantId,
    selectedExileCardId,
    selectedOwnHandCardId,
    selectedTargetHandCardId,
    pairedCardId,
    pairedTargetParticipantId,
    pairedSelectedExileCardId,
    pairedSelectedOwnHandCardId,
    pairedSelectedTargetHandCardId,
    asCounterResponse,
    token,
  }) =>
    request(`/match/${roomId}/play-card`, {
      method: 'POST',
      token,
      body: {
        actingParticipantId,
        cardId,
        targetParticipantId,
        selectedExileCardId,
        selectedOwnHandCardId,
        selectedTargetHandCardId,
        pairedCardId,
        pairedTargetParticipantId,
        pairedSelectedExileCardId,
        pairedSelectedOwnHandCardId,
        pairedSelectedTargetHandCardId,
        asCounterResponse,
      },
    }),

  discardCard: ({
    roomId,
    actingParticipantId,
    cardId,
    targetParticipantId,
    selectedExileCardId,
    selectedOwnHandCardId,
    selectedTargetHandCardId,
    asCounterResponse,
    token,
  }) =>
    request(`/match/${roomId}/discard-card`, {
      method: 'POST',
      token,
      body: {
        actingParticipantId,
        cardId,
        targetParticipantId,
        selectedExileCardId,
        selectedOwnHandCardId,
        selectedTargetHandCardId,
        asCounterResponse,
      },
    }),

  reactToAttack: ({ roomId, actingParticipantId, reactionCardId, token }) =>
    request(`/match/${roomId}/react-to-attack`, {
      method: 'POST',
      token,
      body: { actingParticipantId, reactionCardId },
    }),

  resolveAttack: ({ roomId, actingParticipantId, resolution, token }) =>
    request(`/match/${roomId}/resolve-attack`, {
      method: 'POST',
      token,
      body: { actingParticipantId, resolution },
    }),

  revealTopDeck: ({ roomId, actingParticipantId, targetParticipantId, topDeckInstanceId, token }) =>
    request(`/match/${roomId}/reveal-top-deck`, {
      method: 'POST',
      token,
      body: { actingParticipantId, targetParticipantId, topDeckInstanceId },
    }),

  endTurn: ({ roomId, actingParticipantId, token }) =>
    request(`/match/${roomId}/end-turn`, {
      method: 'POST',
      token,
      body: { actingParticipantId },
    }),
};
