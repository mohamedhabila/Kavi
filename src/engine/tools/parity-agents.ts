import { BUILT_IN_PERSONAS, type AgentPersona } from '../../services/agents/personas';
import { getAvailablePersonas, getPersona, isBuiltInPersona } from '../../services/agents/registry';
import { usePersonaConfigStore } from '../../services/agents/store';
import { useChatStore } from '../../store/useChatStore';

export async function executeAgentsList(): Promise<string> {
  const personas = getAvailablePersonas();
  return JSON.stringify({
    agents: personas.map((persona) => ({
      id: persona.id,
      name: persona.name,
      description: persona.description,
      icon: persona.icon,
      custom: !BUILT_IN_PERSONAS.some((entry) => entry.id === persona.id),
    })),
  });
}

export async function executeAgentsSwitch(
  args: {
    personaId: string;
  },
  conversationId?: string,
): Promise<string> {
  const persona = getPersona(args.personaId);
  if (!persona) {
    return `Error: persona not found: ${args.personaId}. Use agents_list to see available personas.`;
  }
  if (conversationId) {
    useChatStore.getState().updatePersonaInConversation(conversationId, args.personaId);
  }
  return JSON.stringify({
    status: 'switched',
    personaId: args.personaId,
    name: persona.name,
  });
}

export async function executeAgentsConfigure(args: {
  personaId: string;
  name?: string;
  description?: string;
  model?: string;
  providerId?: string;
  systemPrompt?: string;
  temperature?: number;
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
}): Promise<string> {
  const persona = getPersona(args.personaId);
  const store = usePersonaConfigStore.getState();

  if (!persona) {
    const created: AgentPersona = {
      id: args.personaId,
      name: args.name || args.personaId,
      description: args.description || args.systemPrompt?.slice(0, 100) || 'Custom agent',
      systemPrompt: args.systemPrompt || 'You are a helpful AI assistant.',
      model: args.model,
      providerId: args.providerId,
      temperature: args.temperature,
      thinkingLevel: args.thinkingLevel,
      icon: '🔧',
    };
    store.upsertCustomPersona(created);
    return JSON.stringify({ status: 'created', persona: { id: created.id, name: created.name } });
  }

  if (isBuiltInPersona(args.personaId)) {
    store.setOverride(args.personaId, {
      ...(args.name ? { name: args.name } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.providerId ? { providerId: args.providerId } : {}),
      ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.thinkingLevel ? { thinkingLevel: args.thinkingLevel } : {}),
    });
  } else {
    store.upsertCustomPersona({
      ...persona,
      ...(args.name ? { name: args.name } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.providerId ? { providerId: args.providerId } : {}),
      ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.thinkingLevel ? { thinkingLevel: args.thinkingLevel } : {}),
    });
  }

  const updated =
    getPersona(args.personaId) ||
    usePersonaConfigStore.getState().customPersonas.find((entry) => entry.id === args.personaId);

  return JSON.stringify({
    status: 'configured',
    persona: { id: args.personaId, name: updated?.name || args.name || args.personaId },
  });
}