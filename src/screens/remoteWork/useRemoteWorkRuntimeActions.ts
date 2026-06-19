import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import {
  createExpoWorkflowPrompt,
  getExpoActionArgs,
  getExpoActionLabel as getSharedExpoActionLabel,
  normalizeExpoWorkflowRef,
  type ExpoActionOverrides,
  type ExpoActionType,
  type ExpoWorkflowPromptState,
} from '../../features/expo/projectActions';
import { launchBrowserLiveSession, stopBrowserLiveSession } from '../../services/browser/jobs';
import {
  probeBrowserProvider,
  type BrowserProviderProbeResult,
} from '../../services/browser/providers/probe';
import { probeExpoProject, runExpoProjectAction } from '../../services/expo/workflowActions';
import { useRemoteStore } from '../../services/remote/store';
import { probeSshTarget, type SshProbeResult } from '../../services/ssh/connector';
import {
  probeWorkspaceTarget,
  resolveWorkspaceTargetLaunch,
  type WorkspaceProbeResult,
} from '../../services/workspaces/connector';
import type {
  BrowserProviderConfig,
  ExpoAccountConfig,
  ExpoProjectConfig,
  RemoteSessionRecord,
  SshTargetConfig,
  WorkspaceTargetConfig,
} from '../../types/remote';

type TranslationFn = (key: string, params?: any) => string;
type PendingMap = Record<string, boolean | undefined>;
type WorkspaceProbeMap = Record<string, WorkspaceProbeResult | undefined>;
type SshProbeMap = Record<string, SshProbeResult | undefined>;
type BrowserProbeMap = Record<string, BrowserProviderProbeResult | undefined>;
type ExpoProbeMap = Record<string, { ok: boolean; message: string; checkedAt: number } | undefined>;

type UseRemoteWorkRuntimeActionsParams = {
  t: TranslationFn;
  expoAccounts: ExpoAccountConfig[];
  expoProjects: ExpoProjectConfig[];
};

export function useRemoteWorkRuntimeActions({
  t,
  expoAccounts,
  expoProjects,
}: UseRemoteWorkRuntimeActionsParams) {
  const [activeWorkspaceSession, setActiveWorkspaceSession] = useState<null | {
    target: WorkspaceTargetConfig;
    source: { uri: string; headers?: Record<string, string> };
  }>(null);
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
  const [expoWorkflowPrompt, setExpoWorkflowPrompt] = useState<ExpoWorkflowPromptState>(null);
  const [workspaceSessionError, setWorkspaceSessionError] = useState<string | null>(null);

  const clearWorkspaceProbeResult = useCallback((id: string) => {
    setWorkspaceProbeResults((current) => {
      if (!current[id]) {
        return current;
      }

      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

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

  const runExpoActionNow = useCallback(
    async (
      project: ExpoProjectConfig,
      action: ExpoActionType,
      overrides?: ExpoActionOverrides,
      workflowRef?: string,
    ) => {
      const pendingKey = `${project.id}:${action}`;
      setPendingExpoActions((current) => ({ ...current, [pendingKey]: true }));
      try {
        const actionArgs = getExpoActionArgs(project, action, overrides);
        await runExpoProjectAction(
          project.id,
          action,
          workflowRef ? { ...actionArgs, workflowRef } : actionArgs,
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

  const getExpoActionLabel = useCallback(
    (action: ExpoActionType, overrides?: ExpoActionOverrides) =>
      getSharedExpoActionLabel(t, action, overrides),
    [t],
  );

  const handleRunExpoAction = useCallback(
    (project: ExpoProjectConfig, action: ExpoActionType, overrides?: ExpoActionOverrides) => {
      const account = expoAccounts.find((entry) => entry.id === project.accountId);
      const workflowPrompt = createExpoWorkflowPrompt(project, account, action, overrides);
      if (workflowPrompt) {
        setExpoWorkflowPrompt(workflowPrompt);
        return;
      }
      void runExpoActionNow(project, action, overrides);
    },
    [expoAccounts, runExpoActionNow],
  );

  const handleConfirmExpoWorkflowPrompt = useCallback(() => {
    if (!expoWorkflowPrompt) {
      return;
    }

    const project = expoProjects.find((entry) => entry.id === expoWorkflowPrompt.projectId);
    if (!project) {
      setExpoWorkflowPrompt(null);
      Alert.alert(t('common.error'), t('remoteWork.expoActionFailed'));
      return;
    }

    const workflowRef = normalizeExpoWorkflowRef(expoWorkflowPrompt.workflowRef);
    if (!workflowRef) {
      Alert.alert(t('common.error'), t('remoteWork.expoWorkflowBranchRequired'));
      return;
    }

    const { action, overrides } = expoWorkflowPrompt;
    setExpoWorkflowPrompt(null);
    void runExpoActionNow(project, action, overrides, workflowRef);
  }, [expoProjects, expoWorkflowPrompt, runExpoActionNow, t]);

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

  return {
    activeWorkspaceSession,
    setActiveWorkspaceSession,
    activeBrowserSession,
    setActiveBrowserSession,
    workspaceProbeResults,
    sshProbeResults,
    browserProbeResults,
    expoProbeResults,
    pendingWorkspaceChecks,
    pendingSshChecks,
    pendingBrowserChecks,
    pendingExpoChecks,
    pendingBrowserLaunches,
    pendingExpoActions,
    expoWorkflowPrompt,
    setExpoWorkflowPrompt,
    workspaceSessionError,
    setWorkspaceSessionError,
    clearWorkspaceProbeResult,
    getExpoActionLabel,
    handleOpenWorkspace,
    handleProbeWorkspace,
    handleProbeSsh,
    handleProbeBrowser,
    handleLaunchBrowser,
    handleProbeExpo,
    handleRunExpoAction,
    handleConfirmExpoWorkflowPrompt,
    handleStopBrowser,
  };
}
