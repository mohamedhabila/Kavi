import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AgentPersona } from '../../services/agents/personas';
import { getAvailablePersonasForConfig } from '../../services/agents/registry';

type UseSettingsPersonaFlowParams = {
  personaOverrides: Record<string, Partial<AgentPersona>>;
  customPersonas: AgentPersona[];
  setPersonaOverride: (personaId: string, override: Partial<AgentPersona>) => void;
  upsertCustomPersona: (persona: AgentPersona) => void;
};

export function useSettingsPersonaFlow({
  personaOverrides,
  customPersonas,
  setPersonaOverride,
  upsertCustomPersona,
}: UseSettingsPersonaFlowParams) {
  const personas = useMemo(
    () => getAvailablePersonasForConfig(personaOverrides, customPersonas),
    [personaOverrides, customPersonas],
  );
  const [editingPersonaId, setEditingPersonaId] = useState<string>('default');
  const [personaDraft, setPersonaDraft] = useState<Partial<AgentPersona>>({});

  const currentPersona = useMemo(
    () => personas.find((persona) => persona.id === editingPersonaId) || personas[0],
    [editingPersonaId, personas],
  );

  useEffect(() => {
    if (!currentPersona) return;
    setPersonaDraft({
      name: currentPersona.name,
      description: currentPersona.description,
      systemPrompt: currentPersona.systemPrompt,
      model: currentPersona.model,
      providerId: currentPersona.providerId,
      temperature: currentPersona.temperature,
      thinkingLevel: currentPersona.thinkingLevel,
    });
  }, [currentPersona]);

  const handleSavePersona = useCallback(() => {
    if (!currentPersona) return;

    const normalizedDraft: Partial<AgentPersona> = {
      name: personaDraft.name?.trim() || currentPersona.name,
      description: personaDraft.description?.trim() || currentPersona.description,
      systemPrompt: personaDraft.systemPrompt?.trim() || currentPersona.systemPrompt,
      model: personaDraft.model?.trim() || undefined,
      providerId: personaDraft.providerId?.trim() || undefined,
      temperature: personaDraft.temperature,
      thinkingLevel: personaDraft.thinkingLevel,
    };

    if (customPersonas.some((persona) => persona.id === currentPersona.id)) {
      upsertCustomPersona({
        ...currentPersona,
        ...normalizedDraft,
      });
      return;
    }

    setPersonaOverride(currentPersona.id, normalizedDraft);
  }, [currentPersona, customPersonas, personaDraft, setPersonaOverride, upsertCustomPersona]);

  return {
    personas,
    editingPersonaId,
    setEditingPersonaId,
    personaDraft,
    setPersonaDraft,
    currentPersona,
    handleSavePersona,
  };
}
