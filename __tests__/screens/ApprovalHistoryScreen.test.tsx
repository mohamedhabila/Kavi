// ---------------------------------------------------------------------------
// Tests — ApprovalHistoryScreen
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ApprovalHistoryScreen } from '../../src/screens/ApprovalHistoryScreen';
import { clearAuditLog, logToolCall } from '../../src/services/security/audit';

const mockOpenDrawer = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ openDrawer: mockOpenDrawer, navigate: jest.fn() }),
  useRoute: () => ({ name: 'ApprovalHistory', params: {} }),
  useFocusEffect: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const translate = (key: string, params?: Record<string, any>) => {
  const map: Record<string, string> = {
    'chat.openMenu': 'Open menu',
    'approvalHistory.title': 'Approvals & permissions',
    'approvalHistory.emptyTitle': 'No approval requests',
    'approvalHistory.emptyDescription': 'When tools require approval, requests will appear here.',
    'approvalHistory.clearResolved': 'Clear resolved requests',
    'approvalHistory.reviewEveryTool': 'Review every tool request',
    'approvalHistory.reviewSensitiveTools': 'Review sensitive tool requests',
    'approvalHistory.policyHint': 'Saved permissions apply only to an exact action and target.',
    'approvalHistory.action.approve': 'Allow once',
    'approvalHistory.action.reject': 'Deny',
    'approvalHistory.filter.all': 'All',
    'approvalHistory.filter.pending': 'Pending',
    'approvalHistory.filter.approved': 'Approved',
    'approvalHistory.filter.rejected': 'Rejected',
    'approvalHistory.filter.expired': 'Expired',
    'approvalHistory.status.pending': 'Pending',
    'approvalHistory.status.approved': 'Approved',
    'approvalHistory.status.rejected': 'Rejected',
    'approvalHistory.status.expired': 'Expired',
    'approvalHistory.status.success': 'Success',
    'approvalHistory.status.error': 'Error',
    'approvalHistory.section.approvalMetrics': 'Approval metrics',
    'approvalHistory.section.nativeTelemetry': 'Native tool telemetry',
    'approvalHistory.section.recentNativeActivity': 'Recent native activity',
    'approvalHistory.metric.pending': 'Pending',
    'approvalHistory.metric.approved': 'Approved',
    'approvalHistory.metric.rejected': 'Rejected',
    'approvalHistory.metric.expired': 'Expired',
    'approvalHistory.metric.nativeCalls': 'Native calls',
    'approvalHistory.metric.nativeErrors': 'Native errors',
    'approvalHistory.noNativeActivity': 'No recent native tool activity.',
    'approvalHistory.permissions.title': 'Saved permissions',
    'approvalHistory.permissions.description': 'Review reusable access.',
    'approvalHistory.permissions.empty': 'No saved permissions.',
    'approvalHistory.permissions.active': 'Allowed',
    'approvalHistory.permissions.reviewRequired': 'Review needed',
    'approvalHistory.permissions.localDevice': 'Target: this device',
    'approvalHistory.permissions.exactMcpTool': 'Scope: this exact MCP tool',
    'approvalHistory.permissions.exactTool': 'Scope: this exact tool',
    'approvalHistory.permissions.revoke': 'Revoke',
    'toolApproval.actions.emailComposeTitle': 'Send email',
    'toolApproval.details.recipientCount': `${params?.count ?? 0} recipient(s)`,
    'toolApproval.details.subjectIncluded': 'subject included',
    'toolApproval.redactedNotice': 'Sensitive details are redacted.',
    'toolApproval.genericDescription': 'Run this action with redacted arguments.',
  };

  if (key === 'approvalHistory.targetLabel') {
    return `Target: ${params?.target ?? ''}`;
  }
  if (key === 'approvalHistory.permissions.targetLabel') {
    return `Target: ${params?.target ?? ''}`;
  }
  if (key === 'approvalHistory.permissions.actionLabel') {
    return `Action: ${params?.action ?? ''}`;
  }
  if (key === 'approvalHistory.permissions.personaLabel') {
    return `Assistant profile: ${params?.persona ?? ''}`;
  }
  if (key === 'approvalHistory.permissions.legacyDescription') {
    return `Legacy permission ${params?.permission ?? ''} was disabled.`;
  }
  if (key === 'approvalHistory.permissions.revokeLabel') {
    return `Revoke permission for ${params?.tool ?? ''}`;
  }

  return map[key] || key;
};

