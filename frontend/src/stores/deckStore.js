import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { buildDefaultImoForm } from '../utils/imoAutomation';
import { STORAGE_KEYS } from '../utils/storageKeys';

const DEFAULT_SECTION_STATE = {
  fixed: true,
  division: true,
  imo: true,
};

export const useDeckStore = create(
  persist(
    (set) => ({
      rules: null,
      catalog: [],
      decks: [],
      imoCards: [],
      openSections: DEFAULT_SECTION_STATE,
      selectedDeckId: null,
      name: '',
      draftQuantities: {},
      imoForm: buildDefaultImoForm(),
      hasInitializedDraft: false,
      isDraftDirty: false,

      setModuleData: ({ rules, catalog, decks, imoCards }) =>
        set({
          rules: rules || null,
          catalog: catalog || [],
          decks: decks || [],
          imoCards: imoCards || [],
        }),

      setDraftState: ({ selectedDeckId, name, draftQuantities, isDraftDirty = false }) =>
        set({
          selectedDeckId: selectedDeckId ?? null,
          name: name || '',
          draftQuantities: draftQuantities || {},
          hasInitializedDraft: true,
          isDraftDirty,
        }),

      updateDraftName: (name) =>
        set({
          name,
          hasInitializedDraft: true,
          isDraftDirty: true,
        }),

      updateDraftQuantities: (updater) =>
        set((state) => ({
          draftQuantities:
            typeof updater === 'function' ? updater(state.draftQuantities) : updater || {},
          hasInitializedDraft: true,
          isDraftDirty: true,
        })),

      setOpenSections: (updater) =>
        set((state) => ({
          openSections:
            typeof updater === 'function' ? updater(state.openSections) : updater || DEFAULT_SECTION_STATE,
        })),

      setImoForm: (updater) =>
        set((state) => ({
          imoForm: typeof updater === 'function' ? updater(state.imoForm) : updater || buildDefaultImoForm(),
        })),

      resetImoForm: () =>
        set({
          imoForm: buildDefaultImoForm(),
        }),
    }),
    {
      name: STORAGE_KEYS.decks,
    }
  )
);
