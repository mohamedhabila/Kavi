import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import { ApprovalBanner } from '../../src/components/approval/ApprovalBanner';
import { buildApprovalGrantCandidate } from '../../src/services/remote/approvalGrants';

const mockApprovalStoreState = {
  requests: {} as Record<string, any>,
  approveRequest: jest.fn(),
  rejectRequest: jest.fn(),
  approveAlways: jest.fn(),
};

jest.mock('../../src/services/remote/approvalStore', () => ({
  useApprovalStore: (selector: (state: typeof mockApprovalStoreState) => unknown) =>
    selector(mockApprovalStoreState),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#090909',
      overlay: 'rgba(0,0,0,0.7)',
      surface: '#111',
      surfaceAlt: '#181818',
      subtleBorder: '#333',
      warning: '#fc0',
      warningBackground: '#332a00',
      success: '#0f0',
      danger: '#f00',
      text: '#fff',
      textSecondary: '#ccc',
      textTertiary: '#999',
      primary: '#09f',
      primarySoft: '#023',
      onPrimary: '#fff',
    },
  }),
  AppPalette: {},
}));

const translations: Record<string, string> = {
  'approvalBanner.decisionSheetLabel': 'Approval decision',
  'approvalBanner.unknownAction': 'Assistant action',
  'approvalBanner.actionDetailsUnavailable': 'No additional action details are available.',
  'approvalBanner.needsDecision': 'Your decision is needed',
  'approvalBanner.waitingForDecision': 'Waiting for your decision',
  'approvalBanner.whatWillHappen': 'What will happen',
  'approvalBanner.affectedData': 'Access and affected data',
  'approvalBanner.target': 'Destination',
  'approvalBanner.reversibility': 'Can it be undone?',
  'approvalBanner.whyReview': 'Why review is needed',
  'approvalBanner.safeDefault': 'If time runs out, this request is denied. Nothing will run.',
  'approvalBanner.reject': 'Deny',
  'approvalBanner.rejectHint': 'Stops this action without saving permission',
  'approvalBanner.approve': 'Allow once',
  'approvalBanner.approveHint': 'Allows only this request',
  'approvalBanner.reviewPermission': 'Review saved permission',
  'approvalBanner.persistentHint': 'Reviews the exact reusable access before saving it',
  'approvalBanner.permissionReviewEyebrow': 'Reusable access',
  'approvalBanner.permissionReviewTitle': 'Review saved permission',
  'approvalBanner.permissionReviewDescription':
    'Saving this permission allows the current request and lets the assistant repeat the same bounded action without asking first.',
  'approvalBanner.savedAction': 'Action',
  'approvalBanner.savedActionDetails': 'What can be repeated',
  'approvalBanner.savedTarget': 'Destination',
  'approvalBanner.savedScope': 'Access',
  'approvalBanner.duration': 'Duration',
  'approvalBanner.untilRevoked': 'Until you revoke it',
  'approvalBanner.boundaries': 'When you will be asked again',
  'approvalBanner.boundariesDescription':
    'A different destination, a different action, or a higher-risk request still needs approval.',
  'approvalBanner.revokePath':
    'Revoke anytime in Activity → Approvals & permissions → Saved permissions.',
  'approvalBanner.confirmPersistent': 'Save permission',
  'approvalBanner.thisDevice': 'This device',
  'approvalBanner.selectedDestination': 'The selected destination',
  'approvalBanner.risk.low': 'Low risk',
  'approvalBanner.risk.medium': 'Medium risk',
  'approvalBanner.risk.high': 'High risk',
  'approvalBanner.risk.critical': 'Critical risk',
  'approvalBanner.scope.ssh': 'Files, processes, and services on the selected remote host.',
  'approvalBanner.scope.workspace': 'Files and project state in the selected workspace.',
  'approvalBanner.scope.browser': 'The current browser session and data visible to it.',
  'approvalBanner.scope.expo': 'The selected app project and its build or release state.',
  'approvalBanner.scope.native': 'The selected device feature and only the data you choose.',
  'approvalBanner.scope.other': 'The connected service and the data required for this action.',
  'approvalBanner.reversibilityLevel.low':
    'Limited to the action shown; future access remains under your control.',
  'approvalBanner.reversibilityLevel.medium':
    'It may change the destination; some changes may need a manual undo.',
  'approvalBanner.reversibilityLevel.high':
    'It can make significant changes. Review the destination before allowing.',
  'approvalBanner.reversibilityLevel.critical':
    'It can cause destructive or hard-to-reverse changes.',
  'approvalBanner.reviewReason.destructive':
    'This action may delete, overwrite, or irreversibly change data.',
  'approvalBanner.reviewReason.sensitiveData': 'This action may reach sensitive or private data.',
  'approvalBanner.reviewReason.systemAccess':
    'This action can operate on a system outside this conversation.',
  'approvalBanner.reviewReason.compoundAction':
    'This request combines multiple operations or command steps.',
  'approvalBanner.reviewReason.unverified': 'The impact could not be fully verified in advance.',
  'common.cancel': 'Cancel',
};

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (key === 'approvalBanner.announcement') {
        return `Approval needed for ${params?.action ?? ''}.`;
      }
      if (key === 'approvalBanner.queuePosition') {
        return `Decision ${params?.current ?? 0} of ${params?.total ?? 0}`;
      }
      if (key === 'approvalBanner.expiresIn') return `Expires in ${params?.time ?? ''}`;
      return translations[key] ?? key;
    },
  }),
}));