jest.mock('../../src/i18n/manager', () => ({
  i18n: { t: translate },
}));
jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: translate }),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      mode: 'dark',
      background: '#000',
      surface: '#111',
      panel: '#111',
      border: '#333',
      header: '#222',
      text: '#fff',
      textSecondary: '#aaa',
      textTertiary: '#777',
      primary: '#0f0',
      primarySoft: '#030',
      onPrimary: '#fff',
      danger: '#f00',
      warning: '#ff0',
      success: '#0f0',
    },
  }),
  AppPalette: {},
}));

// Mock lucide-react-native icons
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const mockIcon = (name: string) =>
    React.forwardRef((props: any, ref: any) =>
      React.createElement('View', { ...props, ref, testID: `icon-${name}` }),
    );
  return {
    Menu: mockIcon('Menu'),
    ShieldCheck: mockIcon('ShieldCheck'),
    ShieldX: mockIcon('ShieldX'),
    ShieldAlert: mockIcon('ShieldAlert'),
    ShieldQuestion: mockIcon('ShieldQuestion'),
    Clock: mockIcon('Clock'),
    Trash2: mockIcon('Trash2'),
    Filter: mockIcon('Filter'),
  };
});

// Mock approval store
const mockRequests: Record<string, any> = {};
const mockApprove = jest.fn();
const mockReject = jest.fn();
const mockClearResolved = jest.fn();
const mockRemoveFromAllowlist = jest.fn();
let mockAllowlist: any[] = [];
let mockPolicy = {
  requireApproval: false,
  alwaysApproveTools: [],
  autoApproveTools: [],
  timeoutMs: 300000,
};
let mockAnalytics = {
  totalRequests: 0,
  totalApproved: 0,
  totalRejected: 0,
  totalExpired: 0,
  totalAllowAlways: 0,
  averageDecisionMs: 0,
  byTool: {},
};

jest.mock('../../src/services/remote/approvalStore', () => ({
  useApprovalStore: (selector: (s: any) => any) => {
    const state = {
      requests: mockRequests,
      policy: mockPolicy,
      allowlist: mockAllowlist,
      analytics: mockAnalytics,
      approveRequest: mockApprove,
      rejectRequest: mockReject,
      clearResolved: mockClearResolved,
      removeFromAllowlist: mockRemoveFromAllowlist,
    };
    return selector(state);
  },
}));

