import React, { useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ActivityFeedView } from '../../src/components/activity/ActivityFeedView';
import type { ActivityFilter, ActivityItem } from '../../src/services/activity/activityFeed';

const mockTranslations: Record<string, string> = {
  'nav.activity': 'Activity',
  'nav.assistant': 'Assistant',
  'activity.intro': 'See what needs you and what is underway.',
  'activity.filtersLabel': 'Activity filters',
  'activity.filterLabelWithCount': '{label}, {count}',
  'activity.filter.pending': 'Pending',
  'activity.filter.active': 'Active',
  'activity.filter.recent': 'Recent',
  'activity.filter.automations': 'Automations',
  'activity.status.waiting': 'Waiting for you',
  'activity.status.active': 'In progress',
  'activity.status.completed': 'Completed',
  'activity.fromConversation': 'From {title}',
  'activity.nextOccurrence': 'Next: {time}',
  'activity.openDecisionHint': 'Opens decision details',
  'activity.openAutomationHint': 'Opens this automation',
  'activity.openConversationHint': 'Returns to the source chat',
  'activity.openCreation': 'Open linked creation',
  'activity.openCreationHint': 'Opens the creation',
  'activity.empty.pendingTitle': 'Nothing needs your attention',
  'activity.empty.pendingHint': 'Decisions will appear here.',
  'activity.empty.activeTitle': 'No work in progress',
  'activity.empty.activeHint': 'Longer tasks will appear here.',
  'activity.empty.recentTitle': 'No recent activity',
  'activity.empty.recentHint': 'Completed work will appear here.',
  'activity.empty.automationsTitle': 'No reminders or automations',
  'activity.empty.automationsHint': 'Create a reminder or routine.',
  'activity.createAutomation': 'Create reminder or automation',
  'activity.openAssistant': 'Open Assistant',
  'activity.advancedTitle': 'Advanced work details',
  'activity.advancedHint': 'View worker hierarchy, sessions, and tool counts.',
};

function mockTranslate(key: string, params?: Record<string, string | number>): string {
  return Object.entries(params ?? {}).reduce(
    (value, [name, replacement]) => value.replace(`{${name}}`, String(replacement)),
    mockTranslations[key] ?? key,
  );
}

jest.mock('../../src/i18n/useTranslation', () => ({
  useTranslation: () => ({ locale: 'en', t: mockTranslate }),
}));

