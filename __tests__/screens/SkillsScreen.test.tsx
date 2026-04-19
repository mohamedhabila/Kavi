// ---------------------------------------------------------------------------
// Tests — SkillsScreen
// ---------------------------------------------------------------------------

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SkillsScreen } from '../../src/screens/SkillsScreen';

const mockListClawHubSkills = jest.fn();
const mockSearchClawHub = jest.fn();
const mockInstallSkillFromHub = jest.fn();
const mockInstallSkillFromUrl = jest.fn();
const mockGetSecure = jest.fn();
const mockSaveSecure = jest.fn();
const mockDeleteSecure = jest.fn();
const mockToggleEntry = jest.fn();
const mockRemoveEntry = jest.fn();
const mockAddEntry = jest.fn();
let mockExecutionSettings = {
  mcpServers: [],
  sshTargets: [],
  workspaceTargets: [],
};

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
const mockEntries: any[] = [];
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
  useSettingsStore: (selector: any) => selector(mockExecutionSettings),
}));

jest.mock('../../src/services/clawhub/registryClient', () => ({
  listClawHubSkills: (...args: any[]) => mockListClawHubSkills(...args),
  searchClawHub: (...args: any[]) => mockSearchClawHub(...args),
  installSkillFromHub: (...args: any[]) => mockInstallSkillFromHub(...args),
  installSkillFromUrl: (...args: any[]) => mockInstallSkillFromUrl(...args),
}));

jest.mock('../../src/services/storage/SecureStorage', () => ({
  getSecure: (...args: any[]) => mockGetSecure(...args),
  saveSecure: (...args: any[]) => mockSaveSecure(...args),
  deleteSecure: (...args: any[]) => mockDeleteSecure(...args),
}));

beforeEach(() => {
  mockEntries.length = 0;
  mockExecutionSettings = {
    mcpServers: [],
    sshTargets: [],
    workspaceTargets: [],
  };
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
});

