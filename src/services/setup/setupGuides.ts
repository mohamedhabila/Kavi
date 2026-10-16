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
import { appBuildingGuide, serverGuide } from './guides/appsAndServers';
import { connectAppGuide, MCP_DIRECTORY, type DirectoryServer } from './guides/connectedApps';
import {
  findRegistryServer,
  searchMcpRegistry,
  type RegistrySearchResult,
} from './mcpRegistrySearch';
import type { SetupGuide, SetupTopic } from './setupGuideTypes';
import { readSetupPages, type SetupResearch } from './setupResearch';

export type SetupState = Readonly<{
  /** Already set up for what the guide unlocks; null when the phone cannot tell. */
  configured: boolean | null;
  /** This phone cannot do what the guide sets up (an Android setting on iOS). */
  unavailable?: true;
  detail: string;
}>;

/** Where a directory service's address came from. */
export type ServerAddress = Readonly<{
  url: string;
  /** registry: read from the vendor's registry entry just now; directory: last seen there. */
  checked: 'registry' | 'directory';
  note?: string;
}>;

export type ResolvedSetupGuide = Readonly<{
  guide: SetupGuide;
  state: SetupState;
  /** The vendors' pages as they read now; absent for guides with no vendor pages. */
  research?: SetupResearch;
  /** For a directory service: its address, as the MCP Registry lists it now. */
  address?: ServerAddress;
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

async function readState(
  topic: SetupTopic,
  option: string | undefined,
  /** For connect_app: every address the chosen service is known by. */
  serverUrls: ReadonlyArray<string>,
): Promise<SetupState> {
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
        return serverUrls.some((url) => connected.has(url))
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

/** The guide for [topic] (and the option the person chose), before anything is read. */
export function setupGuideFor(topic: SetupTopic, option: string | undefined): SetupGuide {
  switch (topic) {
    case 'app_building':
      return appBuildingGuide(option);
    case 'server':
      return serverGuide(option);
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
 * The address the vendor's registry entry lists now: the directory's own when the entry
 * still has it, else the entry's current one (streamable HTTP first). The directory's
 * address stands in only when the registry cannot say.
 */
async function currentServerAddress(server: DirectoryServer): Promise<ServerAddress> {
  const lookup = await findRegistryServer(server.registryName);
  if (lookup.status === 'unavailable') {
    return {
      url: server.url,
      checked: 'directory',
      note: `${lookup.reason} This is the address the registry last listed.`,
    };
  }
  if (lookup.matches.some((match) => match.url === server.url)) {
    return { url: server.url, checked: 'registry' };
  }
  const current =
    lookup.matches.find((match) => match.transport === 'streamable-http') ?? lookup.matches[0];
  return current
    ? { url: current.url, checked: 'registry' }
    : {
        url: server.url,
        checked: 'directory',
        note: `The MCP Registry no longer lists ${server.registryName}; check the vendor's site before connecting.`,
      };
}

/**
 * The guide for [topic], whether it is already set up, the vendors' pages as they read
 * now, and for a service: its current address in the MCP Registry, or what the registry
 * has under that name when the directory does not list it. Everything is read at once and
 * bounded; a page or registry that does not answer leaves the guide answering without it.
 * A guide this phone cannot follow opens no form.
 */
export async function resolveSetupGuide(
  topic: SetupTopic,
  option?: string,
): Promise<ResolvedSetupGuide> {
  const server = topic === 'connect_app' ? findDirectoryServer(option) : undefined;
  const baseGuide = setupGuideFor(topic, option);
  const [address, registry, research] = await Promise.all([
    server ? currentServerAddress(server) : undefined,
    topic === 'connect_app' && option?.trim() && !server ? searchMcpRegistry(option) : undefined,
    baseGuide.pages.length > 0 ? readSetupPages(baseGuide.pages) : undefined,
  ]);
  const state = await readState(
    topic,
    option,
    server ? [...new Set([server.url, address?.url ?? server.url])] : [],
  );
  const fullGuide = server && address ? connectAppGuide(server, address.url) : baseGuide;
  const { form: _form, ...formless } = fullGuide;
  return {
    guide: state.unavailable ? formless : fullGuide,
    state,
    ...(research ? { research } : {}),
    ...(address ? { address } : {}),
    ...(registry ? { registry } : {}),
  };
}
