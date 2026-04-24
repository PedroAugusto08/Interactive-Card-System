import { create } from 'zustand';

export const useRoomStore = create((set) => ({
  currentRoom: null,
  players: [],
  currentMatch: null,
  currentUserState: null,
  logs: [],

  setRoomData: ({ room, players }) =>
    set({
      currentRoom: room || null,
      players: players || [],
    }),

  setMatchData: (snapshot) =>
    set({
      currentMatch: snapshot?.match || null,
      currentUserState: snapshot?.currentUserState || null,
      logs: snapshot?.logs || [],
    }),

  clearRoom: () =>
    set({
      currentRoom: null,
      players: [],
      currentMatch: null,
      currentUserState: null,
      logs: [],
    }),
}));
