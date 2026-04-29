// ---------------------------------------------------------------------------
// Kavi — Settings Screen
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  Server,
  Key,
  Globe,
  Cpu,
  Languages,
  Link2,
  Image,
  Check,
  Search,
  CloudSun,
  Bell,
  Wrench,
  ExternalLink,
  Brain,
  ShieldCheck,
  Bot,
  ChevronDown,
} from 'lucide-react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useChatStore } from '../store/useChatStore';
import { useAppTheme, AppPalette, ThemePreference } from '../theme/useAppTheme';
import {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  LlmProviderConfig,
  McpServerConfig,
  SshTargetConfig,
  WebSearchProvider,
  WorkspaceTargetConfig,
} from '../types';
import { buildProviderFromPreset, finalizeProviderConfig, KNOWN_PROVIDERS } from '../constants/api';
import { generateId } from '../utils/id';
import {
  saveProviderApiKey,
  getProviderApiKey,
  deleteProviderApiKey,
  deleteMcpOAuthClientSecret,
  getMcpOAuthClientSecret,
  saveSecure,
  getSecure,
  deleteSecure,
  saveMcpOAuthClientSecret,
} from '../services/storage/SecureStorage';
import { useTranslation, SUPPORTED_LOCALES, LOCALE_DISPLAY_NAMES, type Locale } from '../i18n';
import { i18n } from '../i18n/manager';
import { useBackToChat } from '../navigation/useBackToChat';
import { SERVICE_SETUP_FIELDS, orderToolsByGroup } from '../services/setup/catalog';
import { TOOL_DEFINITIONS } from '../engine/tools/definitions';
import { useToolPermissionsStore } from '../services/security/permissions';
import { getAvailablePersonasForConfig } from '../services/agents/registry';
import { usePersonaConfigStore } from '../services/agents/store';
import type { AgentPersona } from '../services/agents/personas';
import { clearMcpOAuth, hasStoredMcpOAuth } from '../services/mcp/oauth';
import { normalizeMcpServerConfigMetadata } from '../services/mcp/metadata';
import {
  BROWSER_PROVIDER_AUTH_OPTIONS,
  BROWSER_PROVIDER_OPTIONS,
  BROWSER_PROVIDER_PRESETS,
  getBrowserProviderAuthHint,
  getBrowserProviderAuthLabel,
  getBrowserProviderLabel,
  getBrowserProviderReadiness,
  isValidBrowserProviderBaseUrl,
} from '../services/browser/providers';
import {
  WORKSPACE_AUTH_MODE_OPTIONS,
  WORKSPACE_PROVIDER_OPTIONS,
  getWorkspaceProviderLabel,
  getWorkspaceTargetReadiness,
  isValidWorkspaceBaseUrl,
} from '../services/workspaces/connector';
import {
  getWorkspaceTargetDisplayName,
  normalizeWorkspaceTargetLinks,
} from '../services/workspaces/config';
import {
  clearStoredSshSecrets,
  getSshHostFingerprint,
  getSshHostKeyPolicyLabel,
  getSshTargetAuthModeLabel,
  getSshTargetReadiness,
  SSH_HOST_KEY_POLICY_OPTIONS,
} from '../services/ssh/connector';
import { SSH_AUTH_MODE_OPTIONS, SSH_PTY_OPTIONS } from '../services/ssh/native';
import {
  getExpoProjectDisplayOwner,
  getExpoProjectExecutionMode,
  getExpoProjectReadiness,
  getExpoProjectReadinessLabel,
  syncExpoAccountProjects,
} from '../services/expo/eas';
import {
  getLocalLlmCatalogEntriesForProvider,
  getLocalLlmCatalogEntry,
  getLocalLlmModelDisplayName,
} from '../services/localLlm/catalog';
import {
  isLocalLlmModelInstalled,
  isOnDeviceLlmProvider,
  formatLocalLlmRuntimeStatusLabel,
  getLocalLlmRuntimeStatus,
  subscribeToLocalLlmRuntimeStatusChanges,
  type LocalLlmRuntimeStatus,
} from '../services/localLlm/runtime';
import { useLocalLlmModelDownload } from '../hooks/useLocalLlmModelDownload';
import { LocalModelDownloadPanel } from '../components/localLlm/LocalModelDownloadPanel';
import { useSecureDraftValue } from './useSecureDraftValue';
import {
  SettingsBrowserEditor,
  SettingsExpoAccountEditor,
  SettingsExpoProjectEditor,
  SettingsMcpEditor,
  SettingsProviderEditor,
  SettingsSshEditor,
  SettingsWorkspaceEditor,
} from './components/settings/SettingsConfigEditors';
import {
  createBrowserDraft,
  createExpoAccountDraft,
  createExpoProjectDraft,
  createMcpServerDraft,
  createSshDraft,
  createWorkspaceDraft,
  formatPathList,
  prepareBrowserDraft,
  prepareExpoAccountDraft,
  prepareExpoProjectDraft,
  prepareMcpServerDraft,
  prepareSshDraft,
  prepareWorkspaceDraft,
  parsePathList,
  toggleExpoProjectPlatform,
} from './configDrafts';

type SettingsSection =
  | 'main'
  | 'provider-edit'
  | 'mcp-edit'
  | 'ssh-edit'
  | 'workspace-edit'
  | 'browser-edit'
  | 'expo-account-edit'
  | 'expo-project-edit';
type MainSettingsSectionId = 'overview' | 'assistant' | 'tools' | 'personas' | 'surfaces' | 'data';
type PersonaThinkingLevel = NonNullable<AgentPersona['thinkingLevel']>;

const MAIN_SETTINGS_SECTION_ORDER: MainSettingsSectionId[] = [
  'overview',
  'assistant',
  'tools',
  'personas',
  'surfaces',
  'data',
];
const THINKING_LEVEL_VALUES: ThinkingOption[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];
const PERSONA_THINKING_LEVEL_VALUES: PersonaThinkingLevel[] = ['off', 'low', 'medium', 'high'];
const WEB_SEARCH_PROVIDER_VALUES: WebSearchProvider[] = [
  'auto',
  'brave',
  'perplexity',
  'grok',
  'kimi',
  'gemini',
];
const SERVICE_SETUP_I18N_KEYS: Record<string, string> = {
  BRAVE_API_KEY: 'onboarding.services.brave',
  PERPLEXITY_API_KEY: 'onboarding.services.perplexity',
  XAI_API_KEY: 'onboarding.services.grok',
  KIMI_API_KEY: 'onboarding.services.kimi',
  GOOGLE_API_KEY: 'onboarding.services.gemini',
  FIRECRAWL_API_KEY: 'onboarding.services.firecrawl',
  OPENWEATHER_API_KEY: 'onboarding.services.weather',
  GITHUB_TOKEN: 'onboarding.services.github',
  ALPHA_VANTAGE_API_KEY: 'onboarding.services.finance',
};

// ── Collapsible Section Component ──────────────────────────────────────
const CollapsibleSection: React.FC<{
  title: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  colors: AppPalette;
}> = ({ title, children, open, onToggle, colors }) => {
  return (
    <View style={{ marginTop: 8 }}>
      <TouchableOpacity
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 12,
          paddingHorizontal: 16,
          backgroundColor: colors.surfaceAlt,
          borderRadius: 8,
          marginHorizontal: 16,
        }}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
      >
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{title}</Text>
        {open ? (
          <ChevronDown size={18} color={colors.textSecondary} />
        ) : (
          <ChevronRight size={18} color={colors.textSecondary} />
        )}
      </TouchableOpacity>
      {open && <View style={{ paddingTop: 4 }}>{children}</View>}
    </View>
  );
};

type ThinkingOption = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

const ManagedScrollView = React.forwardRef<
  ScrollView,
  {
    children: React.ReactNode;
    style: any;
    contentContainerStyle?: any;
    onTrackedScroll: (y: number) => void;
    onRestore: () => void;
  }
>(({ children, style, contentContainerStyle, onTrackedScroll, onRestore }, ref) => (
  <ScrollView
    ref={ref}
    style={style}
    contentContainerStyle={contentContainerStyle}
    keyboardShouldPersistTaps="handled"
    scrollEventThrottle={16}
    onScroll={(event) => onTrackedScroll(event.nativeEvent.contentOffset.y)}
    onContentSizeChange={onRestore}
  >
    {children}
  </ScrollView>
));

