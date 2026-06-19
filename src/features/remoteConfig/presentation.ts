import type {
  BrowserProviderConfig,
  ExpoProjectConfig,
  McpServerConfig,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';

import type { TranslationFn } from './hooks/useRemoteConfigControllerShared';

type RemoteConfigPresentation = {
  getLocalizedWorkspaceProviderLabel: (provider?: WorkspaceTargetConfig['provider']) => string;
  getWorkspaceAuthModeLabel: (authMode?: WorkspaceTargetConfig['authMode']) => string;
  getLocalizedBrowserAuthModeLabel: (authMode?: BrowserProviderConfig['authMode']) => string;
  getLocalizedSshHostKeyPolicyOptionLabel: (policy?: SshTargetConfig['hostKeyPolicy']) => string;
  getLocalizedMcpTransportLabel: (transport?: McpServerConfig['transport']) => string;
  getLocalizedExpoModeLabel: (mode?: ExpoProjectConfig['mode']) => string;
  getMcpMetadataChips: (server: McpServerConfig) => string[];
};

function getMcpStatusTransportLabel(
  t: TranslationFn,
  transport?: McpServerConfig['transport'],
): string {
  switch (transport) {
    case 'streamable-http':
      return t('mcpStatus.transportHttp');
    case 'sse':
      return t('mcpStatus.transportSse');
    default:
      return t('mcpStatus.transportAuto');
  }
}

function getMcpAuthLabel(t: TranslationFn, server: McpServerConfig): string {
  switch (server.capabilities?.authMode || 'none') {
    case 'oauth':
      return t('mcpStatus.oauthConnected');
    case 'header':
      return t('mcpStatus.headerAuth');
    case 'variable':
      return t('mcpStatus.variableAuth');
    case 'mixed':
      return t('mcpStatus.mixedAuth');
    default:
      return t('mcpStatus.noAuth');
  }
}

export function createRemoteConfigPresentation(t: TranslationFn): RemoteConfigPresentation {
  return {
    getLocalizedWorkspaceProviderLabel(provider) {
      switch (provider || 'code-server') {
        case 'vscode-web':
          return 'VS Code Web';
        case 'vscode-tunnel':
          return 'VS Code Tunnel';
        case 'cursor':
          return 'Cursor';
        case 'windsurf':
          return 'Windsurf';
        case 'antigravity':
          return 'Antigravity';
        case 'generic-vscode':
          return 'Generic VS Code IDE';
        case 'openvscode-server':
          return t('remoteWork.providerOpenVSCode');
        case 'custom':
          return t('remoteWork.providerCustom');
        case 'code-server':
        default:
          return t('remoteWork.providerCodeServer');
      }
    },
    getWorkspaceAuthModeLabel(authMode) {
      switch (authMode || 'none') {
        case 'bearer':
          return t('settings.workspaceAuthBearer');
        case 'query-token':
          return t('settings.workspaceAuthQueryToken');
        case 'none':
        default:
          return t('settings.workspaceAuthNone');
      }
    },
    getLocalizedBrowserAuthModeLabel(authMode) {
      switch (authMode || 'api-key-header') {
        case 'bearer':
          return t('settings.workspaceAuthBearer');
        case 'query-token':
          return t('settings.workspaceAuthQueryToken');
        case 'none':
          return t('settings.workspaceAuthNone');
        case 'api-key-header':
        default:
          return t('settings.browserAuthApiKeyHeader');
      }
    },
    getLocalizedSshHostKeyPolicyOptionLabel(policy) {
      return (policy || 'trust-on-first-use') === 'strict'
        ? t('settings.sshHostKeyPolicyStrict')
        : t('settings.sshHostKeyPolicyTofu');
    },
    getLocalizedMcpTransportLabel(transport) {
      switch (transport || 'auto') {
        case 'streamable-http':
          return t('settings.serverTransportHttp');
        case 'sse':
          return t('settings.serverTransportSse');
        case 'auto':
        default:
          return t('settings.serverTransportAuto');
      }
    },
    getLocalizedExpoModeLabel(mode) {
      switch (mode || 'eas-workflow') {
        case 'direct-ssh':
          return t('settings.expoExecutionModeDirectSsh');
        case 'github-workflow':
          return t('settings.expoExecutionModeGithubWorkflow');
        case 'eas-workflow':
        default:
          return t('settings.expoExecutionModeEasWorkflow');
      }
    },
    getMcpMetadataChips(server) {
      const chips = [
        server.trust?.source === 'official-registry'
          ? t('mcpStatus.officialRegistry')
          : t('mcpStatus.manualServer'),
        getMcpStatusTransportLabel(t, server.capabilities?.transport || server.transport),
        getMcpAuthLabel(t, server),
      ];

      if (server.capabilities?.requiresConfiguration) {
        chips.push(t('mcpStatus.configurationRequired'));
      }
      if (server.capabilities?.requiresSecrets) {
        chips.push(t('mcpStatus.secretsRequired'));
      }

      return chips;
    },
  };
}
