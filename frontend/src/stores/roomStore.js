import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../utils/storageKeys';

export const useRoomStore = create(
  persist(
    (set) => ({
      currentRoom: null,
      players: [],
      lobbyParticipants: [],
      currentMatch: null,
      viewer: null,
      participantStates: [],
      logs: [],

      setRoomData: ({ room, players, lobbyParticipants }) =>
        set({
          currentRoom: room || null,
          players: players || [],
          lobbyParticipants: lobbyParticipants || [],
        }),

      setMatchData: (snapshot) =>
        set((state) => ({
          currentMatch: snapshot?.match !== undefined ? snapshot.match || null : state.currentMatch,
          viewer: snapshot?.viewer !== undefined ? snapshot.viewer || null : state.viewer,
          participantStates: Array.isArray(snapshot?.participantStates) ? snapshot.participantStates : state.participantStates,
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
          lobbyParticipants: [],
          currentMatch: null,
          viewer: null,
          participantStates: [],
          logs: [],
        }),
    }),
    {
      name: STORAGE_KEYS.room,
    }
  )
);
