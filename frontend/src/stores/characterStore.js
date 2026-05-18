import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { STORAGE_KEYS } from '../utils/storageKeys';

const EMPTY_CATALOG = {
  divisions: [],
  imoCards: [],
};

export const useCharacterStore = create(
  persist(
    (set) => ({
      catalog: EMPTY_CATALOG,
      characters: [],
      imoCards: [],

      setModuleData: ({ catalog, characters, imoCards }) =>
        set({
          catalog: catalog || EMPTY_CATALOG,
          characters: characters || [],
          imoCards: imoCards || [],
        }),
    }),
    {
      name: STORAGE_KEYS.characters,
    }
  )
);
