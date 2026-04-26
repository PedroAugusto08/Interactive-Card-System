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
        set((state) => ({
          currentMatch: snapshot?.match !== undefined ? snapshot.match || null : state.currentMatch,
          currentUserState:
            snapshot?.currentUserState !== undefined ? snapshot.currentUserState || null : state.currentUserState,
          logs: Array.isArray(snapshot?.logs) ? snapshot.logs : state.logs,
        })),

      appendMatchLog: (logItem) =>
        set((state) => ({
          logs:
            !logItem || state.logs.some((entry) => entry.id && logItem.id && entry.id === logItem.id)
              ? state.logs
              : [logItem, ...state.logs].slice(0, 50),
        })),

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