ManagedScrollView.displayName = 'ManagedScrollView';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const handleBack = useBackToChat();
  const { colors } = useAppTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const toolGroups = useMemo(() => orderToolsByGroup(TOOL_DEFINITIONS), []);

  const providers = useSettingsStore((s) => s.providers);
  const mcpServers = useSettingsStore((s) => s.mcpServers);
  const sshTargets = useSettingsStore((s) => s.sshTargets || []);
  const workspaceTargets = useSettingsStore((s) => s.workspaceTargets || []);
  const browserProviders = useSettingsStore((s) => s.browserProviders || []);
  const expoAccounts = useSettingsStore((s) => s.expoAccounts || []);
  const expoProjects = useSettingsStore((s) => s.expoProjects || []);
  const theme = useSettingsStore((s) => s.theme);
  const systemPrompt = useSettingsStore((s) => s.systemPrompt);
  const locale = useSettingsStore((s) => s.locale);
  const thinkingLevel = useSettingsStore((s) => s.thinkingLevel);
  const webSearchProvider = useSettingsStore((s) => s.webSearchProvider);
  const linkUnderstandingEnabled = useSettingsStore((s) => s.linkUnderstandingEnabled);
  const mediaUnderstandingEnabled = useSettingsStore((s) => s.mediaUnderstandingEnabled);
  const maxLinks = useSettingsStore((s) => s.maxLinks);
  const defaultConversationMode = useSettingsStore((s) => s.defaultConversationMode);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const updateProvider = useSettingsStore((s) => s.updateProvider);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const addMcpServer = useSettingsStore((s) => s.addMcpServer);
  const updateMcpServer = useSettingsStore((s) => s.updateMcpServer);
  const removeMcpServer = useSettingsStore((s) => s.removeMcpServer);
  const addSshTarget = useSettingsStore((s) => s.addSshTarget);
  const updateSshTarget = useSettingsStore((s) => s.updateSshTarget);
  const removeSshTarget = useSettingsStore((s) => s.removeSshTarget);
  const addWorkspaceTarget = useSettingsStore((s) => s.addWorkspaceTarget);
  const updateWorkspaceTarget = useSettingsStore((s) => s.updateWorkspaceTarget);
  const removeWorkspaceTarget = useSettingsStore((s) => s.removeWorkspaceTarget);
  const addBrowserProvider = useSettingsStore((s) => s.addBrowserProvider);
  const updateBrowserProvider = useSettingsStore((s) => s.updateBrowserProvider);
  const removeBrowserProvider = useSettingsStore((s) => s.removeBrowserProvider);
  const addExpoAccount = useSettingsStore((s) => s.addExpoAccount);
  const updateExpoAccount = useSettingsStore((s) => s.updateExpoAccount);
  const removeExpoAccount = useSettingsStore((s) => s.removeExpoAccount);
  const addExpoProject = useSettingsStore((s) => s.addExpoProject);
  const updateExpoProject = useSettingsStore((s) => s.updateExpoProject);
  const removeExpoProject = useSettingsStore((s) => s.removeExpoProject);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setSystemPrompt = useSettingsStore((s) => s.setSystemPrompt);
  const setLocale = useSettingsStore((s) => s.setLocale);
  const setThinkingLevel = useSettingsStore((s) => s.setThinkingLevel);
  const setWebSearchProvider = useSettingsStore((s) => s.setWebSearchProvider);
  const setLinkUnderstandingEnabled = useSettingsStore((s) => s.setLinkUnderstandingEnabled);
  const setMediaUnderstandingEnabled = useSettingsStore((s) => s.setMediaUnderstandingEnabled);
  const setMaxLinks = useSettingsStore((s) => s.setMaxLinks);
  const setDefaultConversationMode = useSettingsStore((s) => s.setDefaultConversationMode);
  const disableLongTermMemory = useSettingsStore((s) => s.disableLongTermMemory === true);
  const setDisableLongTermMemory = useSettingsStore((s) => s.setDisableLongTermMemory);
  const consolidationProviderId = useSettingsStore((s) => s.consolidationProvider ?? null);
  const setConsolidationProvider = useSettingsStore((s) => s.setConsolidationProvider);
  const clearAllConversations = useChatStore((s) => s.clearAllConversations);
  const permissions = useToolPermissionsStore((s) => s.permissions);
  const setToolPermission = useToolPermissionsStore((s) => s.setPermission);
  const personaOverrides = usePersonaConfigStore((s) => s.overrides);
  const customPersonas = usePersonaConfigStore((s) => s.customPersonas);
  const setPersonaOverride = usePersonaConfigStore((s) => s.setOverride);
  const upsertCustomPersona = usePersonaConfigStore((s) => s.upsertCustomPersona);

  const [section, setSection] = useState<SettingsSection>('main');
  const [editingProvider, setEditingProvider] = useState<LlmProviderConfig | null>(null);
  const [editingMcp, setEditingMcp] = useState<McpServerConfig | null>(null);
  const [editingSsh, setEditingSsh] = useState<SshTargetConfig | null>(null);
  const [editingWorkspace, setEditingWorkspace] = useState<WorkspaceTargetConfig | null>(null);
  const [editingBrowser, setEditingBrowser] = useState<BrowserProviderConfig | null>(null);
  const [editingExpoAccount, setEditingExpoAccount] = useState<ExpoAccountConfig | null>(null);
  const [editingExpoProject, setEditingExpoProject] = useState<ExpoProjectConfig | null>(null);
  const [localRuntimeStatusesByProviderId, setLocalRuntimeStatusesByProviderId] = useState<
    Record<string, LocalLlmRuntimeStatus>
  >({});
  const [showApiKey, setShowApiKey] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [mcpHeadersText, setMcpHeadersText] = useState('');
  const [mcpTimeoutText, setMcpTimeoutText] = useState('20000');
  const [mcpOauthClientSecret, setMcpOauthClientSecret] = useState('');
  const [sshPortText, setSshPortText] = useState('22');
  const [sshPassword, setSshPassword] = useState('');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [sshPassphrase, setSshPassphrase] = useState('');
  const [sshFingerprintPending, setSshFingerprintPending] = useState(false);
  const [workspaceConfigRootsText, setWorkspaceConfigRootsText] = useState('');
  const [workspaceAccessToken, setWorkspaceAccessToken] = useState('');
  const [browserApiKey, setBrowserApiKey] = useState('');
  const [expoAccountToken, setExpoAccountToken] = useState('');
  const [hasStoredMcpOauthSession, setHasStoredMcpOauthSession] = useState(false);
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [serviceKeys, setServiceKeys] = useState<Record<string, string>>({});
  const personas = useMemo(
    () => getAvailablePersonasForConfig(personaOverrides, customPersonas),
    [personaOverrides, customPersonas],
  );
  const [editingPersonaId, setEditingPersonaId] = useState<string>('default');
  const [personaDraft, setPersonaDraft] = useState<Partial<AgentPersona>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedPanels, setExpandedPanels] = useState({
    toolPermissions: true,
    personas: true,
    executionSurfaces: true,
  });
  const [activeMainSection, setActiveMainSection] = useState<MainSettingsSectionId>('overview');
  const handledRouteMcpRef = React.useRef<string | null>(null);
  const activeMainSectionRef = useRef<MainSettingsSectionId>('overview');
  const mainScrollRef = useRef<ScrollView>(null);
  const editorScrollRef = useRef<ScrollView>(null);
  const pendingRestoreSectionRef = useRef<SettingsSection>('main');
  const scrollOffsetsRef = useRef<Record<SettingsSection, number>>({
    main: 0,
    'provider-edit': 0,
    'mcp-edit': 0,
    'ssh-edit': 0,
    'workspace-edit': 0,
    'browser-edit': 0,
    'expo-account-edit': 0,
    'expo-project-edit': 0,
  });
  const mainSectionOffsetsRef = useRef<Record<MainSettingsSectionId, number>>({
    overview: 0,
    assistant: 0,
    tools: 0,
    personas: 0,
    surfaces: 0,
    data: 0,
  });
  const editingProviderIsOnDevice = Boolean(
    editingProvider && isOnDeviceLlmProvider(editingProvider),
  );
  const editingProviderSelectedModelId =
    editingProviderIsOnDevice && editingProvider ? editingProvider.model : undefined;
  const editingProviderSelectedModelInstalled = Boolean(
    editingProviderIsOnDevice &&
    editingProvider &&
    isLocalLlmModelInstalled(editingProvider, editingProvider.model),
  );
  const {
    downloadModel: downloadEditingLocalModel,
    downloadState: editingLocalModelDownloadState,
    isDownloading: editingLocalModelDownloadInProgress,
    wasJustDownloaded: editingLocalModelWasJustDownloaded,
  } = useLocalLlmModelDownload(
    editingProviderSelectedModelId,
    editingProviderSelectedModelInstalled,
  );

  useEffect(() => {
    let cancelled = false;
    const loadStatuses = async () => {
      const onDeviceProviders = providers.filter((provider) => isOnDeviceLlmProvider(provider));

      if (onDeviceProviders.length === 0) {
        if (!cancelled) {
          setLocalRuntimeStatusesByProviderId({});
        }
        return;
      }

      try {
        const entries = await Promise.all(
          onDeviceProviders.map(async (provider) => {
            const status = await getLocalLlmRuntimeStatus(provider);
            return status ? ([provider.id, status] as const) : null;
          }),
        );

        if (cancelled) {
          return;
        }

        const nextStatuses: Record<string, LocalLlmRuntimeStatus> = {};
        entries.forEach((entry) => {
          if (!entry) {
            return;
          }
          nextStatuses[entry[0]] = entry[1];
        });
        setLocalRuntimeStatusesByProviderId(nextStatuses);
      } catch {
        if (!cancelled) {
          setLocalRuntimeStatusesByProviderId({});
        }
      }
    };

    void loadStatuses();
    const unsubscribe = subscribeToLocalLlmRuntimeStatusChanges(() => {
      void loadStatuses();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [providers]);

  const translateWithFallback = useCallback(
    (key: string, fallback: string, params?: Record<string, string | number>) => {
      const translated = t(key, params);
      return translated === key ? fallback : translated;
    },
    [t],
  );

  const thinkingLevelOptions = useMemo(
    () =>
      THINKING_LEVEL_VALUES.map((value) => ({
        value,
        label: t(`settings.thinkingOptions.${value}.label`),
        hint: t(`settings.thinkingOptions.${value}.hint`),
      })),
    [t],
  );

  const personaThinkingLevelOptions = useMemo(
    () =>
      PERSONA_THINKING_LEVEL_VALUES.map((value) => ({
        value,
        label: t(`settings.thinkingOptions.${value}.label`),
        hint: t(`settings.thinkingOptions.${value}.hint`),
      })),
    [t],
  );

  const webSearchProviderOptions = useMemo(
    () =>
      WEB_SEARCH_PROVIDER_VALUES.map((value) => ({
        value,
        label: translateWithFallback(`onboarding.webProviders.${value}.title`, value),
        detail: translateWithFallback(`onboarding.webProviders.${value}.detail`, ''),
      })),
    [translateWithFallback],
  );

  const builtInToolSections = useMemo(
    () => [
      {
        id: 'research',
        icon: Search,
        title: t('settings.builtInGroups.research.title'),
        description: t('settings.builtInGroups.research.description'),
      },
      {
        id: 'device',
        icon: Bell,
        title: t('settings.builtInGroups.device.title'),
        description: t('settings.builtInGroups.device.description'),
      },
      {
        id: 'services',
        icon: CloudSun,
        title: t('settings.builtInGroups.services.title'),
        description: t('settings.builtInGroups.services.description'),
      },
      {
        id: 'catalog',
        icon: Wrench,
        title: t('settings.builtInGroups.catalog.title'),
        description: t('settings.builtInGroups.catalog.description'),
      },
    ],
    [t],
  );

  const mainSections = useMemo(
    () => [
      {
        id: 'overview' as const,
        title: t('settings.mainSections.overview.title'),
        hint: t('settings.mainSections.overview.hint'),
      },
      {
        id: 'assistant' as const,
        title: t('settings.mainSections.assistant.title'),
        hint: t('settings.mainSections.assistant.hint'),
      },
      {
        id: 'tools' as const,
        title: t('settings.mainSections.tools.title'),
        hint: t('settings.mainSections.tools.hint'),
      },
      {
        id: 'personas' as const,
        title: t('settings.mainSections.personas.title'),
        hint: t('settings.mainSections.personas.hint'),
      },
      {
        id: 'surfaces' as const,
        title: t('settings.mainSections.surfaces.title'),
        hint: t('settings.mainSections.surfaces.hint'),
      },
      {
        id: 'data' as const,
        title: t('settings.mainSections.data.title'),
        hint: t('settings.mainSections.data.hint'),
      },
    ],
    [t],
  );

  const getServiceFieldCopy = useCallback(
    (field: (typeof SERVICE_SETUP_FIELDS)[number]) => {
      const prefix = SERVICE_SETUP_I18N_KEYS[field.storageKey];
      if (!prefix) return field;

      return {
        ...field,
        label: translateWithFallback(`${prefix}.title`, field.label),
        hint: translateWithFallback(`${prefix}.hint`, field.hint),
        category: translateWithFallback(`${prefix}.category`, field.category),
        unlocks: translateWithFallback(`${prefix}.unlocks`, field.unlocks),
        setup: translateWithFallback(`${prefix}.setup`, field.setup),
        freeAccess: translateWithFallback(`${prefix}.freeAccess`, field.freeAccess),
      };
    },
    [translateWithFallback],
  );

  const togglePanel = useCallback((panel: keyof typeof expandedPanels) => {
    setExpandedPanels((current) => ({ ...current, [panel]: !current[panel] }));
  }, []);

  const updateTrackedScroll = useCallback((sectionKey: SettingsSection, y: number) => {
    scrollOffsetsRef.current[sectionKey] = y;
    if (sectionKey !== 'main') return;

    let nextActive: MainSettingsSectionId = 'overview';
    for (const sectionId of MAIN_SETTINGS_SECTION_ORDER) {
      if ((mainSectionOffsetsRef.current[sectionId] || 0) - 64 <= y) {
        nextActive = sectionId;
      }
    }

    if (activeMainSectionRef.current !== nextActive) {
      activeMainSectionRef.current = nextActive;
      setActiveMainSection(nextActive);
    }
  }, []);

  const restoreTrackedScroll = useCallback(
    (sectionKey: SettingsSection, ref: React.RefObject<ScrollView | null>) => {
      if (pendingRestoreSectionRef.current !== sectionKey) return;
      pendingRestoreSectionRef.current = 'main';
      const y = scrollOffsetsRef.current[sectionKey] || 0;
      requestAnimationFrame(() => {
        ref.current?.scrollTo({ y, animated: false });
      });
    },
    [],
  );

  const handleJumpToMainSection = useCallback((sectionId: MainSettingsSectionId) => {
    activeMainSectionRef.current = sectionId;
    setActiveMainSection(sectionId);
    const y = Math.max((mainSectionOffsetsRef.current[sectionId] || 0) - 12, 0);
    mainScrollRef.current?.scrollTo({ y, animated: true });
  }, []);

  useEffect(() => {
    pendingRestoreSectionRef.current = section;
    if (section !== 'main') return;

    let nextActive: MainSettingsSectionId = 'overview';
    const y = scrollOffsetsRef.current.main || 0;
    for (const sectionId of MAIN_SETTINGS_SECTION_ORDER) {
      if ((mainSectionOffsetsRef.current[sectionId] || 0) - 64 <= y) {
        nextActive = sectionId;
      }
    }
    activeMainSectionRef.current = nextActive;
    setActiveMainSection(nextActive);
  }, [section]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const entries = await Promise.all(
        SERVICE_SETUP_FIELDS.map(
          async (field) => [field.storageKey, (await getSecure(field.storageKey)) || ''] as const,
        ),
      );

      if (!cancelled) {
        setServiceKeys(Object.fromEntries(entries));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (section !== 'ssh-edit' || !editingSsh) {
      setSshPassword('');
      setSshPrivateKey('');
      setSshPassphrase('');
      return undefined;
    }

    void Promise.all([
      editingSsh.passwordRef ? getSecure(editingSsh.passwordRef) : Promise.resolve(''),
      editingSsh.privateKeyRef ? getSecure(editingSsh.privateKeyRef) : Promise.resolve(''),
      editingSsh.passphraseRef ? getSecure(editingSsh.passphraseRef) : Promise.resolve(''),
    ]).then(([password, privateKey, passphrase]) => {
      if (!cancelled) {
        setSshPassword(password || '');
        setSshPrivateKey(privateKey || '');
        setSshPassphrase(passphrase || '');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [editingSsh, section]);

  useSecureDraftValue({
    enabled: section === 'workspace-edit' && editingWorkspace?.authMode !== 'none',
    secureRef: editingWorkspace?.accessTokenRef,
    setValue: setWorkspaceAccessToken,
  });

  useSecureDraftValue({
    enabled: section === 'browser-edit' && editingBrowser?.authMode !== 'none',
    secureRef: editingBrowser?.apiKeyRef,
    setValue: setBrowserApiKey,
  });

  useSecureDraftValue({
    enabled: section === 'expo-account-edit',
    secureRef: editingExpoAccount?.tokenRef,
    setValue: setExpoAccountToken,
  });

  const persistServiceKey = useCallback(
    async (storageKey: string, value: string) => {
      try {
        const trimmed = value.trim();
        if (trimmed) {
          await saveSecure(storageKey, trimmed);
        } else {
          await deleteSecure(storageKey);
        }
      } catch {
        Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      }
    },
    [t],
  );

  const handleOpenUrl = useCallback(
    async (url?: string) => {
      if (!url) return;
      try {
        await Linking.openURL(url);
      } catch {
        Alert.alert(t('common.error'), t('settings.invalidUrlFormat'));
      }
    },
    [t],
  );

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

  const permissionStateByTool = useMemo(() => {
    return new Map(permissions.map((permission) => [permission.toolName, permission]));
  }, [permissions]);

  const handleLocaleChange = useCallback(
    async (newLocale: Locale) => {
      setLocale(newLocale);
      await i18n.setLocale(newLocale);
      setShowLanguagePicker(false);
    },
    [setLocale],
  );

  // --- Provider Edit ---
  const handleNewProvider = (preset?: (typeof KNOWN_PROVIDERS)[number]) => {
    const newProvider: LlmProviderConfig = preset
      ? buildProviderFromPreset(preset, { id: generateId(), enabled: true })
      : finalizeProviderConfig({
          id: generateId(),
          name: t('settings.newProvider'),
          baseUrl: '',
          apiKey: '',
          model: '',
          enabled: true,
        });
    setEditingProvider(newProvider);
    setTempApiKey('');
    setSection('provider-edit');
  };

  const handleEditProvider = async (provider: LlmProviderConfig) => {
    const key = (await getProviderApiKey(provider.id)) || '';
    setEditingProvider({ ...provider });
    setTempApiKey(key);
    setSection('provider-edit');
  };

  const handleDownloadSelectedLocalModel = useCallback(async () => {
    if (!editingProvider || !editingProviderIsOnDevice) {
      return;
    }

    const catalogEntry = getLocalLlmCatalogEntry(editingProvider.model);
    if (!catalogEntry) {
      return;
    }

    const updatedProvider = await downloadEditingLocalModel(
      editingProvider,
      catalogEntry.id,
      catalogEntry.sizeBytes,
    );

    if (updatedProvider) {
      setEditingProvider(updatedProvider);
    }
  }, [downloadEditingLocalModel, editingProvider, editingProviderIsOnDevice]);

  const handleSaveProvider = async () => {
    if (!editingProvider) return;

    const localProvider = isOnDeviceLlmProvider(editingProvider);

    if (
      localProvider &&
      (editingLocalModelDownloadInProgress ||
        !isLocalLlmModelInstalled(editingProvider, editingProvider.model))
    ) {
      return;
    }

    if (!localProvider) {
      const url = editingProvider.baseUrl?.trim();
      if (url) {
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            Alert.alert(t('settings.invalidUrl'), t('settings.invalidUrlHttp'));
            return;
          }
        } catch {
          Alert.alert(t('settings.invalidUrl'), t('settings.invalidUrlFormat'));
          return;
        }
      }
    }

    try {
      if (!localProvider && tempApiKey) {
        await saveProviderApiKey(editingProvider.id, tempApiKey);
      }
      const finalizedProvider = finalizeProviderConfig(editingProvider);
      const existing = providers.find((p) => p.id === editingProvider.id);
      if (existing) {
        updateProvider(finalizedProvider);
      } else {
        addProvider(finalizedProvider);
      }
      setSection('main');
      setEditingProvider(null);
      setTempApiKey('');
      setShowApiKey(false);
    } catch {
      Alert.alert(t('common.error'), t('onboarding.saveFailed'));
    }
  };

  const handleDeleteProvider = (id: string) => {
    Alert.alert(t('settings.deleteProvider'), t('settings.deleteProviderConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          removeProvider(id);
          await deleteProviderApiKey(id);
          setSection('main');
          setEditingProvider(null);
        },
      },
    ]);
  };

  // --- MCP Server Edit ---
  const handleNewMcp = useCallback(() => {
    const newServer: McpServerConfig = createMcpServerDraft({
      name: t('settings.newMcpServer'),
      headers: {},
      timeoutMs: 20000,
    });
    setEditingMcp(newServer);
    setMcpHeadersText('');
    setMcpTimeoutText('20000');
    setMcpOauthClientSecret('');
    setHasStoredMcpOauthSession(false);
    setSection('mcp-edit');
  }, [t]);

  const handleEditMcp = async (server: McpServerConfig) => {
    const oauthSecret = server.oauth?.clientSecretRef
      ? await getMcpOAuthClientSecret(server.id)
      : '';
    const storedOauthSession = await hasStoredMcpOAuth(server.id);

    setEditingMcp(prepareMcpServerDraft(server, { defaultTimeoutMs: 20000 }));
    setMcpHeadersText(server.headers ? JSON.stringify(server.headers, null, 2) : '');
    setMcpTimeoutText(String(server.timeoutMs || 20000));
    setMcpOauthClientSecret(oauthSecret || '');
    setHasStoredMcpOauthSession(storedOauthSession);
    setSection('mcp-edit');
  };

  const normalizedEditingMcp = useMemo(
    () => (editingMcp ? normalizeMcpServerConfigMetadata(editingMcp) : null),
    [editingMcp],
  );

  const getMcpTransportLabel = useCallback(
    (transport?: McpServerConfig['transport']) => {
      switch (transport) {
        case 'streamable-http':
          return t('mcpStatus.transportHttp');
        case 'sse':
          return t('mcpStatus.transportSse');
        default:
          return t('mcpStatus.transportAuto');
      }
    },
    [t],
  );

  const getMcpAuthLabel = useCallback(
    (server: McpServerConfig) => {
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
    },
    [t],
  );

  const getMcpMetadataChips = useCallback(
    (server: McpServerConfig) => {
      const chips = [
        server.trust?.source === 'official-registry'
          ? t('mcpStatus.officialRegistry')
          : t('mcpStatus.manualServer'),
        getMcpTransportLabel(server.capabilities?.transport || server.transport),
        getMcpAuthLabel(server),
      ];

      if (server.capabilities?.requiresConfiguration) {
        chips.push(t('mcpStatus.configurationRequired'));
      }
      if (server.capabilities?.requiresSecrets) {
        chips.push(t('mcpStatus.secretsRequired'));
      }

      return chips;
    },
    [getMcpAuthLabel, getMcpTransportLabel, t],
  );

  useEffect(() => {
    const routeServerId = route.params?.serverId as string | undefined;
    const routeSection = route.params?.section as SettingsSection | undefined;
    const nextKey = routeServerId || routeSection || null;

    if (!nextKey || handledRouteMcpRef.current === nextKey) {
      return;
    }

    handledRouteMcpRef.current = nextKey;

    if (routeServerId) {
      const server = mcpServers.find((candidate) => candidate.id === routeServerId);
      if (server) {
        void handleEditMcp(server);
      }
      return;
    }

    if (routeSection === 'mcp-edit') {
      handleNewMcp();
    }
  }, [handleNewMcp, mcpServers, route.params]);

  const handleSaveMcp = async () => {
    if (!editingMcp) return;

    // Validate MCP server URL
    const url = editingMcp.url?.trim();
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
          Alert.alert(t('settings.invalidUrl'), t('settings.invalidMcpUrl'));
          return;
        }
      } catch {
        Alert.alert(t('settings.invalidUrl'), t('settings.invalidMcpUrlFormat'));
        return;
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
        return;
      }
    }

    const timeoutMs = Number.parseInt(mcpTimeoutText, 10);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
      Alert.alert(t('common.error'), t('settings.serverTimeoutInvalid'));
      return;
    }

    const existing = mcpServers.find((s) => s.id === editingMcp.id);
    const normalizedServer = normalizeMcpServerConfigMetadata({
      ...editingMcp,
      headers,
      timeoutMs,
      sseUrl: editingMcp.sseUrl?.trim() || undefined,
      transport: editingMcp.transport || 'auto',
      oauth:
        editingMcp.oauth && Object.values(editingMcp.oauth).some(Boolean)
          ? {
              clientId: editingMcp.oauth.clientId?.trim() || undefined,
              clientSecretRef: mcpOauthClientSecret.trim()
                ? `mcp_oauth_client_secret_${editingMcp.id}`
                : undefined,
              authorizationUrl: editingMcp.oauth.authorizationUrl?.trim() || undefined,
              tokenUrl: editingMcp.oauth.tokenUrl?.trim() || undefined,
              scope: editingMcp.oauth.scope?.trim() || undefined,
              projectNameForProxy: editingMcp.oauth.projectNameForProxy?.trim() || undefined,
              tokenEndpointAuthMethod: editingMcp.oauth.tokenEndpointAuthMethod || undefined,
            }
          : undefined,
    });

    if (mcpOauthClientSecret.trim()) {
      await saveMcpOAuthClientSecret(editingMcp.id, mcpOauthClientSecret.trim());
    } else if (existing?.oauth?.clientSecretRef || editingMcp.oauth?.clientSecretRef) {
      await deleteMcpOAuthClientSecret(editingMcp.id);
    }

    if (existing?.oauth && !normalizedServer.oauth) {
      await clearMcpOAuth(editingMcp.id);
    }

    if (existing) {
      updateMcpServer(normalizedServer);
    } else {
      addMcpServer(normalizedServer);
    }
    setSection('main');
    setEditingMcp(null);
    setMcpOauthClientSecret('');
    setHasStoredMcpOauthSession(false);
  };

  const handleResetMcpOAuthSession = useCallback(() => {
    if (!editingMcp) return;

    Alert.alert(t('settings.mcpResetOAuthSession'), t('settings.mcpResetOAuthSessionConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.mcpResetOAuthSession'),
        style: 'destructive',
        onPress: async () => {
          await clearMcpOAuth(editingMcp.id);
          setHasStoredMcpOauthSession(false);
          Alert.alert(t('settings.mcpResetOAuthSessionSuccess'));
        },
      },
    ]);
  }, [editingMcp, t]);

  const handleDeleteMcp = (id: string) => {
    Alert.alert(t('settings.deleteMcpServer'), t('settings.deleteMcpConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          removeMcpServer(id);
          await clearMcpOAuth(id);
          setSection('main');
          setEditingMcp(null);
          setMcpOauthClientSecret('');
        },
      },
    ]);
  };

  const handleNewSsh = useCallback(() => {
    setEditingSsh(createSshDraft({ name: t('settings.newSshTarget') }));
    setSshPortText('22');
    setSshPassword('');
    setSshPrivateKey('');
    setSshPassphrase('');
    setSection('ssh-edit');
  }, [t]);

  const handleEditSsh = useCallback((target: SshTargetConfig) => {
    setEditingSsh(prepareSshDraft(target));
    setSshPortText(String(target.port || 22));
    setSection('ssh-edit');
  }, []);

  const handleSaveSsh = useCallback(async () => {
    if (!editingSsh) {
      return;
    }

    const host = editingSsh.host.trim();
    const username = editingSsh.username.trim();
    const port = Number.parseInt(sshPortText, 10);
    const hostKeyPolicy = editingSsh.hostKeyPolicy || 'trust-on-first-use';
    const trustedHostFingerprint =
      editingSsh.trustedHostFingerprint?.trim().replace(/-/g, ':').toUpperCase() || undefined;
    const authMode = editingSsh.authMode || 'password';
    const password = sshPassword.trim();
    const privateKey = sshPrivateKey.trim();
    const passphrase = sshPassphrase.trim();
    const previousTarget = sshTargets.find((target) => target.id === editingSsh.id);

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

    if (authMode === 'password' && !password) {
      Alert.alert(t('common.error'), t('settings.sshPasswordRequired'));
      return;
    }

    if (authMode === 'private-key' && !privateKey) {
      Alert.alert(t('common.error'), t('settings.sshPrivateKeyRequired'));
      return;
    }

    const passwordRef = `ssh_password_${editingSsh.id}`;
    const privateKeyRef = `ssh_private_key_${editingSsh.id}`;
    const passphraseRef = `ssh_passphrase_${editingSsh.id}`;

    try {
      if (authMode === 'password') {
        await saveSecure(passwordRef, password);
        await deleteSecure(privateKeyRef);
        await deleteSecure(passphraseRef);
      } else {
        await saveSecure(privateKeyRef, privateKey);
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
      ...editingSsh,
      host,
      username,
      port,
      remoteRoot: editingSsh.remoteRoot?.trim() || undefined,
      hostKeyPolicy,
      trustedHostFingerprint: preserveFingerprint ? trustedHostFingerprint : undefined,
      authMode,
      passwordRef: authMode === 'password' ? passwordRef : undefined,
      privateKeyRef: authMode === 'private-key' ? privateKeyRef : undefined,
      passphraseRef: authMode === 'private-key' && passphrase ? passphraseRef : undefined,
      ptyType: editingSsh.ptyType || 'xterm',
    };

    if (sshTargets.find((target) => target.id === normalizedTarget.id)) {
      updateSshTarget(normalizedTarget);
    } else {
      addSshTarget(normalizedTarget);
    }

    setEditingSsh(null);
    setSshPortText('22');
    setSshPassword('');
    setSshPrivateKey('');
    setSshPassphrase('');
    setSection('main');
  }, [
    addSshTarget,
    editingSsh,
    sshPassphrase,
    sshPassword,
    sshPortText,
    sshPrivateKey,
    sshTargets,
    t,
    updateSshTarget,
  ]);

  const handleFetchSshFingerprint = useCallback(async () => {
    if (!editingSsh) {
      return;
    }

    const host = editingSsh.host.trim();
    const username = editingSsh.username.trim();
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
      setEditingSsh((current) =>
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
  }, [editingSsh, sshPortText, t]);

  const handleDeleteSsh = useCallback(
    (id: string) => {
      Alert.alert(t('settings.deleteSshTarget'), t('settings.deleteSshTargetConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            const target = sshTargets.find((entry) => entry.id === id);
            removeSshTarget(id);
            if (target) {
              await clearStoredSshSecrets(target);
            }
            setEditingSsh(null);
            setSshPortText('22');
            setSshPassword('');
            setSshPrivateKey('');
            setSshPassphrase('');
            setSection('main');
          },
        },
      ]);
    },
    [removeSshTarget, sshTargets, t],
  );

  const handleNewWorkspace = useCallback(() => {
    setEditingWorkspace(createWorkspaceDraft({ name: t('settings.newWorkspaceTarget') }));
    setWorkspaceConfigRootsText('');
    setWorkspaceAccessToken('');
    setSection('workspace-edit');
  }, [t]);

  const handleEditWorkspace = useCallback((target: WorkspaceTargetConfig) => {
    setEditingWorkspace(prepareWorkspaceDraft(target));
    setWorkspaceConfigRootsText(formatPathList(target.configRoots));
    setWorkspaceAccessToken('');
    setSection('workspace-edit');
  }, []);

  const handleSaveWorkspace = useCallback(async () => {
    if (!editingWorkspace) {
      return;
    }

    const rootPath = editingWorkspace.rootPath.trim();
    const baseUrl = (editingWorkspace.baseUrl || '').trim();
    const provider = editingWorkspace.provider || 'code-server';
    const authMode = editingWorkspace.authMode || 'none';
    const queryTokenParam = (editingWorkspace.queryTokenParam || '').trim();
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

    if (authMode !== 'none' && !accessToken && !editingWorkspace.accessTokenRef) {
      Alert.alert(t('common.error'), t('settings.workspaceAccessTokenRequired'));
      return;
    }

    const accessTokenRef = `workspace_access_token_${editingWorkspace.id}`;
    try {
      if (authMode !== 'none' && accessToken) {
        await saveSecure(accessTokenRef, accessToken);
      } else {
        await deleteSecure(accessTokenRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return;
    }

    const normalizedTarget = normalizeWorkspaceTargetLinks(
      {
        ...editingWorkspace,
        name: getWorkspaceTargetDisplayName({
          ...editingWorkspace,
          rootPath,
          provider,
        }),
        rootPath,
        configRoots: parsePathList(workspaceConfigRootsText),
        provider,
        baseUrl,
        authMode,
        accessTokenRef:
          authMode !== 'none' ? editingWorkspace.accessTokenRef || accessTokenRef : undefined,
        queryTokenParam: authMode === 'query-token' ? queryTokenParam : undefined,
        browserProviderId: (editingWorkspace.browserProviderId || '').trim() || undefined,
        sshTargetId: (editingWorkspace.sshTargetId || '').trim() || undefined,
        aiTaskCommandTemplate: (editingWorkspace.aiTaskCommandTemplate || '').trim() || undefined,
      },
      {
        browserProviders,
        sshTargets,
      },
    );

    if (workspaceTargets.find((target) => target.id === normalizedTarget.id)) {
      updateWorkspaceTarget(normalizedTarget);
    } else {
      addWorkspaceTarget(normalizedTarget);
    }

    setEditingWorkspace(null);
    setWorkspaceConfigRootsText('');
    setWorkspaceAccessToken('');
    setSection('main');
  }, [
    addWorkspaceTarget,
    browserProviders,
    editingWorkspace,
    sshTargets,
    t,
    updateWorkspaceTarget,
    workspaceAccessToken,
    workspaceConfigRootsText,
    workspaceTargets,
  ]);

  const handleDeleteWorkspace = useCallback(
    (id: string) => {
      Alert.alert(t('settings.deleteWorkspaceTarget'), t('settings.deleteWorkspaceTargetConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            removeWorkspaceTarget(id);
            setEditingWorkspace(null);
            setWorkspaceConfigRootsText('');
            setWorkspaceAccessToken('');
            void deleteSecure(`workspace_access_token_${id}`);
            setSection('main');
          },
        },
      ]);
    },
    [removeWorkspaceTarget, t],
  );

  const handleNewBrowserProvider = useCallback(() => {
    setEditingBrowser(createBrowserDraft({ name: t('settings.newBrowserProvider') }));
    setBrowserApiKey('');
    setSection('browser-edit');
  }, [t]);

  const handleEditBrowserProvider = useCallback((provider: BrowserProviderConfig) => {
    setEditingBrowser(prepareBrowserDraft(provider));
    setBrowserApiKey('');
    setSection('browser-edit');
  }, []);

  const handleSaveBrowserProvider = useCallback(async () => {
    if (!editingBrowser) {
      return;
    }

    const baseUrl = (editingBrowser.baseUrl || '').trim();
    const authMode = editingBrowser.authMode || 'api-key-header';
    const provider = editingBrowser.provider || 'browserbase';
    const projectId = (editingBrowser.projectId || '').trim();
    const queryTokenParam = (editingBrowser.queryTokenParam || '').trim();
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

    if (authMode !== 'none' && !apiKey) {
      Alert.alert(t('common.error'), t('settings.browserApiKeyRequired'));
      return;
    }

    const apiKeyRef = `browser_provider_api_key_${editingBrowser.id}`;
    try {
      if (authMode !== 'none' && apiKey) {
        await saveSecure(apiKeyRef, apiKey);
      } else {
        await deleteSecure(apiKeyRef);
      }
    } catch {
      Alert.alert(t('common.error'), t('settings.secureKeySaveFailed'));
      return;
    }

    const normalizedProvider: BrowserProviderConfig = {
      ...editingBrowser,
      provider,
      baseUrl,
      authMode,
      apiKeyRef: authMode !== 'none' && apiKey ? apiKeyRef : undefined,
      queryTokenParam: authMode === 'query-token' ? queryTokenParam : undefined,
      projectId: provider === 'browserbase' ? projectId : undefined,
    };

    if (browserProviders.find((entry) => entry.id === normalizedProvider.id)) {
      updateBrowserProvider(normalizedProvider);
    } else {
      addBrowserProvider(normalizedProvider);
    }

    setEditingBrowser(null);
    setBrowserApiKey('');
    setSection('main');
  }, [
    addBrowserProvider,
    browserApiKey,
    browserProviders,
    editingBrowser,
    t,
    updateBrowserProvider,
  ]);

  const handleDeleteBrowserProvider = useCallback(
    (id: string) => {
      Alert.alert(t('settings.deleteBrowserProvider'), t('settings.deleteBrowserProviderConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            removeBrowserProvider(id);
            setEditingBrowser(null);
            setBrowserApiKey('');
            void deleteSecure(`browser_provider_api_key_${id}`);
            setSection('main');
          },
        },
      ]);
    },
    [removeBrowserProvider, t],
  );

  const handleNewExpoAccount = useCallback(() => {
    setEditingExpoAccount(createExpoAccountDraft({ name: t('settings.newExpoAccount') }));
    setExpoAccountToken('');
    setSection('expo-account-edit');
  }, [t]);

  const handleEditExpoAccount = useCallback((account: ExpoAccountConfig) => {
    setEditingExpoAccount(prepareExpoAccountDraft(account));
    setExpoAccountToken('');
    setSection('expo-account-edit');
  }, []);

  const handleSaveExpoAccount = useCallback(async () => {
    if (!editingExpoAccount) {
      return;
    }

    const owner = editingExpoAccount.owner.trim();
    if (!owner) {
      Alert.alert(t('common.error'), t('settings.expoOwnerRequired'));
      return;
    }

    const tokenRef = `expo_account_token_${editingExpoAccount.id}`;
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
      ...editingExpoAccount,
      name: editingExpoAccount.name.trim() || owner,
      owner,
      accountType: editingExpoAccount.accountType || 'personal',
      tokenRef: expoAccountToken.trim() ? tokenRef : undefined,
    };

    if (expoAccounts.find((account) => account.id === normalizedAccount.id)) {
      updateExpoAccount(normalizedAccount);
    } else {
      addExpoAccount(normalizedAccount);
    }

    if (normalizedAccount.tokenRef) {
      try {
        await syncExpoAccountProjects(normalizedAccount.id);
      } catch (error) {
        Alert.alert(
          t('common.error'),
          error instanceof Error ? error.message : 'Failed to sync Expo projects',
        );
      }
    }

    setEditingExpoAccount(null);
    setExpoAccountToken('');
    setSection('main');
  }, [addExpoAccount, editingExpoAccount, expoAccountToken, expoAccounts, t, updateExpoAccount]);

  const handleSyncExpoAccount = useCallback(
    async (accountId?: string) => {
      const targetAccountId = accountId || expoAccounts[0]?.id;
      if (!targetAccountId) {
        Alert.alert(t('common.error'), t('settings.expoAccountRequired'));
        return;
      }

      try {
        const result = await syncExpoAccountProjects(targetAccountId);
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
    [expoAccounts, t],
  );

  const handleDeleteExpoAccount = useCallback(
    (id: string) => {
      Alert.alert(t('settings.deleteExpoAccount'), t('settings.deleteExpoAccountConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            removeExpoAccount(id);
            setEditingExpoAccount(null);
            setExpoAccountToken('');
            void deleteSecure(`expo_account_token_${id}`);
            setSection('main');
          },
        },
      ]);
    },
    [removeExpoAccount, t],
  );

  const handleNewExpoProject = useCallback(() => {
    if (expoAccounts.length === 0) {
      Alert.alert(t('common.error'), t('settings.expoAccountRequired'));
      return;
    }

    setEditingExpoProject(
      createExpoProjectDraft(expoAccounts[0], sshTargets[0]?.id, {
        name: t('settings.newExpoProject'),
      }),
    );
    setSection('expo-project-edit');
  }, [expoAccounts, sshTargets, t]);

  const handleEditExpoProject = useCallback((project: ExpoProjectConfig) => {
    setEditingExpoProject(prepareExpoProjectDraft(project));
    setSection('expo-project-edit');
  }, []);

  const toggleExpoPlatform = useCallback((platform: 'android' | 'ios' | 'web') => {
    setEditingExpoProject((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        platforms: toggleExpoProjectPlatform(current.platforms, platform),
      };
    });
  }, []);

  const handleSaveExpoProject = useCallback(() => {
    if (!editingExpoProject) {
      return;
    }

    const linkedAccount = expoAccounts.find(
      (account) => account.id === editingExpoProject.accountId,
    );
    if (!linkedAccount) {
      Alert.alert(t('common.error'), t('settings.expoLinkedAccountRequired'));
      return;
    }

    const owner = editingExpoProject.owner.trim() || linkedAccount.owner.trim();
    const slug = editingExpoProject.slug.trim();
    if (!owner) {
      Alert.alert(t('common.error'), t('settings.expoProjectOwnerRequired'));
      return;
    }
    if (!slug) {
      Alert.alert(t('common.error'), t('settings.expoProjectSlugRequired'));
      return;
    }

    if (!editingExpoProject.platforms?.length) {
      Alert.alert(t('common.error'), t('settings.expoTargetPlatformsRequired'));
      return;
    }

    if (editingExpoProject.mode === 'direct-ssh') {
      if (!editingExpoProject.sshTargetId) {
        Alert.alert(t('common.error'), t('settings.expoDirectModeMissingSshTarget'));
        return;
      }
      if (!editingExpoProject.projectPath?.trim()) {
        Alert.alert(t('common.error'), t('settings.expoDirectModeProjectPathRequired'));
        return;
      }
    } else if (editingExpoProject.mode === 'github-workflow') {
      if (!editingExpoProject.repoFullName?.trim()) {
        Alert.alert(t('common.error'), t('settings.expoWorkflowRepositoryRequired'));
        return;
      }
      if (!editingExpoProject.workflowFile?.trim()) {
        Alert.alert(t('common.error'), t('settings.expoWorkflowFileRequired'));
        return;
      }
    }

    const normalizedProject: ExpoProjectConfig = {
      ...editingExpoProject,
      name: editingExpoProject.name.trim() || `${owner}/${slug}`,
      owner,
      slug,
      projectPath: editingExpoProject.projectPath?.trim() || undefined,
      repoFullName: editingExpoProject.repoFullName?.trim() || undefined,
      workflowFile: editingExpoProject.workflowFile?.trim() || undefined,
      workflowRef: editingExpoProject.workflowRef?.trim() || undefined,
      defaultBuildProfile: editingExpoProject.defaultBuildProfile?.trim() || undefined,
      defaultUpdateBranch: editingExpoProject.defaultUpdateBranch?.trim() || undefined,
      updateChannel: editingExpoProject.updateChannel?.trim() || undefined,
      webUrl: editingExpoProject.webUrl?.trim() || undefined,
      previewUrl: editingExpoProject.previewUrl?.trim() || undefined,
      customDomain: editingExpoProject.customDomain?.trim() || undefined,
      platforms: editingExpoProject.platforms,
    };

    if (expoProjects.find((project) => project.id === normalizedProject.id)) {
      updateExpoProject(normalizedProject);
    } else {
      addExpoProject(normalizedProject);
    }

    setEditingExpoProject(null);
    setSection('main');
  }, [addExpoProject, editingExpoProject, expoAccounts, expoProjects, t, updateExpoProject]);

  const handleDeleteExpoProject = useCallback(
    (id: string) => {
      Alert.alert(t('settings.deleteExpoProject'), t('settings.deleteExpoProjectConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            removeExpoProject(id);
            setEditingExpoProject(null);
            setSection('main');
          },
        },
      ]);
    },
    [removeExpoProject, t],
  );

  // --- Theme ---
  const ThemeButton: React.FC<{ value: ThemePreference; label: string; icon: React.ReactNode }> = ({
    value,
    label,
    icon,
  }) => (
    <TouchableOpacity
      style={[styles.themeBtn, theme === value && styles.themeBtnActive]}
      onPress={() => setTheme(value)}
      accessibilityRole="button"
      accessibilityLabel={t('settings.useTheme', { name: label })}
      accessibilityState={{ selected: theme === value }}
    >
      {icon}
      <Text style={[styles.themeBtnText, theme === value && styles.themeBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  // --- Provider Edit Section ---
  if (section === 'provider-edit' && editingProvider) {
    const localCatalog = editingProviderIsOnDevice
      ? getLocalLlmCatalogEntriesForProvider(editingProvider)
      : [];
    const selectedLocalCatalogEntry = editingProviderIsOnDevice
      ? getLocalLlmCatalogEntry(editingProvider.model) || localCatalog[0] || null
      : null;
    const canSaveProvider =
      !editingProviderIsOnDevice ||
      (isLocalLlmModelInstalled(editingProvider, editingProvider.model) &&
        !editingLocalModelDownloadInProgress);

    return (
      <SettingsProviderEditor
        editingProvider={editingProvider}
        isExisting={providers.some((provider) => provider.id === editingProvider.id)}
        isOnDevice={editingProviderIsOnDevice}
        canSave={canSaveProvider}
        localCatalog={localCatalog}
        selectedLocalCatalogEntry={selectedLocalCatalogEntry}
        tempApiKey={tempApiKey}
        showApiKey={showApiKey}
        editingLocalModelDownloadState={editingLocalModelDownloadState}
        editingLocalModelWasJustDownloaded={editingLocalModelWasJustDownloaded}
        handleDeleteProvider={handleDeleteProvider}
        handleDownloadSelectedLocalModel={handleDownloadSelectedLocalModel}
        handleSaveProvider={handleSaveProvider}
        isLocalLlmModelInstalled={isLocalLlmModelInstalled}
        onToggleShowApiKey={() => setShowApiKey(!showApiKey)}
        setEditingProvider={(provider) => setEditingProvider(provider)}
        setTempApiKey={setTempApiKey}
        colors={colors}
        styles={styles}
        t={t}
        scrollRef={editorScrollRef}
        onBack={() => setSection('main')}
        onTrackedScroll={(y) => updateTrackedScroll('provider-edit', y)}
        onRestore={() => restoreTrackedScroll('provider-edit', editorScrollRef)}
      />
    );
  }

  // --- MCP Edit Section ---
  if (section === 'mcp-edit' && editingMcp) {
    return (
      <SettingsMcpEditor
        editingMcp={editingMcp}
        normalizedEditingMcp={normalizedEditingMcp}
        hasStoredMcpOauthSession={hasStoredMcpOauthSession}
        isExisting={mcpServers.some((server) => server.id === editingMcp.id)}
        mcpHeadersText={mcpHeadersText}
        mcpOauthClientSecret={mcpOauthClientSecret}
        mcpTimeoutText={mcpTimeoutText}
        getMcpMetadataChips={getMcpMetadataChips}
        handleDeleteMcp={handleDeleteMcp}
        handleResetMcpOAuthSession={handleResetMcpOAuthSession}
        handleSaveMcp={handleSaveMcp}
        setEditingMcp={(server) => setEditingMcp(server)}
        setMcpHeadersText={setMcpHeadersText}
        setMcpOauthClientSecret={setMcpOauthClientSecret}
        setMcpTimeoutText={setMcpTimeoutText}
        colors={colors}
        styles={styles}
        t={t}
        scrollRef={editorScrollRef}
        onBack={() => setSection('main')}
        onTrackedScroll={(y) => updateTrackedScroll('mcp-edit', y)}
        onRestore={() => restoreTrackedScroll('mcp-edit', editorScrollRef)}
      />
    );
  }

  if (section === 'ssh-edit' && editingSsh) {
    return (
      <SettingsSshEditor
        editingSsh={editingSsh}
        isExisting={sshTargets.some((target) => target.id === editingSsh.id)}
        sshFingerprintPending={sshFingerprintPending}
        sshPassphrase={sshPassphrase}
        sshPassword={sshPassword}
        sshPortText={sshPortText}
        sshPrivateKey={sshPrivateKey}
        handleDeleteSsh={handleDeleteSsh}
        handleFetchSshFingerprint={handleFetchSshFingerprint}
        handleSaveSsh={handleSaveSsh}
        setEditingSsh={(target) => setEditingSsh(target)}
        setSshPassphrase={setSshPassphrase}
        setSshPassword={setSshPassword}
        setSshPortText={setSshPortText}
        setSshPrivateKey={setSshPrivateKey}
        colors={colors}
        styles={styles}
        t={t}
        scrollRef={editorScrollRef}
        onBack={() => setSection('main')}
        onTrackedScroll={(y) => updateTrackedScroll('ssh-edit', y)}
        onRestore={() => restoreTrackedScroll('ssh-edit', editorScrollRef)}
      />
    );
  }

  if (section === 'workspace-edit' && editingWorkspace) {
    return (
      <SettingsWorkspaceEditor
        editingWorkspace={editingWorkspace}
        isExisting={workspaceTargets.some((target) => target.id === editingWorkspace.id)}
        browserProviders={browserProviders}
        sshTargets={sshTargets}
        workspaceAccessToken={workspaceAccessToken}
        workspaceConfigRootsText={workspaceConfigRootsText}
        handleDeleteWorkspace={handleDeleteWorkspace}
        handleSaveWorkspace={handleSaveWorkspace}
        setEditingWorkspace={(target) => setEditingWorkspace(target)}
        setWorkspaceAccessToken={setWorkspaceAccessToken}
        setWorkspaceConfigRootsText={setWorkspaceConfigRootsText}
        colors={colors}
        styles={styles}
        t={t}
        scrollRef={editorScrollRef}
        onBack={() => setSection('main')}
        onTrackedScroll={(y) => updateTrackedScroll('workspace-edit', y)}
        onRestore={() => restoreTrackedScroll('workspace-edit', editorScrollRef)}
      />
    );
  }

  if (section === 'browser-edit' && editingBrowser) {
    return (
      <SettingsBrowserEditor
        editingBrowser={editingBrowser}
        isExisting={browserProviders.some((provider) => provider.id === editingBrowser.id)}
        browserApiKey={browserApiKey}
        handleSaveBrowserProvider={handleSaveBrowserProvider}
        handleDeleteBrowserProvider={handleDeleteBrowserProvider}
        setBrowserApiKey={setBrowserApiKey}
        setEditingBrowser={(provider) => setEditingBrowser(provider)}
        colors={colors}
        styles={styles}
        t={t}
        scrollRef={editorScrollRef}
        onBack={() => setSection('main')}
        onTrackedScroll={(y) => updateTrackedScroll('browser-edit', y)}
        onRestore={() => restoreTrackedScroll('browser-edit', editorScrollRef)}
      />
    );
  }

  if (section === 'expo-account-edit' && editingExpoAccount) {
    return (
      <SettingsExpoAccountEditor
        editingExpoAccount={editingExpoAccount}
        isExisting={expoAccounts.some((account) => account.id === editingExpoAccount.id)}
        expoAccountToken={expoAccountToken}
        handleDeleteExpoAccount={handleDeleteExpoAccount}
        handleSaveExpoAccount={handleSaveExpoAccount}
        setEditingExpoAccount={(account) => setEditingExpoAccount(account)}
        setExpoAccountToken={setExpoAccountToken}
        colors={colors}
        styles={styles}
        t={t}
        scrollRef={editorScrollRef}
        onBack={() => setSection('main')}
        onTrackedScroll={(y) => updateTrackedScroll('expo-account-edit', y)}
        onRestore={() => restoreTrackedScroll('expo-account-edit', editorScrollRef)}
      />
    );
  }

  if (section === 'expo-project-edit' && editingExpoProject) {
    return (
      <SettingsExpoProjectEditor
        editingExpoProject={editingExpoProject}
        isExisting={expoProjects.some((project) => project.id === editingExpoProject.id)}
        expoAccounts={expoAccounts}
        sshTargets={sshTargets}
        handleDeleteExpoProject={handleDeleteExpoProject}
        handleSaveExpoProject={handleSaveExpoProject}
        setEditingExpoProject={(project) => setEditingExpoProject(project)}
        toggleExpoPlatform={toggleExpoPlatform}
        colors={colors}
        styles={styles}
        t={t}
        scrollRef={editorScrollRef}
        onBack={() => setSection('main')}
        onTrackedScroll={(y) => updateTrackedScroll('expo-project-edit', y)}
        onRestore={() => restoreTrackedScroll('expo-project-edit', editorScrollRef)}
      />
    );
  }

  // --- Main Settings ---
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
        <Text style={styles.headerTitle}>{t('settings.title')}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ManagedScrollView
        ref={mainScrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        onTrackedScroll={(y) => updateTrackedScroll('main', y)}
        onRestore={() => restoreTrackedScroll('main', mainScrollRef)}
      >
        <View
          style={[styles.sectionCard, styles.overviewCard]}
          onLayout={(event) => {
            mainSectionOffsetsRef.current.overview = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>{t('settings.quickSetupTitle')}</Text>
            <Text style={styles.sectionCardHint}>{t('settings.quickSetupHint')}</Text>
          </View>
          <View style={styles.quickSetupGrid}>
            <TouchableOpacity
              style={[styles.quickSetupChip, providers.length > 0 && styles.quickSetupChipActive]}
              onPress={() =>
                providers.length > 0 ? void handleEditProvider(providers[0]) : handleNewProvider()
              }
              accessibilityRole="button"
              accessibilityLabel={t('settings.quickSetupAction', {
                name: t('settings.providers'),
                count: String(providers.length),
                status: providers.length > 0 ? t('settings.configured') : t('settings.needsSetup'),
              })}
            >
              <Cpu size={16} color={providers.length > 0 ? colors.success : colors.textTertiary} />
              <Text
                style={[styles.quickSetupLabel, providers.length > 0 && { color: colors.text }]}
              >
                {t('settings.providers')} {providers.length > 0 ? `(${providers.length})` : ''}
              </Text>
              {providers.length === 0 && <Plus size={14} color={colors.primary} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickSetupChip, mcpServers.length > 0 && styles.quickSetupChipActive]}
              onPress={() =>
                mcpServers.length > 0 ? void handleEditMcp(mcpServers[0]) : handleNewMcp()
              }
              accessibilityRole="button"
              accessibilityLabel={t('settings.quickSetupAction', {
                name: t('settings.mcpServers'),
                count: String(mcpServers.length),
                status: mcpServers.length > 0 ? t('settings.configured') : t('settings.needsSetup'),
              })}
            >
              <Server
                size={16}
                color={mcpServers.length > 0 ? colors.success : colors.textTertiary}
              />
              <Text
                style={[styles.quickSetupLabel, mcpServers.length > 0 && { color: colors.text }]}
              >
                {t('settings.mcpServers')} {mcpServers.length > 0 ? `(${mcpServers.length})` : ''}
              </Text>
              {mcpServers.length === 0 && <Plus size={14} color={colors.primary} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.quickSetupChip,
                (expoAccounts.length > 0 || expoProjects.length > 0) && styles.quickSetupChipActive,
              ]}
              onPress={() =>
                expoAccounts.length > 0
                  ? void handleEditExpoAccount(expoAccounts[0])
                  : handleNewExpoAccount()
              }
              accessibilityRole="button"
              accessibilityLabel={t('settings.quickSetupAction', {
                name: t('settings.expoAccounts'),
                count: String(expoAccounts.length + expoProjects.length),
                status:
                  expoAccounts.length > 0 || expoProjects.length > 0
                    ? t('settings.configured')
                    : t('settings.needsSetup'),
              })}
            >
              <Globe
                size={16}
                color={
                  expoAccounts.length > 0 || expoProjects.length > 0
                    ? colors.success
                    : colors.textTertiary
                }
              />
              <Text
                style={[
                  styles.quickSetupLabel,
                  (expoAccounts.length > 0 || expoProjects.length > 0) && { color: colors.text },
                ]}
              >
                {t('settings.quickSetupExpo')}{' '}
                {expoAccounts.length + expoProjects.length > 0
                  ? `(${expoAccounts.length + expoProjects.length})`
                  : ''}
              </Text>
              {expoAccounts.length + expoProjects.length === 0 && (
                <Plus size={14} color={colors.primary} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickSetupChip, sshTargets.length > 0 && styles.quickSetupChipActive]}
              onPress={() =>
                sshTargets.length > 0 ? void handleEditSsh(sshTargets[0]) : handleNewSsh()
              }
              accessibilityRole="button"
              accessibilityLabel={t('settings.quickSetupAction', {
                name: t('settings.sshTargets'),
                count: String(sshTargets.length),
                status: sshTargets.length > 0 ? t('settings.configured') : t('settings.needsSetup'),
              })}
            >
              <Key size={16} color={sshTargets.length > 0 ? colors.success : colors.textTertiary} />
              <Text
                style={[styles.quickSetupLabel, sshTargets.length > 0 && { color: colors.text }]}
              >
                {t('settings.sshTargets')} {sshTargets.length > 0 ? `(${sshTargets.length})` : ''}
              </Text>
              {sshTargets.length === 0 && <Plus size={14} color={colors.primary} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.quickSetupChip,
                browserProviders.length > 0 && styles.quickSetupChipActive,
              ]}
              onPress={() =>
                browserProviders.length > 0
                  ? handleEditBrowserProvider(browserProviders[0])
                  : handleNewBrowserProvider()
              }
              accessibilityRole="button"
              accessibilityLabel={t('settings.quickSetupAction', {
                name: t('settings.browserProviders'),
                count: String(browserProviders.length),
                status:
                  browserProviders.length > 0 ? t('settings.configured') : t('settings.needsSetup'),
              })}
            >
              <Search
                size={16}
                color={browserProviders.length > 0 ? colors.success : colors.textTertiary}
              />
              <Text
                style={[
                  styles.quickSetupLabel,
                  browserProviders.length > 0 && { color: colors.text },
                ]}
              >
                {t('settings.browserProviders')}{' '}
                {browserProviders.length > 0 ? `(${browserProviders.length})` : ''}
              </Text>
              {browserProviders.length === 0 && <Plus size={14} color={colors.primary} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.quickSetupChip,
                workspaceTargets.length > 0 && styles.quickSetupChipActive,
              ]}
              onPress={() =>
                workspaceTargets.length > 0
                  ? handleEditWorkspace(workspaceTargets[0])
                  : handleNewWorkspace()
              }
              accessibilityRole="button"
              accessibilityLabel={t('settings.quickSetupAction', {
                name: t('settings.workspaceTargets'),
                count: String(workspaceTargets.length),
                status:
                  workspaceTargets.length > 0 ? t('settings.configured') : t('settings.needsSetup'),
              })}
            >
              <Wrench
                size={16}
                color={workspaceTargets.length > 0 ? colors.success : colors.textTertiary}
              />
              <Text
                style={[
                  styles.quickSetupLabel,
                  workspaceTargets.length > 0 && { color: colors.text },
                ]}
              >
                {t('settings.workspaceTargets')}{' '}
                {workspaceTargets.length > 0 ? `(${workspaceTargets.length})` : ''}
              </Text>
              {workspaceTargets.length === 0 && <Plus size={14} color={colors.primary} />}
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sectionChipRow}
          style={styles.sectionChipScroller}
        >
          {mainSections.map((sectionMeta) => {
            const active = activeMainSection === sectionMeta.id;
            return (
              <TouchableOpacity
                key={sectionMeta.id}
                style={[styles.sectionChip, active ? styles.sectionChipActive : null]}
                onPress={() => handleJumpToMainSection(sectionMeta.id)}
                accessibilityRole="button"
                accessibilityLabel={sectionMeta.title}
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[styles.sectionChipText, active ? styles.sectionChipTextActive : null]}
                >
                  {sectionMeta.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View
          style={styles.sectionCard}
          onLayout={(event) => {
            mainSectionOffsetsRef.current.assistant = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>
              {t('settings.mainSections.assistant.title')}
            </Text>
            <Text style={styles.sectionCardHint}>{t('settings.mainSections.assistant.hint')}</Text>
          </View>

          {/* Theme */}
          <Text style={styles.sectionTitle}>{t('settings.appearance')}</Text>
          <View style={styles.themeRow}>
            <ThemeButton
              value="light"
              label={t('settings.light')}
              icon={
                <Sun size={18} color={theme === 'light' ? colors.primary : colors.textSecondary} />
              }
            />
            <ThemeButton
              value="dark"
              label={t('settings.dark')}
              icon={
                <Moon size={18} color={theme === 'dark' ? colors.primary : colors.textSecondary} />
              }
            />
            <ThemeButton
              value="system"
              label={t('settings.system')}
              icon={
                <Monitor
                  size={18}
                  color={theme === 'system' ? colors.primary : colors.textSecondary}
                />
              }
            />
          </View>

          {/* Language */}
          <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
          <TouchableOpacity
            style={styles.listItem}
            onPress={() => setShowLanguagePicker(true)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.language')}
          >
            <Languages size={18} color={colors.primary} />
            <View style={styles.listItemContent}>
              <Text style={styles.listItemTitle}>{LOCALE_DISPLAY_NAMES[locale]}</Text>
              <Text style={styles.listItemSubtitle}>{t('settings.languageHint')}</Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </TouchableOpacity>

          {/* Language Picker Modal */}
          <Modal
            visible={showLanguagePicker}
            transparent
            animationType="slide"
            onRequestClose={() => setShowLanguagePicker(false)}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>{t('settings.language')}</Text>
                {SUPPORTED_LOCALES.map((loc) => (
                  <TouchableOpacity
                    key={loc}
                    style={styles.langItem}
                    onPress={() => handleLocaleChange(loc)}
                    accessibilityRole="button"
                    accessibilityLabel={LOCALE_DISPLAY_NAMES[loc]}
                  >
                    <Text
                      style={[
                        styles.langItemText,
                        locale === loc && { color: colors.primary, fontWeight: '700' },
                      ]}
                    >
                      {LOCALE_DISPLAY_NAMES[loc]}
                    </Text>
                    {locale === loc && <Check size={18} color={colors.primary} />}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.modalCloseBtn}
                  onPress={() => setShowLanguagePicker(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.cancel')}
                >
                  <Text style={styles.modalCloseBtnText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Features */}
          <Text style={styles.sectionTitle}>{t('settings.features')}</Text>

          <View style={styles.featureRow}>
            <Link2 size={18} color={colors.primary} />
            <View style={styles.featureContent}>
              <Text style={styles.switchLabel}>{t('settings.linkUnderstanding')}</Text>
              <Text style={styles.featureHint}>{t('settings.linkUnderstandingHint')}</Text>
            </View>
            <Switch
              value={linkUnderstandingEnabled}
              onValueChange={setLinkUnderstandingEnabled}
              trackColor={{ true: colors.primary }}
            />
          </View>

          {linkUnderstandingEnabled && (
            <View style={styles.featureSubRow}>
              <Text style={styles.featureSubLabel}>{t('settings.maxLinks')}</Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => setMaxLinks(maxLinks - 1)}
                  disabled={maxLinks <= 1}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.remove')}
                >
                  <Text style={styles.stepperBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepperValue}>{maxLinks}</Text>
                <TouchableOpacity
                  style={styles.stepperBtn}
                  onPress={() => setMaxLinks(maxLinks + 1)}
                  disabled={maxLinks >= 10}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.add')}
                >
                  <Text style={styles.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.featureRow}>
            <Image size={18} color={colors.primary} />
            <View style={styles.featureContent}>
              <Text style={styles.switchLabel}>{t('settings.mediaUnderstanding')}</Text>
              <Text style={styles.featureHint}>{t('settings.mediaUnderstandingHint')}</Text>
            </View>
            <Switch
              value={mediaUnderstandingEnabled}
              onValueChange={setMediaUnderstandingEnabled}
              trackColor={{ true: colors.primary }}
            />
          </View>

          <Text style={styles.sectionTitle}>{t('settings.defaultConversationMode')}</Text>
          <View style={styles.listItem}>
            <View style={styles.listItemContent}>
              <Text style={styles.listItemTitle}>
                {t('settings.defaultConversationModeSummary')}
              </Text>
              <Text style={styles.listItemSubtitle}>
                {t('settings.defaultConversationModeHint')}
              </Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
            <TouchableOpacity
              style={[
                styles.presetChip,
                defaultConversationMode === 'agentic' && styles.presetChipActive,
              ]}
              onPress={() => setDefaultConversationMode('agentic')}
              accessibilityRole="button"
              accessibilityLabel={t('settings.defaultConversationModeAgenticAccessibility')}
              accessibilityState={{ selected: defaultConversationMode === 'agentic' }}
            >
              <Text
                style={[
                  styles.presetChipText,
                  defaultConversationMode === 'agentic' && styles.presetChipTextActive,
                ]}
              >
                {t('settings.defaultConversationModeAgentic')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.presetChip,
                defaultConversationMode === 'chitchat' && styles.presetChipActive,
              ]}
              onPress={() => setDefaultConversationMode('chitchat')}
              accessibilityRole="button"
              accessibilityLabel={t('settings.defaultConversationModeChitchatAccessibility')}
              accessibilityState={{ selected: defaultConversationMode === 'chitchat' }}
            >
              <Text
                style={[
                  styles.presetChipText,
                  defaultConversationMode === 'chitchat' && styles.presetChipTextActive,
                ]}
              >
                {t('settings.defaultConversationModeChitchat')}
              </Text>
            </TouchableOpacity>
          </ScrollView>

          <Text style={styles.sectionTitle}>{t('settings.reasoningTitle')}</Text>
          <View style={styles.listItem}>
            <Brain size={18} color={colors.primary} />
            <View style={styles.listItemContent}>
              <Text style={styles.listItemTitle}>{t('settings.thinkingLevelTitle')}</Text>
              <Text style={styles.listItemSubtitle}>{t('settings.thinkingLevelHint')}</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
            {thinkingLevelOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.presetChip,
                  thinkingLevel === option.value && styles.presetChipActive,
                ]}
                onPress={() => setThinkingLevel(option.value)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.useThinkingLevel', { name: option.label })}
                accessibilityState={{ selected: thinkingLevel === option.value }}
              >
                <Brain
                  size={14}
                  color={thinkingLevel === option.value ? colors.onPrimary : colors.primary}
                />
                <Text
                  style={[
                    styles.presetChipText,
                    thinkingLevel === option.value && styles.presetChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.listItemSubtitle}>
            {thinkingLevelOptions.find((option) => option.value === thinkingLevel)?.hint}
          </Text>
        </View>

        <View
          style={styles.sectionCard}
          onLayout={(event) => {
            mainSectionOffsetsRef.current.tools = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>{t('settings.mainSections.tools.title')}</Text>
            <Text style={styles.sectionCardHint}>{t('settings.mainSections.tools.hint')}</Text>
          </View>

          <Text style={styles.sectionTitle}>{t('settings.webAndTools')}</Text>
          <Text style={styles.label}>{t('settings.webSearchProvider')}</Text>
          <Text style={styles.listItemSubtitle}>{t('settings.webSearchProviderHint')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
            {webSearchProviderOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.presetChip,
                  webSearchProvider === option.value && styles.presetChipActive,
                ]}
                onPress={() => setWebSearchProvider(option.value)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.useWebSearchProvider', { name: option.label })}
                accessibilityState={{ selected: webSearchProvider === option.value }}
              >
                <Search
                  size={14}
                  color={webSearchProvider === option.value ? colors.onPrimary : colors.primary}
                />
                <Text
                  style={[
                    styles.presetChipText,
                    webSearchProvider === option.value && styles.presetChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.listItemSubtitle}>
            {webSearchProviderOptions.find((option) => option.value === webSearchProvider)?.detail}
          </Text>

          <Text style={styles.label}>{t('settings.secureKeys')}</Text>
          <Text style={styles.listItemSubtitle}>{t('settings.secureKeysHint')}</Text>
          {SERVICE_SETUP_FIELDS.map((field) => {
            const configured = Boolean(serviceKeys[field.storageKey]?.trim());
            const copy = getServiceFieldCopy(field);
            return (
              <View key={field.storageKey} style={styles.secureKeyBlock}>
                <View style={styles.secureKeyHeader}>
                  <View style={styles.secureKeyTitleWrap}>
                    <Text style={styles.secureKeyTitle}>{copy.label}</Text>
                    <Text style={styles.secureKeyMeta}>{copy.category}</Text>
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      configured ? styles.statusPillReady : styles.statusPillMissing,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        configured ? styles.statusPillTextReady : styles.statusPillTextMissing,
                      ]}
                    >
                      {configured ? t('settings.configured') : t('settings.needsSetup')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.secureKeyHint}>{copy.hint}</Text>
                <Text style={styles.setupDetail}>
                  <Text style={styles.setupLabel}>{t('settings.unlocksLabel')}</Text> {copy.unlocks}
                </Text>
                <Text style={styles.setupDetail}>
                  <Text style={styles.setupLabel}>{t('settings.setupLabel')}</Text> {copy.setup}
                </Text>
                <Text style={styles.setupDetail}>
                  <Text style={styles.setupLabel}>{t('settings.freeUseLabel')}</Text>{' '}
                  {copy.freeAccess}
                </Text>
                <TextInput
                  style={styles.input}
                  value={serviceKeys[field.storageKey] || ''}
                  onChangeText={(value) =>
                    setServiceKeys((current) => ({ ...current, [field.storageKey]: value }))
                  }
                  onEndEditing={(event) =>
                    void persistServiceKey(field.storageKey, event.nativeEvent.text || '')
                  }
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />
                {field.docsUrl ? (
                  <TouchableOpacity
                    style={styles.inlineLink}
                    onPress={() => void handleOpenUrl(field.docsUrl)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.openDocsFor', { name: copy.label })}
                  >
                    <ExternalLink size={14} color={colors.primary} />
                    <Text style={styles.inlineLinkText}>{t('settings.openOfficialSetupDocs')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}

          <Text style={styles.label}>{t('settings.builtInTools')}</Text>
          {builtInToolSections.map((section) => {
            const IconComponent = section.icon;
            return (
              <View key={section.title} style={styles.listItem}>
                <IconComponent size={18} color={colors.primary} />
                <View style={styles.listItemContent}>
                  <Text style={styles.listItemTitle}>{section.title}</Text>
                  <Text style={styles.listItemSubtitle}>{section.description}</Text>
                </View>
              </View>
            );
          })}

          <CollapsibleSection
            title={t('settings.toolPermissionsTitle')}
            open={expandedPanels.toolPermissions}
            onToggle={() => togglePanel('toolPermissions')}
            colors={colors}
          >
            <View style={styles.listItem}>
              <ShieldCheck size={18} color={colors.primary} />
              <View style={styles.listItemContent}>
                <Text style={styles.listItemTitle}>{t('settings.toolPermissionsCardTitle')}</Text>
                <Text style={styles.listItemSubtitle}>{t('settings.toolPermissionsCardHint')}</Text>
              </View>
            </View>
            {toolGroups.map((group) => {
              const isExpanded = expandedGroups.has(group.id);
              const totalTools = group.definitions.length;
              const enabledCount = group.definitions.filter((d) => {
                const p = permissionStateByTool.get(d.name);
                return p ? p.allowed : true;
              }).length;
              const enableAll = enabledCount === totalTools;
              return (
                <View key={group.id} style={styles.permissionGroup}>
                  <TouchableOpacity
                    style={styles.permissionGroupHeader}
                    onPress={() => toggleGroup(group.id)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.toolGroupAccessibility', {
                      name: t(`settings.toolGroups.${group.id}.title`),
                      enabled: String(enabledCount),
                      total: String(totalTools),
                    })}
                  >
                    <View style={styles.permissionGroupHeaderText}>
                      <Text style={styles.permissionGroupTitle}>
                        {t(`settings.toolGroups.${group.id}.title`)}
                      </Text>
                      <Text style={styles.permissionGroupCount}>
                        {t('settings.toolGroupCount', {
                          enabled: String(enabledCount),
                          total: String(totalTools),
                        })}
                      </Text>
                    </View>
                    <View style={styles.permissionGroupActions}>
                      <Switch
                        value={enableAll}
                        onValueChange={(value) => {
                          for (const d of group.definitions) {
                            setToolPermission(d.name, value);
                          }
                        }}
                        trackColor={{ true: colors.primary }}
                      />
                      <ChevronDown
                        size={18}
                        color={colors.textSecondary}
                        style={isExpanded ? { transform: [{ rotate: '180deg' }] } : undefined}
                      />
                    </View>
                  </TouchableOpacity>
                  {isExpanded
                    ? group.definitions.map((definition) => {
                        const permission = permissionStateByTool.get(definition.name);
                        const allowed = permission ? permission.allowed : true;
                        return (
                          <View key={definition.name} style={styles.permissionRow}>
                            <View style={styles.permissionTextWrap}>
                              <Text style={styles.permissionToolName}>{definition.name}</Text>
                              <Text style={styles.permissionToolDescription} numberOfLines={2}>
                                {definition.description}
                              </Text>
                            </View>
                            <Switch
                              value={allowed}
                              onValueChange={(value) => setToolPermission(definition.name, value)}
                              trackColor={{ true: colors.primary }}
                            />
                          </View>
                        );
                      })
                    : null}
                </View>
              );
            })}
          </CollapsibleSection>
        </View>

        <View
          style={styles.sectionCard}
          onLayout={(event) => {
            mainSectionOffsetsRef.current.personas = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>{t('settings.mainSections.personas.title')}</Text>
            <Text style={styles.sectionCardHint}>{t('settings.mainSections.personas.hint')}</Text>
          </View>

          <CollapsibleSection
            title={t('settings.personasTitle')}
            open={expandedPanels.personas}
            onToggle={() => togglePanel('personas')}
            colors={colors}
          >
            <View style={styles.listItem}>
              <Bot size={18} color={colors.primary} />
              <View style={styles.listItemContent}>
                <Text style={styles.listItemTitle}>{t('settings.personasCardTitle')}</Text>
                <Text style={styles.listItemSubtitle}>{t('settings.personasCardHint')}</Text>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
              {personas.map((persona) => (
                <TouchableOpacity
                  key={persona.id}
                  style={[
                    styles.presetChip,
                    editingPersonaId === persona.id && styles.presetChipActive,
                  ]}
                  onPress={() => setEditingPersonaId(persona.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.configurePersona', { name: persona.name })}
                  accessibilityState={{ selected: editingPersonaId === persona.id }}
                >
                  <Bot
                    size={14}
                    color={editingPersonaId === persona.id ? colors.onPrimary : colors.primary}
                  />
                  <Text
                    style={[
                      styles.presetChipText,
                      editingPersonaId === persona.id && styles.presetChipTextActive,
                    ]}
                  >
                    {persona.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {currentPersona ? (
              <View style={styles.personaCard}>
                <Text style={styles.secureKeyTitle}>{currentPersona.name}</Text>
                <Text style={styles.secureKeyHint}>{currentPersona.description}</Text>

                <Text style={styles.label}>{t('settings.personaDisplayName')}</Text>
                <TextInput
                  style={styles.input}
                  value={personaDraft.name || ''}
                  onChangeText={(value) =>
                    setPersonaDraft((current) => ({ ...current, name: value }))
                  }
                  placeholder={t('settings.personaDisplayNamePlaceholder')}
                  placeholderTextColor={colors.placeholder}
                />

                <Text style={styles.label}>{t('settings.personaDescription')}</Text>
                <TextInput
                  style={styles.input}
                  value={personaDraft.description || ''}
                  onChangeText={(value) =>
                    setPersonaDraft((current) => ({ ...current, description: value }))
                  }
                  placeholder={t('settings.personaDescriptionPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                />

                <Text style={styles.label}>{t('settings.personaProviderOverride')}</Text>
                <TextInput
                  style={styles.input}
                  value={personaDraft.providerId || ''}
                  onChangeText={(value) =>
                    setPersonaDraft((current) => ({ ...current, providerId: value }))
                  }
                  placeholder={t('settings.personaProviderOverridePlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                />

                <Text style={styles.label}>{t('settings.personaModelOverride')}</Text>
                <TextInput
                  style={styles.input}
                  value={personaDraft.model || ''}
                  onChangeText={(value) =>
                    setPersonaDraft((current) => ({ ...current, model: value }))
                  }
                  placeholder={t('settings.personaModelOverridePlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="none"
                />

                <Text style={styles.label}>{t('settings.personaThinkingLevel')}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.presetRow}
                >
                  {personaThinkingLevelOptions.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.presetChip,
                        personaDraft.thinkingLevel === option.value && styles.presetChipActive,
                      ]}
                      onPress={() =>
                        setPersonaDraft((current) => ({ ...current, thinkingLevel: option.value }))
                      }
                    >
                      <Text
                        style={[
                          styles.presetChipText,
                          personaDraft.thinkingLevel === option.value &&
                            styles.presetChipTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.label}>{t('settings.personaTemperature')}</Text>
                <TextInput
                  style={styles.input}
                  value={
                    personaDraft.temperature !== undefined ? String(personaDraft.temperature) : ''
                  }
                  onChangeText={(value) => {
                    const parsed = value.trim() === '' ? undefined : Number.parseFloat(value);
                    setPersonaDraft((current) => ({
                      ...current,
                      temperature: Number.isFinite(parsed as number) ? parsed : undefined,
                    }));
                  }}
                  placeholder={t('settings.personaTemperaturePlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  keyboardType="decimal-pad"
                />

                <Text style={styles.label}>{t('settings.systemPrompt')}</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={personaDraft.systemPrompt || ''}
                  onChangeText={(value) =>
                    setPersonaDraft((current) => ({ ...current, systemPrompt: value }))
                  }
                  placeholder={t('settings.personaSystemPromptPlaceholder')}
                  placeholderTextColor={colors.placeholder}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />

                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleSavePersona}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.savePersonaAccessibility', {
                    name: currentPersona.name,
                  })}
                >
                  <Text style={styles.primaryButtonText}>
                    {t('settings.savePersonaConfiguration')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </CollapsibleSection>
        </View>

        {/* System Prompt */}
        <Text style={styles.sectionTitle}>{t('settings.systemPrompt')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={systemPrompt}
          onChangeText={setSystemPrompt}
          placeholder={t('settings.systemPromptPlaceholder')}
          placeholderTextColor={colors.placeholder}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <View
          style={styles.sectionCard}
          onLayout={(event) => {
            mainSectionOffsetsRef.current.surfaces = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>{t('settings.mainSections.surfaces.title')}</Text>
            <Text style={styles.sectionCardHint}>{t('settings.mainSections.surfaces.hint')}</Text>
          </View>

          <CollapsibleSection
            title={t('settings.executionSurfaces')}
            open={expandedPanels.executionSurfaces}
            onToggle={() => togglePanel('executionSurfaces')}
            colors={colors}
          >
            <Text style={styles.listItemSubtitle}>{t('settings.executionSurfacesHint')}</Text>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('settings.sshTargets')}</Text>
              <TouchableOpacity
                onPress={handleNewSsh}
                accessibilityRole="button"
                accessibilityLabel={t('settings.addSshTarget')}
              >
                <Plus size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {sshTargets.map((target) => (
              <TouchableOpacity
                key={target.id}
                style={styles.listItem}
                onPress={() => handleEditSsh(target)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.editSshTarget')}
              >
                <Server size={18} color={target.enabled ? colors.primary : colors.textTertiary} />
                <View style={styles.listItemContent}>
                  <Text style={styles.listItemTitle}>{target.name}</Text>
                  <Text
                    style={styles.listItemSubtitle}
                  >{`${target.username}@${target.host}:${target.port}`}</Text>
                  {target.remoteRoot ? (
                    <Text style={styles.listItemSubtitle}>{target.remoteRoot}</Text>
                  ) : null}
                  <Text style={styles.listItemSubtitle}>
                    {getSshTargetAuthModeLabel(target)} · {getSshHostKeyPolicyLabel(target)} ·{' '}
                    {getSshTargetReadiness(target).launchable
                      ? t('remoteWork.statusReady')
                      : t('remoteWork.statusSetupRequired')}
                  </Text>
                  {target.trustedHostFingerprint ? (
                    <Text style={styles.listItemSubtitle}>{target.trustedHostFingerprint}</Text>
                  ) : null}
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}

            {sshTargets.length === 0 ? (
              <Text style={styles.emptyText}>{t('settings.noSshTargets')}</Text>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('settings.workspaceTargets')}</Text>
              <TouchableOpacity
                onPress={handleNewWorkspace}
                accessibilityRole="button"
                accessibilityLabel={t('settings.addWorkspaceTarget')}
              >
                <Plus size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {workspaceTargets.map((target) => (
              <TouchableOpacity
                key={target.id}
                style={styles.listItem}
                onPress={() => handleEditWorkspace(target)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.editWorkspaceTarget')}
              >
                <Cpu size={18} color={target.enabled ? colors.primary : colors.textTertiary} />
                <View style={styles.listItemContent}>
                  <Text style={styles.listItemTitle}>{target.name}</Text>
                  <Text style={styles.listItemSubtitle}>{target.rootPath}</Text>
                  <Text style={styles.listItemSubtitle}>
                    {target.baseUrl?.trim() || t('remoteWork.notConfigured')}
                  </Text>
                  <Text style={styles.listItemSubtitle}>
                    {getWorkspaceProviderLabel(target.provider)} ·{' '}
                    {getWorkspaceTargetReadiness(target).launchable
                      ? t('remoteWork.statusReady')
                      : t('remoteWork.statusSetupRequired')}
                  </Text>
                  {(target.configRoots || []).length > 0 ? (
                    <Text style={styles.listItemSubtitle}>
                      {t('settings.workspaceConfigRootsCount', {
                        count: String((target.configRoots || []).length),
                      })}
                    </Text>
                  ) : null}
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}

            {workspaceTargets.length === 0 ? (
              <Text style={styles.emptyText}>{t('settings.noWorkspaceTargets')}</Text>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('settings.browserProviders')}</Text>
              <TouchableOpacity
                onPress={handleNewBrowserProvider}
                accessibilityRole="button"
                accessibilityLabel={t('settings.addBrowserProvider')}
              >
                <Plus size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {browserProviders.map((provider) => (
              <TouchableOpacity
                key={provider.id}
                style={styles.listItem}
                onPress={() => handleEditBrowserProvider(provider)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.editBrowserProvider')}
              >
                <ShieldCheck
                  size={18}
                  color={provider.enabled ? colors.primary : colors.textTertiary}
                />
                <View style={styles.listItemContent}>
                  <Text style={styles.listItemTitle}>{provider.name}</Text>
                  <Text style={styles.listItemSubtitle}>
                    {getBrowserProviderLabel(provider.provider)}
                  </Text>
                  <Text style={styles.listItemSubtitle}>
                    {provider.baseUrl?.trim() || t('remoteWork.notConfigured')}
                  </Text>
                  <Text style={styles.listItemSubtitle}>
                    {getBrowserProviderAuthLabel(provider.authMode)} ·{' '}
                    {getBrowserProviderReadiness(provider).launchable
                      ? t('remoteWork.statusReady')
                      : t('remoteWork.statusSetupRequired')}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}

            {browserProviders.length === 0 ? (
              <Text style={styles.emptyText}>{t('settings.noBrowserProviders')}</Text>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('settings.expoAccounts')}</Text>
              <TouchableOpacity
                onPress={handleNewExpoAccount}
                accessibilityRole="button"
                accessibilityLabel={t('settings.addExpoAccount')}
              >
                <Plus size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {expoAccounts.map((account) => (
              <TouchableOpacity
                key={account.id}
                style={styles.listItem}
                onPress={() => handleEditExpoAccount(account)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.editNamedExpoAccount', { name: account.name })}
              >
                <CloudSun
                  size={18}
                  color={account.enabled ? colors.primary : colors.textTertiary}
                />
                <View style={styles.listItemContent}>
                  <Text style={styles.listItemTitle}>{account.name}</Text>
                  <Text style={styles.listItemSubtitle}>{account.owner}</Text>
                  <Text style={styles.listItemSubtitle}>
                    {account.accountType === 'robot'
                      ? t('settings.expoAccountTokenRobot')
                      : t('settings.expoAccountTokenPersonal')}{' '}
                    · {account.tokenRef ? t('settings.tokenSaved') : t('settings.tokenMissing')}
                  </Text>
                  <Text style={styles.listItemSubtitle}>
                    {account.lastProjectSyncError
                      ? `Sync failed · ${account.lastProjectSyncError}`
                      : `Projects synced · ${account.syncedProjectCount || 0}`}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}

            {expoAccounts.length === 0 ? (
              <Text style={styles.emptyText}>{t('settings.noExpoAccounts')}</Text>
            ) : null}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('settings.expoProjects')}</Text>
              <TouchableOpacity
                onPress={() =>
                  expoAccounts.length > 0 ? void handleSyncExpoAccount() : handleNewExpoAccount()
                }
                accessibilityRole="button"
                accessibilityLabel={
                  expoAccounts.length > 0 ? 'Sync Expo projects' : t('settings.addExpoAccount')
                }
              >
                <Plus size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {expoProjects.map((project) => {
              const account = expoAccounts.find((entry) => entry.id === project.accountId);
              const readiness = getExpoProjectReadiness(project, account, { sshTargets });
              const mode = getExpoProjectExecutionMode(project, account);
              return (
                <TouchableOpacity
                  key={project.id}
                  style={styles.listItem}
                  onPress={() => handleEditExpoProject(project)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.editNamedExpoProject', { name: project.name })}
                >
                  <Globe size={18} color={project.enabled ? colors.primary : colors.textTertiary} />
                  <View style={styles.listItemContent}>
                    <Text style={styles.listItemTitle}>{project.name}</Text>
                    <Text
                      style={styles.listItemSubtitle}
                    >{`${getExpoProjectDisplayOwner(project, account)}/${project.slug}`}</Text>
                    <Text style={styles.listItemSubtitle}>
                      {mode === 'eas-workflow'
                        ? t('settings.expoExecutionModeEasWorkflow')
                        : mode === 'github-workflow'
                          ? t('settings.expoExecutionModeGithubWorkflow')
                          : t('settings.expoExecutionModeDirectSsh')}{' '}
                      · {getExpoProjectReadinessLabel(readiness)}
                    </Text>
                    {project.webUrl ? (
                      <Text style={styles.listItemSubtitle}>{project.webUrl}</Text>
                    ) : null}
                  </View>
                  <ChevronRight size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })}

            {expoProjects.length === 0 ? (
              <Text style={styles.emptyText}>
                {expoAccounts.length > 0
                  ? 'No Expo projects synced yet. Sync a linked account to import its existing Expo projects.'
                  : t('settings.noExpoProjects')}
              </Text>
            ) : null}

            {/* Providers */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('settings.providers')}</Text>
              <TouchableOpacity
                onPress={() => handleNewProvider()}
                accessibilityRole="button"
                accessibilityLabel={t('settings.addProvider')}
              >
                <Plus size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {/* Quick add presets */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetRow}>
              {KNOWN_PROVIDERS.map((preset) => (
                <TouchableOpacity
                  key={preset.name}
                  style={styles.presetChip}
                  onPress={() => handleNewProvider(preset)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.addNamedProvider', { name: preset.name })}
                >
                  {preset.kind === 'on-device' ? (
                    <Cpu size={14} color={colors.primary} />
                  ) : (
                    <Globe size={14} color={colors.primary} />
                  )}
                  <Text style={styles.presetChipText}>{preset.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {providers.map((provider) => (
              <TouchableOpacity
                key={provider.id}
                style={styles.listItem}
                onPress={() => handleEditProvider(provider)}
                accessibilityRole="button"
                accessibilityLabel={t('settings.editNamedProvider', { name: provider.name })}
              >
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: provider.enabled ? colors.success : colors.textTertiary },
                  ]}
                />
                <View style={styles.listItemContent}>
                  <Text style={styles.listItemTitle}>{provider.name}</Text>
                  <Text style={styles.listItemSubtitle}>
                    {isOnDeviceLlmProvider(provider)
                      ? getLocalLlmModelDisplayName(provider.model)
                      : provider.model || provider.baseUrl}
                  </Text>
                  {isOnDeviceLlmProvider(provider) &&
                  localRuntimeStatusesByProviderId[provider.id] ? (
                    <Text style={styles.listItemSubtitle}>
                      {formatLocalLlmRuntimeStatusLabel(
                        localRuntimeStatusesByProviderId[provider.id],
                      )}
                    </Text>
                  ) : null}
                </View>
                <ChevronRight size={18} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}

            {providers.length === 0 && (
              <Text style={styles.emptyText}>{t('settings.noProviders')}</Text>
            )}

            {/* MCP Servers */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('settings.mcpServers')}</Text>
              <TouchableOpacity
                onPress={handleNewMcp}
                accessibilityRole="button"
                accessibilityLabel={t('settings.addMcpServer')}
              >
                <Plus size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>

            {mcpServers.map((server) =>
              (() => {
                const normalizedServer = normalizeMcpServerConfigMetadata(server);
                return (
                  <TouchableOpacity
                    key={server.id}
                    style={styles.listItem}
                    onPress={() => handleEditMcp(server)}
                    accessibilityRole="button"
                    accessibilityLabel={t('settings.editNamedMcpServer', { name: server.name })}
                  >
                    <Server
                      size={18}
                      color={server.enabled ? colors.primary : colors.textTertiary}
                    />
                    <View style={styles.listItemContent}>
                      <Text style={styles.listItemTitle}>{server.name}</Text>
                      <Text style={styles.listItemSubtitle}>{server.url}</Text>
                      <Text style={styles.listItemSubtitle}>
                        {getMcpMetadataChips(normalizedServer).join(' · ')}
                      </Text>
                    </View>
                    <ChevronRight size={18} color={colors.textTertiary} />
                  </TouchableOpacity>
                );
              })(),
            )}

            {mcpServers.length === 0 && (
              <Text style={styles.emptyText}>{t('settings.noMcpServers')}</Text>
            )}
          </CollapsibleSection>
        </View>

        {/* Danger Zone */}
        <View
          style={styles.sectionCard}
          onLayout={(event) => {
            mainSectionOffsetsRef.current.data = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>{t('settings.mainSections.data.title')}</Text>
            <Text style={styles.sectionCardHint}>{t('settings.mainSections.data.hint')}</Text>
          </View>

          {/* Privacy — long-term memory opt-out */}
          <View style={styles.featureRow}>
            <Brain size={18} color={colors.primary} />
            <View style={styles.featureContent}>
              <Text style={styles.switchLabel}>{t('memory.disableLongTermMemory')}</Text>
              <Text style={styles.featureHint}>{t('memory.disableLongTermMemoryHint')}</Text>
            </View>
            <Switch
              value={disableLongTermMemory}
              onValueChange={setDisableLongTermMemory}
              trackColor={{ true: colors.primary }}
              accessibilityLabel={t('memory.disableLongTermMemory')}
            />
          </View>

          {/* Consolidation provider selector */}
          {!disableLongTermMemory && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.label}>{t('memory.consolidationProvider')}</Text>
              <Text style={styles.listItemSubtitle}>
                {t('memory.consolidationProviderHint')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={[styles.presetRow, { flexGrow: 0, flexShrink: 0 }]}
              >
                <TouchableOpacity
                  key="__off__"
                  style={[
                    styles.presetChip,
                    consolidationProviderId === null && styles.presetChipActive,
                  ]}
                  onPress={() => setConsolidationProvider(null)}
                  accessibilityRole="button"
                  accessibilityLabel={t('memory.consolidationProviderOff')}
                  accessibilityState={{ selected: consolidationProviderId === null }}
                  testID="consolidation-provider-chip-off"
                >
                  <Text
                    style={[
                      styles.presetChipText,
                      consolidationProviderId === null && styles.presetChipTextActive,
                    ]}
                  >
                    {t('memory.consolidationProviderOff')}
                  </Text>
                </TouchableOpacity>
                {providers
                  .filter((p) => p.enabled)
                  .map((p) => {
                    const selected = consolidationProviderId === p.id;
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.presetChip, selected && styles.presetChipActive]}
                        onPress={() => setConsolidationProvider(p.id)}
                        accessibilityRole="button"
                        accessibilityLabel={p.name}
                        accessibilityState={{ selected }}
                        testID={`consolidation-provider-chip-${p.id}`}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            selected && styles.presetChipTextActive,
                          ]}
                        >
                          {p.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </ScrollView>
            </View>
          )}

          <Text style={[styles.sectionTitle, { marginTop: 24 }]}>{t('settings.data')}</Text>

          <TouchableOpacity
            style={styles.dangerBtn}
            onPress={() => {
              Alert.alert(t('chat.clearAll'), t('chat.clearAllConfirm'), [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('common.delete'), style: 'destructive', onPress: clearAllConversations },
              ]);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.clearAllData')}
          >
            <Trash2 size={18} color={colors.danger} />
            <Text style={styles.dangerBtnText}>{t('settings.clearAllData')}</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </View>
      </ManagedScrollView>
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
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.text,
    },
    saveBtn: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.primary,
    },
    saveBtnDisabled: {
      color: colors.textTertiary,
    },
    content: {
      flex: 1,
    },
    contentContainer: {
      padding: 16,
      paddingBottom: 32,
    },
    sectionCard: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    overviewCard: {
      marginTop: 4,
    },
    sectionCardHeader: {
      marginBottom: 8,
    },
    sectionCardTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    sectionCardHint: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      marginTop: 4,
    },
    sectionChipScroller: {
      marginBottom: 16,
    },
    sectionChipRow: {
      paddingRight: 8,
    },
    sectionChip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: 8,
    },
    sectionChipActive: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    sectionChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    sectionChipTextActive: {
      color: colors.primary,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginTop: 16,
      marginBottom: 10,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 16,
      marginBottom: 10,
    },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 6,
      marginTop: 12,
    },
    input: {
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 15,
      color: colors.text,
    },
    textArea: {
      minHeight: 80,
      textAlignVertical: 'top',
    },
    apiKeyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    eyeBtn: {
      padding: 8,
    },
    localProviderNotice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 4,
    },
    localProviderNoticeBody: {
      flex: 1,
      gap: 4,
    },
    localProviderNoticeTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    localProviderNoticeText: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    localModelGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 4,
    },
    localModelMeta: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    switchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 16,
      paddingVertical: 8,
    },
    switchLabel: {
      fontSize: 15,
      color: colors.text,
    },
    themeRow: {
      flexDirection: 'row',
      gap: 10,
    },
    themeBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    themeBtnActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    themeBtnText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    themeBtnTextActive: {
      color: colors.primary,
      fontWeight: '600',
    },
    presetRow: {
      marginBottom: 12,
      maxHeight: 40,
    },
    presetChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: colors.primarySoft,
      marginRight: 8,
    },
    presetChipActive: {
      backgroundColor: colors.primary,
    },
    presetChipText: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: '500',
    },
    presetChipTextActive: {
      color: colors.onPrimary,
    },
    listItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: colors.surface,
      borderRadius: 10,
      marginBottom: 6,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    listItemContent: {
      flex: 1,
    },
    listItemTitle: {
      fontSize: 15,
      fontWeight: '500',
      color: colors.text,
    },
    listItemSubtitle: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 2,
    },
    secureKeyBlock: {
      marginBottom: 12,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    mcpMetadataCard: {
      marginBottom: 8,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    mcpChipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 10,
    },
    mcpOauthRow: {
      marginTop: 8,
      gap: 8,
    },
    secureKeyHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 4,
    },
    secureKeyTitleWrap: {
      flex: 1,
    },
    secureKeyTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 4,
    },
    secureKeyMeta: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    secureKeyHint: {
      fontSize: 12,
      color: colors.textTertiary,
      marginBottom: 6,
    },
    setupDetail: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 4,
      lineHeight: 18,
    },
    setupLabel: {
      fontWeight: '700',
      color: colors.text,
    },
    inlineLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 8,
      alignSelf: 'flex-start',
    },
    inlineLinkText: {
      fontSize: 13,
      color: colors.primary,
      fontWeight: '600',
    },
    statusPill: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
    },
    statusPillReady: {
      backgroundColor: colors.primarySoft,
    },
    statusPillMissing: {
      backgroundColor: colors.surfaceAlt,
    },
    statusPillText: {
      fontSize: 11,
      fontWeight: '700',
    },
    statusPillTextReady: {
      color: colors.primary,
    },
    statusPillTextMissing: {
      color: colors.textSecondary,
    },
    permissionGroup: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      marginBottom: 10,
      overflow: 'hidden',
    },
    permissionGroupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 12,
    },
    permissionGroupHeaderText: {
      flex: 1,
    },
    permissionGroupTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    permissionGroupCount: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 2,
    },
    permissionGroupActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    permissionGroupDescription: {
      fontSize: 12,
      color: colors.textTertiary,
      marginBottom: 8,
      lineHeight: 18,
    },
    permissionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    permissionTextWrap: {
      flex: 1,
    },
    permissionToolName: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 2,
    },
    permissionToolDescription: {
      fontSize: 12,
      color: colors.textTertiary,
      lineHeight: 18,
    },
    personaCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 12,
      marginBottom: 8,
    },
    primaryButton: {
      marginTop: 12,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.onPrimary,
    },
    actionRow: {
      flexDirection: 'row',
      gap: 10,
      alignItems: 'center',
      marginTop: 8,
    },
    secondaryBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingVertical: 12,
      backgroundColor: colors.surfaceAlt,
    },
    secondaryBtnText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.primary,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: 'center',
      padding: 20,
    },
    deleteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 24,
      paddingVertical: 12,
      justifyContent: 'center',
    },
    deleteBtnText: {
      fontSize: 15,
      color: colors.danger,
      fontWeight: '500',
    },
    dangerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      backgroundColor: colors.dangerSoft,
      borderRadius: 10,
    },
    dangerBtnText: {
      fontSize: 15,
      color: colors.danger,
      fontWeight: '500',
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 40,
      maxHeight: '70%',
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 16,
      textAlign: 'center',
    },
    langItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    langItemText: {
      fontSize: 16,
      color: colors.text,
    },
    modalCloseBtn: {
      marginTop: 16,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.surfaceAlt,
    },
    modalCloseBtnText: {
      fontSize: 16,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    reviewModalScroll: {
      maxHeight: 420,
    },
    reviewModalScrollContent: {
      paddingBottom: 8,
    },
    reviewModalSummary: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      marginBottom: 16,
    },
    reviewModalSection: {
      marginBottom: 16,
    },
    reviewModalSectionTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 8,
    },
    reviewModalParagraph: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
      marginBottom: 8,
    },
    reviewChecklistCard: {
      marginTop: 10,
      marginBottom: 12,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    reviewChecklistTitle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 4,
    },
    reviewChecklistHint: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.textSecondary,
      marginBottom: 8,
    },
    reviewChecklistItem: {
      fontSize: 12,
      lineHeight: 18,
      color: colors.textTertiary,
      marginBottom: 6,
    },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: colors.surface,
      borderRadius: 10,
      marginBottom: 6,
    },
    featureContent: {
      flex: 1,
    },
    featureHint: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 2,
    },
    featureSubRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 16,
      marginBottom: 6,
    },
    featureSubLabel: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    stepperRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    stepperBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    stepperBtnText: {
      fontSize: 18,
      color: colors.text,
      fontWeight: '600',
    },
    stepperValue: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      minWidth: 20,
      textAlign: 'center',
    },
    quickSetupGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 8,
    },
    quickSetupChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quickSetupChipActive: {
      borderColor: colors.success,
      backgroundColor: colors.surface,
    },
    quickSetupLabel: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textTertiary,
    },
  });
