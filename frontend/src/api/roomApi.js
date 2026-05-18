import { request } from './httpClient';

export const roomApi = {
  createRoom: ({ token }) =>
    request('/rooms', {
      method: 'POST',
      token,
    }),

  joinRoom: ({ code, token }) =>
    request('/rooms/join', {
      method: 'POST',
      token,
      body: { code },
    }),

  leaveRoom: ({ roomId, token }) =>
    request('/rooms/leave', {
      method: 'POST',
      token,
      body: { roomId },
    }),

  getCurrentRoom: ({ token }) => request('/rooms/me/current', { token }),

  listPlayers: ({ roomId, token }) => request(`/rooms/${roomId}/players`, { token }),

  selectCharacter: ({ roomId, characterId, token }) =>
    request(`/rooms/${roomId}/select-character`, {
      method: 'POST',
      token,
      body: { characterId },
    }),

  replaceMasterCharacters: ({ roomId, characterIds, token }) =>
    request(`/rooms/${roomId}/master-characters`, {
      method: 'POST',
      token,
      body: { characterIds },
    }),

  updateTurnOrderDraft: ({ roomId, draftEntryIds, token }) =>
    request(`/rooms/${roomId}/turn-order`, {
      method: 'POST',
      token,
      body: { draftEntryIds },
    }),

  setReady: ({ roomId, isReady, token }) =>
    request(`/rooms/${roomId}/ready`, {
      method: 'POST',
      token,
      body: { isReady },
    }),
};
