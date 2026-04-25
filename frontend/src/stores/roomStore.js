import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../utils/storageKeys';

export const useRoomStore = create(
  persist(
    (set) => ({
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
    }),
    {
      name: STORAGE_KEYS.room,
    }
  )
);
