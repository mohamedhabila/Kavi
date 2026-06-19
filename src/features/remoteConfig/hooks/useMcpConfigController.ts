import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { createMcpServerDraft, prepareMcpServerDraft } from '../../../screens/configDrafts';
import { normalizeMcpServerConfigMetadata } from '../../../services/mcp/metadata';
import { clearMcpOAuth, hasStoredMcpOAuth } from '../../../services/mcp/oauth';
import {
  deleteMcpOAuthClientSecret,
  deleteSecure,
  getMcpOAuthClientSecret,
  saveMcpOAuthClientSecret,
  saveSecure,
} from '../../../services/storage/SecureStorage';
import type { McpServerConfig } from '../../../types/remote';
import { SharedControllerOptions, confirmDeletion } from './useRemoteConfigControllerShared';

const DEFAULT_MCP_TIMEOUT_MS = 20000;

export function useMcpConfigController(
  options: SharedControllerOptions & {
    onSaved?: (server: McpServerConfig) => void;
    onDeleted?: (id: string) => void;
    requireUrl?: boolean;
  },
) {
  const { settings, t, onSaved, onDeleted } = options;
  const requireUrl = options.requireUrl === true;
  const [draft, setDraft] = useState<McpServerConfig | null>(null);
  const [mcpHeadersText, setMcpHeadersText] = useState('');
  const [mcpTimeoutText, setMcpTimeoutText] = useState(String(DEFAULT_MCP_TIMEOUT_MS));
  const [mcpOauthClientSecret, setMcpOauthClientSecret] = useState('');
  const [hasStoredMcpOauthSession, setHasStoredMcpOauthSession] = useState(false);

  const close = useCallback(() => {
    setDraft(null);
    setMcpHeadersText('');
    setMcpTimeoutText(String(DEFAULT_MCP_TIMEOUT_MS));
    setMcpOauthClientSecret('');
    setHasStoredMcpOauthSession(false);
  }, []);

  const openNew = useCallback((overrides: Partial<McpServerConfig> = {}) => {
    const nextDraft = createMcpServerDraft({
      headers: {},
      timeoutMs: DEFAULT_MCP_TIMEOUT_MS,
      ...overrides,
    });
    setDraft(nextDraft);
    setMcpHeadersText(
      nextDraft.headers && Object.keys(nextDraft.headers).length
        ? JSON.stringify(nextDraft.headers, null, 2)
        : '',
    );
    setMcpTimeoutText(String(nextDraft.timeoutMs || DEFAULT_MCP_TIMEOUT_MS));
    setMcpOauthClientSecret('');
    setHasStoredMcpOauthSession(false);
  }, []);

  const openEdit = useCallback(async (server: McpServerConfig) => {
    const oauthSecret = server.oauth?.clientSecretRef
      ? await getMcpOAuthClientSecret(server.id)
      : '';
    const storedOauthSession = await hasStoredMcpOAuth(server.id);

    setDraft(prepareMcpServerDraft(server, { defaultTimeoutMs: DEFAULT_MCP_TIMEOUT_MS }));
    setMcpHeadersText(server.headers ? JSON.stringify(server.headers, null, 2) : '');
    setMcpTimeoutText(String(server.timeoutMs || DEFAULT_MCP_TIMEOUT_MS));
    setMcpOauthClientSecret(oauthSecret || '');
    setHasStoredMcpOauthSession(storedOauthSession);
  }, []);

  const setMcpToken = useCallback((value: string) => {
    setDraft((current) => (current ? { ...current, token: value } : current));
  }, []);

  const save = useCallback(async () => {
    if (!draft) return null;
    const name = draft.name.trim();
    const url = draft.url.trim();
    const token = draft.token?.trim() || '';
    if (!name) {
      Alert.alert(t('common.error'), t('settings.serverNameRequired'));
      return null;
    }
    if (requireUrl && !url) {
      Alert.alert(t('common.error'), t('settings.serverUrlRequired'));
      return null;
    }

    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
          Alert.alert(t('settings.invalidUrl'), t('settings.invalidMcpUrl'));
          return null;
        }
      } catch {
        Alert.alert(t('settings.invalidUrl'), t('settings.invalidMcpUrlFormat'));
        return null;
      }
    }

    let headers: Record<string, string> | undefined;
    if (mcpHeadersText.trim()) {
      try {
        const parsed = JSON.parse(mcpHeadersText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('invalid');
        }
        headers = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, String(value)]),
        );
      } catch {
        Alert.alert(t('common.error'), t('settings.serverHeadersInvalid'));
        return null;
      }
    }

    const timeoutMs = Number.parseInt(mcpTimeoutText, 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
      Alert.alert(t('common.error'), t('settings.serverTimeoutInvalid'));
      return null;
    }

    const existing = (settings.mcpServers || []).find((server) => server.id === draft.id);
    const tokenRef = `mcp_server_token_${draft.id}`;
    try {
      if (token) {
        await saveSecure(tokenRef, token);
      } else if (!draft.tokenRef) {
        await deleteSecure(tokenRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return null;
    }

    const normalizedServer = normalizeMcpServerConfigMetadata({
      ...draft,
      name,
      url,
      token: undefined,
      headers,
      timeoutMs,
      sseUrl: draft.sseUrl?.trim() || undefined,
      transport: draft.transport || 'auto',
      tokenRef: token ? tokenRef : draft.tokenRef,
      oauth:
        draft.oauth && Object.values(draft.oauth).some(Boolean)
          ? {
              clientId: draft.oauth.clientId?.trim() || undefined,
              clientSecretRef: mcpOauthClientSecret.trim()
                ? `mcp_oauth_client_secret_${draft.id}`
                : undefined,
              authorizationUrl: draft.oauth.authorizationUrl?.trim() || undefined,
              tokenUrl: draft.oauth.tokenUrl?.trim() || undefined,
              scope: draft.oauth.scope?.trim() || undefined,
              projectNameForProxy: draft.oauth.projectNameForProxy?.trim() || undefined,
              tokenEndpointAuthMethod: draft.oauth.tokenEndpointAuthMethod || undefined,
            }
          : undefined,
    });

    if (mcpOauthClientSecret.trim()) {
      await saveMcpOAuthClientSecret(draft.id, mcpOauthClientSecret.trim());
    } else if (existing?.oauth?.clientSecretRef || draft.oauth?.clientSecretRef) {
      await deleteMcpOAuthClientSecret(draft.id);
    }

    if (existing?.oauth && !normalizedServer.oauth) {
      await clearMcpOAuth(draft.id);
    }

    if ((settings.mcpServers || []).some((server) => server.id === normalizedServer.id)) {
      settings.updateMcpServer(normalizedServer);
    } else {
      settings.addMcpServer(normalizedServer);
    }
    onSaved?.(normalizedServer);
    close();
    return normalizedServer;
  }, [
    close,
    draft,
    mcpHeadersText,
    mcpOauthClientSecret,
    mcpTimeoutText,
    onSaved,
    requireUrl,
    settings,
    t,
  ]);

  const remove = useCallback(
    (id: string) => {
      confirmDeletion(
        t,
        'settings.deleteMcpConfirm',
        async () => {
          settings.removeMcpServer(id);
          await deleteSecure(`mcp_server_token_${id}`);
          await deleteMcpOAuthClientSecret(id);
          await clearMcpOAuth(id);
          onDeleted?.(id);
          close();
        },
        'settings.deleteMcpServer',
      );
    },
    [close, onDeleted, settings, t],
  );

  const resetOauthSession = useCallback(() => {
    if (!draft) return;

    Alert.alert(t('settings.mcpResetOAuthSession'), t('settings.mcpResetOAuthSessionConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.mcpResetOAuthSession'),
        style: 'destructive',
        onPress: async () => {
          await clearMcpOAuth(draft.id);
          setHasStoredMcpOauthSession(false);
          Alert.alert(t('settings.mcpResetOAuthSessionSuccess'));
        },
      },
    ]);
  }, [draft, t]);

  const isExisting = Boolean(
    draft && (settings.mcpServers || []).some((server) => server.id === draft.id),
  );

  return {
    draft,
    setDraft,
    mcpToken: draft?.token || '',
    setMcpToken,
    mcpHeadersText,
    setMcpHeadersText,
    mcpTimeoutText,
    setMcpTimeoutText,
    mcpOauthClientSecret,
    setMcpOauthClientSecret,
    hasStoredMcpOauthSession,
    isEditorVisible: Boolean(draft),
    isExisting,
    openNew,
    openEdit,
    close,
    resetOauthSession,
    save,
    remove,
  };
}
