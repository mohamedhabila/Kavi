import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowLeft,
  CheckCircle2,
  CloudSun,
  Cpu,
  Globe,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  TerminalSquare,
  X,
} from 'lucide-react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppTheme, AppPalette } from '../theme/useAppTheme';
import { useTranslation } from '../i18n';
import { ErrorBoundary } from '../components/ErrorBoundary';
import {
  RemoteWorkBrowserEditorModal,
  RemoteWorkExpoEditorModal,
  RemoteWorkMcpEditorModal,
  RemoteWorkSshEditorModal,
  RemoteWorkWorkspaceEditorModal,
} from './components/remoteWork/RemoteWorkConfigEditors';
import {
  selectRemoteWorkRemoteSlice,
  selectRemoteWorkSettingsSlice,
  selectRemoteWorkSshSlice,
} from './remoteWorkStoreSelectors';
import {
  getBrowserProviderLabel,
  getBrowserProviderReadiness,
  probeBrowserProvider,
  applyBrowserProviderPreset,
  getBrowserProviderAuthHint,
  getBrowserProviderAuthLabel,
  isValidBrowserProviderBaseUrl,
  BROWSER_PROVIDER_AUTH_OPTIONS,
  BROWSER_PROVIDER_OPTIONS,
  BROWSER_PROVIDER_PRESETS,
  type BrowserProviderProbeResult,
} from '../services/browser/providers';
import { launchBrowserLiveSession, stopBrowserLiveSession } from '../services/browser/jobs';
import {
  getWorkspaceProviderLabel,
  getWorkspaceTargetReadiness,
  probeWorkspaceTarget,
  resolveWorkspaceTargetLaunch,
  isValidWorkspaceBaseUrl,
  WORKSPACE_AUTH_MODE_OPTIONS,
  WORKSPACE_PROVIDER_OPTIONS,
  type WorkspaceProbeResult,
} from '../services/workspaces/connector';
import { getWorkspaceTargetControlStatus } from '../services/workspaces/control';
import {
  getWorkspaceTargetDisplayName,
  normalizeWorkspaceTargetLinks,
} from '../services/workspaces/config';
import {
  getSshHostKeyPolicyLabel,
  getSshTargetAuthModeLabel,
  getSshTargetLabel,
  getSshTargetReadiness,
  getSshHostFingerprint,
  SSH_HOST_KEY_POLICY_OPTIONS,
  probeSshTarget,
  type SshProbeResult,
} from '../services/ssh/connector';
import { SSH_AUTH_MODE_OPTIONS } from '../services/ssh/native';
import { useSshSessionStore } from '../services/ssh/sessionStore';
import { TerminalWebViewRef } from '../components/terminal/TerminalWebView';
import { InteractiveTerminalSurface } from '../components/terminal/InteractiveTerminalSurface';
import { mcpManager, type McpServerStatus } from '../services/mcp/manager';
import { buildRemoteCommandCenterSnapshot } from '../services/remote/commandCenter';
import { useRemoteStore } from '../services/remote/store';
import {
  getExpoProjectDisplayOwner,
  getExpoProjectExecutionMode,
  getExpoProjectReadiness,
  getExpoProjectReadinessLabel,
  probeExpoProject,
  runExpoProjectAction,
  syncExpoAccountProjects,
} from '../services/expo/eas';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  McpServerConfig,
  RemoteJobRecord,
  RemoteSessionRecord,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../types';
import { useBackToChat } from '../navigation/useBackToChat';
import { deleteSecure, getSecure, saveSecure } from '../services/storage/SecureStorage';
import { useSecureDraftValue } from './useSecureDraftValue';
import {
  createBrowserDraft,
  createExpoAccountDraft,
  createExpoProjectDraft,
  createMcpServerDraft,
  createSshDraft,
  createWorkspaceDraft,
  formatPathList,
  getExpoProjectPlatforms,
  parsePathList,
  prepareBrowserDraft,
  prepareExpoAccountDraft,
  prepareExpoProjectDraft,
  prepareMcpServerDraft,
  prepareSshDraft,
  prepareWorkspaceDraft,
  toggleExpoProjectPlatform,
} from './configDrafts';

// Lazy-load WebView to prevent crash when the native module is missing
let WebView: any = null;
try {
  WebView = require('react-native-webview').WebView;
} catch {
  // WebView unavailable — will fall back to placeholder
}

type WorkspaceProbeMap = Record<string, WorkspaceProbeResult | undefined>;
type SshProbeMap = Record<string, SshProbeResult | undefined>;
type BrowserProbeMap = Record<string, BrowserProviderProbeResult | undefined>;
type ExpoProbeMap = Record<string, { ok: boolean; message: string; checkedAt: number } | undefined>;
type PendingMap = Record<string, boolean | undefined>;
type ConfigSurface = 'workspace' | 'ssh' | 'browser' | 'expo' | 'mcp';

const EMPTY_WORKSPACE_TARGETS: WorkspaceTargetConfig[] = [];
const EMPTY_SSH_TARGETS: SshTargetConfig[] = [];
const EMPTY_BROWSER_PROVIDERS: BrowserProviderConfig[] = [];
const EMPTY_MCP_SERVERS: NonNullable<ReturnType<typeof useSettingsStore.getState>['mcpServers']> =
  [];
const EMPTY_EXPO_PROJECTS: ExpoProjectConfig[] = [];
const EMPTY_EXPO_ACCOUNTS: NonNullable<
  ReturnType<typeof useSettingsStore.getState>['expoAccounts']
> = [];
const EMPTY_REMOTE_JOBS_BY_ID: Record<string, RemoteJobRecord> = {};
const EMPTY_REMOTE_SESSIONS_BY_ID: Record<string, RemoteSessionRecord> = {};
const EMPTY_SSH_SESSIONS_BY_ID: Record<
  string,
  ReturnType<typeof useSshSessionStore.getState>['sessions'][string]
> = {};

