import { useMemo } from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { selectRemoteConfigSettingsSlice } from '../../src/features/remoteConfig/hooks/useRemoteConfigStore';
import { selectRemoteRuntimeSlice } from '../../src/services/remote/storeSelectors';
import { selectSshSessionRuntimeSlice } from '../../src/services/ssh/sessionSelectors';

describe('Remote Work selector stability', () => {
  it('keeps zustand selector outputs stable for shallow-equal state', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const useSettingsStore = create(() => ({
        workspaceTargets: [
          {
            id: 'ws-1',
            name: 'Main Repo',
            rootPath: '/workspace/repo',
            baseUrl: 'https://code.example.com',
            provider: 'code-server',
            enabled: true,
          },
        ],
        defaultWorkspaceTargetId: 'ws-1',
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
        browserProviders: [
          {
            id: 'browser-1',
            name: 'Primary Browserbase',
            provider: 'browserbase',
            baseUrl: 'https://api.browserbase.com',
            projectId: 'proj_123',
            authMode: 'api-key-header',
            apiKeyRef: 'browser_provider_api_key_browser-1',
            enabled: true,
          },
        ],
        mcpServers: [
          {
            id: 'mcp-1',
            enabled: true,
            name: 'Tool Server',
            url: 'https://mcp.example.com',
            tools: [],
            allowedTools: [],
          },
        ],
        expoAccounts: [
          {
            id: 'expo-account-1',
            name: 'Expo Prod',
            owner: 'kavi',
            tokenRef: 'expo_account_token_expo-account-1',
            enabled: true,
          },
        ],
        expoProjects: [
          {
            id: 'expo-project-1',
            name: 'Kavi',
            accountId: 'expo-account-1',
            owner: 'kavi',
            slug: 'kavi-app',
            enabled: true,
            mode: 'direct-ssh',
            sshTargetId: 'ssh-1',
            projectPath: '/srv/kavi-app',
            defaultBuildProfile: 'production',
            defaultUpdateBranch: 'production',
            updateChannel: 'production',
            platforms: ['android', 'ios', 'web'],
            webUrl: 'https://app.example.com',
          },
        ],
        addSshTarget: () => {},
        updateSshTarget: () => {},
        removeSshTarget: () => {},
        addWorkspaceTarget: () => {},
        updateWorkspaceTarget: () => {},
        removeWorkspaceTarget: () => {},
        setDefaultWorkspaceTargetId: () => {},
        addBrowserProvider: () => {},
        updateBrowserProvider: () => {},
        removeBrowserProvider: () => {},
        addExpoAccount: () => {},
        updateExpoAccount: () => {},
        removeExpoAccount: () => {},
        addExpoProject: () => {},
        updateExpoProject: () => {},
        removeExpoProject: () => {},
        addMcpServer: () => {},
        updateMcpServer: () => {},
        removeMcpServer: () => {},
      }));

      const useSshSessionStore = create(() => ({
        sessions: {
          'ssh-session-1': {
            id: 'ssh-session-1',
            targetId: 'ssh-1',
            targetName: 'Build box',
            targetLabel: 'developer@ssh.example.com:22',
            status: 'connected',
            transcript: '$ pwd\n/home/user\n',
            createdAt: 1,
            lastActivityAt: 2,
          },
        },
        openShellSession: jest.fn().mockResolvedValue('ssh-session-1'),
        sendShellCommand: jest.fn().mockResolvedValue(undefined),
        closeShellSession: jest.fn(),
      }));

      const useRemoteStore = create(() => ({
        jobs: {},
        sessions: {},
      }));

      const Harness = () => {
        const settings = useSettingsStore(useShallow(selectRemoteConfigSettingsSlice));
        const ssh = useSshSessionStore(useShallow(selectSshSessionRuntimeSlice));
        const remote = useRemoteStore(useShallow(selectRemoteRuntimeSlice));

        const sshSessions = useMemo(() => Object.values(ssh.sessions), [ssh.sessions]);
        const remoteSessions = useMemo(() => Object.values(remote.sessions), [remote.sessions]);
        const remoteJobs = useMemo(() => Object.values(remote.jobs), [remote.jobs]);

        return (
          <Text>
            {settings.workspaceTargets.length}:{settings.sshTargets.length}:
            {settings.browserProviders.length}:{sshSessions.length}:{remoteSessions.length}:
            {remoteJobs.length}
          </Text>
        );
      };

      const screen = render(<Harness />);
      await waitFor(() => {
        expect(screen.getByText('1:1:1:1:0:0')).toBeTruthy();
      });

      const errorOutput = consoleErrorSpy.mock.calls.flat().join('\n');
      expect(errorOutput).not.toContain(
        'The result of getSnapshot should be cached to avoid an infinite loop',
      );
      expect(errorOutput).not.toContain('Maximum update depth exceeded');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
