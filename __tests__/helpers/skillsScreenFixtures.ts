// ---------------------------------------------------------------------------
// Shared fixtures for the SkillsScreen test suites. Extracted when the
// original single file crossed the repository's 700-line maintainability
// limit. SkillsScreen.test.tsx covers list rendering, per-skill secret setup,
// and manual creation; SkillsScreen.clawhub.test.tsx covers ClawHub browse,
// search, and install error handling. Both import this module before
// importing the screen itself so every jest.mock registration below is
// active by the time the screen's own dependency graph is required.
// ---------------------------------------------------------------------------

export const mockListClawHubSkills = jest.fn();
export const mockSearchClawHub = jest.fn();
export const mockInstallSkillFromHub = jest.fn();
export const mockInstallSkillFromUrl = jest.fn();
export const mockGetSecure = jest.fn();
export const mockSaveSecure = jest.fn();
export const mockDeleteSecure = jest.fn();
export const mockToggleEntry = jest.fn();
export const mockRemoveEntry = jest.fn();
export const mockAddEntry = jest.fn();

/**
 * Mutable state read by the mocked stores below. Kept as an always-same
 * object (mutated via `Object.assign`/property writes, never reassigned) so
 * both sibling test files can import and mutate it directly — an imported
 * `let` binding cannot be reassigned from a consumer module.
 */
export const mockExecutionSettings: {
  mcpServers: any[];
  sshTargets: any[];
  workspaceTargets: any[];
  developerModeEnabled: boolean;
} = {
  mcpServers: [],
  sshTargets: [],
  workspaceTargets: [],
  developerModeEnabled: false,
};

export const mockEntries: any[] = [];

jest.mock('../../src/services/ssh/connector', () => ({
  getSshTargetReadiness: (target: any) => ({
    launchable: Boolean(target?.enabled && target?.host && target?.username),
    reason: target?.enabled ? 'ready' : 'disabled',
  }),
  getSshTargetLabel: (target: any) => `${target?.host || 'unknown'}:${target?.port || 22}`,
}));

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
}));

// Mock navigation
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ name: 'Skills' }),
  useFocusEffect: jest.fn(),
}));

// Mock theme
jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      surface: '#111',
      surfaceAlt: '#222',
      header: '#111',
      border: '#333',
      subtleBorder: '#444',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      placeholder: '#555',
      primary: '#0f0',
      onPrimary: '#fff',
      primarySoft: '#030',
      danger: '#f00',
      warning: '#ff0',
      success: '#0f0',
    },
  }),
  AppPalette: {},
}));

// Mock skills store
jest.mock('../../src/services/skills/manager', () => ({
  useSkillsStore: (selector: any) =>
    selector({
      entries: mockEntries,
      toggleEntry: mockToggleEntry,
      removeEntry: mockRemoveEntry,
      addEntry: mockAddEntry,
    }),
}));

jest.mock('../../src/store/useSettingsStore', () => ({
  useSettingsStore: Object.assign((selector: any) => selector(mockExecutionSettings), {
    getState: () => mockExecutionSettings,
  }),
}));

jest.mock('../../src/services/clawhub/apiClient', () => ({
  listClawHubSkills: (...args: any[]) => mockListClawHubSkills(...args),
  searchClawHub: (...args: any[]) => mockSearchClawHub(...args),
}));

jest.mock('../../src/services/clawhub/installWorkflow', () => ({
  installSkillFromHub: (...args: any[]) => mockInstallSkillFromHub(...args),
  installSkillFromUrl: (...args: any[]) => mockInstallSkillFromUrl(...args),
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
  saveSecure: (...args: any[]) => mockSaveSecure(...args),
  deleteSecure: (...args: any[]) => mockDeleteSecure(...args),
}));

/** Mirrors the shared `beforeEach` body every SkillsScreen suite used to run inline. */
export function resetSkillsScreenFixtures() {
  mockEntries.length = 0;
  Object.assign(mockExecutionSettings, {
    mcpServers: [],
    sshTargets: [],
    workspaceTargets: [],
    developerModeEnabled: false,
  });
  mockListClawHubSkills.mockReset();
  mockSearchClawHub.mockReset();
  mockInstallSkillFromHub.mockReset();
  mockInstallSkillFromUrl.mockReset();
  mockGetSecure.mockReset();
  mockSaveSecure.mockReset();
  mockDeleteSecure.mockReset();
  mockToggleEntry.mockReset();
  mockRemoveEntry.mockReset();
  mockAddEntry.mockReset();
  mockListClawHubSkills.mockResolvedValue({ skills: [], nextCursor: null });
  mockSearchClawHub.mockResolvedValue({ skills: [], total: 0, page: 1, pageSize: 20 });
  mockInstallSkillFromHub.mockResolvedValue({ success: true });
  mockInstallSkillFromUrl.mockResolvedValue({ success: true });
  mockGetSecure.mockResolvedValue(null);
  mockSaveSecure.mockResolvedValue(undefined);
  mockDeleteSecure.mockResolvedValue(undefined);
}