describe('SkillsScreen', () => {
  it('renders header with title', () => {
    const { getByText } = render(<SkillsScreen />);
    expect(getByText('Skills')).toBeTruthy();
  });

  it('shows empty state when no skills', () => {
    const { getByText } = render(<SkillsScreen />);
    expect(getByText('No skills installed')).toBeTruthy();
    expect(getByText(/Skills extend your AI/)).toBeTruthy();
  });

  it('renders skill card with full metadata', () => {
    mockEntries.push({
      id: 'skill1',
      enabled: true,
      source: { source: 'local' },
      metadata: {
        name: 'Weather Skill',
        description: 'Get weather info',
        version: '1.2.0',
        tools: ['get_weather', 'forecast'],
      },
    });

    const { getByText } = render(<SkillsScreen />);
    expect(getByText('Weather Skill')).toBeTruthy();
    expect(getByText('Get weather info')).toBeTruthy();
    expect(getByText('v1.2.0')).toBeTruthy();
    expect(getByText('2 tools')).toBeTruthy();
    expect(getByText('local')).toBeTruthy();
    expect(getByText('Runs here')).toBeTruthy();
    expect(getByText('Mobile')).toBeTruthy();
  });

  it('renders skill card without optional fields', () => {
    mockEntries.push({
      id: 'skill2',
      enabled: false,
      source: '',
      metadata: {
        name: 'Minimal Skill',
      },
    });

    const { getByText, queryByText } = render(<SkillsScreen />);
    expect(getByText('Minimal Skill')).toBeTruthy();
    expect(queryByText(/tools?$/)).toBeNull();
    expect(getByText('built-in')).toBeTruthy();
  });

  it('renders singular "tool" for single tool', () => {
    mockEntries.push({
      id: 'skill3',
      enabled: true,
      source: { source: 'remote' },
      metadata: {
        name: 'Single Tool',
        tools: ['one_tool'],
      },
    });

    const { getByText } = render(<SkillsScreen />);
    expect(getByText('1 tool')).toBeTruthy();
  });

  it('renders disabled skill with different styling', () => {
    mockEntries.push({
      id: 'skill4',
      enabled: false,
      source: { source: 'local' },
      metadata: {
        name: 'Disabled Skill',
        description: 'Not active',
        version: '0.1.0',
        tools: ['a', 'b', 'c'],
      },
    });

    const { getByText } = render(<SkillsScreen />);
    expect(getByText('Disabled Skill')).toBeTruthy();
    expect(getByText('3 tools')).toBeTruthy();
  });

  it('renders multiple skills', () => {
    mockEntries.push(
      {
        id: 'skill1',
        enabled: true,
        source: { source: 'local' },
        metadata: { name: 'Skill A', tools: ['t1'] },
      },
      {
        id: 'skill2',
        enabled: true,
        source: { source: 'remote' },
        metadata: { name: 'Skill B', description: 'Another skill', tools: ['t2', 't3'] },
      },
    );

    const { getByText } = render(<SkillsScreen />);
    expect(getByText('Skill A')).toBeTruthy();
    expect(getByText('Skill B')).toBeTruthy();
  });

  it('loads ClawHub skills on the browse tab', async () => {
    mockListClawHubSkills.mockResolvedValueOnce({
      skills: [
        {
          id: 'find-skills',
          name: 'Find Skills',
          description: 'Browse registry',
          version: '0.1.0',
          author: 'ClawHub',
          tags: [],
          downloads: 120,
          rating: 12,
          installUrl: 'https://example.com',
        },
      ],
      nextCursor: 'cursor-2',
    });

    const { getByText } = render(<SkillsScreen />);
    fireEvent.press(getByText('Browse'));

    await waitFor(() => {
      expect(getByText('Find Skills')).toBeTruthy();
    });
    expect(mockListClawHubSkills).toHaveBeenCalledWith({
      limit: 20,
      cursor: null,
      sort: 'downloads',
    });
  });

  it('appends the next ClawHub page on infinite scroll', async () => {
    mockListClawHubSkills
      .mockResolvedValueOnce({
        skills: [
          {
            id: 'find-skills',
            name: 'Find Skills',
            description: 'Browse registry',
            version: '0.1.0',
            author: 'ClawHub',
            tags: [],
            downloads: 120,
            rating: 12,
            installUrl: 'https://example.com/find',
          },
        ],
        nextCursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        skills: [
          {
            id: 'summarize',
            name: 'Summarize',
            description: 'Summarize web pages',
            version: '1.0.0',
            author: 'ClawHub',
            tags: [],
            downloads: 99,
            rating: 10,
            installUrl: 'https://example.com/summarize',
          },
        ],
        nextCursor: null,
      });

    const { getByText, UNSAFE_getByType } = render(<SkillsScreen />);
    fireEvent.press(getByText('Browse'));

    await waitFor(() => {
      expect(getByText('Find Skills')).toBeTruthy();
    });

    const flatList = UNSAFE_getByType(require('react-native').FlatList);
    fireEvent(flatList, 'onEndReached');

    await waitFor(() => {
      expect(getByText('Summarize')).toBeTruthy();
    });

    expect(mockListClawHubSkills).toHaveBeenNthCalledWith(2, {
      limit: 20,
      cursor: 'cursor-2',
      sort: 'downloads',
    });
  });

  it('uses search instead of browse pagination when a query is present', async () => {
    mockSearchClawHub.mockResolvedValueOnce({
      skills: [
        {
          id: 'memory-tiering',
          name: 'Memory Tiering',
          description: 'Automated memory management.',
          version: '1.0.0',
          author: 'ClawHub',
          tags: [],
          downloads: 20,
          rating: 4,
          installUrl: 'https://example.com/memory',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    const { getByPlaceholderText, getByLabelText, getByText } = render(<SkillsScreen />);
    fireEvent.press(getByText('Browse'));
    fireEvent.changeText(getByPlaceholderText('Search skills…'), 'memory');
    fireEvent.press(getByLabelText('Search'));

    await waitFor(() => {
      expect(getByText('Memory Tiering')).toBeTruthy();
    });

    expect(mockSearchClawHub).toHaveBeenCalledWith('memory');
  });

  it('shows configure state for skills with required secrets', async () => {
    mockEntries.push({
      id: 'github-skill',
      enabled: true,
      source: { source: 'clawhub', id: 'github' },
      metadata: {
        name: 'GitHub Skill',
        description: 'Manage repositories and issues',
        version: '1.0.0',
        requiredSecrets: ['GITHUB_TOKEN'],
      },
    });

    const { getByText } = render(<SkillsScreen />);

    await waitFor(() => {
      expect(getByText('0/1 secrets configured')).toBeTruthy();
    });
    expect(getByText('Setup required')).toBeTruthy();
    expect(getByText('Configure')).toBeTruthy();
  });

  it('shows external-surface routing guidance for desktop-dependent skills', () => {
    mockEntries.push({
      id: 'cli-skill',
      enabled: true,
      source: { source: 'clawhub', id: 'cli-skill' },
      metadata: {
        name: 'CLI Skill',
        description: 'Uses gh and desktop installers',
        version: '1.0.0',
        requires: {
          bins: ['gh'],
        },
        install: [
          {
            id: 'brew-gh',
            kind: 'brew',
            label: 'Install gh',
            bins: ['gh'],
          },
        ],
      },
    });

    const { getByText } = render(<SkillsScreen />);
    expect(getByText('Needs external surface')).toBeTruthy();
    expect(getByText('SSH')).toBeTruthy();
    expect(getByText('Workspace')).toBeTruthy();
    expect(getByText(/Requires local binaries: gh/)).toBeTruthy();
    expect(getByText(/Best route: SSH, Workspace/)).toBeTruthy();
  });

  it('marks desktop-dependent skills as runnable when an SSH target is configured', () => {
    mockExecutionSettings = {
      ...mockExecutionSettings,
      sshTargets: [
        {
          id: 'ssh-1',
          name: 'Build box',
          host: 'ssh.example.com',
          port: 22,
          username: 'developer',
          authMode: 'password',
          passwordRef: 'ssh_password_ssh-1',
          enabled: true,
        },
      ],
    };
    mockEntries.push({
      id: 'cli-skill',
      enabled: true,
      source: { source: 'clawhub', id: 'cli-skill' },
      metadata: {
        name: 'CLI Skill',
        description: 'Uses gh and desktop installers',
        version: '1.0.0',
        requires: {
          bins: ['gh'],
        },
      },
    });

    const { getByText, queryByText } = render(<SkillsScreen />);
    expect(getByText('Runs here')).toBeTruthy();
    expect(getByText('SSH')).toBeTruthy();
    expect(queryByText('Needs external surface')).toBeNull();
  });

  it('opens the setup modal after installing a skill that needs secrets', async () => {
    mockInstallSkillFromHub.mockResolvedValueOnce({
      success: true,
      skillEntry: {
        id: 'github-skill',
        enabled: true,
        installedAt: Date.now(),
        source: { source: 'clawhub', id: 'github', url: 'https://example.com/github' },
        metadata: {
          name: 'GitHub Skill',
          description: 'Manage repositories and issues',
          version: '1.0.0',
          primaryEnv: 'GITHUB_TOKEN',
          requiredSecrets: ['GITHUB_TOKEN'],
        },
      },
    });
    mockListClawHubSkills.mockResolvedValueOnce({
      skills: [
        {
          id: 'github',
          name: 'GitHub Skill',
          description: 'Manage repositories and issues',
          version: '1.0.0',
          author: 'ClawHub',
          tags: [],
          downloads: 120,
          rating: 12,
          installUrl: 'https://example.com/github',
        },
      ],
      nextCursor: null,
    });

    const { getByLabelText, getByText, findByText } = render(<SkillsScreen />);
    fireEvent.press(getByText('Browse'));

    await waitFor(() => {
      expect(getByText('GitHub Skill')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Install'));

    expect(await findByText('Set Up GitHub Skill')).toBeTruthy();
    expect(await findByText('GitHub Personal Access Token')).toBeTruthy();
  });

  it('saves configured skill secrets from the setup modal', async () => {
    mockEntries.push({
      id: 'github-skill',
      enabled: true,
      source: { source: 'clawhub', id: 'github' },
      metadata: {
        name: 'GitHub Skill',
        description: 'Manage repositories and issues',
        version: '1.0.0',
        requiredSecrets: ['GITHUB_TOKEN'],
      },
    });

    const { getAllByText, getByText, getByPlaceholderText } = render(<SkillsScreen />);

    await waitFor(() => {
      expect(getByText('Configure')).toBeTruthy();
    });

    fireEvent.press(getByText('Configure'));
    await waitFor(() => {
      expect(getByPlaceholderText('github_pat_...')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('github_pat_...'), 'secret-token');
    fireEvent.press(getAllByText('Configure')[1]);

    await waitFor(() => {
      expect(mockSaveSecure).toHaveBeenCalledWith('GITHUB_TOKEN', 'secret-token');
    });
  });

  it('creates manual skills with prompt, tools, and required secrets', async () => {
    const { getAllByText, getByLabelText, getByText, getByPlaceholderText } = render(
      <SkillsScreen />,
    );

    fireEvent.press(getByLabelText('Add Skill'));
    fireEvent.press(getByText('Create manually'));
    fireEvent.changeText(getByPlaceholderText('My custom skill'), 'Manual GitHub Skill');
    fireEvent.changeText(getByPlaceholderText('What does this skill do?'), 'Created in-app');
    fireEvent.changeText(
      getByPlaceholderText('Additional instructions this skill should inject.'),
      'Use GitHub carefully.',
    );
    fireEvent.changeText(
      getByPlaceholderText('search_web, summarize_page'),
      'create_issue, list_prs',
    );
    fireEvent.changeText(
      getByPlaceholderText('GITHUB_TOKEN, FIRECRAWL_API_KEY'),
      'GITHUB_TOKEN, ANOTHER_SECRET',
    );

    fireEvent.press(getAllByText('Add Skill')[1]);

    await waitFor(() => {
      expect(mockAddEntry).toHaveBeenCalledTimes(1);
    });

    expect(mockAddEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        source: { source: 'manual' },
        systemPrompt: 'Use GitHub carefully.',
        metadata: expect.objectContaining({
          name: 'Manual GitHub Skill',
          description: 'Created in-app',
          tools: ['create_issue', 'list_prs'],
          requiredSecrets: ['GITHUB_TOKEN', 'ANOTHER_SECRET'],
        }),
      }),
    );
  });

  it('shows setup complete when all required secrets are already stored', async () => {
    mockEntries.push({
      id: 'github-skill',
      enabled: true,
      source: { source: 'clawhub', id: 'github' },
      metadata: {
        name: 'GitHub Skill',
        version: '1.0.0',
        requiredSecrets: ['GITHUB_TOKEN'],
      },
    });
    mockGetSecure.mockResolvedValueOnce('stored-token');

    const { getByText } = render(<SkillsScreen />);

    await waitFor(() => {
      expect(getByText('Setup complete')).toBeTruthy();
    });
  });
});
