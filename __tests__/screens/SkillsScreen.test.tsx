// ---------------------------------------------------------------------------
// Tests — SkillsScreen list rendering, secret setup, and manual creation
// ---------------------------------------------------------------------------
//
// Split out when the original single file crossed the repository's 700-line
// maintainability limit. ClawHub browse/search/install coverage lives in
// SkillsScreen.clawhub.test.tsx. Both share fixtures and jest.mock
// registrations from __tests__/helpers/skillsScreenFixtures.ts.

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  mockAddEntry,
  mockEntries,
  mockExecutionSettings,
  mockGetSecure,
  mockSaveSecure,
  resetSkillsScreenFixtures,
} from '../helpers/skillsScreenFixtures';
import { SkillsScreen } from '../../src/screens/SkillsScreen';

beforeEach(() => {
  resetSkillsScreenFixtures();
});

describe('SkillsScreen', () => {
  it('renders header with title', () => {
    const { getByTestId, getByText } = render(<SkillsScreen />);
    expect(getByText('Skills')).toBeTruthy();
    expect(StyleSheet.flatten(getByTestId('skills-back').props.style).minWidth).toBe(48);
    expect(StyleSheet.flatten(getByTestId('skills-add').props.style).minHeight).toBe(48);
    expect(getByTestId('skills-tab-installed').props.accessibilityRole).toBe('tab');
    expect(getByTestId('skills-tab-installed').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(getByTestId('skills-tab-browse').props.accessibilityState).toMatchObject({
      selected: false,
    });
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
      source: { source: 'bundled' },
      metadata: {
        name: 'Weather Skill',
        description: 'Get weather info',
        version: '1.2.0',
        tools: ['get_weather', 'forecast'],
      },
    });

    const { getByLabelText, getByText } = render(<SkillsScreen />);
    expect(getByText('Weather Skill')).toBeTruthy();
    expect(getByLabelText('Weather Skill').props.accessibilityRole).toBe('switch');
    expect(getByText('Get weather info')).toBeTruthy();
    expect(getByText('v1.2.0')).toBeTruthy();
    expect(getByText('2 tools')).toBeTruthy();
    expect(getByText('built-in')).toBeTruthy();
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

    const { getByText, queryByText } = render(<SkillsScreen />);

    await waitFor(() => {
      expect(getByText('0/1 secrets configured')).toBeTruthy();
    });
    expect(getByText('ClawHub')).toBeTruthy();
    expect(queryByText('clawhub')).toBeNull();
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
    Object.assign(mockExecutionSettings, {
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
    });
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
    const { getAllByText, getByLabelText, getByTestId, getByText, getByPlaceholderText } = render(
      <SkillsScreen />,
    );

    fireEvent.press(getByLabelText('Add Skill'));
    expect(getByTestId('skills-add-mode-url').props.accessibilityState).toMatchObject({
      selected: true,
    });
    fireEvent.press(getByText('Create manually'));
    expect(getByTestId('skills-add-mode-manual').props.accessibilityState).toMatchObject({
      selected: true,
    });
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
