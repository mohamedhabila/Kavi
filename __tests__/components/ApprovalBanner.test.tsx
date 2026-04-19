import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ApprovalBanner } from '../../src/components/approval/ApprovalBanner';

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
      surface: '#111',
      warning: '#fc0',
      success: '#0f0',
      danger: '#f00',
      text: '#fff',
      textSecondary: '#ccc',
      textTertiary: '#999',
      primary: '#09f',
      onPrimary: '#fff',
    },
  }),
  AppPalette: {},
}));

jest.mock('../../src/i18n', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, any>) => {
      switch (key) {
        case 'approvalBanner.morePending':
          return `${params?.count ?? 0} more pending`;
        case 'approvalBanner.elapsedSeconds':
          return `${params?.count ?? 0}s ago`;
        case 'approvalBanner.elapsedMinutes':
          return `${params?.count ?? 0}m ago`;
        case 'approvalBanner.targetLabel':
          return `Target: ${params?.target ?? ''}`;
        case 'approvalBanner.reject':
          return 'Reject';
        case 'approvalBanner.alwaysAllow':
          return 'Always allow';
        case 'approvalBanner.approve':
          return 'Approve';
        default:
          return key;
      }
    },
  }),
}));

describe('ApprovalBanner', () => {
  beforeEach(() => {
    mockApprovalStoreState.requests = {};
    mockApprovalStoreState.approveRequest.mockReset();
    mockApprovalStoreState.rejectRequest.mockReset();
    mockApprovalStoreState.approveAlways.mockReset();
  });

  it('renders nothing when there are no pending approvals', () => {
    const { toJSON } = render(<ApprovalBanner />);
    expect(toJSON()).toBeNull();
  });

  it('renders only the first three pending approvals and shows overflow count', () => {
    mockApprovalStoreState.requests = {
      one: {
        id: 'one',
        status: 'pending',
        title: 'Approve shell command',
        description: 'Run ls',
        requestedAt: Date.now() - 30_000,
        riskLevel: 'low',
      },
      two: {
        id: 'two',
        status: 'pending',
        title: 'Approve browser action',
        description: 'Open site',
        requestedAt: Date.now() - 120_000,
        riskLevel: 'medium',
      },
      three: {
        id: 'three',
        status: 'pending',
        title: 'Approve SSH command',
        description: 'Restart service',
        requestedAt: Date.now() - 180_000,
        riskLevel: 'high',
      },
      four: {
        id: 'four',
        status: 'pending',
        title: 'Approve deletion',
        description: 'Remove temp file',
        requestedAt: Date.now() - 240_000,
        riskLevel: 'critical',
      },
      done: {
        id: 'done',
        status: 'approved',
        title: 'Already handled',
        description: 'Ignore this',
        requestedAt: Date.now() - 50_000,
        riskLevel: 'low',
      },
    };

    const { getByText, queryByText } = render(<ApprovalBanner />);

    expect(getByText('Approve shell command')).toBeTruthy();
    expect(getByText('Approve browser action')).toBeTruthy();
    expect(getByText('Approve SSH command')).toBeTruthy();
    expect(queryByText('Approve deletion')).toBeNull();
    expect(queryByText('Already handled')).toBeNull();
    expect(getByText('1 more pending')).toBeTruthy();
  });

  it('dispatches approve, reject, and always-allow actions for the visible request', () => {
    mockApprovalStoreState.requests = {
      critical: {
        id: 'critical',
        status: 'pending',
        title: 'Deploy prod change',
        description: 'Apply release patch',
        requestedAt: Date.now() - 90_000,
        riskLevel: 'critical',
        riskReasons: ['writes to prod', 'restarts service'],
        targetId: 'prod-server',
      },
    };

    const { getByText } = render(<ApprovalBanner />);

    expect(getByText('writes to prod · restarts service')).toBeTruthy();
    expect(getByText('Target: prod-server')).toBeTruthy();

    fireEvent.press(getByText('Reject'));
    fireEvent.press(getByText('Always allow'));
    fireEvent.press(getByText('Approve'));

    expect(mockApprovalStoreState.rejectRequest).toHaveBeenCalledWith('critical');
    expect(mockApprovalStoreState.approveAlways).toHaveBeenCalledWith('critical');
    expect(mockApprovalStoreState.approveRequest).toHaveBeenCalledWith('critical');
  });
});
