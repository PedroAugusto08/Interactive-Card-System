import { create } from 'zustand';

// Store simples para estado de sala no frontend.
export const useRoomStore = create((set) => ({
  currentRoom: null,
  players: [],

  // Atualiza sala e lista de jogadores de uma vez.
  setRoomData: ({ room, players }) =>
    set({
      currentRoom: room || null,
      players: players || [],
    }),

  // Limpa dados da sala atual.
  clearRoom: () =>
    set({
      currentRoom: null,
      players: [],
    }),
}));
