// ---------------------------------------------------------------------------
// Tests — SkillsScreen ClawHub browse, search, and install error handling
// ---------------------------------------------------------------------------
//
// Split out of SkillsScreen.test.tsx to stay under the maintainability line
// limit. List rendering and secret setup coverage lives there; both suites
// share fixtures and jest.mock registrations from
// __tests__/helpers/skillsScreenFixtures.ts.

import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import {
  mockExecutionSettings,
  mockInstallSkillFromHub,
  mockListClawHubSkills,
  mockSearchClawHub,
  resetSkillsScreenFixtures,
} from '../helpers/skillsScreenFixtures';
import { SkillsScreen } from '../../src/screens/SkillsScreen';

beforeEach(() => {
  resetSkillsScreenFixtures();
});

describe('SkillsScreen ClawHub browse and install', () => {
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

    fireEvent.press(getByLabelText('Install GitHub Skill'));

    expect(await findByText('Set Up GitHub Skill')).toBeTruthy();
    expect(await findByText('GitHub Personal Access Token')).toBeTruthy();
  });

  it('uses the typed compatibility failure for the blocked-install presentation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockInstallSkillFromHub.mockResolvedValueOnce({
      success: false,
      failureKind: 'compatibility',
      error: 'هذه المهارة تتطلب سطح تنفيذ آخر.',
    });
    mockListClawHubSkills.mockResolvedValueOnce({
      skills: [
        {
          id: 'external-runtime',
          name: 'External Runtime',
          description: 'Requires another execution surface',
          version: '1.0.0',
          author: 'ClawHub',
          tags: [],
          downloads: 1,
          rating: 1,
          installUrl: 'https://example.com/external-runtime',
        },
      ],
      nextCursor: null,
    });

    const { getByLabelText, getByText } = render(<SkillsScreen />);
    fireEvent.press(getByText('Browse'));
    await waitFor(() => expect(getByText('External Runtime')).toBeTruthy());
    fireEvent.press(getByLabelText('Install External Runtime'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith('Install blocked', 'هذه المهارة تتطلب سطح تنفيذ آخر.'),
    );
    alertSpy.mockRestore();
  });

  it('shows a plain-language alert (not the raw exception) when install throws', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockInstallSkillFromHub.mockRejectedValueOnce(new Error('network boom'));
    mockListClawHubSkills.mockResolvedValueOnce({
      skills: [
        {
          id: 'flaky-skill',
          name: 'Flaky Skill',
          description: 'Fixture',
          version: '1.0.0',
          author: 'ClawHub',
          tags: [],
          downloads: 1,
          rating: 1,
          installUrl: 'https://example.com/flaky-skill',
        },
      ],
      nextCursor: null,
    });

    const { getByLabelText, getByText } = render(<SkillsScreen />);
    fireEvent.press(getByText('Browse'));
    await waitFor(() => expect(getByText('Flaky Skill')).toBeTruthy());
    fireEvent.press(getByLabelText('Install Flaky Skill'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const [, body] = alertSpy.mock.calls[0];
    expect(body).not.toContain('network boom');
    alertSpy.mockRestore();
  });

  it('appends the technical error detail only when developer mode is on', async () => {
    mockExecutionSettings.developerModeEnabled = true;
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockInstallSkillFromHub.mockRejectedValueOnce(new Error('network boom'));
    mockListClawHubSkills.mockResolvedValueOnce({
      skills: [
        {
          id: 'flaky-skill-dev',
          name: 'Flaky Skill Dev',
          description: 'Fixture',
          version: '1.0.0',
          author: 'ClawHub',
          tags: [],
          downloads: 1,
          rating: 1,
          installUrl: 'https://example.com/flaky-skill-dev',
        },
      ],
      nextCursor: null,
    });

    const { getByLabelText, getByText } = render(<SkillsScreen />);
    fireEvent.press(getByText('Browse'));
    await waitFor(() => expect(getByText('Flaky Skill Dev')).toBeTruthy());
    fireEvent.press(getByLabelText('Install Flaky Skill Dev'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const [, body] = alertSpy.mock.calls[0];
    expect(body).toContain('network boom');
    mockExecutionSettings.developerModeEnabled = false;
    alertSpy.mockRestore();
  });

  it('does not infer an install category from provider prose', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockInstallSkillFromHub.mockResolvedValueOnce({
      success: false,
      failureKind: 'transport',
      error: 'The compatible registry endpoint is temporarily unavailable.',
    });
    mockListClawHubSkills.mockResolvedValueOnce({
      skills: [
        {
          id: 'registry-timeout',
          name: 'Registry Timeout',
          description: 'Fixture',
          version: '1.0.0',
          author: 'ClawHub',
          tags: [],
          downloads: 1,
          rating: 1,
          installUrl: 'https://example.com/registry-timeout',
        },
      ],
      nextCursor: null,
    });

    const { getByLabelText, getByText } = render(<SkillsScreen />);
    fireEvent.press(getByText('Browse'));
    await waitFor(() => expect(getByText('Registry Timeout')).toBeTruthy());
    fireEvent.press(getByLabelText('Install Registry Timeout'));

    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        'Error',
        'The compatible registry endpoint is temporarily unavailable.',
      ),
    );
    alertSpy.mockRestore();
  });
});
