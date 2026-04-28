import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../utils/storageKeys';

// Store de autenticacao com persistencia local.
export const useAuthStore = create(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      // Salva sessao autenticada.
      setAuth: (token, user) =>
        set(() => {
          const previousUser = get().user;
          const isSameUser =
            previousUser &&
            user &&
            ((previousUser.id && user.id && previousUser.id === user.id) ||
              (previousUser.email && user.email && previousUser.email === user.email));

          return {
            token,
            user:
              isSameUser && previousUser?.profileImage && !user?.profileImage
                ? {
                    ...user,
                    profileImage: previousUser.profileImage,
                  }
                : user,
            isAuthenticated: true,
          };
        }),

      // Atualiza parcialmente os dados do usuario na sessao local.
      updateUser: (nextUserFields) =>
        set((state) => ({
          user: state.user
            ? {
                ...state.user,
                ...nextUserFields,
              }
            : state.user,
        })),

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
