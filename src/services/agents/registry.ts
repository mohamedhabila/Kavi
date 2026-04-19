import type { AgentPersona } from './personas';
import { BUILT_IN_PERSONAS } from './personas';
import { usePersonaConfigStore, type PersonaConfigPatch } from './store';

function mergePersona(base: AgentPersona, override?: Partial<AgentPersona>): AgentPersona {
  if (!override) return base;
  return {
    ...base,
    ...override,
  };
}

export function getAvailablePersonasForConfig(
  overrides: Record<string, PersonaConfigPatch>,
  customPersonas: AgentPersona[],
): AgentPersona[] {
  const builtIn = BUILT_IN_PERSONAS.map((persona) => mergePersona(persona, overrides[persona.id]));
  return [...builtIn, ...customPersonas];
}

export function getAvailablePersonas(): AgentPersona[] {
  const { overrides, customPersonas } = usePersonaConfigStore.getState();
  return getAvailablePersonasForConfig(overrides, customPersonas);
}

export function getPersona(personaId: string): AgentPersona | undefined {
  return getAvailablePersonas().find((persona) => persona.id === personaId);
}

export function isBuiltInPersona(personaId: string): boolean {
  return BUILT_IN_PERSONAS.some((persona) => persona.id === personaId);
}
