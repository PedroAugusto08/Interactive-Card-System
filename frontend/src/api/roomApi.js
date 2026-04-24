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

  selectDeck: ({ roomId, deckId, token }) =>
    request(`/rooms/${roomId}/select-deck`, {
      method: 'POST',
      token,
      body: { deckId },
    }),

  setReady: ({ roomId, isReady, token }) =>
    request(`/rooms/${roomId}/ready`, {
      method: 'POST',
      token,
      body: { isReady },
    }),
};
