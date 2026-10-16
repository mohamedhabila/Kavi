// ---------------------------------------------------------------------------
// Kavi — Guided setup: which guide a request needs, and whether it is already done
// ---------------------------------------------------------------------------

import { getAssistantRoleState } from '../assistant/assistantRole';
import { mcpManager } from '../mcp/manager';
import { getNotificationAccessState } from '../notifications/notificationReader';
import { getSecure } from '../storage/SecureStorage';
import { useSettingsStore } from '../../store/useSettingsStore';
import { getRuntimeToolAvailabilityContext } from '../../engine/tools/runtimeAvailability';
import { BLAND_API_KEY_SECRET } from '../integrations/communication/blandClient';
import { SERVICE_SETUP_FIELDS } from './catalog';
import {
  aiProviderGuide,
  PHONE_CALLS_GUIDE,
  phoneAccessGuide,
  serviceKeyGuide,
} from './guides/accountsAndPhone';
import { APP_BUILDING_GUIDE, SERVER_GUIDE } from './guides/appsAndServers';
import { connectAppGuide, MCP_DIRECTORY, type DirectoryServer } from './guides/connectedApps';
import { searchMcpRegistry, type RegistrySearchResult } from './mcpRegistrySearch';
import type { SetupGuide, SetupTopic } from './setupGuideTypes';

export type SetupState = Readonly<{
  /** Already set up for what the guide unlocks; null when the phone cannot tell. */
  configured: boolean | null;
  /** This phone cannot do what the guide sets up (an Android setting on iOS). */
  unavailable?: true;
  detail: string;
}>;

export type ResolvedSetupGuide = Readonly<{
  guide: SetupGuide;
  state: SetupState;
  /** For a service the directory does not list: what the MCP Registry has. */
  registry?: RegistrySearchResult;
}>;

/** The directory entry an option names, by id or by the service's name in any case. */
function findDirectoryServer(option: string | undefined): DirectoryServer | undefined {
  const wanted = option?.trim().toLowerCase();
  if (!wanted) return undefined;
  return MCP_DIRECTORY.find(
    (server) => server.id === wanted || server.name.toLowerCase() === wanted,
  );
}

async function hasSecret(storageKey: string): Promise<boolean> {
  return Boolean((await getSecure(storageKey))?.trim());
}

function connectedServerUrls(): Set<string> {
  const connected = new Set<string>();
  for (const status of mcpManager.getAllStatuses()) {
    if (status.state !== 'connected') continue;
    const config = useSettingsStore
      .getState()
      .mcpServers?.find((server) => server.id === status.id);
    if (config?.url) connected.add(config.url);
  }
  return connected;
}

async function readState(topic: SetupTopic, option: string | undefined): Promise<SetupState> {
  const availability = getRuntimeToolAvailabilityContext();
  switch (topic) {
    case 'app_building':
      return availability.hasExpoAccounts
        ? { configured: true, detail: 'An Expo account is connected.' }
        : { configured: false, detail: 'No Expo account is connected yet.' };
    case 'server':
      return availability.hasSshTargets
        ? { configured: true, detail: 'An SSH server is set up.' }
        : { configured: false, detail: 'No SSH server is set up yet.' };
    case 'connect_app': {
      const server = findDirectoryServer(option);
      const connected = connectedServerUrls();
      if (server) {
        return connected.has(server.url)
          ? { configured: true, detail: `${server.name} is connected.` }
          : { configured: false, detail: `${server.name} is not connected yet.` };
      }
      return { configured: null, detail: `${connected.size} service(s) are connected.` };
    }
    case 'ai_provider': {
      const providers = useSettingsStore
        .getState()
        .providers.filter((provider) => provider.enabled);
      return {
        configured: providers.length > 0,
        detail: `${providers.length} AI provider(s) are set up.`,
      };
    }
    case 'service_key': {
      const field = SERVICE_SETUP_FIELDS.find((candidate) => candidate.storageKey === option);
      if (!field) return { configured: null, detail: 'Pick a service to check its key.' };
      return (await hasSecret(field.storageKey))
        ? { configured: true, detail: `The ${field.label} is set.` }
        : { configured: false, detail: `The ${field.label} is not set yet.` };
    }
    case 'phone_access': {
      if (option === 'notification_access') {
        const access = await getNotificationAccessState();
        return access === 'unavailable'
          ? {
              configured: null,
              unavailable: true,
              detail: 'This phone does not let apps read notifications (iOS).',
            }
          : {
              configured: access === 'granted',
              detail: `Notification access is ${access.replace('_', ' ')}.`,
            };
      }
      const role = await getAssistantRoleState();
      return role === 'unavailable'
        ? {
            configured: null,
            unavailable: true,
            detail: 'This phone has no assistant role apps can hold (iOS or old Android).',
          }
        : {
            configured: role === 'held',
            detail:
              role === 'held' ? 'Kavi is the phone assistant.' : 'Kavi is not the phone assistant.',
          };
    }
    case 'phone_calls':
      return (await hasSecret(BLAND_API_KEY_SECRET))
        ? { configured: true, detail: 'The Bland API key is set.' }
        : { configured: false, detail: 'The Bland API key is not set yet.' };
  }
}

function guideFor(topic: SetupTopic, option: string | undefined): SetupGuide {
  switch (topic) {
    case 'app_building':
      return APP_BUILDING_GUIDE;
    case 'server':
      return SERVER_GUIDE;
    case 'connect_app':
      return connectAppGuide(findDirectoryServer(option));
    case 'ai_provider':
      return aiProviderGuide(option);
    case 'service_key':
      return serviceKeyGuide(option);
    case 'phone_access':
      return phoneAccessGuide(option);
    case 'phone_calls':
      return PHONE_CALLS_GUIDE;
  }
}

/**
 * The guide for [topic], whether it is already set up, and, for a service the directory
 * does not list, what the MCP Registry has under that name. A guide this phone cannot
 * follow opens no form.
 */
export async function resolveSetupGuide(
  topic: SetupTopic,
  option?: string,
): Promise<ResolvedSetupGuide> {
  const state = await readState(topic, option);
  const fullGuide = guideFor(topic, option);
  const { form: _form, ...formless } = fullGuide;
  const guide = state.unavailable ? formless : fullGuide;
  const registry =
    topic === 'connect_app' && option?.trim() && !findDirectoryServer(option)
      ? await searchMcpRegistry(option)
      : undefined;
  return { guide, state, ...(registry ? { registry } : {}) };
}
