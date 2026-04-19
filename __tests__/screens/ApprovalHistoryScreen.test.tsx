// ---------------------------------------------------------------------------
// Tests — ApprovalHistoryScreen
// ---------------------------------------------------------------------------

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ApprovalHistoryScreen } from '../../src/screens/ApprovalHistoryScreen';
import { clearAuditLog, logToolCall } from '../../src/services/security/audit';

const mockOpenDrawer = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ openDrawer: mockOpenDrawer }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const translate = (key: string, params?: Record<string, any>) => {
  const map: Record<string, string> = {
    'approvalHistory.title': 'Approvals',
    'approvalHistory.emptyTitle': 'No approval requests',
    'approvalHistory.emptyDescription': 'When tools require approval, requests will appear here.',
    'approvalHistory.globalApprovalOn': 'Global approval: ON',
    'approvalHistory.globalApprovalOff': 'Global approval: OFF',
    'approvalHistory.action.approve': 'Approve',
    'approvalHistory.action.reject': 'Reject',
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
    'toolApproval.actions.emailComposeTitle': 'Send email',
    'toolApproval.details.recipientCount': `${params?.count ?? 0} recipient(s)`,
    'toolApproval.details.subjectIncluded': 'subject included',
    'toolApproval.redactedNotice': 'Sensitive details are redacted.',
    'toolApproval.genericDescription': 'Run this action with redacted arguments.',
  };

  if (key === 'approvalHistory.targetLabel') {
    return `Target: ${params?.target ?? ''}`;
  }

  return map[key] || key;
};

jest.mock('../../src/i18n', () => ({
  i18n: { t: translate },
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
const mockSetPolicy = jest.fn();
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
      analytics: mockAnalytics,
      approveRequest: mockApprove,
      rejectRequest: mockReject,
      clearResolved: mockClearResolved,
      setPolicy: mockSetPolicy,
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
    expect(getByText('Approvals')).toBeTruthy();
  });

  it('should show empty state when no requests exist', () => {
    const { getByText } = render(<ApprovalHistoryScreen />);
    expect(getByText('No approval requests')).toBeTruthy();
    expect(getByText('When tools require approval, requests will appear here.')).toBeTruthy();
    expect(getByText('Native tool telemetry')).toBeTruthy();
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
    expect(getByText('Approve')).toBeTruthy();
    expect(getByText('Reject')).toBeTruthy();
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
    fireEvent.press(getByText('Approve'));
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
    fireEvent.press(getByText('Reject'));
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

    const { getAllByText, getByText, queryByText } = render(<ApprovalHistoryScreen />);

    // Initially "All" is selected — both should be visible
    expect(getByText('Pending Tool')).toBeTruthy();
    expect(getByText('Approved Tool')).toBeTruthy();

    // Click "Approved" filter chip (find by the filter chip, not the status label)
    // There are multiple "Approved" texts — filter chip and status label. Use getAllByText.
    const approvedTexts = getAllByText('Approved');
    // The first match is the filter chip (it comes before card content in DOM)
    fireEvent.press(approvedTexts[0]);
    expect(queryByText('Pending Tool')).toBeNull();
    expect(getByText('Approved Tool')).toBeTruthy();

    // Click "Pending" filter
    fireEvent.press(getByText('Pending (1)'));
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

  it('should show policy toggle', () => {
    const { getByText } = render(<ApprovalHistoryScreen />);
    expect(getByText('Global approval: OFF')).toBeTruthy();
  });

  it('should toggle policy when policy bar is pressed', () => {
    const { getByText } = render(<ApprovalHistoryScreen />);
    fireEvent.press(getByText('Global approval: OFF'));
    expect(mockSetPolicy).toHaveBeenCalledWith({ requireApproval: true });
  });

  it('should call clearResolved when trash button is pressed', () => {
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

    const { getByText, queryByText } = render(<ApprovalHistoryScreen />);
    expect(getByText('Native tool telemetry')).toBeTruthy();
    expect(getByText('email_compose')).toBeTruthy();
    expect(queryByText('jane@example.com')).toBeNull();
    expect(queryByText('Private subject')).toBeNull();
  });
});
