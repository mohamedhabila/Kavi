import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AgentPersona } from './personas';

export type PersonaConfigPatch = Partial<
  Pick<
    AgentPersona,
    | 'name'
    | 'description'
    | 'systemPrompt'
    | 'model'
    | 'providerId'
    | 'temperature'
    | 'thinkingLevel'
  >
>;

interface PersonaConfigState {
  overrides: Record<string, PersonaConfigPatch>;
  customPersonas: AgentPersona[];
  setOverride: (personaId: string, patch: PersonaConfigPatch) => void;
  clearOverride: (personaId: string) => void;
  upsertCustomPersona: (persona: AgentPersona) => void;
  removeCustomPersona: (personaId: string) => void;
  reset: () => void;
}

export const usePersonaConfigStore = create<PersonaConfigState>()(
  persist(
    (set) => ({
      overrides: {},
      customPersonas: [],
      setOverride: (personaId, patch) =>
        set((state) => ({
          overrides: {
            ...state.overrides,
            [personaId]: {
              ...state.overrides[personaId],
              ...patch,
            },
          },
        })),
      clearOverride: (personaId) =>
        set((state) => {
          const next = { ...state.overrides };
          delete next[personaId];
          return { overrides: next };
        }),
      upsertCustomPersona: (persona) =>
        set((state) => {
          const existingIndex = state.customPersonas.findIndex((entry) => entry.id === persona.id);
          if (existingIndex >= 0) {
            const next = [...state.customPersonas];
            next[existingIndex] = persona;
            return { customPersonas: next };
          }
          return { customPersonas: [...state.customPersonas, persona] };
        }),
      removeCustomPersona: (personaId) =>
        set((state) => ({
          customPersonas: state.customPersonas.filter((persona) => persona.id !== personaId),
        })),
      reset: () => set({ overrides: {}, customPersonas: [] }),
    }),
    {
      name: 'kavi-persona-config',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
