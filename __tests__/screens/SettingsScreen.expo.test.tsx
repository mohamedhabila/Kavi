import { fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import {
  confirmSettingsDestructiveAlert,
  renderSettingsScreen,
  settingsMocks,
  settingsTestState,
  setupSettingsScreenTestSuite,
} from './SettingsScreen.testSupport';

describe('SettingsScreen expo remote config', () => {
  setupSettingsScreenTestSuite();
  it('should save a new Expo account, persist its token, and sync projects', async () => {
    const { getAllByLabelText, getByDisplayValue, getByPlaceholderText, getByText } =
      renderSettingsScreen();

    fireEvent.press(getAllByLabelText('Add Expo account')[0]);
    fireEvent.changeText(getByDisplayValue('New Expo Account'), '');
    fireEvent.changeText(getByPlaceholderText('my-org'), 'kavi');
    fireEvent.changeText(getByPlaceholderText('eas_xxx'), 'eas_live_token');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(settingsMocks.saveSecure).toHaveBeenCalledWith(
        expect.stringContaining('expo_account_token_'),
        'eas_live_token',
      );
      expect(settingsMocks.addExpoAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'kavi',
          name: 'kavi',
          accountType: 'personal',
          tokenRef: expect.stringContaining('expo_account_token_'),
        }),
      );
    });

    const savedAccount = settingsMocks.addExpoAccount.mock.calls[0][0];
    expect(settingsMocks.syncExpoAccountProjects).toHaveBeenCalledWith(savedAccount.id);
  });

  it('should require an owner before saving a new Expo account', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getAllByLabelText, getByText } = renderSettingsScreen();

    fireEvent.press(getAllByLabelText('Add Expo account')[0]);
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Expo account owner is required.');
    });
    expect(settingsMocks.addExpoAccount).not.toHaveBeenCalled();
  });

  it('should update an existing Expo account and clear its stored token', async () => {
    settingsTestState.expoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'robot',
        enabled: true,
        tokenRef: 'expo_account_token_expo-account-1',
      },
    ];
    settingsMocks.getSecure.mockImplementation(async (key: string) =>
      key === 'expo_account_token_expo-account-1' ? 'eas_saved_token' : '',
    );

    const { getByDisplayValue, getByText } = renderSettingsScreen();

    fireEvent.press(getByText('Expo Production'));

    await waitFor(() => {
      expect(getByDisplayValue('eas_saved_token')).toBeTruthy();
    });

    fireEvent.changeText(getByDisplayValue('eas_saved_token'), '');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(settingsMocks.deleteSecure).toHaveBeenCalledWith('expo_account_token_expo-account-1');
      expect(settingsMocks.updateExpoAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'expo-account-1',
          owner: 'kavi',
          accountType: 'robot',
          tokenRef: undefined,
        }),
      );
    });
    expect(settingsMocks.syncExpoAccountProjects).not.toHaveBeenCalled();
  });

  it('should sync Expo projects from the main settings surface', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    settingsTestState.expoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];

    const { getByLabelText } = renderSettingsScreen();
    fireEvent.press(getByLabelText('Sync Expo projects'));

    await waitFor(() => {
      expect(settingsMocks.syncExpoAccountProjects).toHaveBeenCalledWith('expo-account-1');
      expect(Alert.alert).toHaveBeenCalledWith('Expo projects synced', 'Projects synced: 1');
    });
  });

  it('should execute delete Expo account confirmation', async () => {
    settingsTestState.expoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    confirmSettingsDestructiveAlert();

    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Expo Production'));

    await waitFor(() => {
      expect(getByText('Delete Expo Account')).toBeTruthy();
    });

    fireEvent.press(getByText('Delete Expo Account'));

    await waitFor(() => {
      expect(settingsMocks.removeExpoAccount).toHaveBeenCalledWith('expo-account-1');
      expect(settingsMocks.deleteSecure).toHaveBeenCalledWith('expo_account_token_expo-account-1');
    });
  });

  it('should require a project path for direct SSH Expo projects', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    settingsTestState.expoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    settingsTestState.sshTargets = [
      {
        id: 'ssh-1',
        name: 'Build Host',
        host: 'ssh.example.com',
        port: 22,
        username: 'deploy',
        authMode: 'password',
        passwordRef: 'ssh_password_ssh-1',
        enabled: true,
      },
    ];
    settingsTestState.expoProjects = [
      {
        id: 'expo-project-1',
        name: 'Client App',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'client-app',
        enabled: true,
        mode: 'direct-ssh',
        sshTargetId: 'ssh-1',
        projectPath: '',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        updateChannel: 'production',
        platforms: ['android'],
      },
    ];

    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Client App'));

    await waitFor(() => {
      expect(getByText('Edit Expo Project')).toBeTruthy();
    });

    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Project path is required for direct mode.',
      );
    });
    expect(settingsMocks.updateExpoProject).not.toHaveBeenCalled();
  });

  it('should require a repository for GitHub workflow Expo projects', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    settingsTestState.expoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    settingsTestState.expoProjects = [
      {
        id: 'expo-project-1',
        name: 'Client App',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'client-app',
        enabled: true,
        mode: 'github-workflow',
        repoFullName: '',
        workflowFile: '',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        updateChannel: 'production',
        platforms: ['android', 'ios'],
      },
    ];

    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Client App'));

    await waitFor(() => {
      expect(getByText('Edit Expo Project')).toBeTruthy();
    });

    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'GitHub repository is required for workflow mode.',
      );
    });
    expect(settingsMocks.updateExpoProject).not.toHaveBeenCalled();
  });

  it('should require a workflow file for GitHub workflow Expo projects', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    settingsTestState.expoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    settingsTestState.expoProjects = [
      {
        id: 'expo-project-1',
        name: 'Client App',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'client-app',
        enabled: true,
        mode: 'github-workflow',
        repoFullName: 'kavi/client-app',
        workflowFile: '',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        updateChannel: 'production',
        platforms: ['android', 'ios'],
      },
    ];

    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Client App'));

    await waitFor(() => {
      expect(getByText('Edit Expo Project')).toBeTruthy();
    });

    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Workflow file is required for workflow mode.',
      );
    });
    expect(settingsMocks.updateExpoProject).not.toHaveBeenCalled();
  });

  it('should save an existing Expo project with normalized fields', async () => {
    settingsTestState.expoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    settingsTestState.expoProjects = [
      {
        id: 'expo-project-1',
        name: 'Client App',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'client-app',
        enabled: true,
        mode: 'github-workflow',
        repoFullName: 'kavi/client-app',
        workflowFile: '.github/workflows/deploy.yml',
        workflowRef: 'main',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        updateChannel: 'production',
        webUrl: 'https://app.example.com',
        previewUrl: 'https://preview.example.com',
        customDomain: 'app.example.com',
        platforms: ['android', 'ios'],
      },
    ];

    const { getByDisplayValue, getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Client App'));

    await waitFor(() => {
      expect(getByText('Edit Expo Project')).toBeTruthy();
    });

    fireEvent.changeText(getByDisplayValue('Client App'), '  Mobile Client  ');
    fireEvent.changeText(getByDisplayValue('kavi'), '  kavi-team  ');
    fireEvent.changeText(getByDisplayValue('client-app'), '  mobile-client  ');
    fireEvent.changeText(getByDisplayValue('https://preview.example.com'), '');
    fireEvent.changeText(getByDisplayValue('app.example.com'), '');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(settingsMocks.updateExpoProject).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'expo-project-1',
          name: 'Mobile Client',
          owner: 'kavi-team',
          slug: 'mobile-client',
          previewUrl: undefined,
          customDomain: undefined,
          repoFullName: 'kavi/client-app',
          workflowFile: '.github/workflows/deploy.yml',
          platforms: ['android', 'ios'],
        }),
      );
    });
  });

  it('should execute delete Expo project confirmation', async () => {
    settingsTestState.expoAccounts = [
      {
        id: 'expo-account-1',
        name: 'Expo Production',
        owner: 'kavi',
        accountType: 'personal',
        enabled: true,
      },
    ];
    settingsTestState.expoProjects = [
      {
        id: 'expo-project-1',
        name: 'Client App',
        accountId: 'expo-account-1',
        owner: 'kavi',
        slug: 'client-app',
        enabled: true,
        mode: 'eas-workflow',
        defaultBuildProfile: 'production',
        defaultUpdateBranch: 'production',
        updateChannel: 'production',
        platforms: ['android', 'ios'],
      },
    ];
    confirmSettingsDestructiveAlert();

    const { getByText } = renderSettingsScreen();
    fireEvent.press(getByText('Client App'));

    await waitFor(() => {
      expect(getByText('Delete Expo Project')).toBeTruthy();
    });

    fireEvent.press(getByText('Delete Expo Project'));

    await waitFor(() => {
      expect(settingsMocks.removeExpoProject).toHaveBeenCalledWith('expo-project-1');
    });
  });
});