const RemoteWorkScreenInner: React.FC = () => {
  const navigation = useNavigation();
  const handleBack = useBackToChat();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const isTablet = width >= 900;
  const isWide = width >= 680;
  const summaryColumns = width >= 1040 ? 4 : width >= 760 ? 3 : 2;
  const styles = useMemo(() => createStyles(colors), [colors]);
  const editorModalShellStyles = useMemo(
    () => ({
      container: styles.sessionContainer,
      header: styles.header,
      titleWrap: styles.sessionTitleWrap,
      title: styles.headerTitle,
      subtitle: styles.sessionSubtitle,
      body: styles.content,
    }),
    [styles],
  );

  const settingsSlice = useSettingsStore(useShallow(selectRemoteWorkSettingsSlice));
  const sshStoreSlice = useSshSessionStore(useShallow(selectRemoteWorkSshSlice));
  const remoteStoreSlice = useRemoteStore(useShallow(selectRemoteWorkRemoteSlice));

  const workspaceTargets = settingsSlice.workspaceTargets ?? EMPTY_WORKSPACE_TARGETS;
  const sshTargets = settingsSlice.sshTargets ?? EMPTY_SSH_TARGETS;
  const browserProviders = settingsSlice.browserProviders ?? EMPTY_BROWSER_PROVIDERS;
  const mcpServers = settingsSlice.mcpServers ?? EMPTY_MCP_SERVERS;
  const expoAccounts = settingsSlice.expoAccounts ?? EMPTY_EXPO_ACCOUNTS;
  const expoProjects = settingsSlice.expoProjects ?? EMPTY_EXPO_PROJECTS;
  const addSshTarget = settingsSlice.addSshTarget;
  const updateSshTarget = settingsSlice.updateSshTarget;
  const removeSshTarget = settingsSlice.removeSshTarget;
  const addWorkspaceTarget = settingsSlice.addWorkspaceTarget;
  const updateWorkspaceTarget = settingsSlice.updateWorkspaceTarget;
  const removeWorkspaceTarget = settingsSlice.removeWorkspaceTarget;
  const addBrowserProvider = settingsSlice.addBrowserProvider;
  const updateBrowserProvider = settingsSlice.updateBrowserProvider;
  const removeBrowserProvider = settingsSlice.removeBrowserProvider;
  const addExpoAccount = settingsSlice.addExpoAccount;
  const updateExpoAccount = settingsSlice.updateExpoAccount;
  const removeExpoAccount = settingsSlice.removeExpoAccount;
  const addExpoProject = settingsSlice.addExpoProject;
  const updateExpoProject = settingsSlice.updateExpoProject;
  const removeExpoProject = settingsSlice.removeExpoProject;
  const addMcpServer = settingsSlice.addMcpServer;
  const updateMcpServer = settingsSlice.updateMcpServer;
  const removeMcpServer = settingsSlice.removeMcpServer;
  const sshSessionMap = sshStoreSlice.sessions ?? EMPTY_SSH_SESSIONS_BY_ID;
  const openShellSession = sshStoreSlice.openShellSession;
  const writeShellInput = sshStoreSlice.writeShellInput;
  const closeShellSession = sshStoreSlice.closeShellSession;
  const remoteJobsById = remoteStoreSlice.jobs ?? EMPTY_REMOTE_JOBS_BY_ID;
  const remoteSessionsById = remoteStoreSlice.sessions ?? EMPTY_REMOTE_SESSIONS_BY_ID;

  const sshSessions = useMemo(() => Object.values(sshSessionMap), [sshSessionMap]);
  const remoteJobs = useMemo(() => Object.values(remoteJobsById), [remoteJobsById]);
  const remoteSessions = useMemo(() => Object.values(remoteSessionsById), [remoteSessionsById]);

  const [activeWorkspaceSession, setActiveWorkspaceSession] = useState<null | {
    target: WorkspaceTargetConfig;
    source: { uri: string; headers?: Record<string, string> };
  }>(null);
  const [activeSshSessionId, setActiveSshSessionId] = useState<string | null>(null);
  const [activeBrowserSession, setActiveBrowserSession] = useState<RemoteSessionRecord | null>(
    null,
  );
  const [workspaceProbeResults, setWorkspaceProbeResults] = useState<WorkspaceProbeMap>({});
  const [sshProbeResults, setSshProbeResults] = useState<SshProbeMap>({});
  const [browserProbeResults, setBrowserProbeResults] = useState<BrowserProbeMap>({});
  const [expoProbeResults, setExpoProbeResults] = useState<ExpoProbeMap>({});
  const [pendingWorkspaceChecks, setPendingWorkspaceChecks] = useState<PendingMap>({});
  const [pendingSshChecks, setPendingSshChecks] = useState<PendingMap>({});
  const [pendingBrowserChecks, setPendingBrowserChecks] = useState<PendingMap>({});
  const [pendingExpoChecks, setPendingExpoChecks] = useState<PendingMap>({});
  const [pendingBrowserLaunches, setPendingBrowserLaunches] = useState<PendingMap>({});
  const [pendingExpoActions, setPendingExpoActions] = useState<PendingMap>({});
  const [openingShellTargetId, setOpeningShellTargetId] = useState<string | null>(null);
  const [workspaceSessionError, setWorkspaceSessionError] = useState<string | null>(null);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>(() =>
    mcpManager.getAllStatuses(),
  );
  const [activeConfigSurface, setActiveConfigSurface] = useState<ConfigSurface>('workspace');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [isWorkspaceEditorVisible, setIsWorkspaceEditorVisible] = useState(false);
  const [isSshEditorVisible, setIsSshEditorVisible] = useState(false);
  const [isBrowserEditorVisible, setIsBrowserEditorVisible] = useState(false);
  const [isExpoEditorVisible, setIsExpoEditorVisible] = useState(false);
  const [isMcpEditorVisible, setIsMcpEditorVisible] = useState(false);
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceTargetConfig | null>(null);
  const [workspaceConfigRootsText, setWorkspaceConfigRootsText] = useState('');
  const [workspaceAccessToken, setWorkspaceAccessToken] = useState('');
  const [sshDraft, setSshDraft] = useState<SshTargetConfig | null>(null);
  const [sshPortText, setSshPortText] = useState('22');
  const [sshPassword, setSshPassword] = useState('');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [sshPassphrase, setSshPassphrase] = useState('');
  const [sshFingerprintPending, setSshFingerprintPending] = useState(false);
  const [browserDraft, setBrowserDraft] = useState<BrowserProviderConfig | null>(null);
  const [browserApiKey, setBrowserApiKey] = useState('');
  const [expoAccountDraft, setExpoAccountDraft] = useState<ExpoAccountConfig | null>(null);
  const [expoAccountToken, setExpoAccountToken] = useState('');
  const [expoProjectDraft, setExpoProjectDraft] = useState<ExpoProjectConfig | null>(null);
  const [mcpDraft, setMcpDraft] = useState<McpServerConfig | null>(null);
  const [mcpToken, setMcpToken] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const configStudioY = useRef(0);
  const sshTerminalRef = useRef<TerminalWebViewRef>(null);
  const sshTerminalReadyRef = useRef(false);
  const renderedSshSessionIdRef = useRef<string | null>(null);
  const renderedSshTranscriptRef = useRef('');

  const activeSshSession = activeSshSessionId
    ? sshSessions.find((session) => session.id === activeSshSessionId) || null
    : null;

  useEffect(() => {
    setMcpStatuses(mcpManager.getAllStatuses());
    return mcpManager.subscribe(() => {
      setMcpStatuses(mcpManager.getAllStatuses());
    });
  }, []);

  useSecureDraftValue({
    enabled: isWorkspaceEditorVisible && workspaceDraft?.authMode !== 'none',
    secureRef: workspaceDraft?.accessTokenRef,
    setValue: setWorkspaceAccessToken,
  });

  useSecureDraftValue({
    enabled: isBrowserEditorVisible && browserDraft?.authMode !== 'none',
    secureRef: browserDraft?.apiKeyRef,
    setValue: setBrowserApiKey,
  });

  useSecureDraftValue({
    enabled: Boolean(expoAccountDraft),
    secureRef: expoAccountDraft?.tokenRef,
    setValue: setExpoAccountToken,
  });

  const commandCenter = useMemo(
    () =>
      buildRemoteCommandCenterSnapshot(
        {
          mcpServers,
          sshTargets,
          workspaceTargets,
          browserProviders,
          expoAccounts,
          expoProjects,
        },
        {
          mcpStatuses,
          sshSessions,
          remoteSessions,
          remoteJobs,
        },
      ),
    [
      browserProviders,
      expoAccounts,
      expoProjects,
      mcpServers,
      mcpStatuses,
      remoteJobs,
      remoteSessions,
      sshSessions,
      sshTargets,
      workspaceTargets,
    ],
  );

  const mcpTargets = useMemo(
    () => commandCenter.targets.filter((target) => target.kind === 'mcp-server'),
    [commandCenter.targets],
  );
  const expoTargets = useMemo(
    () => commandCenter.targets.filter((target) => target.kind === 'expo-project'),
    [commandCenter.targets],
  );
  const trackedRemoteSessions = useMemo(
    () => [...remoteSessions].sort((left, right) => right.lastActivityAt - left.lastActivityAt),
    [remoteSessions],
  );
  const trackedRemoteJobs = useMemo(
    () => [...remoteJobs].sort((left, right) => right.updatedAt - left.updatedAt),
    [remoteJobs],
  );
  const workspaceControlStatuses = useMemo(
    () =>
      new Map(
        workspaceTargets.map((target) => [
          target.id,
          getWorkspaceTargetControlStatus(target, { browserProviders, sshTargets }),
        ]),
      ),
    [browserProviders, sshTargets, workspaceTargets],
  );
  const getWorkspaceControlStatus = useCallback(
    (target: WorkspaceTargetConfig) => {
      return (
        workspaceControlStatuses.get(target.id) ||
        getWorkspaceTargetControlStatus(target, { browserProviders, sshTargets })
      );
    },
    [browserProviders, sshTargets, workspaceControlStatuses],
  );
  const isWorkspaceControlReady = useCallback(
    (target: WorkspaceTargetConfig) => {
      const status = getWorkspaceControlStatus(target);
      return (
        status.launchable ||
        status.fileAccessReady ||
        status.browserAutomationReady ||
        status.aiTaskReady
      );
    },
    [getWorkspaceControlStatus],
  );

  const workspaceReadyCount = useMemo(
    () => commandCenter.readyCounts.workspace,
    [commandCenter.readyCounts.workspace],
  );
  const workspaceNeedsSetupCount = useMemo(
    () => Math.max(0, commandCenter.enabledCounts.workspace - commandCenter.readyCounts.workspace),
    [commandCenter.enabledCounts.workspace, commandCenter.readyCounts.workspace],
  );
  const workspaceDisabledCount = useMemo(
    () => workspaceTargets.filter((target) => !target.enabled).length,
    [workspaceTargets],
  );
  const selectedWorkspaceTarget = useMemo(() => {
    if (!workspaceTargets.length) {
      return null;
    }
    return (
      workspaceTargets.find((target) => target.id === selectedWorkspaceId) || workspaceTargets[0]
    );
  }, [selectedWorkspaceId, workspaceTargets]);
  const workspaceEditorIsExisting = useMemo(
    () =>
      Boolean(workspaceDraft && workspaceTargets.some((target) => target.id === workspaceDraft.id)),
    [workspaceDraft, workspaceTargets],
  );
  const sshEditorIsExisting = useMemo(
    () => Boolean(sshDraft && sshTargets.some((target) => target.id === sshDraft.id)),
    [sshDraft, sshTargets],
  );
  const browserEditorIsExisting = useMemo(
    () =>
      Boolean(browserDraft && browserProviders.some((provider) => provider.id === browserDraft.id)),
    [browserDraft, browserProviders],
  );
  const expoAccountEditorIsExisting = useMemo(
    () =>
      Boolean(
        expoAccountDraft && expoAccounts.some((account) => account.id === expoAccountDraft.id),
      ),
    [expoAccountDraft, expoAccounts],
  );
  const expoProjectEditorIsExisting = useMemo(
    () =>
      Boolean(
        expoProjectDraft && expoProjects.some((project) => project.id === expoProjectDraft.id),
      ),
    [expoProjectDraft, expoProjects],
  );
  const mcpEditorIsExisting = useMemo(
    () => Boolean(mcpDraft && mcpServers.some((server) => server.id === mcpDraft.id)),
    [mcpDraft, mcpServers],
  );
  const selectedWorkspaceReadiness = selectedWorkspaceTarget
    ? getWorkspaceTargetReadiness(selectedWorkspaceTarget)
    : null;
  const selectedWorkspaceControlStatus = selectedWorkspaceTarget
    ? getWorkspaceControlStatus(selectedWorkspaceTarget)
    : null;
  const selectedWorkspaceProbe = selectedWorkspaceTarget
    ? workspaceProbeResults[selectedWorkspaceTarget.id]
    : undefined;
  const selectedWorkspaceCheckPending = selectedWorkspaceTarget
    ? Boolean(pendingWorkspaceChecks[selectedWorkspaceTarget.id])
    : false;
  const summaryCardWidth = useMemo(() => {
    const horizontalPadding = 32;
    const gap = 12 * (summaryColumns - 1);
    return Math.max(150, (width - horizontalPadding - gap) / summaryColumns);
  }, [summaryColumns, width]);

  useEffect(() => {
    if (workspaceTargets.length === 0) {
      if (selectedWorkspaceId !== null) {
        setSelectedWorkspaceId(null);
      }
      return;
    }

    if (
      !selectedWorkspaceId ||
      !workspaceTargets.some((target) => target.id === selectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(workspaceTargets[0].id);
    }
  }, [selectedWorkspaceId, workspaceTargets]);

  const getWorkspaceReadinessLabel = useCallback(
    (target: WorkspaceTargetConfig) => {
      const readiness = getWorkspaceTargetReadiness(target);
      const controlStatus = getWorkspaceControlStatus(target);
      if (readiness.reason === 'disabled') {
        return t('remoteWork.disabledTarget');
      }
      if (controlStatus.aiTaskReady && !controlStatus.launchable) {
        return t('remoteWork.workspaceAiHandoffReady');
      }
      if (isWorkspaceControlReady(target)) {
        return t('remoteWork.statusReady');
      }
      switch (readiness.reason) {
        case 'missing-base-url':
          return t('remoteWork.missingConnectionConfig');
        case 'invalid-base-url':
          return t('remoteWork.invalidBaseUrl');
        case 'missing-token':
          return t('remoteWork.missingToken');
        case 'missing-query-token-param':
          return t('remoteWork.missingQueryTokenParam');
        case 'missing-root-path':
        default:
          return t('remoteWork.missingRootPath');
      }
    },
    [getWorkspaceControlStatus, isWorkspaceControlReady, t],
  );

  const getLocalizedWorkspaceProviderLabel = useCallback(
    (provider?: WorkspaceTargetConfig['provider']) => {
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
    [t],
  );

  const getWorkspaceAuthModeLabel = useCallback(
    (authMode?: WorkspaceTargetConfig['authMode']) => {
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
    [t],
  );

  const getWorkspaceBrowserProviderName = useCallback(
    (browserProviderId?: string) => {
      if (!browserProviderId) {
        return t('remoteWork.workspaceBrowserProviderAutoSelect');
      }

      return (
        browserProviders.find((provider) => provider.id === browserProviderId)?.name ||
        t('common.none')
      );
    },
    [browserProviders, t],
  );

  const getWorkspaceSshTargetName = useCallback(
    (sshTargetId?: string) => {
      if (!sshTargetId) {
        return t('common.none');
      }

      return sshTargets.find((target) => target.id === sshTargetId)?.name || t('common.none');
    },
    [sshTargets, t],
  );

  const getWorkspaceAiHandoffSummary = useCallback(
    (target: WorkspaceTargetConfig) => {
      const controlStatus = getWorkspaceControlStatus(target);
      if (target.provider === 'cursor') {
        return controlStatus.aiTaskReady && target.sshTargetId
          ? t('remoteWork.workspaceAiHandoffCursorConnected', {
              targetName: getWorkspaceSshTargetName(target.sshTargetId),
            })
          : t('remoteWork.workspaceAiHandoffCursorNeedsTarget');
      }

      if (target.aiTaskCommandTemplate && controlStatus.aiTaskReady && target.sshTargetId) {
        return t('remoteWork.workspaceAiHandoffCustomConnected', {
          targetName: getWorkspaceSshTargetName(target.sshTargetId),
        });
      }

      return t('remoteWork.notConfigured');
    },
    [getWorkspaceControlStatus, getWorkspaceSshTargetName, t],
  );

  const getLocalizedSshHostKeyPolicyOptionLabel = useCallback(
    (policy?: SshTargetConfig['hostKeyPolicy']) => {
      return (policy || 'trust-on-first-use') === 'strict'
        ? t('settings.sshHostKeyPolicyStrict')
        : t('settings.sshHostKeyPolicyTofu');
    },
    [t],
  );

  const getLocalizedBrowserAuthModeLabel = useCallback(
    (authMode?: BrowserProviderConfig['authMode']) => {
      switch (authMode || 'api-key-header') {
        case 'bearer':
          return t('settings.workspaceAuthBearer');
        case 'query-token':
          return t('settings.workspaceAuthQueryToken');
        case 'none':
          return t('settings.workspaceAuthNone');
        case 'api-key-header':
        default:
          return t('settings.browserApiKey');
      }
    },
    [t],
  );

  const getLocalizedExpoModeLabel = useCallback(
    (mode?: ExpoProjectConfig['mode']) => {
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
    [t],
  );

  const getLocalizedMcpTransportLabel = useCallback(
    (transport?: McpServerConfig['transport']) => {
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
    [t],
  );

  const getSshReadinessLabel = useCallback(
    (target: SshTargetConfig) => {
      const readiness = getSshTargetReadiness(target);
      switch (readiness.reason) {
        case 'disabled':
          return t('remoteWork.disabledTarget');
        case 'platform-unsupported':
          return t('remoteWork.sshUnsupported');
        case 'missing-verified-transport':
          return t('remoteWork.sshVerificationUnavailable');
        case 'missing-host':
          return t('remoteWork.missingSshHost');
        case 'missing-host-fingerprint':
          return t('remoteWork.missingSshFingerprint');
        case 'missing-username':
          return t('remoteWork.missingSshUsername');
        case 'missing-auth-secret':
          return t('remoteWork.missingSshAuth');
        case 'ready':
        default:
          return t('remoteWork.statusReady');
      }
    },
    [t],
  );

  const handleOpenWorkspace = useCallback(
    async (target: WorkspaceTargetConfig) => {
      try {
        const request = await resolveWorkspaceTargetLaunch(target);
        setWorkspaceSessionError(null);
        setActiveWorkspaceSession({
          target,
          source: { uri: request.uri, headers: request.headers },
        });
      } catch (error) {
        const key = error instanceof Error ? error.message : 'unknown-error';
        const message =
          key === 'missing-token'
            ? t('remoteWork.missingToken')
            : key === 'missing-query-token-param'
              ? t('remoteWork.missingQueryTokenParam')
              : key === 'invalid-base-url'
                ? t('remoteWork.invalidBaseUrl')
                : key === 'missing-base-url'
                  ? t('remoteWork.missingConnectionConfig')
                  : key === 'disabled'
                    ? t('remoteWork.disabledTarget')
                    : t('remoteWork.launchFailed');
        Alert.alert(t('common.error'), message);
      }
    },
    [t],
  );

  const handleProbeWorkspace = useCallback(async (target: WorkspaceTargetConfig) => {
    setPendingWorkspaceChecks((current) => ({ ...current, [target.id]: true }));
    const result = await probeWorkspaceTarget(target);
    setWorkspaceProbeResults((current) => ({ ...current, [target.id]: result }));
    setPendingWorkspaceChecks((current) => ({ ...current, [target.id]: false }));
  }, []);

  const handleProbeSsh = useCallback(async (target: SshTargetConfig) => {
    setPendingSshChecks((current) => ({ ...current, [target.id]: true }));
    const result = await probeSshTarget(target);
    setSshProbeResults((current) => ({ ...current, [target.id]: result }));
    setPendingSshChecks((current) => ({ ...current, [target.id]: false }));
  }, []);

  const handleProbeBrowser = useCallback(async (provider: BrowserProviderConfig) => {
    setPendingBrowserChecks((current) => ({ ...current, [provider.id]: true }));
    const result = await probeBrowserProvider(provider);
    setBrowserProbeResults((current) => ({ ...current, [provider.id]: result }));
    setPendingBrowserChecks((current) => ({ ...current, [provider.id]: false }));
  }, []);

  const handleLaunchBrowser = useCallback(
    async (provider: BrowserProviderConfig) => {
      setPendingBrowserLaunches((current) => ({ ...current, [provider.id]: true }));
      try {
        const sessionId = await launchBrowserLiveSession(provider);
        const session = useRemoteStore.getState().sessions[sessionId];
        if (session?.liveViewUrl) {
          setActiveBrowserSession(session);
        }
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('remoteWork.browserLaunchFailed'),
        );
      } finally {
        setPendingBrowserLaunches((current) => ({ ...current, [provider.id]: false }));
      }
    },
    [t],
  );

  const handleProbeExpo = useCallback(async (project: ExpoProjectConfig) => {
    setPendingExpoChecks((current) => ({ ...current, [project.id]: true }));
    const result = await probeExpoProject(project.id);
    setExpoProbeResults((current) => ({ ...current, [project.id]: result }));
    setPendingExpoChecks((current) => ({ ...current, [project.id]: false }));
  }, []);

  const handleRunExpoAction = useCallback(
    async (
      project: ExpoProjectConfig,
      action: 'build' | 'update' | 'submit' | 'deploy-web',
      overrides?: {
        platform?: 'android' | 'ios' | 'all';
      },
    ) => {
      const pendingKey = `${project.id}:${action}`;
      setPendingExpoActions((current) => ({ ...current, [pendingKey]: true }));
      try {
        await runExpoProjectAction(
          project.id,
          action,
          action === 'build'
            ? { platform: overrides?.platform || 'android' }
            : action === 'submit'
              ? { platform: overrides?.platform || 'ios' }
              : action === 'deploy-web'
                ? { alias: 'production' }
                : { message: `Triggered from Remote Work for ${project.name}` },
        );
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('remoteWork.expoActionFailed'),
        );
      } finally {
        setPendingExpoActions((current) => ({ ...current, [pendingKey]: false }));
      }
    },
    [t],
  );

  const handleStopBrowser = useCallback(
    async (session: RemoteSessionRecord) => {
      try {
        await stopBrowserLiveSession(session.id);
        if (activeBrowserSession?.id === session.id) {
          setActiveBrowserSession(null);
        }
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('remoteWork.browserStopFailed'),
        );
      }
    },
    [activeBrowserSession?.id, t],
  );

  const handleOpenShell = useCallback(
    async (target: SshTargetConfig) => {
      setOpeningShellTargetId(target.id);
      try {
        const existingSession = sshSessions.find(
          (session) => session.targetId === target.id && session.status !== 'closed',
        );
        if (existingSession) {
          setActiveSshSessionId(existingSession.id);
          return;
        }
        const sessionId = await openShellSession(target);
        setActiveSshSessionId(sessionId);
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('remoteWork.sshLaunchFailed'),
        );
      } finally {
        setOpeningShellTargetId(null);
      }
    },
    [openShellSession, sshSessions, t],
  );

  const resetSshTerminalSurface = useCallback(() => {
    sshTerminalReadyRef.current = false;
    renderedSshSessionIdRef.current = null;
    renderedSshTranscriptRef.current = '';
  }, []);

  const syncActiveSshTranscript = useCallback(() => {
    if (!sshTerminalReadyRef.current || !activeSshSession) {
      return;
    }

    const terminal = sshTerminalRef.current;
    if (!terminal) {
      return;
    }

    const transcript = activeSshSession.transcript || '';
    if (renderedSshSessionIdRef.current !== activeSshSession.id) {
      terminal.reset();
      renderedSshSessionIdRef.current = activeSshSession.id;
      renderedSshTranscriptRef.current = '';
    }

    const previousTranscript = renderedSshTranscriptRef.current;
    if (transcript === previousTranscript) {
      return;
    }

    if (previousTranscript && transcript.startsWith(previousTranscript)) {
      const delta = transcript.slice(previousTranscript.length);
      if (delta) {
        terminal.write(delta);
      }
    } else {
      terminal.reset();
      if (transcript) {
        terminal.write(transcript);
      }
    }

    renderedSshTranscriptRef.current = transcript;
  }, [activeSshSession]);

  useEffect(() => {
    if (!activeSshSession) {
      resetSshTerminalSurface();
      return;
    }
    syncActiveSshTranscript();
  }, [
    activeSshSession,
    activeSshSession?.id,
    activeSshSession?.transcript,
    resetSshTerminalSurface,
    syncActiveSshTranscript,
  ]);

  const handleSshTerminalReady = useCallback(() => {
    sshTerminalReadyRef.current = true;
    syncActiveSshTranscript();
  }, [syncActiveSshTranscript]);

  const handleSshTerminalInput = useCallback(
    async (data: string) => {
      if (!activeSshSession || activeSshSession.status !== 'connected') {
        return;
      }
      try {
        await writeShellInput(activeSshSession.id, data);
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('remoteWork.sshLaunchFailed'),
        );
      }
    },
    [activeSshSession, t, writeShellInput],
  );

  const handleTerminalLink = useCallback((uri: string) => {
    Linking.openURL(uri).catch((error) => {
      console.warn('[RemoteWorkScreen] Failed to open terminal link:', error);
    });
  }, []);

  const handleCloseSshModal = useCallback(() => {
    resetSshTerminalSurface();
    setActiveSshSessionId(null);
  }, [resetSshTerminalSurface]);

  const getBrowserReadinessLabel = useCallback(
    (provider: BrowserProviderConfig) => {
      const readiness = getBrowserProviderReadiness(provider);
      switch (readiness.reason) {
        case 'disabled':
          return t('remoteWork.disabledTarget');
        case 'missing-base-url':
          return t('remoteWork.missingConnectionConfig');
        case 'invalid-base-url':
          return t('remoteWork.invalidBaseUrl');
        case 'missing-api-key':
          return t('remoteWork.missingToken');
        case 'missing-project-id':
          return t('remoteWork.browserProjectRequired');
        case 'ready':
        default:
          return t('remoteWork.statusReady');
      }
    },
    [t],
  );

  const resetWorkspaceEditor = useCallback(() => {
    setWorkspaceDraft(createWorkspaceDraft());
    setWorkspaceConfigRootsText('');
    setWorkspaceAccessToken('');
  }, []);

  const closeWorkspaceEditor = useCallback(() => {
    setIsWorkspaceEditorVisible(false);
    setWorkspaceDraft(null);
    setWorkspaceConfigRootsText('');
    setWorkspaceAccessToken('');
  }, []);

  const resetSshEditor = useCallback(() => {
    setSshDraft(createSshDraft());
    setSshPortText('22');
    setSshPassword('');
    setSshPrivateKey('');
    setSshPassphrase('');
  }, []);

  const closeSshEditor = useCallback(() => {
    setIsSshEditorVisible(false);
    setSshPassword('');
    setSshPrivateKey('');
    setSshPassphrase('');
  }, []);

  const resetBrowserEditor = useCallback(() => {
    setBrowserDraft(createBrowserDraft());
    setBrowserApiKey('');
  }, []);

  const closeBrowserEditor = useCallback(() => {
    setIsBrowserEditorVisible(false);
    setBrowserApiKey('');
  }, []);

  const handleEditWorkspaceConfig = useCallback((target: WorkspaceTargetConfig) => {
    setActiveConfigSurface('workspace');
    setSelectedWorkspaceId(target.id);
    setWorkspaceDraft(prepareWorkspaceDraft(target));
    setWorkspaceConfigRootsText(formatPathList(target.configRoots));
    setWorkspaceAccessToken('');
    setIsWorkspaceEditorVisible(true);
  }, []);

  const handleEditSshConfig = useCallback((target: SshTargetConfig) => {
    setActiveConfigSurface('ssh');
    setSshDraft(prepareSshDraft(target));
    setSshPortText(String(target.port || 22));
    setSshPassword('');
    setSshPrivateKey('');
    setSshPassphrase('');
    setIsSshEditorVisible(true);
  }, []);

  const handleEditBrowserConfig = useCallback((provider: BrowserProviderConfig) => {
    setActiveConfigSurface('browser');
    setBrowserDraft(prepareBrowserDraft(provider));
    setBrowserApiKey('');
    setIsBrowserEditorVisible(true);
  }, []);

  const handleFetchFingerprint = useCallback(async () => {
    if (!sshDraft) return;
    const host = sshDraft.host.trim();
    const username = sshDraft.username.trim();
    const port = Number.parseInt(sshPortText, 10);
    if (!host) {
      Alert.alert(t('common.error'), t('settings.sshHostRequired'));
      return;
    }
    if (!username) {
      Alert.alert(t('common.error'), t('settings.sshUsernameRequired'));
      return;
    }
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      Alert.alert(t('common.error'), t('settings.sshPortInvalid'));
      return;
    }
    setSshFingerprintPending(true);
    try {
      const fingerprint = await getSshHostFingerprint({ host, username, port });
      setSshDraft((current) =>
        current ? { ...current, trustedHostFingerprint: fingerprint } : current,
      );
    } catch (error) {
      Alert.alert(
        t('common.error'),
        error instanceof Error ? error.message : t('settings.sshFingerprintFetchFailed'),
      );
    } finally {
      setSshFingerprintPending(false);
    }
  }, [sshDraft, sshPortText, t]);

  const handleSaveWorkspaceConfig = useCallback(async () => {
    if (!workspaceDraft) return;
    const rootPath = workspaceDraft.rootPath.trim();
    const baseUrl = (workspaceDraft.baseUrl || '').trim();
    const provider = workspaceDraft.provider || 'code-server';
    const authMode = workspaceDraft.authMode || 'none';
    const queryTokenParam = (workspaceDraft.queryTokenParam || '').trim();
    const accessToken = workspaceAccessToken.trim();

    if (!rootPath) {
      Alert.alert(t('common.error'), t('settings.workspaceRootRequired'));
      return;
    }
    if (baseUrl && !isValidWorkspaceBaseUrl(baseUrl)) {
      Alert.alert(t('common.error'), t('settings.workspaceBaseUrlInvalid'));
      return;
    }
    if (authMode === 'query-token' && baseUrl && !queryTokenParam) {
      Alert.alert(t('common.error'), t('settings.workspaceQueryTokenParamRequired'));
      return;
    }
    if (authMode !== 'none' && !accessToken && !workspaceDraft.accessTokenRef) {
      Alert.alert(t('common.error'), t('settings.workspaceAccessTokenRequired'));
      return;
    }

    const accessTokenRef = `workspace_access_token_${workspaceDraft.id}`;
    try {
      if (authMode !== 'none' && accessToken) {
        await saveSecure(accessTokenRef, accessToken);
      } else if (authMode === 'none') {
        await deleteSecure(accessTokenRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return;
    }

    const normalizedTarget = normalizeWorkspaceTargetLinks(
      {
        ...workspaceDraft,
        name: getWorkspaceTargetDisplayName({
          ...workspaceDraft,
          rootPath,
          provider,
        }),
        rootPath,
        configRoots: parsePathList(workspaceConfigRootsText),
        provider,
        baseUrl,
        authMode,
        accessTokenRef:
          authMode !== 'none' ? workspaceDraft.accessTokenRef || accessTokenRef : undefined,
        queryTokenParam: authMode === 'query-token' ? queryTokenParam : undefined,
        browserProviderId: (workspaceDraft.browserProviderId || '').trim() || undefined,
        sshTargetId: (workspaceDraft.sshTargetId || '').trim() || undefined,
        aiTaskCommandTemplate: (workspaceDraft.aiTaskCommandTemplate || '').trim() || undefined,
      },
      {
        browserProviders,
        sshTargets,
      },
    );

    if (workspaceTargets.find((target) => target.id === normalizedTarget.id)) {
      updateWorkspaceTarget?.(normalizedTarget);
    } else {
      addWorkspaceTarget?.(normalizedTarget);
    }
    setSelectedWorkspaceId(normalizedTarget.id);
    setWorkspaceProbeResults((current) => {
      if (!current[normalizedTarget.id]) {
        return current;
      }
      const next = { ...current };
      delete next[normalizedTarget.id];
      return next;
    });
    closeWorkspaceEditor();
  }, [
    addWorkspaceTarget,
    browserProviders,
    closeWorkspaceEditor,
    sshTargets,
    t,
    updateWorkspaceTarget,
    workspaceAccessToken,
    workspaceConfigRootsText,
    workspaceDraft,
    workspaceTargets,
  ]);

  const handleDeleteWorkspaceConfig = useCallback(
    (id: string) => {
      Alert.alert(t('common.delete'), t('settings.deleteWorkspaceTargetConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            removeWorkspaceTarget?.(id);
            void deleteSecure(`workspace_access_token_${id}`);
            closeWorkspaceEditor();
          },
        },
      ]);
    },
    [closeWorkspaceEditor, removeWorkspaceTarget, t],
  );

  const handleSaveSshConfig = useCallback(async () => {
    if (!sshDraft) return;
    const host = sshDraft.host.trim();
    const username = sshDraft.username.trim();
    const port = Number.parseInt(sshPortText, 10);
    const hostKeyPolicy = sshDraft.hostKeyPolicy || 'trust-on-first-use';
    const trustedHostFingerprint =
      sshDraft.trustedHostFingerprint?.trim().replace(/-/g, ':').toUpperCase() || undefined;
    const authMode = sshDraft.authMode || 'password';
    const password = sshPassword.trim();
    const privateKey = sshPrivateKey.trim();
    const passphrase = sshPassphrase.trim();
    const previousTarget = sshTargets.find((target) => target.id === sshDraft.id);

    if (!host) {
      Alert.alert(t('common.error'), t('settings.sshHostRequired'));
      return;
    }
    if (!username) {
      Alert.alert(t('common.error'), t('settings.sshUsernameRequired'));
      return;
    }
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      Alert.alert(t('common.error'), t('settings.sshPortInvalid'));
      return;
    }
    if (hostKeyPolicy === 'strict' && !trustedHostFingerprint) {
      Alert.alert(t('common.error'), t('settings.sshFingerprintRequired'));
      return;
    }
    if (authMode === 'password' && !password && !sshDraft.passwordRef) {
      Alert.alert(t('common.error'), t('settings.sshPasswordRequired'));
      return;
    }
    if (authMode === 'private-key' && !privateKey && !sshDraft.privateKeyRef) {
      Alert.alert(t('common.error'), t('settings.sshPrivateKeyRequired'));
      return;
    }

    const passwordRef = `ssh_password_${sshDraft.id}`;
    const privateKeyRef = `ssh_private_key_${sshDraft.id}`;
    const passphraseRef = `ssh_passphrase_${sshDraft.id}`;
    try {
      if (authMode === 'password') {
        if (password) await saveSecure(passwordRef, password);
        await deleteSecure(privateKeyRef);
        await deleteSecure(passphraseRef);
      } else {
        if (privateKey) await saveSecure(privateKeyRef, privateKey);
        if (passphrase) {
          await saveSecure(passphraseRef, passphrase);
        } else {
          await deleteSecure(passphraseRef);
        }
        await deleteSecure(passwordRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return;
    }

    const preserveFingerprint =
      !previousTarget ||
      (previousTarget.host.trim() === host && (previousTarget.port || 22) === port) ||
      trustedHostFingerprint !==
        (previousTarget.trustedHostFingerprint?.trim().replace(/-/g, ':').toUpperCase() ||
          undefined);

    const normalizedTarget: SshTargetConfig = {
      ...sshDraft,
      host,
      username,
      port,
      remoteRoot: sshDraft.remoteRoot?.trim() || undefined,
      hostKeyPolicy,
      trustedHostFingerprint: preserveFingerprint ? trustedHostFingerprint : undefined,
      authMode,
      passwordRef: authMode === 'password' ? sshDraft.passwordRef || passwordRef : undefined,
      privateKeyRef:
        authMode === 'private-key' ? sshDraft.privateKeyRef || privateKeyRef : undefined,
      passphraseRef:
        authMode === 'private-key' && (passphrase || sshDraft.passphraseRef)
          ? sshDraft.passphraseRef || passphraseRef
          : undefined,
      ptyType: sshDraft.ptyType || 'xterm',
    };

    if (sshTargets.find((target) => target.id === normalizedTarget.id)) {
      updateSshTarget?.(normalizedTarget);
    } else {
      addSshTarget?.(normalizedTarget);
    }
    closeSshEditor();
  }, [
    addSshTarget,
    closeSshEditor,
    sshDraft,
    sshPassphrase,
    sshPassword,
    sshPortText,
    sshPrivateKey,
    sshTargets,
    t,
    updateSshTarget,
  ]);

  const handleDeleteSshConfig = useCallback(
    (id: string) => {
      Alert.alert(t('common.delete'), t('settings.deleteSshTargetConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            removeSshTarget?.(id);
            await deleteSecure(`ssh_password_${id}`);
            await deleteSecure(`ssh_private_key_${id}`);
            await deleteSecure(`ssh_passphrase_${id}`);
            closeSshEditor();
          },
        },
      ]);
    },
    [closeSshEditor, removeSshTarget, t],
  );

  const handleSaveBrowserConfig = useCallback(async () => {
    if (!browserDraft) return;
    const baseUrl = (browserDraft.baseUrl || '').trim();
    const authMode = browserDraft.authMode || 'api-key-header';
    const provider = browserDraft.provider || 'browserbase';
    const projectId = (browserDraft.projectId || '').trim();
    const queryTokenParam = (browserDraft.queryTokenParam || '').trim();
    const apiKey = browserApiKey.trim();

    if (baseUrl && !isValidBrowserProviderBaseUrl(baseUrl)) {
      Alert.alert(t('common.error'), t('settings.browserBaseUrlInvalid'));
      return;
    }
    if (provider === 'browserbase' && !projectId) {
      Alert.alert(t('common.error'), t('settings.browserProjectRequired'));
      return;
    }
    if (authMode === 'query-token' && !queryTokenParam) {
      Alert.alert(t('common.error'), t('settings.browserQueryTokenParamRequired'));
      return;
    }
    if (authMode !== 'none' && !apiKey && !browserDraft.apiKeyRef) {
      Alert.alert(t('common.error'), t('settings.browserApiKeyRequired'));
      return;
    }

    const apiKeyRef = `browser_provider_api_key_${browserDraft.id}`;
    try {
      if (authMode !== 'none' && apiKey) {
        await saveSecure(apiKeyRef, apiKey);
      } else if (authMode === 'none') {
        await deleteSecure(apiKeyRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return;
    }

    const normalizedProvider: BrowserProviderConfig = {
      ...browserDraft,
      provider,
      baseUrl,
      authMode,
      apiKeyRef: authMode !== 'none' ? browserDraft.apiKeyRef || apiKeyRef : undefined,
      queryTokenParam: authMode === 'query-token' ? queryTokenParam : undefined,
      projectId: provider === 'browserbase' ? projectId : undefined,
    };

    if (browserProviders.find((entry) => entry.id === normalizedProvider.id)) {
      updateBrowserProvider?.(normalizedProvider);
    } else {
      addBrowserProvider?.(normalizedProvider);
    }
    closeBrowserEditor();
  }, [
    addBrowserProvider,
    browserApiKey,
    browserDraft,
    browserProviders,
    closeBrowserEditor,
    t,
    updateBrowserProvider,
  ]);

  const handleDeleteBrowserConfig = useCallback(
    (id: string) => {
      Alert.alert(t('common.delete'), t('settings.deleteBrowserProviderConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            removeBrowserProvider?.(id);
            void deleteSecure(`browser_provider_api_key_${id}`);
            closeBrowserEditor();
          },
        },
      ]);
    },
    [closeBrowserEditor, removeBrowserProvider, t],
  );

  const resetExpoEditor = useCallback(() => {
    const firstAccount = expoAccounts[0];
    setActiveConfigSurface('expo');
    setExpoAccountDraft(
      firstAccount ? prepareExpoAccountDraft(firstAccount) : createExpoAccountDraft(),
    );
    setExpoAccountToken('');
    setExpoProjectDraft(createExpoProjectDraft(firstAccount, sshTargets[0]?.id));
  }, [expoAccounts, sshTargets]);

  const closeExpoEditor = useCallback(() => {
    setIsExpoEditorVisible(false);
    setExpoAccountToken('');
  }, []);

  const handleEditExpoAccount = useCallback((account: ExpoAccountConfig) => {
    setActiveConfigSurface('expo');
    setExpoAccountDraft(prepareExpoAccountDraft(account));
    setExpoAccountToken('');
    setIsExpoEditorVisible(true);
  }, []);

  const handleEditExpoProject = useCallback(
    (project: ExpoProjectConfig) => {
      setActiveConfigSurface('expo');
      setExpoProjectDraft(prepareExpoProjectDraft(project));
      const account = expoAccounts.find((a) => a.id === project.accountId);
      if (account) handleEditExpoAccount(account);
      setIsExpoEditorVisible(true);
    },
    [expoAccounts, handleEditExpoAccount],
  );

  const toggleExpoPlatform = useCallback((platform: 'android' | 'ios' | 'web') => {
    setExpoProjectDraft((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        platforms: toggleExpoProjectPlatform(current.platforms, platform),
      };
    });
  }, []);

  const handleSyncExpoAccount = useCallback(
    async (accountId?: string) => {
      const targetAccountId = accountId || expoAccountDraft?.id || expoAccounts[0]?.id;
      if (!targetAccountId) {
        Alert.alert(t('common.error'), t('settings.expoAccountRequired'));
        return;
      }

      try {
        const result = await syncExpoAccountProjects(targetAccountId);
        const syncedState = useSettingsStore.getState();
        const syncedAccount = syncedState.expoAccounts?.find(
          (account) => account.id === targetAccountId,
        );
        const syncedProjects =
          syncedState.expoProjects?.filter((project) => project.accountId === targetAccountId) ||
          [];
        if (syncedAccount) {
          setExpoAccountDraft(prepareExpoAccountDraft(syncedAccount));
        }
        if (syncedProjects.length > 0) {
          setExpoProjectDraft(prepareExpoProjectDraft(syncedProjects[0]));
        } else if (syncedAccount) {
          setExpoProjectDraft(createExpoProjectDraft(syncedAccount, sshTargets[0]?.id));
        }
        Alert.alert(
          t('settings.expoProjectsSyncedTitle'),
          t('settings.expoProjectsSyncedCount', { count: result.projectCount }),
        );
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : t('settings.expoProjectsSyncFailed'),
        );
      }
    },
    [expoAccountDraft?.id, expoAccounts, sshTargets, t],
  );

  const handleSaveExpoAccount = useCallback(async () => {
    if (!expoAccountDraft) return;
    const owner = expoAccountDraft.owner.trim();
    if (!owner) {
      Alert.alert(t('common.error'), t('settings.expoOwnerRequired'));
      return;
    }

    const tokenRef = `expo_account_token_${expoAccountDraft.id}`;
    try {
      if (expoAccountToken.trim()) {
        await saveSecure(tokenRef, expoAccountToken.trim());
      } else {
        await deleteSecure(tokenRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return;
    }

    const normalizedAccount: ExpoAccountConfig = {
      ...expoAccountDraft,
      name: expoAccountDraft.name.trim() || owner,
      owner,
      accountType: expoAccountDraft.accountType || 'personal',
      tokenRef: expoAccountToken.trim() ? tokenRef : undefined,
    };

    if (expoAccounts.find((a) => a.id === normalizedAccount.id)) {
      updateExpoAccount?.(normalizedAccount);
    } else {
      addExpoAccount?.(normalizedAccount);
    }
    if (normalizedAccount.tokenRef) {
      await handleSyncExpoAccount(normalizedAccount.id);
      closeExpoEditor();
      return;
    }

    closeExpoEditor();
  }, [
    addExpoAccount,
    closeExpoEditor,
    expoAccountDraft,
    expoAccountToken,
    expoAccounts,
    handleSyncExpoAccount,
    t,
    updateExpoAccount,
  ]);

  const handleDeleteExpoAccount = useCallback(
    (id: string) => {
      Alert.alert(t('common.delete'), t('settings.deleteExpoAccountDetachConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            removeExpoAccount?.(id);
            void deleteSecure(`expo_account_token_${id}`);
            closeExpoEditor();
          },
        },
      ]);
    },
    [closeExpoEditor, removeExpoAccount, t],
  );

  const handleSaveExpoProject = useCallback(async () => {
    if (!expoProjectDraft) return;
    const linkedAccount = expoAccounts.find((account) => account.id === expoProjectDraft.accountId);
    if (!linkedAccount) {
      Alert.alert(t('common.error'), t('settings.expoLinkedAccountRequired'));
      return;
    }

    const owner = expoProjectDraft.owner.trim() || linkedAccount.owner.trim();
    const slug = expoProjectDraft.slug.trim();
    if (!owner) {
      Alert.alert(t('common.error'), t('settings.expoProjectOwnerRequired'));
      return;
    }
    if (!slug) {
      Alert.alert(t('common.error'), t('settings.expoProjectSlugRequired'));
      return;
    }
    if (!expoProjectDraft.platforms?.length) {
      Alert.alert(t('common.error'), t('settings.expoTargetPlatformsRequired'));
      return;
    }

    if (expoProjectDraft.mode === 'direct-ssh') {
      if (!expoProjectDraft.sshTargetId) {
        Alert.alert(t('common.error'), t('settings.expoDirectModeMissingSshTarget'));
        return;
      }
      if (!expoProjectDraft.projectPath?.trim()) {
        Alert.alert(t('common.error'), t('settings.expoDirectModeProjectPathRequired'));
        return;
      }
    } else if (expoProjectDraft.mode === 'github-workflow') {
      if (!expoProjectDraft.repoFullName?.trim()) {
        Alert.alert(t('common.error'), t('settings.expoWorkflowRepositoryRequired'));
        return;
      }
      if (!expoProjectDraft.workflowFile?.trim()) {
        Alert.alert(t('common.error'), t('settings.expoWorkflowFileRequired'));
        return;
      }
    }

    const normalizedProject: ExpoProjectConfig = {
      ...expoProjectDraft,
      name: expoProjectDraft.name.trim() || `${owner}/${slug}`,
      slug,
      owner,
      projectPath: expoProjectDraft.projectPath?.trim() || undefined,
      repoFullName: expoProjectDraft.repoFullName?.trim() || undefined,
      workflowFile: expoProjectDraft.workflowFile?.trim() || undefined,
      workflowRef: expoProjectDraft.workflowRef?.trim() || undefined,
      defaultBuildProfile: expoProjectDraft.defaultBuildProfile?.trim() || undefined,
      defaultUpdateBranch: expoProjectDraft.defaultUpdateBranch?.trim() || undefined,
      updateChannel: expoProjectDraft.updateChannel?.trim() || undefined,
      webUrl: expoProjectDraft.webUrl?.trim() || undefined,
      previewUrl: expoProjectDraft.previewUrl?.trim() || undefined,
      customDomain: expoProjectDraft.customDomain?.trim() || undefined,
      platforms: expoProjectDraft.platforms,
    };

    if (expoProjects.find((p) => p.id === normalizedProject.id)) {
      updateExpoProject?.(normalizedProject);
    } else {
      addExpoProject?.(normalizedProject);
    }
    closeExpoEditor();
  }, [
    addExpoProject,
    closeExpoEditor,
    expoAccounts,
    expoProjectDraft,
    expoProjects,
    t,
    updateExpoProject,
  ]);

  const handleDeleteExpoProject = useCallback(
    (id: string) => {
      Alert.alert(t('common.delete'), t('settings.deleteExpoProjectConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            removeExpoProject?.(id);
            closeExpoEditor();
          },
        },
      ]);
    },
    [closeExpoEditor, removeExpoProject, t],
  );

  const resetMcpEditor = useCallback(() => {
    setMcpDraft(createMcpServerDraft());
    setMcpToken('');
  }, []);

  const closeMcpEditor = useCallback(() => {
    setIsMcpEditorVisible(false);
    setMcpToken('');
  }, []);

  const handleEditMcpConfig = useCallback((server: McpServerConfig) => {
    setActiveConfigSurface('mcp');
    setMcpDraft(prepareMcpServerDraft(server));
    setMcpToken('');
    setIsMcpEditorVisible(true);
  }, []);

  const handleSaveMcpConfig = useCallback(async () => {
    if (!mcpDraft) return;
    const name = mcpDraft.name.trim();
    const url = mcpDraft.url.trim();
    const token = mcpToken.trim();
    if (!name) {
      Alert.alert(t('common.error'), t('settings.serverNameRequired'));
      return;
    }
    if (!url) {
      Alert.alert(t('common.error'), t('settings.serverUrlRequired'));
      return;
    }

    const tokenRef = `mcp_server_token_${mcpDraft.id}`;
    try {
      if (token) await saveSecure(tokenRef, token);
      else if (!mcpDraft.tokenRef) await deleteSecure(tokenRef);
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return;
    }

    const normalizedServer: McpServerConfig = {
      ...mcpDraft,
      name,
      url,
      tokenRef: token ? tokenRef : mcpDraft.tokenRef,
    };

    if (mcpServers.find((s) => s.id === normalizedServer.id)) {
      updateMcpServer?.(normalizedServer);
    } else {
      addMcpServer?.(normalizedServer);
    }
    closeMcpEditor();
  }, [addMcpServer, closeMcpEditor, mcpDraft, mcpServers, mcpToken, t, updateMcpServer]);

  const handleDeleteMcpConfig = useCallback(
    (id: string) => {
      Alert.alert(t('common.delete'), t('settings.deleteMcpConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            removeMcpServer?.(id);
            void deleteSecure(`mcp_server_token_${id}`);
            closeMcpEditor();
          },
        },
      ]);
    },
    [closeMcpEditor, removeMcpServer, t],
  );

  const scrollToConfigStudio = useCallback((surface: ConfigSurface) => {
    setActiveConfigSurface(surface);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, configStudioY.current - 12), animated: true });
    }, 50);
  }, []);

  const handleCreateWorkspace = useCallback(() => {
    setActiveConfigSurface('workspace');
    resetWorkspaceEditor();
    setIsWorkspaceEditorVisible(true);
  }, [resetWorkspaceEditor]);

  const handleCreateSsh = useCallback(() => {
    resetSshEditor();
    setIsSshEditorVisible(true);
  }, [resetSshEditor]);

  const handleCreateBrowser = useCallback(() => {
    resetBrowserEditor();
    setIsBrowserEditorVisible(true);
  }, [resetBrowserEditor]);

  const handleCreateExpo = useCallback(() => {
    resetExpoEditor();
    setIsExpoEditorVisible(true);
  }, [resetExpoEditor]);

  const handleCreateMcp = useCallback(() => {
    resetMcpEditor();
    setIsMcpEditorVisible(true);
  }, [resetMcpEditor]);

  useEffect(() => {
    if (!sshDraft) resetSshEditor();
    if (!browserDraft) resetBrowserEditor();
    if (!expoAccountDraft && !expoProjectDraft) resetExpoEditor();
    if (!mcpDraft) resetMcpEditor();
  }, [
    browserDraft,
    expoAccountDraft,
    expoProjectDraft,
    mcpDraft,
    resetBrowserEditor,
    resetExpoEditor,
    resetMcpEditor,
    resetSshEditor,
    sshDraft,
  ]);

  const summaryCards = [
    {
      key: 'workspace',
      title: t('remoteWork.launchableTargets'),
      value: `${commandCenter.readyCounts.workspace}/${commandCenter.enabledCounts.workspace || workspaceTargets.length || 0}`,
      icon: Cpu,
    },
    {
      key: 'ssh',
      title: t('remoteWork.sshSummary'),
      value: `${commandCenter.readyCounts.ssh}/${commandCenter.enabledCounts.ssh || sshTargets.length || 0}`,
      icon: TerminalSquare,
    },
    {
      key: 'mcp',
      title: t('remoteWork.mcpSummary'),
      value: `${commandCenter.readyCounts.mcp}/${commandCenter.enabledCounts.mcp || mcpServers.length || 0}`,
      icon: Server,
    },
    {
      key: 'browser',
      title: t('remoteWork.browserSummary'),
      value: `${commandCenter.readyCounts.browser}/${commandCenter.enabledCounts.browser || browserProviders.length || 0}`,
      icon: ShieldCheck,
    },
    {
      key: 'expo',
      title: t('remoteWork.expoSummary'),
      value: `${commandCenter.readyCounts.expo}/${commandCenter.enabledCounts.expo || expoProjects.length || 0}`,
      icon: CloudSun,
    },
  ];

  const activeConfigSurfaceCard = useMemo(() => {
    switch (activeConfigSurface) {
      case 'ssh':
        return {
          title: t('remoteWork.sshTargetsTitle'),
          hint: t('remoteWork.sshManageHint'),
          value: `${commandCenter.readyCounts.ssh}/${commandCenter.enabledCounts.ssh || sshTargets.length || 0}`,
          actionLabel: t('settings.addSshTarget'),
          onPress: handleCreateSsh,
        };
      case 'browser':
        return {
          title: t('remoteWork.browserTargetsTitle'),
          hint: t('remoteWork.browserManageHint'),
          value: `${commandCenter.readyCounts.browser}/${commandCenter.enabledCounts.browser || browserProviders.length || 0}`,
          actionLabel: t('settings.addBrowserProvider'),
          onPress: handleCreateBrowser,
        };
      case 'expo':
        return {
          title: t('remoteWork.expoTargetsTitle'),
          hint: t('remoteWork.expoManageHint'),
          value: `${commandCenter.readyCounts.expo}/${commandCenter.enabledCounts.expo || expoProjects.length || 0}`,
          actionLabel:
            expoAccounts.length > 0 ? t('settings.addExpoProject') : t('settings.addExpoAccount'),
          onPress: handleCreateExpo,
        };
      case 'mcp':
        return {
          title: t('remoteWork.mcpTargetsTitle'),
          hint: t('remoteWork.mcpManageHint'),
          value: `${commandCenter.readyCounts.mcp}/${commandCenter.enabledCounts.mcp || mcpServers.length || 0}`,
          actionLabel: t('settings.addMcpServer'),
          onPress: handleCreateMcp,
        };
      case 'workspace':
      default:
        return {
          title: t('remoteWork.configuredTargets'),
          hint: t('remoteWork.workspaceManageFromHubHint'),
          value: `${commandCenter.readyCounts.workspace}/${commandCenter.enabledCounts.workspace || workspaceTargets.length || 0}`,
          actionLabel: t('settings.addWorkspaceTarget'),
          onPress: handleCreateWorkspace,
        };
    }
  }, [
    activeConfigSurface,
    browserProviders.length,
    commandCenter.enabledCounts.browser,
    commandCenter.enabledCounts.expo,
    commandCenter.enabledCounts.mcp,
    commandCenter.enabledCounts.ssh,
    commandCenter.enabledCounts.workspace,
    commandCenter.readyCounts.browser,
    commandCenter.readyCounts.expo,
    commandCenter.readyCounts.mcp,
    commandCenter.readyCounts.ssh,
    commandCenter.readyCounts.workspace,
    expoAccounts.length,
    expoProjects.length,
    handleCreateBrowser,
    handleCreateExpo,
    handleCreateMcp,
    handleCreateSsh,
    handleCreateWorkspace,
    mcpServers.length,
    sshTargets.length,
    t,
    workspaceTargets.length,
  ]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('remoteWork.title')}</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings' as never)}
          accessibilityRole="button"
          accessibilityLabel={t('remoteWork.openSettings')}
        >
          <ShieldCheck size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentInner}
      >
        <View style={[styles.infoCard, styles.heroCard, isTablet ? styles.heroCardWide : null]}>
          <View style={styles.heroCopy}>
            <Text style={styles.infoTitle}>{t('remoteWork.summaryTitle')}</Text>
            <Text style={styles.infoText}>{t('remoteWork.summaryHint')}</Text>
          </View>
          <View style={styles.heroStats}>
            <View style={styles.heroStatPill}>
              <Text style={styles.heroStatValue}>
                {commandCenter.readyCounts.workspace +
                  commandCenter.readyCounts.ssh +
                  commandCenter.readyCounts.browser}
              </Text>
              <Text style={styles.heroStatLabel}>{t('remoteWork.launchableSurfacesStat')}</Text>
            </View>
            <View style={styles.heroStatPillMuted}>
              <Text style={styles.heroStatValueMuted}>
                {trackedRemoteSessions.filter((session) => session.status !== 'closed').length}
              </Text>
              <Text style={styles.heroStatLabel}>{t('remoteWork.liveSessionsStat')}</Text>
            </View>
          </View>
        </View>

        <View style={styles.summaryGrid}>
          {summaryCards.map((card) => {
            const Icon = card.icon;
            const selected = activeConfigSurface === card.key;

            return (
              <TouchableOpacity
                key={card.key}
                style={styles.surfaceOverviewCard}
                onPress={() => setActiveConfigSurface(card.key as typeof activeConfigSurface)}
                accessibilityRole="button"
                accessibilityLabel={card.title}
              >
                <View style={styles.surfaceOverviewCopy}>
                  <Text style={styles.targetTitle}>{card.title}</Text>
                  <Text style={styles.targetSubtitle}>{card.value}</Text>
                </View>
                <View style={styles.surfaceOverviewStatPill}>
                  <Icon size={16} color={colors.primary} />
                  <Text style={styles.surfaceOverviewLabel}>
                    {selected ? t('remoteWork.editSettings') : t('remoteWork.openSettings')}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.infoCard}>
          <View style={styles.surfaceOverviewCopy}>
            <Text style={styles.targetTitle}>{activeConfigSurfaceCard.title}</Text>
            <Text style={styles.targetSubtitle}>{activeConfigSurfaceCard.hint}</Text>
          </View>
          <View style={styles.surfaceOverviewStatPill}>
            <Text style={styles.surfaceOverviewValue}>{activeConfigSurfaceCard.value}</Text>
            <Text style={styles.surfaceOverviewLabel}>{t('settings.configured')}</Text>
          </View>
          <View style={styles.configActionRow}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={activeConfigSurfaceCard.onPress}
              accessibilityRole="button"
              accessibilityLabel={activeConfigSurfaceCard.actionLabel}
            >
              <Text style={styles.primaryBtnText}>{activeConfigSurfaceCard.actionLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderText}>
            <Text style={styles.sectionTitle}>{t('remoteWork.configuredTargets')}</Text>
            <Text style={styles.sectionCaption}>{t('remoteWork.workspaceHubHint')}</Text>
          </View>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleCreateWorkspace}
            accessibilityRole="button"
            accessibilityLabel={t('settings.addWorkspaceTarget')}
          >
            <Text style={styles.primaryBtnText}>{t('settings.addWorkspaceTarget')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.workspaceHubCard}>
          <View style={[styles.workspaceHubTopRow, isWide ? styles.workspaceHubTopRowWide : null]}>
            <View style={styles.workspaceHubCopy}>
              <Text style={styles.infoTitle}>{t('remoteWork.configuredTargets')}</Text>
              <Text style={styles.infoText}>
                {workspaceTargets.length === 0
                  ? t('remoteWork.noWorkspaceTargetsHint')
                  : t('remoteWork.workspaceHubHint')}
              </Text>
            </View>
            <View style={styles.workspaceHubStats}>
              <View style={styles.workspaceHubStatCard}>
                <Text style={styles.workspaceHubStatValue}>{workspaceReadyCount}</Text>
                <Text style={styles.workspaceHubStatLabel}>
                  {t('remoteWork.workspaceReadyCount', { count: workspaceReadyCount })}
                </Text>
              </View>
              <View style={styles.workspaceHubStatCard}>
                <Text style={styles.workspaceHubStatValue}>{workspaceNeedsSetupCount}</Text>
                <Text style={styles.workspaceHubStatLabel}>
                  {t('remoteWork.workspaceNeedsSetupCount', { count: workspaceNeedsSetupCount })}
                </Text>
              </View>
              <View style={styles.workspaceHubStatCard}>
                <Text style={styles.workspaceHubStatValue}>{workspaceDisabledCount}</Text>
                <Text style={styles.workspaceHubStatLabel}>
                  {t('remoteWork.workspaceDisabledCount', { count: workspaceDisabledCount })}
                </Text>
              </View>
            </View>
          </View>

          {workspaceTargets.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t('remoteWork.noWorkspaceTargetsTitle')}</Text>
              <Text style={styles.emptyText}>{t('remoteWork.noWorkspaceTargetsHint')}</Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleCreateWorkspace}
                accessibilityRole="button"
                accessibilityLabel={t('settings.addWorkspaceTarget')}
              >
                <Text style={styles.primaryBtnText}>{t('settings.addWorkspaceTarget')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.workspaceSelectorRail}
              >
                {workspaceTargets.map((target) => {
                  const controlReady = isWorkspaceControlReady(target);
                  const selected = target.id === selectedWorkspaceTarget?.id;
                  const probe = workspaceProbeResults[target.id];
                  return (
                    <TouchableOpacity
                      key={target.id}
                      style={[
                        styles.workspaceSelectorCard,
                        selected ? styles.workspaceSelectorCardActive : null,
                      ]}
                      onPress={() => setSelectedWorkspaceId(target.id)}
                      accessibilityRole="button"
                      accessibilityLabel={getWorkspaceTargetDisplayName(target)}
                    >
                      <View style={styles.targetHeader}>
                        <View style={styles.targetHeaderText}>
                          <Text style={styles.targetTitle} numberOfLines={1}>
                            {getWorkspaceTargetDisplayName(target)}
                          </Text>
                          <Text style={styles.targetSubtitle} numberOfLines={1}>
                            {getLocalizedWorkspaceProviderLabel(target.provider)}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.badge,
                            controlReady ? styles.badgeReady : styles.badgeWarn,
                          ]}
                        >
                          <Text
                            style={[
                              styles.badgeText,
                              controlReady ? styles.badgeTextReady : styles.badgeTextWarn,
                            ]}
                            numberOfLines={1}
                          >
                            {getWorkspaceReadinessLabel(target)}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.workspaceSelectorPath} numberOfLines={1}>
                        {target.rootPath || t('remoteWork.missingRootPath')}
                      </Text>
                      <Text style={styles.workspaceSelectorPath} numberOfLines={1}>
                        {target.baseUrl?.trim() || t('remoteWork.notConfigured')}
                      </Text>
                      {probe ? (
                        <View style={styles.probeRow}>
                          <CheckCircle2
                            size={14}
                            color={probe.ok ? colors.success || colors.primary : colors.danger}
                          />
                          <Text
                            style={[
                              styles.probeText,
                              {
                                color: probe.ok ? colors.success || colors.primary : colors.danger,
                              },
                            ]}
                            numberOfLines={1}
                          >
                            {probe.message}
                          </Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {selectedWorkspaceTarget && selectedWorkspaceReadiness ? (
                <View style={styles.workspaceDetailCard}>
                  <View style={styles.targetHeader}>
                    <View style={styles.targetHeaderText}>
                      <Text style={styles.targetTitle}>
                        {getWorkspaceTargetDisplayName(selectedWorkspaceTarget)}
                      </Text>
                      <Text style={styles.targetSubtitle}>
                        {getLocalizedWorkspaceProviderLabel(selectedWorkspaceTarget.provider)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.badge,
                        isWorkspaceControlReady(selectedWorkspaceTarget)
                          ? styles.badgeReady
                          : styles.badgeWarn,
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          isWorkspaceControlReady(selectedWorkspaceTarget)
                            ? styles.badgeTextReady
                            : styles.badgeTextWarn,
                        ]}
                      >
                        {getWorkspaceReadinessLabel(selectedWorkspaceTarget)}
                      </Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.workspaceDetailGrid,
                      isWide ? styles.workspaceDetailGridWide : null,
                    ]}
                  >
                    <View style={styles.workspaceDetailCell}>
                      <Text style={styles.detailLabel}>{t('remoteWork.rootPath')}</Text>
                      <Text style={styles.detailValue}>{selectedWorkspaceTarget.rootPath}</Text>
                    </View>
                    <View style={styles.workspaceDetailCell}>
                      <Text style={styles.detailLabel}>{t('remoteWork.baseUrl')}</Text>
                      <Text style={styles.detailValue}>
                        {selectedWorkspaceTarget.baseUrl?.trim() || t('remoteWork.notConfigured')}
                      </Text>
                    </View>
                    <View style={styles.workspaceDetailCell}>
                      <Text style={styles.detailLabel}>{t('settings.workspaceProvider')}</Text>
                      <Text style={styles.detailValue}>
                        {getLocalizedWorkspaceProviderLabel(selectedWorkspaceTarget.provider)}
                      </Text>
                    </View>
                    <View style={styles.workspaceDetailCell}>
                      <Text style={styles.detailLabel}>{t('settings.workspaceAuthMode')}</Text>
                      <Text style={styles.detailValue}>
                        {getWorkspaceAuthModeLabel(selectedWorkspaceTarget.authMode)}
                      </Text>
                    </View>
                    <View style={styles.workspaceDetailCell}>
                      <Text style={styles.detailLabel}>{t('settings.workspaceConfigRoots')}</Text>
                      <Text style={styles.detailValue}>
                        {t('settings.workspaceConfigRootsCount', {
                          count: selectedWorkspaceTarget.configRoots?.length || 0,
                        })}
                      </Text>
                    </View>
                    <View style={styles.workspaceDetailCell}>
                      <Text style={styles.detailLabel}>
                        {t('remoteWork.workspaceBrowserProvider')}
                      </Text>
                      <Text style={styles.detailValue}>
                        {getWorkspaceBrowserProviderName(selectedWorkspaceTarget.browserProviderId)}
                      </Text>
                    </View>
                    <View style={styles.workspaceDetailCell}>
                      <Text style={styles.detailLabel}>{t('remoteWork.workspaceAiHandoff')}</Text>
                      <Text style={styles.detailValue}>
                        {getWorkspaceAiHandoffSummary(selectedWorkspaceTarget)}
                      </Text>
                    </View>
                    {selectedWorkspaceControlStatus ? (
                      <View style={styles.workspaceDetailCell}>
                        <Text style={styles.detailLabel}>{t('remoteWork.summaryTitle')}</Text>
                        <Text style={styles.detailValue}>
                          {selectedWorkspaceControlStatus.summary}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {selectedWorkspaceCheckPending ? (
                    <View style={styles.probeRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.probeText}>{t('remoteWork.checkingConnection')}</Text>
                    </View>
                  ) : selectedWorkspaceProbe ? (
                    <View style={styles.probeRow}>
                      <CheckCircle2
                        size={14}
                        color={
                          selectedWorkspaceProbe.ok
                            ? colors.success || colors.primary
                            : colors.danger
                        }
                      />
                      <Text
                        style={[
                          styles.probeText,
                          {
                            color: selectedWorkspaceProbe.ok
                              ? colors.success || colors.primary
                              : colors.danger,
                          },
                        ]}
                      >
                        {selectedWorkspaceProbe.message}
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[
                        styles.primaryBtn,
                        !selectedWorkspaceReadiness.launchable && styles.disabledBtn,
                      ]}
                      onPress={() => void handleOpenWorkspace(selectedWorkspaceTarget)}
                      disabled={!selectedWorkspaceReadiness.launchable}
                      accessibilityRole="button"
                      accessibilityLabel={t('remoteWork.launchWorkspace')}
                    >
                      <Text style={styles.primaryBtnText}>{t('remoteWork.launchWorkspace')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => void handleProbeWorkspace(selectedWorkspaceTarget)}
                      accessibilityRole="button"
                      accessibilityLabel={t('remoteWork.checkConnection')}
                    >
                      {selectedWorkspaceCheckPending ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <RefreshCw size={16} color={colors.primary} />
                      )}
                      <Text style={styles.secondaryBtnText}>
                        {selectedWorkspaceCheckPending
                          ? t('remoteWork.checkingConnection')
                          : t('remoteWork.checkConnection')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => handleEditWorkspaceConfig(selectedWorkspaceTarget)}
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.editWorkspaceTarget')}
                    >
                      <Text style={styles.secondaryBtnText}>{t('common.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('remoteWork.mcpTargetsTitle')}</Text>
          <Text
            style={styles.sectionCaption}
          >{`${mcpTargets.filter((target) => target.readiness === 'ready').length}/${mcpTargets.filter((target) => target.readiness !== 'disabled').length || mcpTargets.length || 0}`}</Text>
        </View>

        {mcpTargets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('remoteWork.noMcpTargetsTitle')}</Text>
            <Text style={styles.emptyText}>{t('remoteWork.noMcpTargetsHint')}</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleCreateMcp}
              accessibilityRole="button"
              accessibilityLabel={t('settings.addMcpServer')}
            >
              <Text style={styles.primaryBtnText}>{t('settings.addMcpServer')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {mcpTargets.map((target) => (
          <View key={target.id} style={styles.targetCard}>
            <View style={styles.targetHeader}>
              <View style={styles.targetHeaderText}>
                <Text style={styles.targetTitle}>{target.name}</Text>
                <Text style={styles.targetSubtitle}>{target.detail}</Text>
              </View>
              <View
                style={[
                  styles.badge,
                  target.readiness === 'ready' ? styles.badgeReady : styles.badgeWarn,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    target.readiness === 'ready' ? styles.badgeTextReady : styles.badgeTextWarn,
                  ]}
                >
                  {target.statusLabel}
                </Text>
              </View>
            </View>

            {target.activitySummary ? (
              <Text style={styles.detailValue}>{target.activitySummary}</Text>
            ) : null}
            {target.error ? <Text style={styles.sessionError}>{target.error}</Text> : null}

            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  const server = mcpServers.find((s) => s.id === target.id);
                  if (server) handleEditMcpConfig(server);
                }}
                accessibilityRole="button"
                accessibilityLabel={t('settings.editMcpServer')}
              >
                <Text style={styles.secondaryBtnText}>{t('common.edit')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('remoteWork.sshTargetsTitle')}</Text>
          <Text style={styles.sectionCaption}>
            {t('remoteWork.activeSshSessions', {
              count: sshSessions.filter((session) => session.status === 'connected').length,
            })}
          </Text>
        </View>

        {sshTargets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('remoteWork.noSshTargetsTitle')}</Text>
            <Text style={styles.emptyText}>{t('remoteWork.noSshTargetsHint')}</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleCreateSsh}
              accessibilityRole="button"
              accessibilityLabel={t('settings.addSshTarget')}
            >
              <Text style={styles.primaryBtnText}>{t('settings.addSshTarget')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {sshTargets.map((target) => {
          const readiness = getSshTargetReadiness(target);
          const probe = sshProbeResults[target.id];
          const pending = Boolean(pendingSshChecks[target.id]);
          const existingSession = sshSessions.find(
            (session) => session.targetId === target.id && session.status !== 'closed',
          );
          const opening = openingShellTargetId === target.id;
          return (
            <View key={target.id} style={styles.targetCard}>
              <View style={styles.targetHeader}>
                <View style={styles.targetHeaderText}>
                  <Text style={styles.targetTitle}>{target.name}</Text>
                  <Text style={styles.targetSubtitle}>{getSshTargetLabel(target)}</Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    readiness.launchable ? styles.badgeReady : styles.badgeWarn,
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      readiness.launchable ? styles.badgeTextReady : styles.badgeTextWarn,
                    ]}
                  >
                    {getSshReadinessLabel(target)}
                  </Text>
                </View>
              </View>

              <Text style={styles.detailLabel}>{t('remoteWork.sshAuthMode')}</Text>
              <Text style={styles.detailValue}>
                {getSshTargetAuthModeLabel(target)} · {getSshHostKeyPolicyLabel(target)}
              </Text>

              {target.trustedHostFingerprint ? (
                <>
                  <Text style={styles.detailLabel}>{t('remoteWork.sshTrustedFingerprint')}</Text>
                  <Text style={styles.detailValue}>{target.trustedHostFingerprint}</Text>
                </>
              ) : null}

              {target.remoteRoot ? (
                <>
                  <Text style={styles.detailLabel}>{t('remoteWork.rootPath')}</Text>
                  <Text style={styles.detailValue}>{target.remoteRoot}</Text>
                </>
              ) : null}

              {probe ? (
                <View style={styles.probeRow}>
                  <CheckCircle2
                    size={14}
                    color={probe.ok ? colors.success || colors.primary : colors.danger}
                  />
                  <Text
                    style={[
                      styles.probeText,
                      { color: probe.ok ? colors.success || colors.primary : colors.danger },
                    ]}
                  >
                    {probe.message}
                  </Text>
                </View>
              ) : null}

              {existingSession ? (
                <Text style={styles.sessionHint}>{t('remoteWork.resumeShellHint')}</Text>
              ) : null}

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, !readiness.launchable && styles.disabledBtn]}
                  onPress={() => void handleOpenShell(target)}
                  disabled={!readiness.launchable || opening}
                  accessibilityRole="button"
                  accessibilityLabel={
                    existingSession ? t('remoteWork.resumeShell') : t('remoteWork.openShell')
                  }
                >
                  {opening ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Play size={14} color={colors.onPrimary} />
                  )}
                  <Text style={styles.primaryBtnText}>
                    {existingSession ? t('remoteWork.resumeShell') : t('remoteWork.openShell')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => void handleProbeSsh(target)}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.checkConnection')}
                >
                  {pending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <RefreshCw size={16} color={colors.primary} />
                  )}
                  <Text style={styles.secondaryBtnText}>
                    {pending ? t('remoteWork.checkingConnection') : t('remoteWork.checkConnection')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => handleEditSshConfig(target)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.editSshTarget')}
                >
                  <Text style={styles.secondaryBtnText}>{t('common.edit')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('remoteWork.browserTargetsTitle')}</Text>
          <Text style={styles.sectionCaption}>
            {t('remoteWork.configuredCount', {
              count: browserProviders.filter((provider) => provider.enabled).length,
            })}
          </Text>
        </View>

        {browserProviders.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('remoteWork.noBrowserTargetsTitle')}</Text>
            <Text style={styles.emptyText}>{t('remoteWork.noBrowserTargetsHint')}</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleCreateBrowser}
              accessibilityRole="button"
              accessibilityLabel={t('settings.addBrowserProvider')}
            >
              <Text style={styles.primaryBtnText}>{t('settings.addBrowserProvider')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {browserProviders.map((provider) => {
          const readiness = getBrowserProviderReadiness(provider);
          const probe = browserProbeResults[provider.id];
          const pending = Boolean(pendingBrowserChecks[provider.id]);
          const launching = Boolean(pendingBrowserLaunches[provider.id]);
          const activeBrowserProviderSession = trackedRemoteSessions.find(
            (session) =>
              session.providerId === provider.id &&
              session.kind === 'browser-live' &&
              session.status !== 'closed',
          );
          return (
            <View key={provider.id} style={styles.targetCard}>
              <View style={styles.targetHeader}>
                <View style={styles.targetHeaderText}>
                  <Text style={styles.targetTitle}>{provider.name}</Text>
                  <Text style={styles.targetSubtitle}>
                    {getBrowserProviderLabel(provider.provider)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    readiness.launchable ? styles.badgeReady : styles.badgeWarn,
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      readiness.launchable ? styles.badgeTextReady : styles.badgeTextWarn,
                    ]}
                  >
                    {getBrowserReadinessLabel(provider)}
                  </Text>
                </View>
              </View>

              <Text style={styles.detailLabel}>{t('remoteWork.baseUrl')}</Text>
              <Text style={styles.detailValue}>
                {provider.baseUrl?.trim() || t('remoteWork.notConfigured')}
              </Text>

              {provider.projectId ? (
                <>
                  <Text style={styles.detailLabel}>{t('remoteWork.browserProjectId')}</Text>
                  <Text style={styles.detailValue}>{provider.projectId}</Text>
                </>
              ) : null}

              {probe ? (
                <View style={styles.probeRow}>
                  <CheckCircle2
                    size={14}
                    color={probe.ok ? colors.success || colors.primary : colors.danger}
                  />
                  <Text
                    style={[
                      styles.probeText,
                      { color: probe.ok ? colors.success || colors.primary : colors.danger },
                    ]}
                  >
                    {probe.message}
                  </Text>
                </View>
              ) : null}

              {activeBrowserProviderSession ? (
                <Text style={styles.sessionHint}>{activeBrowserProviderSession.summary}</Text>
              ) : null}

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, !readiness.launchable && styles.disabledBtn]}
                  onPress={() => void handleLaunchBrowser(provider)}
                  disabled={!readiness.launchable || launching}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.launchBrowserSession')}
                >
                  {launching ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Play size={14} color={colors.onPrimary} />
                  )}
                  <Text style={styles.primaryBtnText}>{t('remoteWork.launchBrowserSession')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => void handleProbeBrowser(provider)}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.checkConnection')}
                >
                  {pending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <RefreshCw size={16} color={colors.primary} />
                  )}
                  <Text style={styles.secondaryBtnText}>
                    {pending ? t('remoteWork.checkingConnection') : t('remoteWork.checkConnection')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => handleEditBrowserConfig(provider)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.editBrowserProvider')}
                >
                  <Text style={styles.secondaryBtnText}>{t('common.edit')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('remoteWork.expoTargetsTitle')}</Text>
          <Text
            style={styles.sectionCaption}
          >{`${expoTargets.filter((target) => target.readiness === 'ready').length}/${expoTargets.filter((target) => target.readiness !== 'disabled').length || expoTargets.length || 0}`}</Text>
        </View>

        {expoProjects.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {expoAccounts.length > 0
                ? t('settings.noExpoProjects')
                : t('settings.noExpoAccounts')}
            </Text>
            <Text style={styles.emptyText}>
              {expoAccounts.length > 0
                ? t('remoteWork.expoEmptyHintWithAccounts')
                : t('remoteWork.expoEmptyHintNoAccounts')}
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleCreateExpo}
              accessibilityRole="button"
              accessibilityLabel={
                expoAccounts.length > 0
                  ? t('remoteWork.syncExpoProjects')
                  : t('remoteWork.linkExpoAccount')
              }
            >
              <Text style={styles.primaryBtnText}>
                {expoAccounts.length > 0
                  ? t('remoteWork.syncExpoProjects')
                  : t('remoteWork.linkExpoAccount')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {expoProjects.map((project) => {
          const account = expoAccounts.find((entry) => entry.id === project.accountId);
          const readiness = getExpoProjectReadiness(project, account, { sshTargets });
          const mode = getExpoProjectExecutionMode(project, account);
          const probe = expoProbeResults[project.id];
          const probing = Boolean(pendingExpoChecks[project.id]);
          const buildPending = Boolean(pendingExpoActions[`${project.id}:build`]);
          const updatePending = Boolean(pendingExpoActions[`${project.id}:update`]);
          const submitPending = Boolean(pendingExpoActions[`${project.id}:submit`]);
          const deployPending = Boolean(pendingExpoActions[`${project.id}:deploy-web`]);
          const supportedPlatforms = getExpoProjectPlatforms(project.platforms);
          const supportsAndroid = supportedPlatforms.includes('android');
          const supportsIos = supportedPlatforms.includes('ios');
          const supportsWeb = supportedPlatforms.includes('web');
          return (
            <View key={project.id} style={styles.targetCard}>
              <View style={styles.targetHeader}>
                <View style={styles.targetHeaderText}>
                  <Text style={styles.targetTitle}>{project.name}</Text>
                  <Text
                    style={styles.targetSubtitle}
                  >{`${getExpoProjectDisplayOwner(project, account)}/${project.slug}`}</Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    readiness.launchable ? styles.badgeReady : styles.badgeWarn,
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      readiness.launchable ? styles.badgeTextReady : styles.badgeTextWarn,
                    ]}
                  >
                    {getExpoProjectReadinessLabel(readiness)}
                  </Text>
                </View>
              </View>

              <Text style={styles.detailLabel}>{t('settings.expoExecutionMode')}</Text>
              <Text style={styles.detailValue}>
                {mode === 'eas-workflow'
                  ? t('settings.expoExecutionModeEasWorkflow')
                  : mode === 'github-workflow'
                    ? t('settings.expoExecutionModeGithubWorkflow')
                    : t('settings.expoExecutionModeDirectSsh')}
              </Text>

              <Text style={styles.detailLabel}>{t('settings.expoTargetPlatforms')}</Text>
              <Text style={styles.detailValue}>{supportedPlatforms.join(', ')}</Text>

              {project.webUrl ? (
                <>
                  <Text style={styles.detailLabel}>{t('settings.expoProductionWebUrl')}</Text>
                  <Text style={styles.detailValue}>{project.webUrl}</Text>
                </>
              ) : null}

              {project.previewUrl ? (
                <>
                  <Text style={styles.detailLabel}>{t('settings.expoPreviewUrl')}</Text>
                  <Text style={styles.detailValue}>{project.previewUrl}</Text>
                </>
              ) : null}

              {project.customDomain ? (
                <>
                  <Text style={styles.detailLabel}>{t('settings.expoCustomDomain')}</Text>
                  <Text style={styles.detailValue}>{project.customDomain}</Text>
                </>
              ) : null}

              {probe ? (
                <View style={styles.probeRow}>
                  <CheckCircle2
                    size={14}
                    color={probe.ok ? colors.success || colors.primary : colors.danger}
                  />
                  <Text
                    style={[
                      styles.probeText,
                      { color: probe.ok ? colors.success || colors.primary : colors.danger },
                    ]}
                  >
                    {probe.message}
                  </Text>
                </View>
              ) : null}

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.primaryBtn, !readiness.launchable && styles.disabledBtn]}
                  onPress={() =>
                    void handleRunExpoAction(project, 'build', { platform: 'android' })
                  }
                  disabled={!readiness.launchable || buildPending || !supportsAndroid}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.expoBuildAndroid')}
                >
                  {buildPending ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <Play size={14} color={colors.onPrimary} />
                  )}
                  <Text style={styles.primaryBtnText}>{t('remoteWork.expoBuildAndroid')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.secondaryBtn,
                    (!readiness.launchable || !supportsIos) && styles.disabledBtn,
                  ]}
                  onPress={() => void handleRunExpoAction(project, 'build', { platform: 'ios' })}
                  disabled={!readiness.launchable || buildPending || !supportsIos}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.expoBuildIos')}
                >
                  {buildPending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Play size={16} color={colors.primary} />
                  )}
                  <Text style={styles.secondaryBtnText}>{t('remoteWork.expoBuildIos')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => void handleProbeExpo(project)}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.expoCheckSetup')}
                >
                  {probing ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <RefreshCw size={16} color={colors.primary} />
                  )}
                  <Text style={styles.secondaryBtnText}>
                    {probing ? t('remoteWork.checkingConnection') : t('remoteWork.expoCheckSetup')}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.secondaryBtn, !readiness.launchable && styles.disabledBtn]}
                  onPress={() => void handleRunExpoAction(project, 'update')}
                  disabled={!readiness.launchable || updatePending}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.expoPublishUpdate')}
                >
                  {updatePending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Globe size={16} color={colors.primary} />
                  )}
                  <Text style={styles.secondaryBtnText}>{t('remoteWork.expoPublishUpdate')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.secondaryBtn,
                    (!readiness.launchable || !supportsIos) && styles.disabledBtn,
                  ]}
                  onPress={() => void handleRunExpoAction(project, 'submit', { platform: 'ios' })}
                  disabled={!readiness.launchable || submitPending || !supportsIos}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.expoSubmitIos')}
                >
                  {submitPending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <CloudSun size={16} color={colors.primary} />
                  )}
                  <Text style={styles.secondaryBtnText}>{t('remoteWork.expoSubmitIos')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.secondaryBtn,
                    (!readiness.launchable || !supportsWeb) && styles.disabledBtn,
                  ]}
                  onPress={() => void handleRunExpoAction(project, 'deploy-web')}
                  disabled={!readiness.launchable || deployPending || !supportsWeb}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.expoDeployWeb')}
                >
                  {deployPending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <CloudSun size={16} color={colors.primary} />
                  )}
                  <Text style={styles.secondaryBtnText}>{t('remoteWork.expoDeployWeb')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => handleEditExpoProject(project)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.editExpoProject')}
                >
                  <Text style={styles.secondaryBtnText}>{t('common.edit')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('remoteWork.sessionsTitle')}</Text>
          <Text style={styles.sectionCaption}>
            {String(trackedRemoteSessions.filter((session) => session.status !== 'closed').length)}
          </Text>
        </View>

        {trackedRemoteSessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('remoteWork.noSessionsTitle')}</Text>
            <Text style={styles.emptyText}>{t('remoteWork.noSessionsHint')}</Text>
          </View>
        ) : (
          trackedRemoteSessions.map((session) => (
            <View key={session.id} style={styles.targetCard}>
              <View style={styles.targetHeader}>
                <View style={styles.targetHeaderText}>
                  <Text style={styles.targetTitle}>{session.summary}</Text>
                  <Text style={styles.targetSubtitle}>{session.kind}</Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    session.status === 'connected' ? styles.badgeReady : styles.badgeWarn,
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      session.status === 'connected' ? styles.badgeTextReady : styles.badgeTextWarn,
                    ]}
                  >
                    {session.status}
                  </Text>
                </View>
              </View>

              {session.liveViewUrl ? (
                <>
                  <Text style={styles.detailLabel}>{t('remoteWork.liveViewUrl')}</Text>
                  <Text style={styles.detailValue}>{session.liveViewUrl}</Text>
                </>
              ) : null}

              {session.error ? <Text style={styles.sessionError}>{session.error}</Text> : null}

              {session.kind === 'browser-live' ? (
                <View style={styles.actionRow}>
                  {session.liveViewUrl ? (
                    <TouchableOpacity
                      style={styles.primaryBtn}
                      onPress={() => setActiveBrowserSession(session)}
                      accessibilityRole="button"
                      accessibilityLabel={t('remoteWork.openLiveView')}
                    >
                      <Text style={styles.primaryBtnText}>{t('remoteWork.openLiveView')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => void handleStopBrowser(session)}
                    accessibilityRole="button"
                    accessibilityLabel={t('remoteWork.stopBrowserSession')}
                  >
                    <Text style={styles.secondaryBtnText}>
                      {t('remoteWork.stopBrowserSession')}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ))
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('remoteWork.jobsTitle')}</Text>
          <Text style={styles.sectionCaption}>
            {String(trackedRemoteJobs.filter((job) => job.status === 'running').length)}
          </Text>
        </View>

        {trackedRemoteJobs.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t('remoteWork.noJobsTitle')}</Text>
            <Text style={styles.emptyText}>{t('remoteWork.noJobsHint')}</Text>
          </View>
        ) : (
          trackedRemoteJobs.map((job: RemoteJobRecord) => (
            <View key={job.id} style={styles.targetCard}>
              <View style={styles.targetHeader}>
                <View style={styles.targetHeaderText}>
                  <Text style={styles.targetTitle}>{job.summary}</Text>
                  <Text style={styles.targetSubtitle}>{job.executionSurface}</Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    job.status === 'completed' ? styles.badgeReady : styles.badgeWarn,
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      job.status === 'completed' ? styles.badgeTextReady : styles.badgeTextWarn,
                    ]}
                  >
                    {job.status}
                  </Text>
                </View>
              </View>
              {job.progressText ? <Text style={styles.detailValue}>{job.progressText}</Text> : null}
              {job.error ? <Text style={styles.sessionError}>{job.error}</Text> : null}
              {job.artifacts.map((artifact) => (
                <View key={artifact.id} style={styles.probeRow}>
                  <CheckCircle2 size={14} color={colors.textSecondary} />
                  <Text style={styles.probeText}>
                    {artifact.uri || artifact.value || artifact.title}
                  </Text>
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <RemoteWorkWorkspaceEditorModal
        visible={isWorkspaceEditorVisible}
        draft={workspaceDraft}
        isExisting={workspaceEditorIsExisting}
        browserProviders={browserProviders}
        sshTargets={sshTargets}
        workspaceAccessToken={workspaceAccessToken}
        workspaceConfigRootsText={workspaceConfigRootsText}
        closeEditor={closeWorkspaceEditor}
        setDraft={setWorkspaceDraft}
        setWorkspaceAccessToken={setWorkspaceAccessToken}
        setWorkspaceConfigRootsText={setWorkspaceConfigRootsText}
        getLocalizedWorkspaceProviderLabel={getLocalizedWorkspaceProviderLabel}
        getWorkspaceAuthModeLabel={getWorkspaceAuthModeLabel}
        handleDeleteWorkspaceConfig={handleDeleteWorkspaceConfig}
        handleSaveWorkspaceConfig={handleSaveWorkspaceConfig}
        colors={colors}
        styles={styles}
        shellStyles={editorModalShellStyles}
        t={t}
      />

      <RemoteWorkSshEditorModal
        visible={isSshEditorVisible}
        draft={sshDraft}
        isExisting={sshEditorIsExisting}
        isWide={isWide}
        sshPortText={sshPortText}
        sshPassword={sshPassword}
        sshPrivateKey={sshPrivateKey}
        sshPassphrase={sshPassphrase}
        sshFingerprintPending={sshFingerprintPending}
        closeEditor={closeSshEditor}
        setDraft={setSshDraft}
        setSshPassphrase={setSshPassphrase}
        setSshPassword={setSshPassword}
        setSshPortText={setSshPortText}
        setSshPrivateKey={setSshPrivateKey}
        getLocalizedSshHostKeyPolicyOptionLabel={getLocalizedSshHostKeyPolicyOptionLabel}
        handleDeleteSshConfig={handleDeleteSshConfig}
        handleFetchFingerprint={handleFetchFingerprint}
        handleSaveSshConfig={handleSaveSshConfig}
        colors={colors}
        styles={styles}
        shellStyles={editorModalShellStyles}
        t={t}
      />

      <RemoteWorkBrowserEditorModal
        visible={isBrowserEditorVisible}
        draft={browserDraft}
        isExisting={browserEditorIsExisting}
        browserApiKey={browserApiKey}
        closeEditor={closeBrowserEditor}
        setDraft={setBrowserDraft}
        setBrowserApiKey={setBrowserApiKey}
        getLocalizedBrowserAuthModeLabel={getLocalizedBrowserAuthModeLabel}
        handleDeleteBrowserConfig={handleDeleteBrowserConfig}
        handleSaveBrowserConfig={handleSaveBrowserConfig}
        colors={colors}
        styles={styles}
        shellStyles={editorModalShellStyles}
        t={t}
      />

      <RemoteWorkExpoEditorModal
        visible={isExpoEditorVisible}
        expoAccountDraft={expoAccountDraft}
        expoProjectDraft={expoProjectDraft}
        expoAccountEditorIsExisting={expoAccountEditorIsExisting}
        expoProjectEditorIsExisting={expoProjectEditorIsExisting}
        expoAccountToken={expoAccountToken}
        expoAccounts={expoAccounts}
        expoProjects={expoProjects}
        isWide={isWide}
        sshTargets={sshTargets}
        closeEditor={closeExpoEditor}
        setExpoAccountDraft={setExpoAccountDraft}
        setExpoAccountToken={setExpoAccountToken}
        setExpoProjectDraft={setExpoProjectDraft}
        getLocalizedExpoModeLabel={getLocalizedExpoModeLabel}
        handleDeleteExpoAccount={handleDeleteExpoAccount}
        handleDeleteExpoProject={handleDeleteExpoProject}
        handleEditExpoAccount={handleEditExpoAccount}
        handleEditExpoProject={handleEditExpoProject}
        handleSaveExpoAccount={handleSaveExpoAccount}
        handleSaveExpoProject={handleSaveExpoProject}
        handleSyncExpoAccount={handleSyncExpoAccount}
        toggleExpoPlatform={toggleExpoPlatform}
        colors={colors}
        styles={styles}
        shellStyles={editorModalShellStyles}
        t={t}
      />

      <RemoteWorkMcpEditorModal
        visible={isMcpEditorVisible}
        draft={mcpDraft}
        isExisting={mcpEditorIsExisting}
        mcpToken={mcpToken}
        closeEditor={closeMcpEditor}
        setDraft={setMcpDraft}
        setMcpToken={setMcpToken}
        getLocalizedMcpTransportLabel={getLocalizedMcpTransportLabel}
        handleDeleteMcpConfig={handleDeleteMcpConfig}
        handleSaveMcpConfig={handleSaveMcpConfig}
        colors={colors}
        styles={styles}
        shellStyles={editorModalShellStyles}
        t={t}
      />

      <Modal
        visible={Boolean(activeWorkspaceSession)}
        animationType="slide"
        onRequestClose={() => setActiveWorkspaceSession(null)}
      >
        <SafeAreaView style={styles.sessionContainer} edges={['top']}>
          <View style={styles.header}>
            <View style={styles.sessionTitleWrap}>
              <Text style={styles.headerTitle}>
                {activeWorkspaceSession
                  ? getWorkspaceTargetDisplayName(activeWorkspaceSession.target)
                  : t('remoteWork.title')}
              </Text>
              <Text style={styles.sessionSubtitle}>
                {activeWorkspaceSession?.target.rootPath || ''}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setActiveWorkspaceSession(null)}
              accessibilityRole="button"
              accessibilityLabel={t('remoteWork.closeSession')}
            >
              <X size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          {workspaceSessionError ? (
            <Text style={styles.sessionError}>{workspaceSessionError}</Text>
          ) : null}
          {activeWorkspaceSession ? (
            WebView ? (
              <WebView
                testID="remote-workspace-webview"
                source={activeWorkspaceSession.source}
                style={styles.webview}
                onError={(event: any) =>
                  setWorkspaceSessionError(
                    event.nativeEvent?.description || t('remoteWork.launchFailed'),
                  )
                }
                startInLoadingState
              />
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>{t('remoteWork.webviewUnavailableTitle')}</Text>
                <Text style={styles.emptyText}>{t('remoteWork.webviewUnavailableHint')}</Text>
              </View>
            )
          ) : null}
        </SafeAreaView>
      </Modal>

      <Modal
        visible={Boolean(activeSshSession)}
        animationType="slide"
        onRequestClose={handleCloseSshModal}
      >
        <SafeAreaView style={styles.sessionContainer} edges={['top']}>
          <View style={styles.header}>
            <View style={styles.sessionTitleWrap}>
              <Text style={styles.headerTitle}>
                {activeSshSession?.targetName || t('remoteWork.openShell')}
              </Text>
              <Text style={styles.sessionSubtitle}>{activeSshSession?.targetLabel || ''}</Text>
            </View>
            <View style={styles.modalActions}>
              {activeSshSession ? (
                <TouchableOpacity
                  onPress={() => {
                    closeShellSession(activeSshSession.id);
                    handleCloseSshModal();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('remoteWork.disconnectShell')}
                >
                  <Text style={styles.disconnectText}>{t('remoteWork.disconnectShell')}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                onPress={handleCloseSshModal}
                accessibilityRole="button"
                accessibilityLabel={t('remoteWork.closeSession')}
              >
                <X size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.shellBody}>
            <Text style={styles.shellStatus}>
              {activeSshSession?.status === 'error'
                ? activeSshSession.error || t('remoteWork.sshLaunchFailed')
                : activeSshSession?.status === 'closed'
                  ? t('remoteWork.shellClosed')
                  : t('remoteWork.shellConnected')}
            </Text>

            <View style={styles.shellTerminal}>
              <InteractiveTerminalSurface
                ref={sshTerminalRef}
                colors={colors}
                fontSize={14}
                onInput={handleSshTerminalInput}
                onReady={handleSshTerminalReady}
                onLink={handleTerminalLink}
                searchPlaceholder={t('terminal.searchPlaceholder')}
              />
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={Boolean(activeBrowserSession)}
        animationType="slide"
        onRequestClose={() => setActiveBrowserSession(null)}
      >
        <SafeAreaView style={styles.sessionContainer} edges={['top']}>
          <View style={styles.header}>
            <View style={styles.sessionTitleWrap}>
              <Text style={styles.headerTitle}>
                {activeBrowserSession?.summary || t('remoteWork.openLiveView')}
              </Text>
              <Text style={styles.sessionSubtitle}>{activeBrowserSession?.liveViewUrl || ''}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setActiveBrowserSession(null)}
              accessibilityRole="button"
              accessibilityLabel={t('remoteWork.closeSession')}
            >
              <X size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
          {activeBrowserSession?.liveViewUrl ? (
            WebView ? (
              <WebView
                testID="remote-browser-webview"
                source={{ uri: activeBrowserSession.liveViewUrl }}
                style={styles.webview}
                startInLoadingState
              />
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>{t('remoteWork.webviewUnavailableTitle')}</Text>
                <Text style={styles.emptyText}>{t('remoteWork.webviewUnavailableHint')}</Text>
              </View>
            )
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t('remoteWork.noLiveViewTitle')}</Text>
              <Text style={styles.emptyText}>{t('remoteWork.noLiveViewHint')}</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const createStyles = (colors: AppPalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.header,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      flexShrink: 1,
    },
    content: {
      flex: 1,
    },
    contentInner: {
      padding: 16,
      gap: 16,
    },
    infoCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 16,
      gap: 8,
    },
    surfaceOverviewCard: {
      flex: 1,
      minWidth: 170,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 14,
      gap: 10,
    },
    surfaceOverviewCopy: {
      gap: 4,
      flex: 1,
    },
    surfaceOverviewStatPill: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.primarySoft,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    surfaceOverviewValue: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.primary,
    },
    surfaceOverviewLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.primary,
    },
    heroCard: {
      gap: 14,
    },
    heroCardWide: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    heroCopy: {
      flex: 1,
      gap: 8,
    },
    heroStats: {
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
    },
    heroStatPill: {
      flex: 1,
      minWidth: 100,
      backgroundColor: colors.primarySoft,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 4,
    },
    heroStatPillMuted: {
      flex: 1,
      minWidth: 100,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 4,
    },
    heroStatValue: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.primary,
    },
    heroStatValueMuted: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.text,
    },
    heroStatLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    infoTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    infoText: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
    },
    summaryGrid: {
      flexDirection: 'row',
      gap: 12,
      flexWrap: 'wrap',
    },
    summaryCard: {
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 14,
      gap: 8,
      flexShrink: 1,
      overflow: 'hidden',
    },
    summaryCardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    summaryValue: {
      fontSize: 24,
      fontWeight: '800',
      color: colors.text,
    },
    summaryLabel: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sectionHeaderText: {
      flex: 1,
      gap: 4,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      flexShrink: 1,
    },
    sectionCaption: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    headerAction: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '600',
    },
    configStudioCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      padding: 16,
      gap: 16,
      overflow: 'hidden',
    },
    workspaceSurfacePanel: {
      gap: 14,
    },
    configSurfaceRow: {
      flexDirection: 'row',
      gap: 10,
      paddingRight: 4,
    },
    surfaceChip: {
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 10,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    surfaceChipActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    surfaceChipText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    surfaceChipTextActive: {
      color: colors.primary,
    },
    configForm: {
      gap: 12,
    },
    configFormHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
    },
    configFormHeaderText: {
      flex: 1,
      gap: 4,
    },
    configInput: {
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 14,
    },
    configTextArea: {
      minHeight: 96,
    },
    optionRow: {
      flexDirection: 'row',
      gap: 8,
      flexWrap: 'wrap',
    },
    horizontalChipRow: {
      gap: 8,
    },
    optionChip: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    optionChipActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    optionChipText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    optionChipTextActive: {
      color: colors.primary,
    },
    formHint: {
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 17,
    },
    workspaceSurfaceStats: {
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
    },
    workspaceSurfaceStatCard: {
      flex: 1,
      minWidth: 108,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 4,
    },
    workspaceSurfaceStatValue: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
    },
    workspaceSurfaceStatLabel: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    workspaceSurfaceFocusCard: {
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 14,
      gap: 10,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingTop: 4,
    },
    switchLabelWrap: {
      flex: 1,
      gap: 3,
    },
    switchTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    switchHint: {
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 17,
    },
    configActionRow: {
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
      paddingTop: 4,
    },
    destructiveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.danger,
    },
    destructiveBtnText: {
      color: colors.danger,
      fontWeight: '700',
      fontSize: 13,
    },
    inlineLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    inlineActionText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.primary,
    },
    formGrid: {
      gap: 12,
    },
    formGridWide: {
      flexDirection: 'row',
      alignItems: 'flex-end',
    },
    formGridItem: {
      flex: 1,
      gap: 12,
    },
    formGridPortItem: {
      maxWidth: 120,
    },
    emptyCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 16,
      gap: 10,
    },
    emptyTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    emptyText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    workspaceHubCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      padding: 16,
      gap: 16,
    },
    workspaceHubTopRow: {
      gap: 14,
    },
    workspaceHubTopRowWide: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    workspaceHubCopy: {
      flex: 1,
      gap: 8,
    },
    workspaceHubStats: {
      flexDirection: 'row',
      gap: 10,
      flexWrap: 'wrap',
    },
    workspaceHubStatCard: {
      minWidth: 116,
      flex: 1,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 12,
      gap: 4,
    },
    workspaceHubStatValue: {
      fontSize: 22,
      fontWeight: '800',
      color: colors.text,
    },
    workspaceHubStatLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 16,
    },
    workspaceSelectorRail: {
      gap: 10,
      paddingRight: 4,
    },
    workspaceSelectorCard: {
      width: 236,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 14,
      gap: 8,
    },
    workspaceSelectorCardActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    workspaceSelectorPath: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    workspaceDetailCard: {
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      padding: 16,
      gap: 12,
    },
    workspaceDetailGrid: {
      gap: 12,
    },
    workspaceDetailGridWide: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    workspaceDetailCell: {
      flex: 1,
      minWidth: 140,
      gap: 6,
    },
    targetCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 16,
      gap: 10,
      overflow: 'hidden',
    },
    targetHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
    },
    targetHeaderText: {
      flex: 1,
      gap: 4,
    },
    targetTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    targetSubtitle: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    badge: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      flexShrink: 0,
      maxWidth: '45%',
    },
    badgeReady: {
      backgroundColor: colors.primarySoft,
    },
    badgeWarn: {
      backgroundColor: colors.surfaceAlt,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '700',
    },
    badgeTextReady: {
      color: colors.primary,
    },
    badgeTextWarn: {
      color: colors.textSecondary,
    },
    detailLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    detailValue: {
      fontSize: 13,
      color: colors.text,
      flexShrink: 1,
    },
    probeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    probeText: {
      flex: 1,
      fontSize: 12,
    },
    actionRow: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'center',
      flexWrap: 'wrap',
    },
    primaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    primaryBtnText: {
      color: colors.onPrimary,
      fontWeight: '700',
      fontSize: 13,
    },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 11,
      backgroundColor: colors.surfaceAlt,
    },
    secondaryBtnText: {
      color: colors.primary,
      fontWeight: '600',
      fontSize: 13,
    },
    disabledBtn: {
      opacity: 0.45,
    },
    workspaceEditorContent: {
      padding: 16,
      gap: 16,
    },
    workspaceEditorSectionCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 18,
      padding: 16,
      gap: 12,
    },
    workspaceEditorSectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    sessionContainer: {
      flex: 1,
      backgroundColor: colors.background,
    },
    sessionTitleWrap: {
      flex: 1,
      gap: 2,
    },
    sessionSubtitle: {
      color: colors.textSecondary,
      fontSize: 12,
    },
    sessionError: {
      color: colors.danger,
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    webview: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    disconnectText: {
      color: colors.danger,
      fontWeight: '700',
      fontSize: 13,
    },
    shellBody: {
      flex: 1,
      padding: 16,
      gap: 12,
    },
    shellStatus: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    shellTerminal: {
      flex: 1,
      backgroundColor: colors.panel,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    sessionHint: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    configDivider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 4,
    },
  });

export const RemoteWorkScreen: React.FC = () => {
  const { t } = useTranslation();

  return (
    <ErrorBoundary
      fallbackTitle={t('errorBoundary.title')}
      fallbackMessage={t('errorBoundary.message')}
    >
      <RemoteWorkScreenInner />
    </ErrorBoundary>
  );
};
