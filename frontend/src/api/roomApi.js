import { request } from './httpClient';

// Chamadas HTTP relacionadas a salas.
export const roomApi = {
  createRoom: (token) =>
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

  listPlayers: ({ roomId, token }) => request(`/rooms/${roomId}/players`, { token }),
};
