import { mockChatScreenState } from './state';

export const mockPersonas = [
  {
    id: 'default',
    name: 'Assistant',
    description: 'General-purpose helpful AI assistant',
    systemPrompt: 'default prompt',
  },
  {
    id: 'coder',
    name: 'Coder',
    description: 'Programming and software development expert',
    systemPrompt: 'coder prompt',
  },
];

// Mock navigation
export const mockOpenDrawer = jest.fn();
export const mockNavigate = jest.fn();
export const mockGoBack = jest.fn();
export const mockCloseDrawer = jest.fn();
const mockNavigation = {
  openDrawer: mockOpenDrawer,
  navigate: mockNavigate,
  goBack: mockGoBack,
  closeDrawer: mockCloseDrawer,
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useIsFocused: () => true,
  useRoute: () => ({ params: {} }),
}));

// Mock safe area
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...props }: any) => {
    const React = require('react');
    const { View } = require('react-native');
    return React.createElement(View, props, children);
  },
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../../src/components/chat/MessageBubble', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');

  const getResponseSegmentSnapshots = (responseSegments?: any[]) =>
    (responseSegments ?? []).map((segment) => segment?.subAgentEvent?.snapshot).filter(Boolean);

  const humanizeToolName = (value?: string) => {
    if (!value) {
      return '';
    }

    return value
      .split('_')
      .filter(Boolean)
      .map((segment: string) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  };

  const pushText = (nodes: any[], seen: Set<string>, value: unknown, keyPrefix: string) => {
    if (typeof value !== 'string') {
      return;
    }

    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    nodes.push(React.createElement(Text, { key: `${keyPrefix}-${nodes.length}` }, normalized));
  };

  const MessageBubble = ({
    message,
    agentRun,
    isStreaming,
    responseSegments,
    onEdit,
    onRetry,
    onShareWorkspaceFile,
    onOpenSubAgentDetails,
  }: any) => {
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    const nodes: any[] = [];
    const seen = new Set<string>();
    const responseSegmentSnapshots = getResponseSegmentSnapshots(responseSegments);
    const baseSnapshot =
      responseSegmentSnapshots[responseSegmentSnapshots.length - 1] ||
      message?.subAgentEvent?.snapshot;
    const liveSnapshot = baseSnapshot?.sessionId
      ? mockChatScreenState.activeSubAgents.find(
          (candidate: any) => candidate?.sessionId === baseSnapshot.sessionId,
        )
      : undefined;
    const snapshot = liveSnapshot || baseSnapshot;
    const shareableAttachment = Array.isArray(message?.attachments)
      ? message.attachments.find(
          (attachment: any) =>
            typeof attachment?.workspacePath === 'string' && attachment.workspacePath.length > 0,
        )
      : undefined;

    if (isStreaming) {
      nodes.push(
        React.createElement(
          View,
          {
            key: 'streaming',
            testID: 'message-bubble-streaming',
            accessibilityLabel: 'Assistant is typing',
          },
          React.createElement(Text, null, 'Working on it'),
        ),
      );
    }

    pushText(nodes, seen, message?.content, 'message');

    for (const segment of responseSegments ?? []) {
      pushText(nodes, seen, segment?.text, 'segment-text');
      pushText(nodes, seen, segment?.content, 'segment-content');
      pushText(nodes, seen, segment?.reasoning, 'segment-reasoning');
      pushText(nodes, seen, segment?.subAgentEvent?.snapshot?.name, 'segment-sub-agent-name');
      pushText(
        nodes,
        seen,
        segment?.subAgentEvent?.snapshot?.currentActivity,
        'segment-sub-agent-activity',
      );
      pushText(
        nodes,
        seen,
        segment?.subAgentEvent?.snapshot?.activeToolName,
        'segment-sub-agent-tool',
      );
    }

    for (const toolCall of message?.toolCalls ?? []) {
      pushText(nodes, seen, humanizeToolName(toolCall?.name), 'tool-human');
    }

    pushText(nodes, seen, snapshot?.name, 'snapshot-name');
    pushText(nodes, seen, snapshot?.currentActivity, 'snapshot-activity');
    pushText(nodes, seen, snapshot?.activeToolName, 'snapshot-tool');

    if (agentRun) {
      const goals = Array.isArray(agentRun?.controlGraph?.goals)
        ? agentRun.controlGraph.goals
        : [];
      const activeGoals = goals.filter((goal: any) => goal?.status === 'active');
      const compactPreview =
        activeGoals[0]?.title ?? (goals.length > 0 ? goals[0]?.title : undefined);

      nodes.push(
        React.createElement(
          View,
          { key: 'goals', testID: 'agent-goals-widget' },
          goals.length === 0 && agentRun.status === 'running'
            ? React.createElement(Text, null, 'Goals pending bootstrap')
            : null,
          goals.length > 0
            ? React.createElement(Text, null, `Goals (${goals.length})`)
            : null,
          !detailsOpen && compactPreview
            ? React.createElement(Text, null, compactPreview)
            : null,
          goals.length > 0
            ? React.createElement(
                TouchableOpacity,
                {
                  testID: 'agent-goals-toggle',
                  onPress: () => setDetailsOpen((open: boolean) => !open),
                },
                React.createElement(Text, null, 'Toggle goals'),
              )
            : null,
          detailsOpen && goals.length > 0
            ? React.createElement(
                View,
                { testID: 'agent-goals-details' },
                ...goals.map((goal: any) =>
                  React.createElement(
                    View,
                    { key: goal.id, testID: `agent-goals-item-${goal.id}` },
                    React.createElement(Text, null, goal.title),
                  ),
                ),
              )
            : null,
        ),
      );
    }

    if (message?.role === 'assistant' && isStreaming && nodes.length === 0) {
      nodes.push(
        React.createElement(View, {
          key: 'typing-indicator',
          accessibilityLabel: 'Assistant is typing',
        }),
      );
    }

    if (snapshot) {
      nodes.push(
        React.createElement(
          TouchableOpacity,
          {
            key: 'sub-agent-open-details',
            testID: 'sub-agent-open-details',
            onPress: () => onOpenSubAgentDetails?.(snapshot),
          },
          React.createElement(Text, null, snapshot.name || 'Worker details'),
        ),
      );
    }

    if (onEdit && message?.role !== 'assistant' && message?.role !== 'tool') {
      nodes.push(
        React.createElement(
          TouchableOpacity,
          {
            key: 'edit',
            onPress: () => onEdit?.(message.id, message.content),
          },
          React.createElement(View, { testID: 'icon-Edit2' }),
        ),
      );
    }

    if (message?.role === 'assistant' && onRetry) {
      nodes.push(
        React.createElement(
          TouchableOpacity,
          {
            key: 'retry',
            onPress: () => onRetry(message.id),
          },
          React.createElement(View, { testID: 'icon-RotateCcw' }),
        ),
      );
    }

    if (shareableAttachment && onShareWorkspaceFile) {
      nodes.push(
        React.createElement(
          TouchableOpacity,
          {
            key: 'share-workspace-file',
            testID: 'message-bubble-share-workspace-file',
            onPress: () => onShareWorkspaceFile(shareableAttachment),
          },
          React.createElement(Text, null, 'Share workspace file'),
        ),
      );
    }

    return React.createElement(View, null, ...nodes);
  };

  return { MessageBubble };
});

export const mockAddMessage = jest.fn();
export const mockUpdateMessage = jest.fn();

// Mock ApprovalBanner to avoid needing full approval store
jest.mock('../../src/components/approval/ApprovalBanner', () => ({
  ApprovalBanner: () => null,
}));
