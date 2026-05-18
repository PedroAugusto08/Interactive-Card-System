import { request } from './httpClient';

export const matchApi = {
  getSnapshot: ({ roomId, token }) => request(`/match/${roomId}`, { token }),

  start: ({ roomId, token }) =>
    request(`/match/${roomId}/start`, {
      method: 'POST',
      token,
    }),

  completeOpeningHand: ({ roomId, actingParticipantId, selectedCardIds, token }) =>
    request(`/match/${roomId}/complete-opening-hand`, {
      method: 'POST',
      token,
      body: { actingParticipantId, selectedCardIds },
    }),

  generateImo: ({ roomId, actingParticipantId, cardId, token }) =>
    request(`/match/${roomId}/generate-imo`, {
      method: 'POST',
      token,
      body: { actingParticipantId, cardId },
    }),

  useImoCard: ({
    roomId,
    actingParticipantId,
    cardId,
    targetParticipantId,
    selectedExiledCardId,
    selectedOwnHandCardId,
    selectedTargetHandCardId,
    token,
  }) =>
    request(`/match/${roomId}/use-imo-card`, {
      method: 'POST',
      token,
      body: {
        actingParticipantId,
        cardId,
        targetParticipantId,
        selectedExiledCardId,
        selectedOwnHandCardId,
        selectedTargetHandCardId,
      },
    }),

  exileImoCard: ({
    roomId,
    actingParticipantId,
    cardId,
    targetParticipantId,
    selectedExiledCardId,
    selectedOwnHandCardId,
    selectedTargetHandCardId,
    token,
  }) =>
    request(`/match/${roomId}/exile-imo-card`, {
      method: 'POST',
      token,
      body: {
        actingParticipantId,
        cardId,
        targetParticipantId,
        selectedExiledCardId,
        selectedOwnHandCardId,
        selectedTargetHandCardId,
      },
    }),

  useDivisionAction: ({
    roomId,
    actingParticipantId,
    divisionId,
    targetParticipantId,
    selectedExiledCardId,
    selectedOwnHandCardId,
    selectedTargetHandCardId,
    token,
  }) =>
    request(`/match/${roomId}/use-division-action`, {
      method: 'POST',
      token,
      body: {
        actingParticipantId,
        divisionId,
        targetParticipantId,
        selectedExiledCardId,
        selectedOwnHandCardId,
        selectedTargetHandCardId,
      },
    }),

  endTurn: ({ roomId, actingParticipantId, token }) =>
    request(`/match/${roomId}/end-turn`, {
      method: 'POST',
      token,
      body: { actingParticipantId },
    }),
};