function standardPolicy() {
  return { persistentApproval: 'allowed', expiryFallback: 'global-policy' } as const;
}

describe('ApprovalBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApprovalStoreState.requests = {};
    mockApprovalStoreState.approveRequest.mockReset();
    mockApprovalStoreState.rejectRequest.mockReset();
    mockApprovalStoreState.approveAlways.mockReset();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(jest.fn());
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders nothing when there are no pending approvals', () => {
    const { toJSON } = render(<ApprovalBanner />);
    expect(toJSON()).toBeNull();
  });

  it('does not present a global decision sheet from an unfocused screen', () => {
    mockApprovalStoreState.requests = {
      hidden: {
        id: 'hidden',
        status: 'pending',
        title: 'Hidden action',
        description: 'Belongs to another mounted screen',
        requestedAt: Date.now(),
        riskLevel: 'low',
      },
    };

    const { toJSON } = render(<ApprovalBanner enabled={false} />);
    expect(toJSON()).toBeNull();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });

  it('shows one decision at a time in deadline order and exposes the queue position', () => {
    const now = Date.now();
    mockApprovalStoreState.requests = {
      later: {
        id: 'later',
        status: 'pending',
        title: 'Later action',
        description: 'Runs later',
        requestedAt: now - 30_000,
        expiresAt: now + 120_000,
        riskLevel: 'low',
      },
      first: {
        id: 'first',
        status: 'pending',
        title: 'First action',
        description: 'Runs first',
        requestedAt: now - 20_000,
        expiresAt: now + 60_000,
        riskLevel: 'medium',
      },
      oldestDeadline: {
        id: 'oldestDeadline',
        status: 'pending',
        title: 'Second action',
        description: 'Runs second',
        requestedAt: now - 10_000,
        expiresAt: now + 90_000,
        riskLevel: 'high',
      },
      done: {
        id: 'done',
        status: 'approved',
        title: 'Already handled',
        description: 'Ignore this',
        requestedAt: now - 50_000,
        riskLevel: 'low',
      },
    };

    const { getByText, getByTestId, queryByText } = render(<ApprovalBanner />);

    expect(getByTestId('approval-decision-scroll')).toBeTruthy();
    expect(getByText('First action')).toBeTruthy();
    expect(queryByText('Later action')).toBeNull();
    expect(queryByText('Second action')).toBeNull();
    expect(queryByText('Already handled')).toBeNull();
    expect(getByText('Decision 1 of 3')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      'Approval needed for First action.',
    );
  });

  it('shows structured, redacted consequences without leaking raw risk details', () => {
    const apiKey = ['sk', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
    mockApprovalStoreState.requests = {
      scoped: {
        id: 'scoped',
        status: 'pending',
        title: 'Run status check',
        description: `Authorization: Bearer ${apiKey}`,
        requestedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        riskLevel: 'medium',
        riskReasons: ['Sensitive path: /etc/shadow'],
        targetId: `server.example.test?token=${apiKey}`,
        scope: 'ssh',
      },
    };

    const result = render(<ApprovalBanner />);
    const rendered = JSON.stringify(result.toJSON());

    expect(result.getByText('Access and affected data')).toBeTruthy();
    expect(
      result.getByText('Files, processes, and services on the selected remote host.'),
    ).toBeTruthy();
    expect(result.getByText('This action may reach sensitive or private data.')).toBeTruthy();
    expect(
      result.getByText('If time runs out, this request is denied. Nothing will run.'),
    ).toBeTruthy();
    expect(rendered).toContain('[REDACTED]');
    expect(rendered).not.toContain(apiKey);
    expect(rendered).not.toContain('/etc/shadow');
    expect(rendered).not.toContain('Sensitive path:');
  });

  it('updates the visible countdown without repeatedly announcing it', () => {
    jest.useFakeTimers();
    const now = new Date('2026-07-23T12:00:00.000Z');
    jest.setSystemTime(now);
    mockApprovalStoreState.requests = {
      timed: {
        id: 'timed',
        status: 'pending',
        title: 'Timed action',
        description: 'Wait for a decision',
        requestedAt: now.getTime(),
        expiresAt: now.getTime() + 90_000,
        riskLevel: 'low',
      },
    };

    const { getByText, unmount } = render(<ApprovalBanner />);
    expect(getByText('Expires in 1:30')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(getByText('Expires in 1:29')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('provides 48-point one-shot decision targets with clear semantics', () => {
    mockApprovalStoreState.requests = {
      decision: {
        id: 'decision',
        status: 'pending',
        title: 'Share selected file',
        description: 'Share one selected file',
        requestedAt: Date.now(),
        riskLevel: 'low',
      },
    };

    const { getByLabelText } = render(<ApprovalBanner />);
    const deny = getByLabelText('Deny');
    const allow = getByLabelText('Allow once');

    expect(StyleSheet.flatten(deny.props.style).minHeight).toBeGreaterThanOrEqual(48);
    expect(StyleSheet.flatten(allow.props.style).minHeight).toBeGreaterThanOrEqual(48);
    expect(deny.props.accessibilityHint).toBe('Stops this action without saving permission');
    expect(allow.props.accessibilityHint).toBe('Allows only this request');

    fireEvent.press(deny);
    fireEvent.press(allow);
    expect(mockApprovalStoreState.rejectRequest).toHaveBeenCalledWith('decision');
    expect(mockApprovalStoreState.approveRequest).toHaveBeenCalledWith('decision');
  });

  it('reviews bounded reusable access in context before saving it', () => {
    const grantCandidate = buildApprovalGrantCandidate({
      toolName: 'ssh_exec',
      targetId: 'staging-server',
      args: { command: 'pwd' },
      riskLevel: 'low',
      destructive: false,
    });
    mockApprovalStoreState.requests = {
      scoped: {
        id: 'scoped',
        status: 'pending',
        title: 'Run status check',
        description: 'Run pwd on the selected host',
        requestedAt: Date.now(),
        riskLevel: 'low',
        targetId: 'staging-server',
        scope: 'ssh',
        decisionPolicy: standardPolicy(),
        grantCandidate,
      },
    };

    const result = render(<ApprovalBanner />);
    fireEvent.press(result.getByLabelText('Review saved permission'));

    expect(result.getByTestId('approval-permission-review')).toBeTruthy();
    expect(result.getByText('staging-server')).toBeTruthy();
    expect(result.getByText('Until you revoke it')).toBeTruthy();
    expect(result.getByText('When you will be asked again')).toBeTruthy();
    expect(
      result.getByText('Revoke anytime in Activity → Approvals & permissions → Saved permissions.'),
    ).toBeTruthy();
    expect(result.queryByLabelText('Allow once')).toBeNull();
    expect(mockApprovalStoreState.approveAlways).not.toHaveBeenCalled();

    fireEvent.press(result.getByLabelText('Cancel'));
    expect(result.getByLabelText('Allow once')).toBeTruthy();
    fireEvent.press(result.getByLabelText('Review saved permission'));
    fireEvent.press(result.getByLabelText('Save permission'));
    expect(mockApprovalStoreState.approveAlways).toHaveBeenCalledWith('scoped');
  });

  it('never offers reusable access for a one-shot request or an unbounded grant', () => {
    mockApprovalStoreState.requests = {
      memory: {
        id: 'memory',
        status: 'pending',
        title: 'Remember observed fact',
        description: 'Store one fact from this result',
        requestedAt: Date.now(),
        riskLevel: 'medium',
        decisionPolicy: { persistentApproval: 'forbidden', expiryFallback: 'reject' },
      },
    };

    const { queryByLabelText, getByLabelText } = render(<ApprovalBanner />);
    expect(queryByLabelText('Review saved permission')).toBeNull();
    expect(getByLabelText('Deny')).toBeTruthy();
    expect(getByLabelText('Allow once')).toBeTruthy();
  });

  it('renders safe fallbacks for malformed legacy presentation fields', () => {
    mockApprovalStoreState.requests = {
      legacy: {
        id: 'legacy',
        status: 'pending',
        title: '\u0000',
        description: '   ',
        requestedAt: Number.NaN,
        expiresAt: 'soon',
        riskLevel: 'unexpected',
        riskReasons: 'Sensitive path: /private',
        scope: 'unexpected',
      },
    };

    const { getByText } = render(<ApprovalBanner />);
    expect(getByText('Assistant action')).toBeTruthy();
    expect(getByText('No additional action details are available.')).toBeTruthy();
    expect(getByText('Low risk')).toBeTruthy();
    expect(getByText('The connected service and the data required for this action.')).toBeTruthy();
  });
});