jest.mock('../../src/theme/useAppTheme', () => ({
  useAppTheme: () => ({
    colors: {
      background: '#000',
      border: '#333',
      danger: '#ef4444',
      dangerSoft: '#3f1111',
      header: '#111',
      onPrimary: '#000',
      primary: '#22c55e',
      primarySoft: '#123524',
      success: '#22c55e',
      surface: '#111',
      surfaceAlt: '#222',
      text: '#fff',
      textSecondary: '#bbb',
      textTertiary: '#888',
      warning: '#f59e0b',
      warningBackground: '#3b2405',
    },
  }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../src/components/navigation/RouteLeadingButton', () => {
  const { TouchableOpacity: MockTouchableOpacity } = require('react-native');
  return {
    RouteLeadingButton: (props: any) => <MockTouchableOpacity {...props} />,
  };
});

const items: ActivityItem[] = [
  {
    id: 'approval:approval-1',
    kind: 'approval',
    status: 'waiting',
    title: 'Share the itinerary',
    detail: 'Send it to the calendar service',
    timestamp: Date.UTC(2026, 6, 22, 12),
    approvalId: 'approval-1',
  },
  {
    id: 'assistant-run:conversation-1:run-1',
    kind: 'assistant-run',
    status: 'active',
    title: 'Plan the trip',
    detail: 'Comparing train routes',
    timestamp: Date.UTC(2026, 6, 22, 13),
    sourceConversationId: 'conversation-1',
    sourceConversationTitle: 'Summer trip',
  },
  {
    id: 'assistant-run:conversation-1:run-2',
    kind: 'assistant-run',
    status: 'completed',
    title: 'Create the itinerary',
    timestamp: Date.UTC(2026, 6, 22, 14),
    sourceConversationId: 'conversation-1',
    sourceConversationTitle: 'Summer trip',
    artifactPaths: ['travel/itinerary.pdf'],
  },
];

interface HarnessProps {
  initialFilter?: ActivityFilter;
  sourceItems?: ActivityItem[];
  onOpenAdvanced?: jest.Mock;
  onOpenArtifact?: jest.Mock;
  onOpenAssistant?: jest.Mock;
  onOpenAutomations?: jest.Mock;
  onOpenItem?: jest.Mock;
}

function ActivityHarness({
  initialFilter = 'pending',
  sourceItems = items,
  onOpenAdvanced = jest.fn(),
  onOpenArtifact = jest.fn(),
  onOpenAssistant = jest.fn(),
  onOpenAutomations = jest.fn(),
  onOpenItem = jest.fn(),
}: HarnessProps) {
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter);
  return (
    <ActivityFeedView
      filter={filter}
      items={sourceItems}
      onFilterChange={setFilter}
      onOpenAdvanced={onOpenAdvanced}
      onOpenArtifact={onOpenArtifact}
      onOpenAssistant={onOpenAssistant}
      onOpenAutomations={onOpenAutomations}
      onOpenItem={onOpenItem}
    />
  );
}

describe('ActivityFeedView', () => {
  it('uses accessible 48-point filters and switches between canonical states', () => {
    const { getByTestId, getByText, queryByText } = render(<ActivityHarness />);

    const pendingFilter = getByTestId('activity-filter-pending');
    expect(StyleSheet.flatten(pendingFilter.props.style).minHeight).toBe(48);
    expect(pendingFilter.props.accessibilityRole).toBe('tab');
    expect(pendingFilter.props.accessibilityState).toEqual({ selected: true });
    expect(getByText('Share the itinerary')).toBeTruthy();

    fireEvent.press(getByTestId('activity-filter-active'));

    expect(getByTestId('activity-filter-active').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(getByText('Plan the trip')).toBeTruthy();
    expect(queryByText('Share the itinerary')).toBeNull();
  });

  it('opens source work and linked creations as separate actions', () => {
    const onOpenArtifact = jest.fn();
    const onOpenItem = jest.fn();
    const { getByTestId, getByText } = render(
      <ActivityHarness
        initialFilter="recent"
        onOpenArtifact={onOpenArtifact}
        onOpenItem={onOpenItem}
      />,
    );

    expect(getByText('From Summer trip')).toBeTruthy();
    fireEvent.press(getByTestId('activity-item-assistant-run:conversation-1:run-2'));
    expect(onOpenItem).toHaveBeenCalledWith(items[2]);

    const artifact = getByTestId('activity-artifact-assistant-run:conversation-1:run-2');
    expect(StyleSheet.flatten(artifact.props.style).width).toBe(48);
    fireEvent.press(artifact);
    expect(onOpenArtifact).toHaveBeenCalledWith(items[2], 'travel/itinerary.pdf');
  });

  it('guides empty automation and work states to the relevant next action', () => {
    const onOpenAdvanced = jest.fn();
    const onOpenAutomations = jest.fn();
    const { getByTestId, getByText } = render(
      <ActivityHarness
        initialFilter="automations"
        sourceItems={[]}
        onOpenAdvanced={onOpenAdvanced}
        onOpenAutomations={onOpenAutomations}
      />,
    );

    expect(getByText('No reminders or automations')).toBeTruthy();
    fireEvent.press(getByTestId('activity-empty-action-automations'));
    expect(onOpenAutomations).toHaveBeenCalledTimes(1);

    const advanced = getByTestId('activity-open-advanced-work');
    expect(StyleSheet.flatten(advanced.props.style).minHeight).toBe(56);
    fireEvent.press(advanced);
    expect(onOpenAdvanced).toHaveBeenCalledTimes(1);
  });
});
