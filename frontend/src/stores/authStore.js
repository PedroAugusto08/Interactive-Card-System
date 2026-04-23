import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../utils/storageKeys';

// Store de autenticacao com persistencia local.
export const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      // Salva sessao autenticada.
      setAuth: (token, user) =>
        set({
          token,
          user,
          isAuthenticated: true,
        }),

      // Limpa sessao local.
      logout: () =>
        set({
          token: null,
          user: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: STORAGE_KEYS.auth,
    }
  )
);