describe('ApprovalHistoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAuditLog();
    // Reset requests
    Object.keys(mockRequests).forEach((k) => delete mockRequests[k]);
    mockAllowlist = [];
    mockPolicy = {
      requireApproval: false,
      alwaysApproveTools: [],
      autoApproveTools: [],
      timeoutMs: 300000,
    };
    mockAnalytics = {
      totalRequests: 0,
      totalApproved: 0,
      totalRejected: 0,
      totalExpired: 0,
      totalAllowAlways: 0,
      averageDecisionMs: 0,
      byTool: {},
    };
  });

  it('should render the header with title', () => {
    const { getByText } = render(<ApprovalHistoryScreen />);
    expect(getByText('Approvals & permissions')).toBeTruthy();
  });

  it('should show empty state when no requests exist', () => {
    const { getByText } = render(<ApprovalHistoryScreen />);
    expect(getByText('No approval requests')).toBeTruthy();
    expect(getByText('When tools require approval, requests will appear here.')).toBeTruthy();
    expect(getByText('Native tool telemetry')).toBeTruthy();
    expect(getByText('No saved permissions.')).toBeTruthy();
  });

  it('should render request cards when requests exist', () => {
    mockRequests['req-1'] = {
      id: 'req-1',
      title: 'Tool: ssh_exec',
      description: 'Execute ls -la',
      status: 'pending',
      requestedAt: Date.now(),
    };
    mockRequests['req-2'] = {
      id: 'req-2',
      title: 'Tool: browser_execute',
      description: 'Run script',
      status: 'approved',
      requestedAt: Date.now() - 10000,
      resolvedAt: Date.now() - 5000,
    };

    const { getByText } = render(<ApprovalHistoryScreen />);
    expect(getByText('Tool: ssh_exec')).toBeTruthy();
    expect(getByText('Tool: browser_execute')).toBeTruthy();
  });

  it('should show approve/reject buttons for pending requests', () => {
    mockRequests['req-1'] = {
      id: 'req-1',
      title: 'Tool: ssh_exec',
      description: 'Execute something',
      status: 'pending',
      requestedAt: Date.now(),
    };

    const { getByText } = render(<ApprovalHistoryScreen />);
    expect(getByText('Allow once')).toBeTruthy();
    expect(getByText('Deny')).toBeTruthy();
  });

  it('should call approveRequest when approve button is pressed', () => {
    mockRequests['req-1'] = {
      id: 'req-1',
      title: 'Tool: ssh_exec',
      description: 'Execute something',
      status: 'pending',
      requestedAt: Date.now(),
    };

    const { getByText } = render(<ApprovalHistoryScreen />);
    fireEvent.press(getByText('Allow once'));
    expect(mockApprove).toHaveBeenCalledWith('req-1');
  });

  it('should call rejectRequest when reject button is pressed', () => {
    mockRequests['req-1'] = {
      id: 'req-1',
      title: 'Tool: ssh_exec',
      description: 'Execute something',
      status: 'pending',
      requestedAt: Date.now(),
    };

    const { getByText } = render(<ApprovalHistoryScreen />);
    fireEvent.press(getByText('Deny'));
    expect(mockReject).toHaveBeenCalledWith('req-1');
  });

  it('should filter by status when filter chips are pressed', () => {
    mockRequests['req-1'] = {
      id: 'req-1',
      title: 'Pending Tool',
      description: 'desc',
      status: 'pending',
      requestedAt: Date.now(),
    };
    mockRequests['req-2'] = {
      id: 'req-2',
      title: 'Approved Tool',
      description: 'desc',
      status: 'approved',
      requestedAt: Date.now() - 10000,
      resolvedAt: Date.now(),
    };

    const { getByTestId, getByText, queryByText } = render(<ApprovalHistoryScreen />);

    // Initially "All" is selected — both should be visible
    expect(getByText('Pending Tool')).toBeTruthy();
    expect(getByText('Approved Tool')).toBeTruthy();
    expect(getByTestId('approval-filter-all').props.accessibilityRole).toBe('tab');
    expect(getByTestId('approval-filter-all').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(StyleSheet.flatten(getByTestId('approval-filter-all').props.style).minHeight).toBe(48);

    fireEvent.press(getByTestId('approval-filter-approved'));
    expect(queryByText('Pending Tool')).toBeNull();
    expect(getByText('Approved Tool')).toBeTruthy();
    expect(getByTestId('approval-filter-approved').props.accessibilityState).toEqual({
      selected: true,
    });

    // Click "Pending" filter
    expect(getByTestId('approval-filter-pending').props.accessibilityLabel).toBe('Pending (1)');
    fireEvent.press(getByTestId('approval-filter-pending'));
    expect(getByText('Pending Tool')).toBeTruthy();
    expect(queryByText('Approved Tool')).toBeNull();
  });

  it('should show pending count in filter chip', () => {
    mockRequests['req-1'] = {
      id: 'req-1',
      title: 'Tool',
      description: 'desc',
      status: 'pending',
      requestedAt: Date.now(),
    };

    const { getByText } = render(<ApprovalHistoryScreen />);
    expect(getByText(/Pending \(1\)/)).toBeTruthy();
  });

  it('should show the current review policy as a non-interactive summary', () => {
    const { getByText } = render(<ApprovalHistoryScreen />);
    expect(getByText('Review sensitive tool requests')).toBeTruthy();
    expect(getByText('Saved permissions apply only to an exact action and target.')).toBeTruthy();
  });

  it('shows scoped permissions, flags legacy grants, and revokes by exact key', () => {
    mockAllowlist = [
      {
        version: 1,
        key: 'v1-scoped-key',
        toolName: 'ssh_exec',
        scope: 'ssh',
        actionClass: 'pwd',
        targetKind: 'ssh-host',
        targetId: 'staging-host',
        addedAt: 20,
        status: 'active',
        source: 'user',
      },
      {
        version: 1,
        key: 'legacy-review-key',
        toolName: 'browser_click',
        scope: 'browser',
        actionClass: 'legacy',
        targetKind: 'tool',
        addedAt: 10,
        status: 'review-required',
        source: 'legacy',
        legacyKey: 'browser_click',
      },
      {
        version: 1,
        key: 'internal-only',
        toolName: 'internal_tool',
        scope: 'other',
        actionClass: '*',
        targetKind: 'tool',
        addedAt: 30,
        status: 'active',
        source: 'internal',
      },
    ];

    const { getByLabelText, getByText, queryByText } = render(<ApprovalHistoryScreen />);

    expect(getByText('ssh_exec')).toBeTruthy();
    expect(getByText('Action: pwd')).toBeTruthy();
    expect(getByText('Target: staging-host')).toBeTruthy();
    expect(getByText('Allowed')).toBeTruthy();
    expect(getByText('Review needed')).toBeTruthy();
    expect(getByText('Legacy permission browser_click was disabled.')).toBeTruthy();
    expect(queryByText('internal_tool')).toBeNull();

    fireEvent.press(getByLabelText('Revoke permission for ssh_exec'));
    expect(mockRemoveFromAllowlist).toHaveBeenCalledWith('v1-scoped-key');
  });

  it('should call clearResolved when trash button is pressed', () => {
    mockRequests['resolved'] = {
      id: 'resolved',
      title: 'Resolved request',
      description: 'Already handled',
      status: 'approved',
      requestedAt: Date.now() - 1000,
      resolvedAt: Date.now(),
    };
    const { getByTestId } = render(<ApprovalHistoryScreen />);
    const trashIcon = getByTestId('icon-Trash2');
    fireEvent.press(trashIcon.parent || trashIcon);
    expect(mockClearResolved).toHaveBeenCalled();
  });

  it('should open drawer when menu button is pressed', () => {
    const { getByTestId } = render(<ApprovalHistoryScreen />);
    const menuIcon = getByTestId('icon-Menu');
    fireEvent.press(menuIcon.parent || menuIcon);
    expect(mockOpenDrawer).toHaveBeenCalled();
  });

  it('should display status labels correctly', () => {
    mockRequests['req-approved'] = {
      id: 'req-approved',
      title: 'Approved Item',
      description: 'desc',
      status: 'approved',
      requestedAt: Date.now() - 60000,
      resolvedAt: Date.now(),
    };
    mockRequests['req-rejected'] = {
      id: 'req-rejected',
      title: 'Rejected Item',
      description: 'desc',
      status: 'rejected',
      requestedAt: Date.now() - 60000,
      resolvedAt: Date.now(),
    };

    const { getAllByText } = render(<ApprovalHistoryScreen />);
    // The status texts should be rendered
    expect(getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Rejected').length).toBeGreaterThanOrEqual(1);
  });

  it('should render redacted native telemetry activity', () => {
    logToolCall(
      'email_compose',
      JSON.stringify({ recipients: ['jane@example.com'], subject: 'Private subject' }),
      'success',
      24,
      'conv-1',
    );
    logToolCall('phone_call', JSON.stringify({ number: '+12125550101' }), 'error', 12, 'conv-1');

    const { getByText, queryByText } = render(<ApprovalHistoryScreen />);
    expect(getByText('Native tool telemetry')).toBeTruthy();
    expect(getByText('email_compose')).toBeTruthy();
    expect(getByText('Success')).toBeTruthy();
    expect(getByText('Error')).toBeTruthy();
    expect(queryByText('jane@example.com')).toBeNull();
    expect(queryByText('Private subject')).toBeNull();
  });
});
